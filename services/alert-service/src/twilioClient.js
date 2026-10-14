'use strict';

/**
 * Thin wrapper around the Twilio Programmable Messaging API.
 *
 * Credentials come only from process.env (Section 12 - Secure Environment Variables):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER.
 *
 * SMS_DRY_RUN=true (or missing credentials outside production) logs instead of sending,
 * so the whole flow can be demoed and load-tested without spending SMS credit.
 */
const logger = require('./lib/logger');

let client = null;
function getClient() {
  if (!client) {
    // Lazy-require so the service still boots in dry-run mode without Twilio configured.
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

function isConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER));
}

function isDryRun() {
  if (process.env.SMS_DRY_RUN === 'true') return true;
  if (!isConfigured()) {
    if (process.env.NODE_ENV === 'production') throw new Error('Twilio credentials are not configured');
    return true;
  }
  return false;
}

/** Twilio error codes that will never succeed on retry (bad / unreachable / opted-out number). */
const PERMANENT_ERRORS = new Set([21211, 21214, 21408, 21610, 21612, 21614]);

/**
 * Sends one SMS.
 * @returns {Promise<{sid:string, status:string, simulated?:boolean}>}
 * @throws Error with `.permanent = true` when retrying is pointless.
 */
async function sendSms({ to, body }) {
  if (!/^\+[1-9]\d{7,14}$/.test(to)) {
    const err = new Error('Recipient must be an E.164 phone number');
    err.permanent = true;
    throw err;
  }
  const text = String(body).slice(0, 640); // keep to <= 4 concatenated segments

  if (isDryRun()) {
    const sid = `SIMULATED_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info('SMS dry-run (not sent)', { sid, chars: text.length });
    return { sid, status: 'simulated', simulated: true };
  }

  const params = { to, body: text };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  else params.from = process.env.TWILIO_FROM_NUMBER;
  if (process.env.TWILIO_STATUS_CALLBACK_URL) params.statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;

  try {
    const msg = await getClient().messages.create(params);
    return { sid: msg.sid, status: msg.status };
  } catch (err) {
    const wrapped = new Error(`Twilio error ${err.code || ''}: ${err.message}`);
    wrapped.permanent = PERMANENT_ERRORS.has(Number(err.code)) || (err.status >= 400 && err.status < 500 && err.status !== 429);
    throw wrapped;
  }
}

/** Sends through Twilio with no dry-run logic (used by smsSender, which applies the safety rules). */
async function sendViaTwilio({ to, body }) {
  const params = { to, body: String(body).slice(0, 640) };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  else params.from = process.env.TWILIO_FROM_NUMBER;
  if (process.env.TWILIO_STATUS_CALLBACK_URL) params.statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL;
  try {
    const msg = await getClient().messages.create(params);
    return { sid: msg.sid, status: msg.status, provider: 'twilio' };
  } catch (err) {
    const wrapped = new Error(`Twilio error ${err.code || ''}: ${err.message}`);
    wrapped.permanent = PERMANENT_ERRORS.has(Number(err.code)) || (err.status >= 400 && err.status < 500 && err.status !== 429);
    throw wrapped;
  }
}

/** Validates the X-Twilio-Signature header on status-callback webhooks. */
function validateWebhook(signature, url, params) {
  if (!process.env.TWILIO_AUTH_TOKEN) return false;
  // eslint-disable-next-line global-require
  const twilio = require('twilio');
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature || '', url, params || {});
}

module.exports = { sendSms, sendViaTwilio, validateWebhook, isDryRun, isConfigured };
