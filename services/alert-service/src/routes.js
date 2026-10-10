'use strict';

const express = require('express');
const { pool } = require('./db');
const { dispatchAlert, SEVERITY_RANK } = require('./notifier');
const mashup = require('./weatherAlertMashup');
const { validateWebhook } = require('./twilioClient');
const logger = require('./lib/logger');
const { requireInternalToken, internalHeaders } = require('./lib/internalAuth');
const { request } = require('./lib/resilientHttp');
const { parseSmsCheckin, HELP_TEXT: SMS_HELP_TEXT } = require('./smsCheckinParser');

const router = express.Router();
router.use(requireInternalToken);

const SEVERITIES = Object.keys(SEVERITY_RANK);
const CHANNELS = ['sms', 'in_app'];

/* ------------------------- POST /api/alerts/dispatch ------------------------- */
// Manual / programmatic alert dispatch (clinic staff, admin). RBAC already enforced at the gateway.
router.post('/api/alerts/dispatch', async (req, res, next) => {
  try {
    if (!req.user || !['clinic_staff', 'system_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden', message: 'Only clinic staff or administrators can dispatch alerts' });
    }
    const b = req.body || {};
    const errors = [];
    if (typeof b.patientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.patientId)) errors.push('patientId is required');
    if (typeof b.message !== 'string' || b.message.trim().length < 5 || b.message.length > 480) errors.push('message must be 5-480 characters');
    if (b.severity !== undefined && !SEVERITIES.includes(b.severity)) errors.push(`severity must be one of: ${SEVERITIES.join(', ')}`);
    if (b.channels !== undefined && (!Array.isArray(b.channels) || !b.channels.length || b.channels.some((c) => !CHANNELS.includes(c)))) {
      errors.push(`channels must be a non-empty subset of: ${CHANNELS.join(', ')}`);
    }
    if (b.title !== undefined && (typeof b.title !== 'string' || b.title.length > 120)) errors.push('title must be at most 120 characters');
    if (errors.length) return res.status(422).json({ error: 'validation_failed', details: errors });

    const result = await dispatchAlert({
      patientId: b.patientId,
      source: 'manual',
      ruleCode: 'MANUAL',
      severity: b.severity || 'moderate',
      title: b.title || 'Message from your health center',
      message: b.message.trim(),
      channels: b.channels,
      metadata: { requestedBy: req.user.id, reason: b.reason || null },
      createdBy: req.user.id,
    });
    return res.status(202).json(result);
  } catch (err) {
    return next(err);
  }
});

/* ---------------------- GET /api/alerts/notifications ------------------------ */
// Family Dashboard / Caregiver App in-app feed, limited to the caller's patients.
router.get('/api/alerts/notifications', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    let patients = req.user ? req.user.patients : [];
    if (req.query.patientId) {
      if (!patients.includes(req.query.patientId)) return res.status(403).json({ error: 'forbidden', message: 'Not your patient' });
      patients = [req.query.patientId];
    }
    if (!patients.length) return res.json({ notifications: [] });
    const { rows } = await pool.query(
      `SELECT a.id, a.patient_id, a.source, a.rule_code, a.severity, a.title, a.message, a.metadata, a.created_at,
              coalesce(json_agg(json_build_object('channel', n.channel, 'status', n.status)) FILTER (WHERE n.id IS NOT NULL), '[]') AS delivery
         FROM alerts a LEFT JOIN notification_log n ON n.alert_id = a.id
        WHERE a.patient_id = ANY($1)
        GROUP BY a.id ORDER BY a.created_at DESC LIMIT $2`,
      [patients, limit],
    );
    return res.json({
      notifications: rows.map((r) => ({
        id: r.id, patientId: r.patient_id, source: r.source, rule: r.rule_code, severity: r.severity,
        title: r.title, message: r.message, metadata: r.metadata, createdAt: r.created_at, delivery: r.delivery,
      })),
    });
  } catch (err) {
    return next(err);
  }
});

