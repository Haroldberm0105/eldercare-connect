'use strict';

/**
 * SMS dispatch queue with retry-on-failure (Section 15 - Message Queues: Twilio Retry-On-Failure).
 *
 *   REDIS_URL set   -> BullMQ (durable, survives restarts, works across replicas)
 *   REDIS_URL unset -> in-process queue with the same retry/backoff semantics (dev / tests)
 *
 * Each job = one SMS to one recipient. On a transient Twilio failure the job is retried with
 * exponential backoff; a permanent failure (invalid number, opted out) stops immediately.
 * The in-app notification is always written before SMS is attempted, so it acts as the
 * fallback channel while SMS is retrying or after it ultimately fails.
 */
const { pool } = require('./db');
const { sendSms, mode } = require('./smsSender');
const logger = require('./lib/logger');

const QUEUE_NAME = 'sms-dispatch';
const MAX_ATTEMPTS = Number(process.env.SMS_MAX_ATTEMPTS || 5);
const BACKOFF_MS = Number(process.env.SMS_BACKOFF_MS || 5000);
const DAILY_LIMIT = () => Number(process.env.SMS_DAILY_LIMIT || 40);

/** Real (non-simulated) texts sent today, Asia/Manila calendar day. */
async function sentToday() {
  const { rows: [r] } = await pool.query(
    `SELECT count(*)::int AS n FROM notification_log
      WHERE channel = 'sms' AND status IN ('sent','delivered')
        AND updated_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila')`,
  );
  return r.n;
}

async function updateLog(id, fields) {
  const sets = [];
  const vals = [id];
  for (const [k, v] of Object.entries(fields)) {
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  await pool.query(`UPDATE notification_log SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
}

/** Processes one job. Throws to signal "retry". */
async function processJob(data, attempt) {
  try {
    if (mode().live && (await sentToday()) >= DAILY_LIMIT()) {
      await updateLog(data.notificationId, { status: 'skipped', attempts: attempt, note: `Daily SMS limit reached (${DAILY_LIMIT()}); in-app alert only` });
      logger.warn('sms skipped: daily limit reached', { notificationId: data.notificationId, limit: DAILY_LIMIT() });
      return;
    }
    const result = await sendSms({ to: data.to, body: data.body });
    await updateLog(data.notificationId, {
      status: result.simulated ? 'simulated' : 'sent', provider_sid: result.sid, provider: result.simulated ? 'simulated' : result.provider,
      attempts: attempt, error: null, note: result.note || (result.warning ? JSON.stringify(result.warning).slice(0, 300) : null),
    });
    logger.info('sms dispatched', { notificationId: data.notificationId, sid: result.sid, simulated: Boolean(result.simulated), attempt });
  } catch (err) {
    const final = err.permanent || attempt >= MAX_ATTEMPTS;
    await updateLog(data.notificationId, { status: final ? 'failed' : 'queued', attempts: attempt, error: String(err.message).slice(0, 500) });
    logger.warn(final ? 'sms permanently failed - in-app notification remains as fallback' : 'sms failed, will retry', {
      notificationId: data.notificationId, attempt, error: err.message,
    });
    if (!final) throw err;
  }
}

/* ------------------------------ BullMQ backend ------------------------------ */
let bull = null;
function initBull() {
  // eslint-disable-next-line global-require
  const { Queue, Worker } = require('bullmq');
  const u = new URL(process.env.REDIS_URL);
  const connection = {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
  const queue = new Queue(QUEUE_NAME, { connection });
  const worker = new Worker(QUEUE_NAME, (job) => processJob(job.data, job.attemptsMade + 1), {
    connection,
    concurrency: Number(process.env.SMS_CONCURRENCY || 5),
    // Twilio's default throughput for a long code is ~1 msg/sec; stay under it (Risk 5).
    limiter: { max: Number(process.env.SMS_RATE_PER_SEC || 1), duration: 1000 },
  });
  worker.on('error', (err) => logger.error('sms worker error', err));
  bull = { queue, worker };
  logger.info('sms queue backend: BullMQ/Redis');
}

/* ---------------------------- In-memory backend ----------------------------- */
const memQueue = [];
let memTimer = null;
function initMemory() {
  memTimer = setInterval(async () => {
    const now = Date.now();
    const due = memQueue.filter((j) => j.runAt <= now);
    for (const job of due) {
      memQueue.splice(memQueue.indexOf(job), 1);
      job.attempt += 1;
      try {
        await processJob(job.data, job.attempt);
      } catch {
        job.runAt = Date.now() + BACKOFF_MS * 2 ** (job.attempt - 1);
        memQueue.push(job);
      }
    }
  }, 500);
  memTimer.unref();
  logger.warn('sms queue backend: in-memory (set REDIS_URL for durable BullMQ queue)');
}

function init() {
  if (process.env.REDIS_URL) initBull();
  else initMemory();
}

async function enqueue(data) {
  if (bull) {
    await bull.queue.add('sms', data, {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      jobId: data.notificationId, // idempotent enqueue
    });
  } else {
    memQueue.push({ data, attempt: 0, runAt: Date.now() });
  }
}

async function close() {
  if (bull) await Promise.all([bull.worker.close(), bull.queue.close()]);
  if (memTimer) clearInterval(memTimer);
}

function depth() {
  return bull ? null : memQueue.length;
}

module.exports = { init, enqueue, close, depth, processJob };
