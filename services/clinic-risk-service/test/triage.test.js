'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../src/riskScore');
const { validateVisit, validateVisitClose } = require('../src/visitValidation');

test('normal vitals with no weather risk are Routine even with EMR history (QA: Lola Remedios stuck on Urgent)', () => {
  const c = classify({ health: 0, environment: 0, emr: 8, conditions: ['hypertension', 'cardiovascular'] });
  assert.strictEqual(c.priority, 'P4');
  assert.strictEqual(c.category, 'routine');
  assert.match(c.rule, /severity score 0/);
});

test('critical finding is Urgent regardless of total', () => {
  const c = classify({ health: 90 });
  assert.strictEqual(c.priority, 'P1');
  assert.strictEqual(c.category, 'urgent');
});

test('active weather risk keeps a patient out of Routine after normal vitals', () => {
  const c = classify({ health: 0, environment: 60, conditions: ['hypertension'] });
  assert.strictEqual(c.priority, 'P2');
});

test('score bands: watch 35-64, routine below 35', () => {
  assert.strictEqual(classify({ health: 40 }).priority, 'P3');
  assert.strictEqual(classify({ health: 15 }).priority, 'P4');
});

const now = new Date('2026-10-14T02:00:00Z'); // 10:00 Manila
const base = { visitDate: '2026-10-15', visitTime: '09:30', visitType: 'home_visit', destination: "Patient's home", location: '123 Rizal St, Brgy 105, Tondo (near the chapel)' };

test('valid home visit is accepted and converted to an absolute time (UTC+8)', () => {
  const r = validateVisit(base, now);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.strictEqual(r.value.scheduledFor.toISOString(), '2026-10-15T01:30:00.000Z');
});

test('rejects past dates, impossible dates, bad time, missing destination/location', () => {
  assert.match(validateVisit({ ...base, visitDate: '2026-10-13' }, now).errors.join(), /past/);
  assert.match(validateVisit({ ...base, visitDate: '2026-02-30' }, now).errors.join(), /real date/);
  assert.match(validateVisit({ ...base, visitTime: '9:30am' }, now).errors.join(), /HH:MM/);
  const r = validateVisit({ ...base, destination: '', location: 'x' }, now);
  assert.ok(r.errors.some((e) => e.startsWith('destination')) && r.errors.some((e) => e.startsWith('location')));
});

test('in-person visits must be within 06:00-19:59; teleconsults any time', () => {
  assert.match(validateVisit({ ...base, visitTime: '21:00' }, now).errors.join(), /between 06:00/);
  assert.ok(validateVisit({ ...base, visitTime: '21:00', visitType: 'teleconsult', location: '09171234567' }, now).ok);
});

test('completing a visit needs an outcome; resolveCase only with completed', () => {
  assert.strictEqual(validateVisitClose({ status: 'completed' }).ok, false);
  assert.ok(validateVisitClose({ status: 'completed', outcome: 'BP 128/82 on recheck', resolveCase: true }).ok);
  assert.strictEqual(validateVisitClose({ status: 'cancelled', resolveCase: true }).ok, false);
});
