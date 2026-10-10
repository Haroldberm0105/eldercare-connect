'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { mapPatientHistory, toDate, parseBp } = require('../src/emrMapper');

// Shape produced by fast-xml-parser (removeNSPrefix, isArray for repeating elements) from the mock EMR response.
const parsedBody = {
  GetPatientHistoryResponse: {
    PatientHistory: {
      PatientId: 'P-1001', FacilityCode: 'RHU-MNL-01', FullName: 'DELA CRUZ, REMEDIOS', BirthDate: '03/14/1946', Sex: 'F',
      Diagnoses: { Diagnosis: [{ IcdCode: 'I10', Description: 'Essential hypertension', DiagnosedOn: '06/02/2015', Chronic: 'true' }] },
      Visits: { Visit: [
        { VisitId: 'V-1', VisitDate: '11/15/2025', VisitType: 'FOLLOWUP', Facility: 'RHU Tondo', BloodPressure: '140/88' },
        { VisitId: 'V-2', VisitDate: '04/03/2026', VisitType: 'ADMIT', Facility: 'GABMMC', ChiefComplaint: 'Hypertensive urgency', BloodPressure: '188/112' },
      ] },
      Medications: { Medication: [{ DrugName: 'Amlodipine', Dosage: '10 mg', Frequency: 'Once daily', Active: 'true' }] },
      Allergies: { Allergy: ['Penicillin'] },
    },
  },
};

test('maps SOAP body to the internal JSON contract', () => {
  const out = mapPatientHistory(parsedBody, new Date('2026-10-10T00:00:00Z'));
  assert.strictEqual(out.patientId, 'P-1001');
  assert.strictEqual(out.source, 'legacy-emr');
  assert.strictEqual(out.demographics.birthDate, '1946-03-14');
  assert.deepStrictEqual(out.diagnoses[0], { code: 'I10', description: 'Essential hypertension', diagnosedOn: '2015-06-02', chronic: true });
  assert.strictEqual(out.visits[0].id, 'V-2'); // newest first
  assert.strictEqual(out.visits[0].type, 'admission');
  assert.deepStrictEqual(out.visits[0].bloodPressure, { systolic: 188, diastolic: 112 });
  assert.strictEqual(out.medications[0].active, true);
  assert.deepStrictEqual(out.allergies, ['Penicillin']);
});

test('handles empty collections and helper edge cases', () => {
  const out = mapPatientHistory({ GetPatientHistoryResponse: { PatientHistory: { PatientId: 'X', Diagnoses: '', Visits: '', Medications: '', Allergies: '' } } });
  assert.deepStrictEqual([out.diagnoses, out.visits, out.medications, out.allergies], [[], [], [], []]);
  assert.strictEqual(toDate('not a date'), null);
  assert.strictEqual(parseBp('n/a'), null);
  assert.throws(() => mapPatientHistory({}), /PatientHistory missing/);
});
