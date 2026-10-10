'use strict';

/**
 * Missed check-in detector (Section 9: Family Alert triggers on "missed check-in").
 * Every MISSED_CHECKIN_SCAN_MINUTES it finds patients with no check-in in the last
 * MISSED_CHECKIN_HOURS and emits one `checkin.missed` event per patient per day.
 */
const { pool, withTransaction } = require('./db');
const outbox = require('./outbox');
const logger = require('./lib/logger');

const HOURS = Number(process.env.MISSED_CHECKIN_HOURS || 26);
const SCAN_MIN = Number(process.env.MISSED_CHECKIN_SCAN_MINUTES || 30);

async function scan() {
  const { rows } = await pool.query(
    `SELECT p.id, p.full_name, p.zip_code, p.conditions, p.mobility_restricted, p.assigned_clinic,
            max(c.recorded_at) AS last_checkin
       FROM patients p
       LEFT JOIN checkins c ON c.patient_id = p.id
      GROUP BY p.id
     HAVING max(c.recorded_at) IS NULL OR max(c.recorded_at) < now() - ($1 || ' hours')::interval`,
    [String(HOURS)],
  );
  let flagged = 0;
  for (const p of rows) {
    await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO missed_checkin_flags (patient_id, flag_date) VALUES ($1, current_date) ON CONFLICT DO NOTHING RETURNING patient_id`,
        [p.id],
      );
      if (!ins.rowCount) return;
      flagged += 1;
      await outbox.enqueueEvent(client, 'checkin.missed', {
        patient: { id: p.id, fullName: p.full_name, zipCode: p.zip_code, conditions: p.conditions, mobilityRestricted: p.mobility_restricted, assignedClinic: p.assigned_clinic },
        lastCheckinAt: p.last_checkin,
        anomalies: [{ code: 'MISSED_CHECKIN', level: 'moderate', message: `No check-in recorded in the last ${HOURS} hours` }],
        severity: 'moderate',
        severityScore: 40,
      });
    });
  }
  if (flagged) {
    logger.info('missed check-ins flagged', { count: flagged });
    await outbox.flush();
  }
}

function start() {
  if (process.env.MISSED_CHECKIN_ENABLED === 'false') return null;
  const timer = setInterval(() => scan().catch((e) => logger.error('missed-checkin scan failed', e)), SCAN_MIN * 60000);
  timer.unref();
  return timer;
}

module.exports = { scan, start };