/* --------------------- POST /api/alerts/weather-check ------------------------ */
// Lets clinic staff / admins run the weather mashup on demand (e.g. during a demo or typhoon).
router.post('/api/alerts/weather-check', async (req, res, next) => {
  try {
    const { zipCode, countryCode } = req.body || {};
    if (!process.env.OPENWEATHER_API_KEY) {
      return res.status(503).json({ error: 'not_configured', message: 'OPENWEATHER_API_KEY is not set in the alert service .env' });
    }
    if (zipCode !== undefined && !/^[A-Za-z0-9 -]{3,10}$/.test(String(zipCode))) {
      return res.status(422).json({ error: 'validation_failed', details: ['zipCode is invalid'] });
    }
    const results = zipCode
      ? [await mashup.runMashupForZip({ zipCode: String(zipCode), countryCode: countryCode || 'PH' })]
      : await mashup.runMashupForAllLocations();
    const ok = results.filter((r) => !r.error);
    const hottest = ok.reduce((a, r) => (typeof r.heatIndexC === 'number' && (!a || r.heatIndexC > a.heatIndexC) ? r : a), null);
    const actions = ok.flatMap((r) => r.actions || []);
    const summary = {
      areasChecked: results.length,
      areasFailed: results.length - ok.length,
      hottest: hottest ? { zipCode: hottest.zipCode, locationName: hottest.locationName, heatIndexC: hottest.heatIndexC } : null,
      heatAreas: ok.filter((r) => r.heat && r.heat.triggered).map((r) => r.zipCode),
      stormAreas: ok.filter((r) => r.storm && r.storm.triggered).map((r) => r.zipCode),
      patientsWarned: actions.filter((a) => a.sms && !a.sms.suppressed).length,
      alreadyWarned: actions.filter((a) => a.sms && a.sms.suppressed).length,
      triageItemsCreated: actions.filter((a) => a.clinic && a.clinic.created).length,
      usedCachedData: ok.some((r) => r.cache === 'stale'),
    };
    return res.json({ ranAt: new Date().toISOString(), summary, results });
  } catch (err) {
    if (err.message && err.message.includes('OPENWEATHER_API_KEY')) return res.status(503).json({ error: 'not_configured', message: err.message });
    return next(err);
  }
});

/* ------------------------- POST /internal/events ----------------------------- */
// Consumes saga events from the check-in service outbox. Idempotent on eventId.
function anomalyMessage(evt) {
  const name = evt.patient.fullName;
  const top = (evt.anomalies || []).slice(0, 2).map((a) => (a.value !== undefined ? `${a.message} (${a.value})` : a.message)).join('; ');
  if (evt.type === 'checkin.missed') return `No check-in for ${name} in over a day. Please contact the caregiver to confirm they are safe.`;
  return `ALERT for ${name}: ${top}. Logged in today's check-in; the health center has been notified.`;
}

