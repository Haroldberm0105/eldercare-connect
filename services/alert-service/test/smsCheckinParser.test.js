'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSmsCheckin } = require('../src/smsCheckinParser');

test('parses a full check-in message', () => {
  const r = parseSmsCheckin('CHECKIN P-1001 BP 150/90 HR 80 T 36.8 O2 96 MED Y', ['P-1001', 'P-1002']);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.checkin, { patientId: 'P-1001', vitals: { systolic: 150, diastolic: 90, heartRate: 80, temperatureC: 36.8, spo2: 96 }, medication: { taken: true } });
});

test('defaults the patient when the caregiver has only one, keeps notes', () => {
  const r = parseSmsCheckin('checkin bp 120/80 pulse 72 meds no note masakit ang ulo', ['P-1003']);
  assert.ok(r.ok);
  assert.strictEqual(r.checkin.patientId, 'P-1003');
  assert.strictEqual(r.checkin.medication.taken, false);
  assert.strictEqual(r.checkin.notes, 'masakit ang ulo');
});

test('fall-only message', () => {
  const r = parseSmsCheckin('CHECKIN P-1002 FALL', ['P-1001', 'P-1002']);
  assert.ok(r.ok);
  assert.strictEqual(r.checkin.mobilityStatus, 'fall_reported');
});

test('requires patient id when caregiver has several; reports bad tokens', () => {
  const r = parseSmsCheckin('CHECKIN BP 120 HR fast', ['P-1001', 'P-1002']);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('BP')));
  assert.ok(r.errors.some((e) => e.includes('HR')));
  assert.ok(r.errors.some((e) => e.includes('patient ID')));
});

test('HELP returns the help flag', () => {
  assert.strictEqual(parseSmsCheckin('help').help, true);
});
