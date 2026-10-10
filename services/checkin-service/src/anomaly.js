'use strict';

/**
 * Health-anomaly detection for a validated check-in.
 *
 * Thresholds are simplified, configurable screening rules intended to FLAG cases for a
 * clinician's review - they are not a diagnosis. Have the partner RHU's physician sign off on
 * the final values (override via ANOMALY_* env vars or by editing THRESHOLDS).
 *
 * Pure function, no dependencies - unit tested in test/anomaly.test.js.
 */
const LEVEL_SCORE = { critical: 90, high: 70, moderate: 40, low: 15 };

const THRESHOLDS = {
  crisisSystolic: Number(process.env.ANOMALY_CRISIS_SYSTOLIC || 180),
  crisisDiastolic: Number(process.env.ANOMALY_CRISIS_DIASTOLIC || 120),
  highSystolic: Number(process.env.ANOMALY_HIGH_SYSTOLIC || 160),
  highDiastolic: Number(process.env.ANOMALY_HIGH_DIASTOLIC || 100),
  lowSystolic: 90,
  lowDiastolic: 60,
  hrHigh: 120,
  hrLow: 45,
  hrElevated: 100,
  hrSlow: 50,
  feverHigh: 39.0,
  fever: 38.0,
  hypothermia: 35.0,
  spo2Critical: 90,
  spo2Low: 94,
  glucoseLow: 70,
  glucoseHigh: 300,
  baselineSystolicDelta: 25,
  baselineHeartRateDelta: 25,
};

function detectAnomalies({ vitals = {}, medication = {}, mobilityStatus, mood }, baseline = {}, t = THRESHOLDS) {
  const found = [];
  const add = (code, level, message, value) => found.push({ code, level, message, ...(value !== undefined ? { value } : {}) });
  const { systolic: s, diastolic: d, heartRate: hr, temperatureC: temp, spo2, bloodGlucose: glu } = vitals;

  if (s !== undefined) {
    if (s >= t.crisisSystolic || d >= t.crisisDiastolic) add('BP_HYPERTENSIVE_CRISIS', 'critical', 'Blood pressure in hypertensive-crisis range', `${s}/${d}`);
    else if (s >= t.highSystolic || d >= t.highDiastolic) add('BP_HIGH', 'high', 'Blood pressure markedly elevated', `${s}/${d}`);
    else if (s < t.lowSystolic || d < t.lowDiastolic) add('BP_LOW', 'high', 'Blood pressure low (hypotension risk)', `${s}/${d}`);
    if (baseline.systolic && s - baseline.systolic >= t.baselineSystolicDelta && s < t.highSystolic) {
      add('BP_ABOVE_BASELINE', 'moderate', `Systolic ${s - baseline.systolic} mmHg above patient baseline`, s);
    }
  }

  if (hr !== undefined) {
    if (hr > t.hrHigh || hr < t.hrLow) add('HR_ABNORMAL', 'high', hr > t.hrHigh ? 'Heart rate very high' : 'Heart rate very low', hr);
    else if (hr > t.hrElevated || hr < t.hrSlow) add('HR_OUT_OF_RANGE', 'moderate', hr > t.hrElevated ? 'Heart rate elevated' : 'Heart rate slow', hr);
    else if (baseline.heartRate && Math.abs(hr - baseline.heartRate) >= t.baselineHeartRateDelta) {
      add('HR_BASELINE_DEVIATION', 'low', 'Heart rate deviates from patient baseline', hr);
    }
  }

  if (temp !== undefined) {
    if (temp >= t.feverHigh) add('TEMP_HIGH_FEVER', 'high', 'High fever', temp);
    else if (temp >= t.fever) add('TEMP_FEVER', 'moderate', 'Fever', temp);
    else if (temp < t.hypothermia) add('TEMP_HYPOTHERMIA', 'high', 'Body temperature low (hypothermia risk)', temp);
  }

  if (spo2 !== undefined) {
    if (spo2 < t.spo2Critical) add('SPO2_CRITICAL', 'critical', 'Oxygen saturation critically low', spo2);
    else if (spo2 < t.spo2Low) add('SPO2_LOW', 'moderate', 'Oxygen saturation below normal', spo2);
  }

  if (glu !== undefined) {
    if (glu < t.glucoseLow) add('GLUCOSE_LOW', 'high', 'Blood glucose low (hypoglycemia)', glu);
    else if (glu > t.glucoseHigh) add('GLUCOSE_HIGH', 'high', 'Blood glucose very high', glu);
  }

  if (medication.taken === false || (medication.missed && medication.missed.length)) {
    add('MEDICATION_MISSED', 'moderate', 'Medication not taken as prescribed', (medication.missed || []).join(', ') || undefined);
  }
  if (mobilityStatus === 'fall_reported') add('FALL_REPORTED', 'critical', 'Caregiver reported a fall');
  if (mood === 'confused') add('NEW_CONFUSION', 'high', 'Caregiver reported confusion');

  return { anomalies: found, ...scoreSeverity(found) };
}

/** Highest finding drives the score; each extra finding adds 5, capped at 100. */
function scoreSeverity(anomalies) {
  if (!anomalies.length) return { severity: 'none', severityScore: 0 };
  const scores = anomalies.map((a) => LEVEL_SCORE[a.level] || 0);
  const score = Math.min(100, Math.max(...scores) + 5 * (anomalies.length - 1));
  const severity = score >= 85 ? 'critical' : score >= 65 ? 'high' : score >= 35 ? 'moderate' : 'low';
  return { severity, severityScore: score };
}

module.exports = { detectAnomalies, scoreSeverity, THRESHOLDS, LEVEL_SCORE };
