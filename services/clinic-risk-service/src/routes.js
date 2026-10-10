'use strict';

const express = require('express');
const { pool, withTransaction } = require('./db');
const score = require('./riskScore');
const logger = require('./lib/logger');
const { request } = require('./lib/resilientHttp');
const { requireInternalToken, internalHeaders } = require('./lib/internalAuth');

const router = express.Router();
router.use(requireInternalToken);

const ACTIVE = ['open', 'in_review', 'scheduled'];
const ADAPTER_URL = () => process.env.LEGACY_ADAPTER_URL || 'http://localhost:4004';

function toDto(r) {
  return {
    id: r.id,
    patient: { id: r.patient_id, name: r.patient_name, zipCode: r.zip_code, assignedClinic: r.assigned_clinic, conditions: r.conditions, mobilityRestricted: r.mobility_restricted },
    scores: { total: r.total_score, health: r.health_score, environment: r.environment_score, emr: r.emr_score },
    priority: r.priority,
    status: r.status,
    reasons: r.reasons,
    assignedTo: r.assigned_to,
    lastEventAt: r.last_event_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Creates or updates the patient's single active triage item.
 * @param {object} patient  {id, fullName, zipCode, assignedClinic, conditions, mobilityRestricted}
 * @param {{health?:number, environment?:number, emr?:number}} signal  the scores this event changes
 * @param {object} reason   appended to the item's reasons list
 */
async function upsertQueueItem(patient, signal, reason) {
  const attempt = () => withTransaction(async (client) => {
    const { rows: [existing] } = await client.query(
      `SELECT * FROM risk_queue WHERE patient_id = $1 AND status = ANY($2) FOR UPDATE`, [patient.id, ACTIVE],
    );
    const health = signal.health !== undefined ? signal.health : existing ? existing.health_score : 0;
    const environment = signal.environment !== undefined ? signal.environment : existing ? existing.environment_score : 0;
    const emr = signal.emr !== undefined ? signal.emr : existing ? existing.emr_score : 0;
    const conditions = patient.conditions || (existing && existing.conditions) || [];
    const mobilityRestricted = patient.mobilityRestricted !== undefined ? patient.mobilityRestricted : Boolean(existing && existing.mobility_restricted);
    const total = score.totalScore({ health, environment, emr, conditions, mobilityRestricted });
    const priority = score.priorityFor(total);

    if (existing) {
      const reasons = [reason, ...existing.reasons].slice(0, 20);
      const { rows: [row] } = await client.query(
        `UPDATE risk_queue SET health_score = $2, environment_score = $3, emr_score = $4, total_score = $5, priority = $6,
                reasons = $7, conditions = $8, mobility_restricted = $9, last_event_at = now(), updated_at = now(),
                status = CASE WHEN status = 'scheduled' AND $6 IN ('P1','P2') THEN 'open' ELSE status END
          WHERE id = $1 RETURNING *`,
        [existing.id, health, environment, emr, total, priority, JSON.stringify(reasons), conditions, mobilityRestricted],
      );
      return { item: row, created: false };
    }
    const { rows: [row] } = await client.query(
      `INSERT INTO risk_queue (patient_id, patient_name, zip_code, assigned_clinic, conditions, mobility_restricted,
                               health_score, environment_score, emr_score, total_score, priority, reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [patient.id, patient.fullName || patient.id, patient.zipCode || null, patient.assignedClinic || null, conditions, mobilityRestricted,
        health, environment, emr, total, priority, JSON.stringify([reason])],
    );
    return { item: row, created: true };
  });

  try {
    return await attempt();
  } catch (err) {
    if (err.code === '23505') return attempt(); // concurrent insert for same patient -> retry as update
    throw err;
  }
}

/* ---------------------------- GET /api/clinic/queue -------------------------- */
router.get('/api/clinic/queue', async (req, res, next) => {
  try {
    const statuses = String(req.query.status || 'open,in_review,scheduled').split(',').filter((s) => score.VALID_TRANSITIONS[s]);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const params = [statuses.length ? statuses : ACTIVE, limit];
    let clinicFilter = '';
    if (req.query.clinic) { params.push(req.query.clinic); clinicFilter = `AND assigned_clinic = $${params.length}`; }
    if (req.query.priority) { params.push(String(req.query.priority).split(',')); clinicFilter += ` AND priority = ANY($${params.length})`; }

    const [{ rows }, { rows: counts }] = await Promise.all([
      pool.query(`SELECT * FROM risk_queue WHERE status = ANY($1) ${clinicFilter} ORDER BY total_score DESC, last_event_at DESC LIMIT $2`, params),
      pool.query(`SELECT priority, count(*)::int AS n FROM risk_queue WHERE status = ANY($1) GROUP BY priority`, [ACTIVE]),
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      summary: { P1: 0, P2: 0, P3: 0, P4: 0, ...Object.fromEntries(counts.map((c) => [c.priority, c.n])) },
      items: rows.map(toDto),
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------ PATCH /api/clinic/queue/:itemId -------------------- */
router.patch('/api/clinic/queue/:itemId', async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'clinic_staff') return res.status(403).json({ error: 'forbidden' });
    if (!/^[0-9a-f-]{36}$/i.test(req.params.itemId)) return res.status(400).json({ error: 'bad_request', message: 'Invalid item id' });
    const { status, notes, assignedTo } = req.body || {};
    if (status === undefined && notes === undefined && assignedTo === undefined) {
      return res.status(422).json({ error: 'validation_failed', details: ['Provide status, notes and/or assignedTo'] });
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
      return res.status(422).json({ error: 'validation_failed', details: ['notes must be a string up to 2000 characters'] });
    }

    const result = await withTransaction(async (client) => {
      const { rows: [item] } = await client.query('SELECT * FROM risk_queue WHERE id = $1 FOR UPDATE', [req.params.itemId]);
      if (!item) return { status: 404, body: { error: 'not_found' } };
      if (status !== undefined && status !== item.status && !score.VALID_TRANSITIONS[item.status].includes(status)) {
        return { status: 409, body: { error: 'invalid_transition', message: `Cannot move from ${item.status} to ${status}` } };
      }
      const { rows: [updated] } = await client.query(
        `UPDATE risk_queue SET status = coalesce($2, status), assigned_to = coalesce($3, assigned_to), updated_at = now() WHERE id = $1 RETURNING *`,
        [item.id, status || null, assignedTo || null],
      );
      await client.query(
        `INSERT INTO followup_actions (queue_item_id, action, from_status, to_status, notes, performed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [item.id, status && status !== item.status ? 'status_change' : 'note', item.status, updated.status, notes || null, req.user.id],
      );
      const { rows: actions } = await client.query('SELECT * FROM followup_actions WHERE queue_item_id = $1 ORDER BY created_at DESC LIMIT 20', [item.id]);
      return { status: 200, body: { item: toDto(updated), followUps: actions } };
    });
    logger.info('triage item updated', { itemId: req.params.itemId, by: req.user.id, status });
    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

/* ----------------- GET /api/clinic/patients/:id/emr-history ------------------ */
// Pulls legacy EMR history through the SOAP adapter and folds it into the risk score.
router.get('/api/clinic/patients/:id/emr-history', async (req, res, next) => {
  try {
    const patientId = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(patientId)) return res.status(400).json({ error: 'bad_request' });
    let history;
    try {
      const r = await request('legacy-adapter', {
        method: 'GET', url: `${ADAPTER_URL()}/legacy/patients/${encodeURIComponent(patientId)}/history`, headers: internalHeaders(req.get('x-request-id')),
      }, { retries: 1, timeoutMs: 8000 });
      history = r.data;
    } catch (err) {
      if (err.response && err.response.status === 404) return res.status(404).json({ error: 'not_found', message: 'No legacy EMR record for this patient' });
      logger.warn('legacy EMR unavailable', { patientId, error: err.message });
      return res.status(503).json({ error: 'legacy_emr_unavailable', message: 'Legacy clinic EMR is temporarily unavailable' });
    }

    const emr = score.emrScore(history);
    const { rows: [active] } = await pool.query('SELECT * FROM risk_queue WHERE patient_id = $1 AND status = ANY($2)', [patientId, ACTIVE]);
    let item = active || null;
    // Only touch the queue when the EMR contribution actually changes; simply viewing the
    // history must not add a new reason line every time a nurse opens the patient.
    if (active && active.emr_score !== emr) {
      ({ item } = await upsertQueueItem({ id: patientId }, { emr }, {
        type: 'emr_enrichment',
        at: new Date().toISOString(),
        detail: `Legacy EMR history added ${emr} risk point${emr === 1 ? '' : 's'} (recent admissions and chronic diagnoses)`,
      }));
    }
    return res.json({ history, emrScore: emr, queueItem: item ? toDto(item) : null });
  } catch (err) {
    return next(err);
  }
});

/* --------------------------- POST /internal/events --------------------------- */
router.post('/internal/events', async (req, res, next) => {
  const evt = req.body || {};
  if (!evt.eventId || !evt.type || !evt.patient || !evt.patient.id) {
    return res.status(400).json({ error: 'bad_request', message: 'eventId, type and patient.id are required' });
  }
  try {
    const ins = await pool.query('INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [evt.eventId]);
    if (!ins.rowCount) return res.status(200).json({ duplicate: true });

    let signal;
    let reason;
    switch (evt.type) {
      case 'checkin.anomaly_detected':
      case 'checkin.missed':
        signal = { health: Number(evt.severityScore) || 0 };
        reason = {
          type: evt.type === 'checkin.missed' ? 'missed_checkin' : 'health_anomaly',
          at: evt.occurredAt,
          severity: evt.severity,
          detail: (evt.anomalies || []).map((a) => (a.value !== undefined ? `${a.message} (${a.value})` : a.message)).join('; '),
          checkinId: evt.checkin ? evt.checkin.id : undefined,
        };
        break;
      case 'weather.risk_detected':
        signal = { environment: score.environmentScore(evt.environment) };
        reason = {
          type: 'environmental_risk',
          at: evt.occurredAt,
          hazard: evt.environment.hazard,
          detail: evt.environment.hazard === 'heat'
            ? `Heat index ${evt.environment.heatIndexC} °C in their area (${String(evt.environment.level || '').replace(/_/g, ' ')} level). A preventive check is recommended.`
            : `Severe weather in their area: ${(evt.environment.reasons || []).join('; ')}. Patient has limited mobility, so check evacuation plans.`,
        };
        break;
      default:
        await pool.query('DELETE FROM processed_events WHERE event_id = $1', [evt.eventId]);
        return res.status(202).json({ ignored: true });
    }

    try {
      const { item, created } = await upsertQueueItem(evt.patient, signal, reason);
      logger.info(created ? 'triage item created' : 'triage item updated', { itemId: item.id, patientId: item.patient_id, total: item.total_score, priority: item.priority, eventType: evt.type });
      return res.status(created ? 201 : 200).json({ item: toDto(item), created });
    } catch (err) {
      await pool.query('DELETE FROM processed_events WHERE event_id = $1', [evt.eventId]).catch(() => {});
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.upsertQueueItem = upsertQueueItem;
