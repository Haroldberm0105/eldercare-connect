'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validatePatient, validateMedication } = require('../src/patientValidation');

const now = new Date('2026-10-14T00:00:00Z');
const valid = {
  fullName: 'Lolo Andres Bautista',
  birthDate: '1944-05-20',
  sex: 'M',
  addressLine: '123 Rizal St., Brgy. 105, Tondo, Manila',
  zipCode: '1012',
  conditions: ['Hypertension', 'heart disease'],
  mobilityRestricted: true,
  baseline: { systolic: 130, diastolic: 82, heartRate: 74 },
  emergencyContact: { name: 'Ana Bautista', phone: '0917 123 4567', relation: 'daughter' },
  medications: [{ name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', times: ['08:00'] }],
};

test('accepts a complete onboarding payload and normalises it', () => {
  const r = validatePatient(valid, now);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepStrictEqual(r.value.conditions, ['hypertension', 'heart_disease']);
  assert.strictEqual(r.value.countryCode, 'PH');
  assert.strictEqual(r.value.emergencyContact.phone, '09171234567');
  assert.strictEqual(r.value.medications.length, 1);
});

test('rejects missing required fields, bad dates and out-of-range baseline', () => {
  const r = validatePatient({ fullName: 'Al', birthDate: '2030-02-30', zipCode: '!', baseline: { systolic: 999 } }, now);
  assert.strictEqual(r.ok, false);
  for (const field of ['fullName', 'birthDate', 'addressLine', 'zipCode', 'baseline.systolic']) {
    assert.ok(r.errors.some((e) => e.includes(field)), `expected error for ${field}: ${r.errors.join(' | ')}`);
  }
});

test('rejects patients younger than 18 and invalid medication rows', () => {
  const r = validatePatient({ ...valid, birthDate: '2015-01-01', medications: [{ name: 'X', times: ['25:00'] }] }, now);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('between 18 and 125')));
  assert.ok(r.errors.some((e) => e.includes('medications[0].name')));
  assert.ok(r.errors.some((e) => e.includes('medications[0].times')));
});

test('medication partial update requires at least one field and checks end >= start', () => {
  assert.strictEqual(validateMedication({}, '', { partial: true }).ok, false);
  assert.strictEqual(validateMedication({ active: false }, '', { partial: true }).ok, true);
  const r = validateMedication({ name: 'Losartan', dosage: '50 mg', frequency: 'Daily', startDate: '2026-10-10', endDate: '2026-10-01' });
  assert.strictEqual(r.ok, false);
});
