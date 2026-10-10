'use strict';

/**
 * Creates an alert, records the in-app notification, and queues one SMS per subscriber.
 * Shared by: manual dispatch (POST /api/alerts/dispatch), anomaly events from the check-in
 * service, and the weather mashup.
 */
const { pool } = require('./db');
const smsQueue = require('./smsQueue');
const logger = require('./lib/logger');

const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 };

async function getRule(code) {
  const { rows } = await pool.query('SELECT * FROM alert_rules WHERE code = $1', [code]);
  return rows[0] || null;
}

/** Returns false if this dedupe key was already used (alert suppressed). */
async function claimDedupeKey(key) {
  if (!key) return true;
  const { rowCount } = await pool.query('INSERT INTO alert_dedupe (dedupe_key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  return rowCount === 1;
}

/**
 * @param {object} a
 * @param {string} a.patientId
 * @param {string} a.source       anomaly | weather | manual | missed_checkin
 * @param {string} a.ruleCode     key into alert_rules
 * @param {string} a.severity     low | moderate | high | critical
 * @param {string} a.title
 * @param {string} a.message      SMS / in-app text
 * @param {string[]} [a.channels] override rule channels
 * @param {object} [a.metadata]
 * @param {string} [a.createdBy]
 * @param {string} [a.dedupeKey]  suppress duplicates (e.g. same hazard same day)
 */
async function dispatchAlert(a) {
  const rule = await getRule(a.ruleCode);
  if (rule && !rule.enabled) return { suppressed: true, reason: 'rule_disabled' };
  if (rule && a.source !== 'manual' && SEVERITY_RANK[a.severity] < SEVERITY_RANK[rule.min_severity]) {
    return { suppressed: true, reason: 'below_min_severity' };
  }
  if (!(await claimDedupeKey(a.dedupeKey))) return { suppressed: true, reason: 'duplicate' };

  const channels = a.channels || (rule ? rule.channels : ['sms', 'in_app']);

  const { rows: [alert] } = await pool.query(
    `INSERT INTO alerts (patient_id, source, rule_code, severity, title, message, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [a.patientId, a.source, a.ruleCode, a.severity, a.title, a.message, a.metadata || {}, a.createdBy || 'system'],
  );

  const notifications = [];
  // In-app notification = the alerts row itself; logged so delivery status is visible in one place.
  if (channels.includes('in_app')) {
    const { rows: [n] } = await pool.query(
      `INSERT INTO notification_log (alert_id, channel, status, attempts) VALUES ($1, 'in_app', 'delivered', 1) RETURNING id`,
      [alert.id],
    );
    notifications.push({ id: n.id, channel: 'in_app', status: 'delivered' });
  }

  if (channels.includes('sms')) {
    const { rows: subs } = await pool.query('SELECT * FROM subscribers WHERE patient_id = $1 AND sms_enabled = TRUE', [a.patientId]);
    for (const s of subs) {
      const { rows: [n] } = await pool.query(
        `INSERT INTO notification_log (alert_id, subscriber_id, channel, status) VALUES ($1, $2, 'sms', 'queued') RETURNING id`,
        [alert.id, s.id],
      );
      await smsQueue.enqueue({ notificationId: n.id, to: s.phone_e164, body: `[ElderCare Connect] ${a.message}` });
      notifications.push({ id: n.id, channel: 'sms', subscriberId: s.id, relation: s.relation, status: 'queued' });
    }
    if (!subs.length) logger.warn('no SMS subscribers for patient', { patientId: a.patientId, alertId: alert.id });
  }

  logger.info('alert dispatched', { alertId: alert.id, patientId: a.patientId, source: a.source, severity: a.severity, notifications: notifications.length });
  return { suppressed: false, alertId: alert.id, createdAt: alert.created_at, notifications };
}

module.exports = { dispatchAlert, SEVERITY_RANK };
