'use strict';

const express = require('express');
const { pool, withTransaction } = require('./db');
const { validateCheckin } = require('./validation');
const { detectAnomalies } = require('./anomaly');
const outbox = require('./outbox');
const logger = require('./lib/logger');
const { requireInternalToken } = require('./lib/internalAuth');

const router = express.Router();
router.use(requireInternalToken);

const PATIENT_SCOPED = ['caregiver', 'family_member'];

function toPatientDto(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    birthDate: r.birth_date,
    zipCode: r.zip_code,
    countryCode: r.country_code,
    coordinates: r.latitude !== null ? { lat: Number(r.latitude), lon: Number(r.longitude) } : null,
    conditions: r.conditions,
    mobilityRestricted: r.mobility_restricted,
    baseline: r.baseline,
    assignedClinic: r.assigned_clinic,
  };
}

function toCheckinDto(r) {
  return {
    id: r.id,
    patientId: r.patient_id,
    caregiverId: r.caregiver_id,
    recordedAt: r.recorded_at,
    vitals: {
      systolic: r.systolic, diastolic: r.diastolic, heartRate: r.heart_rate,
      temperatureC: r.temperature_c === null ? null : Number(r.temperature_c), spo2: r.spo2, bloodGlucose: r.blood_glucose,
    },
    medication: { taken: r.medication_taken, missed: r.missed_medications },
    mobilityStatus: r.mobility_status,
    mood: r.mood,
    notes: r.notes,
    anomalies: r.anomalies,
    severity: r.severity,
    severityScore: r.severity_score,
    createdAt: r.created_at,
  };
}

/** Defense in depth: re-check the gateway's patient scoping. */
function assertPatientScope(req, res, patientId) {
  if (req.user && PATIENT_SCOPED.includes(req.user.role) && !req.user.patients.includes(patientId)) {
    res.status(403).json({ error: 'forbidden', message: 'You are not assigned to this patient' });
    return false;
  }
  return true;
}

/**
 * Validates, scores and stores one check-in, and enqueues the saga event when anomalous.
 * Shared by the app/web route and the SMS check-in fallback.
 * @param {string} caregiverId
 * @param {string[]|null} allowedPatients  caregiver's assigned patients (null = already verified upstream)
 * @returns {Promise<{status:number, body:object}>}
 */
async function createCheckin(caregiverId, allowedPatients, input, requestId) {
  const result = validateCheckin(input);
  if (!result.ok) return { status: 422, body: { error: 'validation_failed', details: result.errors } };
  const c = result.value;
  if (allowedPatients && !allowedPatients.includes(c.patientId)) {
    return { status: 403, body: { error: 'forbidden', message: 'You are not assigned to this patient' } };
  }

  // Offline-sync replay: return the already-stored check-in instead of duplicating it.
  if (c.idempotencyKey) {
    const dup = await pool.query('SELECT * FROM checkins WHERE caregiver_id = $1 AND idempotency_key = $2', [caregiverId, c.idempotencyKey]);
    if (dup.rows.length) return { status: 200, body: { checkin: toCheckinDto(dup.rows[0]), duplicate: true } };
  }

  const { rows: pr } = await pool.query('SELECT * FROM patients WHERE id = $1', [c.patientId]);
  if (!pr.length) return { status: 404, body: { error: 'not_found', message: 'Patient not found' } };
  const patient = toPatientDto(pr[0]);

  const detection = detectAnomalies(c, patient.baseline);

  const saved = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO checkins (patient_id, caregiver_id, idempotency_key, recorded_at, systolic, diastolic, heart_rate,
                             temperature_c, spo2, blood_glucose, medication_taken, missed_medications, mobility_status,
                             mood, notes, anomalies, severity, severity_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [c.patientId, caregiverId, c.idempotencyKey, c.recordedAt, c.vitals.systolic, c.vitals.diastolic, c.vitals.heartRate,
        c.vitals.temperatureC, c.vitals.spo2, c.vitals.bloodGlucose, c.medication.taken, c.medication.missed, c.mobilityStatus,
        c.mood, c.notes, JSON.stringify(detection.anomalies), detection.severity, detection.severityScore],
    );
    const checkin = toCheckinDto(rows[0]);
    let event = null;
    if (detection.anomalies.length) {
      event = await outbox.enqueueEvent(client, 'checkin.anomaly_detected', {
        patient: { id: patient.id, fullName: patient.fullName, zipCode: patient.zipCode, conditions: patient.conditions, mobilityRestricted: patient.mobilityRestricted, assignedClinic: patient.assignedClinic },
        checkin: { id: checkin.id, recordedAt: checkin.recordedAt, vitals: checkin.vitals, caregiverId: checkin.caregiverId },
        anomalies: detection.anomalies,
        severity: detection.severity,
        severityScore: detection.severityScore,
      });
    }
    return { checkin, event };
  });

  // Kick the dispatcher now instead of waiting for the next poll (keeps end-to-end < 2 s).
  if (saved.event) setImmediate(() => outbox.flush().catch((e) => logger.error('outbox flush', e)));

  logger.info('checkin stored', { requestId, checkinId: saved.checkin.id, patientId: c.patientId, severity: detection.severity });
  return { status: 201, body: { checkin: saved.checkin, eventId: saved.event ? saved.event.eventId : null } };
}

