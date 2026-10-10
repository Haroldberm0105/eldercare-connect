'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateCheckin } = require('../src/validation');
const { detectAnomalies, scoreSeverity } = require('../src/anomaly');

const now = new Date('2026-10-10T08:00:00Z');

test('accepts a normal check-in and normalises values', () => {
  const r = validateCheckin({ patientId: 'P-1001', vitals: { systolic: 128.4, diastolic: 82, heartRate: 74, temperatureC: 36.66 }, medication: { taken: true } }, now);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.value.vitals, { systolic: 128, diastolic: 82, heartRate: 74, temperatureC: 36.7 });
});

test('rejects impossible vitals and bad shapes', () => {
  const r = validateCheckin({ patientId: 'P-1001', vitals: { systolic: 400, diastolic: 82, temperatureC: 'hot' }, mood: 'sleepy' }, now);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('systolic')));
  assert.ok(r.errors.some((e) => e.includes('temperatureC')));
  assert.ok(r.errors.some((e) => e.includes('mood')));
});

test('rejects diastolic >= systolic, missing pair, future timestamps and empty check-ins', () => {
  assert.strictEqual(validateCheckin({ patientId: 'P-1', vitals: { systolic: 120, diastolic: 130 } }, now).ok, false);
  assert.strictEqual(validateCheckin({ patientId: 'P-1', vitals: { systolic: 120 } }, now).ok, false);
  assert.strictEqual(validateCheckin({ patientId: 'P-1', vitals: { heartRate: 70 }, recordedAt: '2026-10-11T08:00:00Z' }, now).ok, false);
  assert.strictEqual(validateCheckin({ patientId: 'P-1' }, now).ok, false);
});

test('normal vitals produce no anomalies', () => {
  const r = detectAnomalies({ vitals: { systolic: 128, diastolic: 82, heartRate: 74, temperatureC: 36.7, spo2: 97 }, medication: { taken: true } }, { systolic: 130 });
  assert.strictEqual(r.anomalies.length, 0);
  assert.strictEqual(r.severity, 'none');
});

test('hypertensive crisis is critical', () => {
  const r = detectAnomalies({ vitals: { systolic: 186, diastolic: 118 } });
  assert.strictEqual(r.anomalies[0].code, 'BP_HYPERTENSIVE_CRISIS');
  assert.strictEqual(r.severity, 'critical');
});

test('multiple moderate findings add up', () => {
  const r = detectAnomalies({ vitals: { temperatureC: 38.2, spo2: 92 }, medication: { taken: false, missed: ['Losartan'] } });
  assert.strictEqual(r.anomalies.length, 3);
  assert.strictEqual(r.severityScore, 50);
  assert.strictEqual(r.severity, 'moderate');
});

test('fall reported is critical; baseline deviation is flagged', () => {
  assert.strictEqual(detectAnomalies({ mobilityStatus: 'fall_reported' }).severity, 'critical');
  const r = detectAnomalies({ vitals: { systolic: 158, diastolic: 90 } }, { systolic: 125 });
  assert.ok(r.anomalies.some((a) => a.code === 'BP_ABOVE_BASELINE'));
});

test('severity score is capped at 100', () => {
  const many = Array.from({ length: 10 }, () => ({ level: 'critical' }));
  assert.strictEqual(scoreSeverity(many).severityScore, 100);
});
