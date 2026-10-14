#!/usr/bin/env node
/**
 * Fake TextBee API for tests and demos without using your SMS quota (zero dependencies).
 *
 *   node testing/mocks/fake-textbee.js            (listens on :4998)
 *
 * Point the alert service at it:
 *   SMS_PROVIDER=textbee  TEXTBEE_API_KEY=test-key  TEXTBEE_DEVICE_ID=test-device
 *   TEXTBEE_BASE_URL=http://localhost:4998/api/v1  SMS_DRY_RUN=false  SMS_RECIPIENT_ALLOWLIST=+639171234567
 *
 * GET /__sent returns every message received, so tests can assert on them.
 * Set FAKE_TEXTBEE_FAIL=503 to simulate an outage (exercises the retry queue).
 */
'use strict';
const http = require('http');

const PORT = Number(process.env.PORT || 4998);
const KEY = process.env.FAKE_TEXTBEE_KEY || 'test-key';
const sent = [];

http.createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/__sent') return send(200, { count: sent.length, messages: sent });
  if (req.method === 'DELETE' && req.url === '/__sent') { sent.length = 0; return send(204, {}); }
  if (req.method !== 'POST' || req.url !== '/api/v1/gateway/send-sms') return send(404, { message: 'Not found' });
  if (req.headers['x-api-key'] !== KEY) return send(401, { message: 'Invalid API key' });
  if (process.env.FAKE_TEXTBEE_FAIL) return send(Number(process.env.FAKE_TEXTBEE_FAIL), { message: 'Simulated outage' });
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { message: 'Invalid JSON' }); }
    if (!Array.isArray(body.recipients) || !body.recipients.length || typeof body.message !== 'string') {
      return send(400, { message: 'recipients[] and message are required' });
    }
    const smsBatchId = `batch_${Date.now()}_${sent.length + 1}`;
    sent.push({ at: new Date().toISOString(), smsBatchId, contentType: req.headers['content-type'], ...body });
    console.log(`${new Date().toISOString()} SMS to ${body.recipients.join(',')} (device ${body.deviceId || 'default'}): ${body.message.slice(0, 80)}`);
    return send(200, { data: { success: true, message: 'SMS added to queue for processing', smsBatchId, recipientCount: body.recipients.length, successCount: body.recipients.length, failureCount: 0 } });
  });
  return undefined;
}).listen(PORT, () => console.log(`fake TextBee listening on :${PORT} (api key: ${KEY})`));