/* ---------------------------- POST /api/checkins ---------------------------- */
router.post('/api/checkins', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'caregiver') {
      return res.status(403).json({ error: 'forbidden', message: 'Only caregivers can submit check-ins' });
    }
    const r = await createCheckin(req.user.id, req.user.patients, req.body, req.get('x-request-id'));
    return res.status(r.status).json(r.body);
  } catch (err) {
    return next(err);
  }
});

/* ------------------------- POST /internal/checkins -------------------------- */
// SMS check-in fallback (Risk 3): the alert service has already matched the sender's phone
// number to a registered caregiver and the patients they care for.
router.post('/internal/checkins', async (req, res, next) => {
  try {
    const { caregiverId, allowedPatients, checkin } = req.body || {};
    if (!caregiverId || !Array.isArray(allowedPatients) || !allowedPatients.length || !checkin) {
      return res.status(400).json({ error: 'bad_request', message: 'caregiverId, allowedPatients[] and checkin are required' });
    }
    const r = await createCheckin(String(caregiverId), allowedPatients.map(String), checkin, req.get('x-request-id'));
    return res.status(r.status).json(r.body);
  } catch (err) {
    return next(err);
  }
});

/* ---------------------- GET /api/patients/:id/history ----------------------- */
router.get('/api/patients/:id/history', async (req, res, next) => {
  try {
    const patientId = req.params.id;
    if (!assertPatientScope(req, res, patientId)) return undefined;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const { rows: pr } = await pool.query('SELECT * FROM patients WHERE id = $1', [patientId]);
    if (!pr.length) return res.status(404).json({ error: 'not_found', message: 'Patient not found' });

    const [{ rows: checkins }, { rows: [trend] }] = await Promise.all([
      pool.query(
        `SELECT * FROM checkins WHERE patient_id = $1 AND recorded_at >= now() - ($2 || ' days')::interval
          ORDER BY recorded_at DESC LIMIT $3`,
        [patientId, String(days), limit],
      ),
      pool.query(
        `SELECT count(*)::int AS total,
                round(avg(systolic))::int AS avg_systolic, max(systolic) AS max_systolic, min(systolic) AS min_systolic,
                round(avg(diastolic))::int AS avg_diastolic,
                round(avg(heart_rate))::int AS avg_heart_rate,
                round(avg(temperature_c), 1)::float AS avg_temperature_c, max(temperature_c)::float AS max_temperature_c,
                round(avg(spo2))::int AS avg_spo2, min(spo2) AS min_spo2,
                count(*) FILTER (WHERE medication_taken = false)::int AS missed_medication_days,
                count(*) FILTER (WHERE severity IN ('high','critical'))::int AS high_severity_checkins
           FROM checkins WHERE patient_id = $1 AND recorded_at >= now() - ($2 || ' days')::interval`,
        [patientId, String(days)],
      ),
    ]);

    const patient = toPatientDto(pr[0]);
    return res.json({
      patient,
      period: { days, from: new Date(Date.now() - days * 86400000).toISOString(), to: new Date().toISOString() },
      trends: {
        totalCheckins: trend.total,
        bloodPressure: { avgSystolic: trend.avg_systolic, avgDiastolic: trend.avg_diastolic, maxSystolic: trend.max_systolic, minSystolic: trend.min_systolic },
        heartRate: { avg: trend.avg_heart_rate },
        temperatureC: { avg: trend.avg_temperature_c, max: trend.max_temperature_c },
        spo2: { avg: trend.avg_spo2, min: trend.min_spo2 },
        missedMedicationDays: trend.missed_medication_days,
        highSeverityCheckins: trend.high_severity_checkins,
      },
      baseline: patient.baseline,
      checkins: checkins.map(toCheckinDto),
    });
  } catch (err) {
    return next(err);
  }
});

/* --------------------------- GET /api/patients/:id -------------------------- */
router.get('/api/patients/:id', async (req, res, next) => {
  try {
    if (!assertPatientScope(req, res, req.params.id)) return undefined;
    const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: 'Patient not found' });
    return res.json(toPatientDto(rows[0]));
  } catch (err) {
    return next(err);
  }
});

/* ---------------- Internal (service-to-service) read endpoints --------------- */

// Used by the weather mashup: list patient profiles, optionally filtered by zip code.
router.get('/internal/patients', async (req, res, next) => {
  try {
    const zips = String(req.query.zip || '').split(',').map((z) => z.trim()).filter(Boolean);
    const { rows } = zips.length
      ? await pool.query('SELECT * FROM patients WHERE zip_code = ANY($1) ORDER BY id', [zips])
      : await pool.query('SELECT * FROM patients ORDER BY id');
    res.json({ patients: rows.map(toPatientDto) });
  } catch (err) {
    next(err);
  }
});

router.get('/internal/patients/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    return res.json(toPatientDto(rows[0]));
  } catch (err) {
    return next(err);
  }
});

// Distinct monitored locations - the weather poller queries OpenWeatherMap once per zip.
router.get('/internal/locations', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT zip_code, country_code, avg(latitude)::float AS lat, avg(longitude)::float AS lon, count(*)::int AS patients
         FROM patients GROUP BY zip_code, country_code ORDER BY zip_code`,
    );
    res.json({ locations: rows.map((r) => ({ zipCode: r.zip_code, countryCode: r.country_code, lat: r.lat, lon: r.lon, patients: r.patients })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
