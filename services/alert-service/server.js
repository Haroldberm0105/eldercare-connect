'use strict';

/**
 * Family Alert & Notification Service
 * Owns: alert rules, notification logs, family subscriber contacts (Section 9).
 * Integrates: Twilio Programmable Messaging (SMS), OpenWeatherMap (weather mashup).
 */
require('dotenv').config();
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'alert-service';

const express = require('express');
const helmet = require('helmet');
const logger = require('./src/lib/logger');
const { pool, migrate, waitForDb } = require('./src/db');
const smsQueue = require('./src/smsQueue');
const mashup = require('./src/weatherAlertMashup');
const { isDryRun } = require('./src/twilioClient');
const { breakerSnapshots } = require('./src/lib/resilientHttp');
const routes = require('./src/routes');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' })); // Twilio callbacks

app.get('/health', async (req, res) => {
  let db = 'up';
  try { await pool.query('SELECT 1'); } catch { db = 'down'; }
  const { rows } = db === 'up'
    ? await pool.query(`SELECT max(fetched_at) AS last_weather FROM weather_cache`)
    : { rows: [{}] };
  const body = {
    status: db === 'up' ? 'up' : 'degraded',
    service: 'alert-service',
    db,
    integrations: {
      twilio: isDryRunSafe() ? 'dry-run' : 'live',
      openWeatherMap: process.env.OPENWEATHER_API_KEY ? 'configured' : 'not-configured',
      lastWeatherFetch: rows[0] && rows[0].last_weather,
      smsQueue: process.env.REDIS_URL ? 'bullmq' : `in-memory (depth ${smsQueue.depth()})`,
    },
    circuitBreakers: breakerSnapshots(),
  };
  res.status(db === 'up' ? 200 : 503).json(body);
});

function isDryRunSafe() {
  try { return isDryRun(); } catch { return false; }
}

app.use(routes);
app.use((req, res) => res.status(404).json({ error: 'not_found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_request', message: 'Malformed JSON body' });
  logger.error('unhandled error', { requestId: req.get('x-request-id'), error: err.message, stack: err.stack });
  return res.status(500).json({ error: 'internal_error', requestId: req.get('x-request-id') });
});

async function main() {
  await waitForDb();
  await migrate();
  smsQueue.init();
  mashup.startScheduler();
  const port = Number(process.env.PORT || 4002);
  const server = app.listen(port, () => logger.info('alert-service listening', { port, smsDryRun: isDryRunSafe() }));
  const shutdown = () => server.close(async () => { await smsQueue.close(); await pool.end(); process.exit(0); });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch((err) => { logger.error('startup failed', err); process.exit(1); });
}

module.exports = app;
