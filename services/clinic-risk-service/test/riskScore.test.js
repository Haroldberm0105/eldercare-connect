'use strict';

const test = require('node:test');
const assert = require('node:assert');
const s = require('../src/riskScore');

test('health-only critical anomaly is P1', () => {
  const total = s.totalScore({ health: 90, conditions: ['hypertension'] });
  assert.strictEqual(total, 95);
  assert.strictEqual(s.priorityFor(total), 'P1');
});

test('heat exposure alone for a cardiovascular patient is a preventive P3', () => {
  const total = s.totalScore({ environment: s.environmentScore({ hazard: 'heat', level: 'extreme_caution' }), conditions: ['cardiovascular'] });
  assert.strictEqual(total, 55);
  assert.strictEqual(s.priorityFor(total), 'P3');
});

test('moderate anomaly during a heatwave compounds to P2', () => {
  const total = s.totalScore({ health: 40, environment: 60, conditions: ['hypertension', 'cardiovascular'] });
  assert.strictEqual(total, 82); // 60 + 0.3*40 + 10
  assert.strictEqual(s.priorityFor(total), 'P2');
});

test('emr score from legacy history', () => {
  const recent = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(s.emrScore({ visits: [{ type: 'admission', date: recent }], diagnoses: [{ chronic: true }, { chronic: true }] }), 8);
  assert.strictEqual(s.emrScore(null), 0);
});

test('no signal means no score; transitions are enforced', () => {
  assert.strictEqual(s.totalScore({}), 0);
  assert.ok(s.VALID_TRANSITIONS.open.includes('in_review'));
  assert.strictEqual(s.VALID_TRANSITIONS.resolved.length, 0);
});
