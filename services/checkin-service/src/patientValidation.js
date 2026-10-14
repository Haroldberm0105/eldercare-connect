'use strict';

/**
 * Validation for patient onboarding and prescribed medications. Pure functions (unit tested).
 * Returns { ok: true, value } or { ok: false, errors: string[] } like validateCheckin().
 */
const { RANGES } = require('./validation');

const SEX = ['F', 'M', 'X'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function ageOn(birth, now) {
  const [y, m, d] = birth.split('-').map(Number);
  let a = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) a -= 1;
  return a;
}

/** One prescribed medication. `prefix` is used in error messages (e.g. "medications[0].") */
function validateMedication(m, prefix = '', { partial = false } = {}) {
  const errors = [];
  const value = {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: [`${prefix || 'medication '}must be an object`] };

  const text = (key, min, max, required) => {
    if (m[key] === undefined || m[key] === null || m[key] === '') {
      if (required && !partial) errors.push(`${prefix}${key} is required`);
      return;
    }
    const v = str(m[key]);
    if (v.length < min || v.length > max) errors.push(`${prefix}${key} must be ${min}-${max} characters`);
    else value[key] = v;
  };
  text('name', 2, 80, true);
  text('dosage', 1, 40, true);
  text('frequency', 2, 60, true);
  text('instructions', 0, 300, false);
  text('prescribedBy', 2, 80, false);

  if (m.times !== undefined) {
    if (!Array.isArray(m.times) || m.times.length > 6 || m.times.some((t) => !TIME_RE.test(String(t)))) {
      errors.push(`${prefix}times must be up to 6 times in 24-hour HH:MM format, e.g. ["08:00","20:00"]`);
    } else value.times = [...new Set(m.times.map(String))].sort();
  }
  for (const key of ['startDate', 'endDate']) {
    if (m[key] === undefined || m[key] === null || m[key] === '') continue;
    if (!isRealDate(String(m[key]))) errors.push(`${prefix}${key} must be a date in YYYY-MM-DD format`);
    else value[key] = String(m[key]);
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) errors.push(`${prefix}endDate cannot be before startDate`);
  if (m.active !== undefined) {
    if (typeof m.active !== 'boolean') errors.push(`${prefix}active must be true or false`);
    else value.active = m.active;
  }
  if (partial && !Object.keys(value).length && !errors.length) errors.push('Nothing to update');
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** New-patient onboarding payload. */
function validatePatient(b, now = new Date()) {
  const errors = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, errors: ['Body must be a JSON object'] };
  const v = {};

  const fullName = str(b.fullName);
  if (fullName.length < 3 || fullName.length > 120) errors.push('fullName is required (3-120 characters)');
  else v.fullName = fullName;

  const birth = str(b.birthDate);
  if (!isRealDate(birth)) errors.push('birthDate is required in YYYY-MM-DD format');
  else {
    const a = ageOn(birth, now);
    if (a < 0) errors.push('birthDate cannot be in the future');
    else if (a < 18 || a > 125) errors.push('Patient age must be between 18 and 125 years');
    else v.birthDate = birth;
  }

  if (b.sex !== undefined && b.sex !== null && b.sex !== '') {
    if (!SEX.includes(b.sex)) errors.push(`sex must be one of: ${SEX.join(', ')}`);
    else v.sex = b.sex;
  }

  const address = str(b.addressLine);
  if (address.length < 3 || address.length > 200) errors.push('addressLine is required (3-200 characters): street, barangay, city');
  else v.addressLine = address;

  const zip = str(b.zipCode);
  if (!/^[A-Za-z0-9 -]{3,10}$/.test(zip)) errors.push('zipCode is required (3-10 letters/digits, e.g. 1012)');
  else v.zipCode = zip;

  const cc = b.countryCode === undefined ? 'PH' : str(b.countryCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) errors.push('countryCode must be a 2-letter code, e.g. PH');
  else v.countryCode = cc;

  for (const [key, lo, hi] of [['latitude', -90, 90], ['longitude', -180, 180]]) {
    if (b[key] === undefined || b[key] === null || b[key] === '') continue;
    const n = Number(b[key]);
    if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`${key} must be between ${lo} and ${hi}`);
    else v[key] = n;
  }
  if ((v.latitude === undefined) !== (v.longitude === undefined)) errors.push('latitude and longitude must be provided together');

  const conditions = b.conditions === undefined ? [] : b.conditions;
  if (!Array.isArray(conditions) || conditions.length > 15) errors.push('conditions must be a list of up to 15 conditions');
  else {
    const slugs = conditions.map((c) => str(c).toLowerCase().replace(/[\s-]+/g, '_'));
    if (slugs.some((c) => !/^[a-z][a-z0-9_]{1,39}$/.test(c))) errors.push('Each condition must be 2-40 letters, e.g. "hypertension" or "heart_disease"');
    else v.conditions = [...new Set(slugs)];
  }

  if (b.mobilityRestricted !== undefined && typeof b.mobilityRestricted !== 'boolean') errors.push('mobilityRestricted must be true or false');
  else v.mobilityRestricted = Boolean(b.mobilityRestricted);

  v.baseline = {};
  if (b.baseline !== undefined) {
    if (!b.baseline || typeof b.baseline !== 'object') errors.push('baseline must be an object of usual vitals');
    else {
      for (const [key, [lo, hi]] of Object.entries(RANGES)) {
        const val = b.baseline[key];
        if (val === undefined || val === null || val === '') continue;
        const n = Number(val);
        if (!Number.isFinite(n) || n < lo || n > hi) errors.push(`baseline.${key} must be between ${lo} and ${hi}`);
        else v.baseline[key] = n;
      }
    }
  }

  if (b.assignedClinic !== undefined && b.assignedClinic !== '') {
    const c = str(b.assignedClinic);
    if (c.length < 2 || c.length > 40) errors.push('assignedClinic must be 2-40 characters');
    else v.assignedClinic = c;
  }

  v.emergencyContact = {};
  if (b.emergencyContact) {
    const ec = b.emergencyContact;
    const name = str(ec.name);
    const phone = str(ec.phone).replace(/[\s()-]/g, '');
    if (name && (name.length < 2 || name.length > 80)) errors.push('emergencyContact.name must be 2-80 characters');
    if (phone && !/^(\+?\d{10,15}|0\d{10})$/.test(phone)) errors.push('emergencyContact.phone must be a mobile number, e.g. +639171234567 or 09171234567');
    if (name || phone) v.emergencyContact = { name, phone, relation: str(ec.relation).slice(0, 40) };
  }

  if (b.notes !== undefined) {
    if (typeof b.notes !== 'string' || b.notes.length > 2000) errors.push('notes must be at most 2000 characters');
    else v.notes = b.notes.trim() || null;
  }

  v.medications = [];
  if (b.medications !== undefined) {
    if (!Array.isArray(b.medications) || b.medications.length > 20) errors.push('medications must be a list of up to 20 prescriptions');
    else {
      b.medications.forEach((m, i) => {
        const r = validateMedication(m, `medications[${i}].`);
        if (r.ok) v.medications.push(r.value);
        else errors.push(...r.errors);
      });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

module.exports = { validatePatient, validateMedication, isRealDate };
