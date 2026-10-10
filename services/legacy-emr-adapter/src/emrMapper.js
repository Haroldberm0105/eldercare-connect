'use strict';

/**
 * Maps the parsed legacy SOAP body into the platform's internal JSON contract
 * (Section 10: "XML (SOAP) in --> JSON out"). Pure function - unit tested.
 *
 * Internal contract (consumed by the Clinic Risk Queue Service):
 * {
 *   patientId, source: "legacy-emr", facility, retrievedAt,
 *   demographics: { fullName, birthDate, sex },
 *   diagnoses:   [{ code, description, diagnosedOn, chronic }],
 *   visits:      [{ id, date, type, facility, complaint, notes, bloodPressure: {systolic, diastolic} | null }],
 *   medications: [{ name, dosage, frequency, active }],
 *   allergies:   [string]
 * }
 */
const toBool = (v) => ['true', '1', 'y', 'yes'].includes(String(v || '').trim().toLowerCase());
const toDate = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  // Legacy systems often send MM/DD/YYYY - normalise to ISO YYYY-MM-DD.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const list = (container, key) => (container && Array.isArray(container[key]) ? container[key] : []);

const VISIT_TYPES = { CONSULT: 'consultation', OPD: 'consultation', ER: 'emergency', ADMIT: 'admission', IPD: 'admission', FOLLOWUP: 'follow_up', HOMEVISIT: 'home_visit' };

function parseBp(v) {
  const m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(String(v || '').trim());
  return m ? { systolic: Number(m[1]), diastolic: Number(m[2]) } : null;
}

function mapPatientHistory(body, now = new Date()) {
  const resp = body.GetPatientHistoryResponse || body;
  const h = resp.PatientHistory;
  if (!h) throw new Error('GetPatientHistoryResponse.PatientHistory missing');

  return {
    patientId: str(h.PatientId),
    source: 'legacy-emr',
    facility: str(h.FacilityCode),
    retrievedAt: now.toISOString(),
    demographics: { fullName: str(h.FullName), birthDate: toDate(h.BirthDate), sex: str(h.Sex) },
    diagnoses: list(h.Diagnoses, 'Diagnosis').map((d) => ({
      code: str(d.IcdCode), description: str(d.Description), diagnosedOn: toDate(d.DiagnosedOn), chronic: toBool(d.Chronic),
    })),
    visits: list(h.Visits, 'Visit')
      .map((v) => ({
        id: str(v.VisitId),
        date: toDate(v.VisitDate),
        type: VISIT_TYPES[String(v.VisitType || '').toUpperCase()] || 'other',
        facility: str(v.Facility),
        complaint: str(v.ChiefComplaint),
        notes: str(v.Remarks),
        bloodPressure: parseBp(v.BloodPressure),
      }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    medications: list(h.Medications, 'Medication').map((m) => ({
      name: str(m.DrugName), dosage: str(m.Dosage), frequency: str(m.Frequency), active: m.Active === undefined ? true : toBool(m.Active),
    })),
    allergies: list(h.Allergies, 'Allergy').map(String),
  };
}

module.exports = { mapPatientHistory, toDate, parseBp };
