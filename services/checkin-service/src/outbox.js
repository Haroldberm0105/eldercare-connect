'use strict';

/**
 * Transactional-outbox dispatcher - the first step of the Check-in -> Alert -> Clinic Queue saga
 * (Section 15 - Transaction Coordination).
 *
 * Events are inserted in the same DB transaction as the check-in, so an event is never lost if
 * a downstream service is down. This dispatcher delivers them with exponential backoff; after
 * OUTBOX_MAX_ATTEMPTS a row is marked "failed" and logged for manual follow-up (never silently
 * dropped). Consumers de-duplicate on eventId, so at-least-once delivery is safe.
 */
const crypto = require('crypto');
const { pool } = require('./db');
const logger = require('./lib/logger');
const { request } = require('./lib/resilientHttp');
const { internalHeaders } = require('./lib/internalAuth');

const TARGETS = {
  alert: () => `${process.env.ALERT_SERVICE_URL || 'http://localhost:4002'}/internal/events`,
  clinic: () => `${process.env.CLINIC_SERVICE_URL || 'http://localhost:4003'}/internal/events`,
};
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 10);
const POLL_MS = Number(process.env.OUTBOX_POLL_MS || 2000);
const BATCH = 25;

/** Inserts one outbox row per target, using the caller's transaction client. */
async function enqueueEvent(client, eventType, payload, targets = Object.keys(TARGETS)) {
  const eventId = crypto.randomUUID();
  const event = { eventId, type: eventType, occurredAt: new Date().toISOString(), source: 'checkin-service', ...payload };
  for (const target of targets) {
    await client.query('INSERT INTO outbox_events (event_id, event_type, target, payload) VALUES ($1, $2, $3, $4)', [eventId, eventType, target, event]);
  }
  return event;
}

let running = false;
async function flush() {
  if (running) return; // single in-process dispatcher; SKIP LOCKED makes multiple replicas safe
  running = true;
  try {
    for (;;) {
      const client = await pool.connect();
      let rows;
      try {
        await client.query('BEGIN');
        ({ rows } = await client.query(
          `SELECT id, target, payload, attempts FROM outbox_events
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
          [BATCH],
        ));
        for (const row of rows) {
          try {
            await request(`outbox-${row.target}`, { method: 'POST', url: TARGETS[row.target](), data: row.payload, headers: internalHeaders(row.payload.eventId) }, { retries: 0, timeoutMs: 4000 });
            await client.query(`UPDATE outbox_events SET status = 'delivered', delivered_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
          } catch (err) {
            const attempts = row.attempts + 1;
            const failed = attempts >= MAX_ATTEMPTS;
            const backoffSec = Math.min(300, 2 ** attempts);
            await client.query(
              `UPDATE outbox_events SET attempts = $2, last_error = $3, status = $4,
                      next_attempt_at = now() + ($5 || ' seconds')::interval WHERE id = $1`,
              [row.id, attempts, String(err.message).slice(0, 500), failed ? 'failed' : 'pending', String(backoffSec)],
            );
            (failed ? logger.error : logger.warn)(failed ? 'outbox event FAILED - manual follow-up required' : 'outbox delivery failed, will retry', {
              eventId: row.payload.eventId, target: row.target, attempts, error: err.message,
            });
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('outbox flush error', err);
        rows = [];
      } finally {
        client.release();
      }
      if (rows.length < BATCH) break;
    }
  } finally {
    running = false;
  }
}

function start() {
  const timer = setInterval(() => flush().catch((e) => logger.error('outbox loop', e)), POLL_MS);
  timer.unref();
  return timer;
}

async function stats() {
  const { rows } = await pool.query(`SELECT status, count(*)::int AS count FROM outbox_events GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

module.exports = { enqueueEvent, flush, start, stats };