router.post('/internal/events', async (req, res, next) => {
  const evt = req.body || {};
  if (!evt.eventId || !evt.type || !evt.patient || !evt.patient.id) {
    return res.status(400).json({ error: 'bad_request', message: 'eventId, type and patient.id are required' });
  }
  if (!['checkin.anomaly_detected', 'checkin.missed'].includes(evt.type)) return res.status(202).json({ ignored: true });

  try {
    const ins = await pool.query('INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [evt.eventId]);
    if (!ins.rowCount) return res.status(200).json({ duplicate: true });

    try {
      const result = await dispatchAlert({
        patientId: evt.patient.id,
        source: evt.type === 'checkin.missed' ? 'missed_checkin' : 'anomaly',
        ruleCode: evt.type === 'checkin.missed' ? 'MISSED_CHECKIN' : 'HEALTH_ANOMALY',
        severity: evt.severity || 'moderate',
        title: evt.type === 'checkin.missed' ? 'Missed daily check-in' : `${String(evt.severity).charAt(0).toUpperCase()}${String(evt.severity).slice(1)} health alert`,
        message: anomalyMessage(evt),
        metadata: { eventId: evt.eventId, checkinId: evt.checkin && evt.checkin.id, anomalies: evt.anomalies, severityScore: evt.severityScore },
      });
      return res.status(202).json(result);
    } catch (err) {
      // Release the idempotency key so the outbox retry can re-process this event.
      await pool.query('DELETE FROM processed_events WHERE event_id = $1', [evt.eventId]).catch(() => {});
      throw err;
    }
  } catch (err) {
    return next(err);
  }
});

/* -------------------- POST /webhooks/twilio/status --------------------------- */
// Twilio delivery-status callbacks (routed through the gateway's public /webhooks path).
router.post('/webhooks/twilio/status', async (req, res, next) => {
  try {
    if (process.env.TWILIO_VALIDATE_WEBHOOK !== 'false') {
      const ok = validateWebhook(req.get('x-twilio-signature'), process.env.TWILIO_STATUS_CALLBACK_URL, req.body);
      if (!ok) return res.status(403).json({ error: 'forbidden', message: 'Invalid Twilio signature' });
    }
    const { MessageSid, MessageStatus, ErrorCode } = req.body || {};
    if (MessageSid && MessageStatus) {
      await pool.query(
        'UPDATE notification_log SET status = $2, error = coalesce($3, error), updated_at = now() WHERE provider_sid = $1',
        [MessageSid, MessageStatus, ErrorCode ? `Twilio error ${ErrorCode}` : null],
      );
      logger.info('twilio status update', { sid: MessageSid, status: MessageStatus });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

/* -------------------- POST /webhooks/twilio/inbound -------------------------- */
// SMS check-in fallback (Section 20, Risk 3): a registered caregiver texts vitals to the Twilio
// number; we match the phone to the caregiver, parse the text, create the check-in through the
// check-in service, and reply with TwiML. Configure this URL as the number's "A message comes in" webhook.
function twiml(message) {
  const esc = String(message).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}

router.post('/webhooks/twilio/inbound', async (req, res, next) => {
  try {
    if (process.env.TWILIO_VALIDATE_WEBHOOK !== 'false') {
      const ok = validateWebhook(req.get('x-twilio-signature'), process.env.TWILIO_INBOUND_WEBHOOK_URL, req.body);
      if (!ok) return res.status(403).json({ error: 'forbidden', message: 'Invalid Twilio signature' });
    }
    res.type('text/xml');
    const { From, Body, MessageSid } = req.body || {};
    const { rows: links } = await pool.query(
      `SELECT user_id, patient_id FROM subscribers WHERE phone_e164 = $1 AND relation = 'caregiver' AND user_id IS NOT NULL`, [From],
    );
    if (!links.length) return res.send(twiml('This number is not registered as an ElderCare caregiver. Please contact your health center.'));

    const caregiverId = links[0].user_id;
    const allowedPatients = [...new Set(links.filter((l) => l.user_id === caregiverId).map((l) => l.patient_id))];
    const parsed = parseSmsCheckin(Body, allowedPatients);
    if (parsed.help) return res.send(twiml(SMS_HELP_TEXT));
    if (!parsed.ok) return res.send(twiml(`Not saved: ${parsed.errors.join('; ')}. Reply HELP for the format.`));

    if (MessageSid && /^[A-Za-z0-9]{8,64}$/.test(MessageSid)) parsed.checkin.idempotencyKey = `sms-${MessageSid}`;
    const r = await request('checkin-service', {
      method: 'POST',
      url: `${process.env.CHECKIN_SERVICE_URL || 'http://localhost:4001'}/internal/checkins`,
      data: { caregiverId, allowedPatients, checkin: parsed.checkin },
      headers: internalHeaders(req.get('x-request-id')),
      validateStatus: () => true,
    }, { retries: 0, timeoutMs: 5000 });

    logger.info('sms check-in', { caregiverId, patientId: parsed.checkin.patientId, status: r.status });
    if (r.status === 201 || r.status === 200) {
      const c = r.data.checkin;
      const summary = c.severity === 'none' ? 'All readings normal.' : `${c.severity.toUpperCase()}: ${c.anomalies.map((a) => a.message).join('; ')}. Family and health center notified.`;
      return res.send(twiml(`Saved check-in for ${c.patientId}. ${summary}`));
    }
    const why = (r.data && (r.data.details ? r.data.details.join('; ') : r.data.message)) || 'please try again later';
    return res.send(twiml(`Not saved: ${why}`));
  } catch (err) {
    logger.error('sms check-in failed', err);
    if (!res.headersSent) return res.type('text/xml').send(twiml('Sorry, the check-in could not be saved right now. Please try again.'));
    return next(err);
  }
});

module.exports = router;
