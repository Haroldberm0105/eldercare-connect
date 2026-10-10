'use strict';

/**
 * SOAP 1.1 client for the partner RHU's Legacy Clinic EMR - operation GetPatientHistory.
 * Builds the XML envelope, posts it, parses the XML response, and surfaces SOAP Faults as errors.
 */
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const { request } = require('./lib/resilientHttp');

const NS = process.env.LEGACY_EMR_NAMESPACE || 'http://rhu.health.gov.ph/emr/v1';
const ACTION = `${NS}/GetPatientHistory`;

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true, // <emr:PatientId> -> PatientId
  parseTagValue: false, // keep "0012" as a string; the mapper converts types explicitly
  trimValues: true,
  // Elements that may repeat must always be arrays, even when only one is returned.
  isArray: (name) => ['Diagnosis', 'Visit', 'Medication', 'Allergy'].includes(name),
  processEntities: true,
});

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** Optional WS-Security UsernameToken header (PasswordText over TLS). */
function securityHeader() {
  const user = process.env.LEGACY_EMR_USERNAME;
  const pass = process.env.LEGACY_EMR_PASSWORD;
  if (!user || !pass) return '<soapenv:Header/>';
  const nonce = crypto.randomBytes(16).toString('base64');
  return `<soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(user)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(pass)}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce}</wsse:Nonce>
        <wsu:Created>${new Date().toISOString()}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>`;
}

function buildGetPatientHistoryEnvelope(patientId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:emr="${NS}">
  ${securityHeader()}
  <soapenv:Body>
    <emr:GetPatientHistoryRequest>
      <emr:PatientId>${escapeXml(patientId)}</emr:PatientId>
    </emr:GetPatientHistoryRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
}

class SoapFaultError extends Error {
  constructor(code, message) {
    super(`SOAP Fault ${code}: ${message}`);
    this.faultCode = code;
    this.faultString = message;
  }
}

/** Parses a SOAP envelope; throws SoapFaultError on <Fault>. Returns the Body object. */
function parseEnvelope(xml) {
  const doc = parser.parse(xml);
  const body = doc && doc.Envelope && doc.Envelope.Body;
  if (!body) throw new Error('Response is not a SOAP envelope');
  if (body.Fault) {
    const f = body.Fault;
    throw new SoapFaultError(String(f.faultcode || 'Server'), String(f.faultstring || 'Unknown fault'));
  }
  return body;
}

async function getPatientHistory(patientId, requestId) {
  const url = process.env.LEGACY_EMR_URL || 'http://localhost:4005/emr';
  const res = await request('legacy-emr', {
    method: 'POST',
    url,
    data: buildGetPatientHistoryEnvelope(patientId),
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${ACTION}"`, ...(requestId ? { 'X-Request-Id': requestId } : {}) },
    responseType: 'text',
    transformResponse: [(d) => d], // keep raw XML
    validateStatus: (s) => s <= 500, // SOAP 1.1 faults are returned with HTTP 500
  }, { retries: 1, timeoutMs: Number(process.env.LEGACY_EMR_TIMEOUT_MS || 6000) });

  return parseEnvelope(res.data);
}

module.exports = { getPatientHistory, buildGetPatientHistoryEnvelope, parseEnvelope, SoapFaultError, escapeXml };
