'use strict';

/**
 * Validation for scheduling and closing clinic visits. Pure functions (unit tested).
 *
 * Dates and times are entered in the health center's local time zone (Asia/Manila, UTC+08:00 by
 * default; override with VISIT_TZ_OFFSET) and stored both as entered and as an absolute instant.
 */
const VISIT_TYPES = ['home_visit', 'clinic_visit', 'teleconsult'];
const CLOSE_STATUSES = ['completed', 'cancelled', 'no_show'];
const TZ = process.env.VISIT_TZ_OFFSET || '+08:00';
const MAX_DAYS_AHEAD = Number(process.env.VISIT_MAX_DAYS_AHEAD || 180);
const HOURS = { from: 6, to: 20 }; // in-person visits 06:00-20:00 local time

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * @param {object} b  { visitDate:'YYYY-MM-DD', visitTime:'HH:MM', visitType, destination, location,
 *                      contactPhone?, notes?, assignedTo? }
 */
function validateVisit(b, now = new Date()) {
  const errors = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, errors: ['Body must be a JSON object'] };
  const v = {};

  const date = str(b.visitDate);
  if (!isRealDate(date)) errors.push('visitDate is required as a real date in YYYY-MM-DD format');
  else v.visitDate = date;

  const time = str(b.visitTime);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.push('visitTime is required in 24-hour HH:MM format, e.g. 09:30');
  else v.visitTime = time;

  if (!VISIT_TYPES.includes(b.visitType)) errors.push(`visitType must be one of: ${VISIT_TYPES.join(', ')}`);
  else v.visitType = b.visitType;

  const destination = str(b.destination);
  if (destination.length < 2 || destination.length > 120) errors.push('destination is required (2-120 characters), e.g. "Patient\'s home" or "RHU Tondo"');
  else v.destination = destination;

  const location = str(b.location);
  if (location.length < 3 || location.length > 300) {
    errors.push(v.visitType === 'teleconsult'
      ? 'location is required (3-300 characters): the phone number or video-call link'
      : 'location is required (3-300 characters): street address, barangay and landmarks');
  } else v.location = location;

  if (b.contactPhone !== undefined && b.contactPhone !== '') {
    const phone = str(b.contactPhone).replace(/[\s()-]/g, '');
    if (!/^(\+?\d{10,15}|0\d{10})$/.test(phone)) errors.push('contactPhone must be a mobile number, e.g. 09171234567');
    else v.contactPhone = phone;
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== 'string' || b.notes.length > 2000) errors.push('notes must be at most 2000 characters');
    else v.notes = b.notes.trim() || null;
  }
  if (b.assignedTo !== undefined && b.assignedTo !== '') {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(b.assignedTo))) errors.push('assignedTo must be a user ID');
    else v.assignedTo = String(b.assignedTo);
  }

  if (v.visitDate && v.visitTime) {
    const at = new Date(`${v.visitDate}T${v.visitTime}:00${TZ}`);
    if (at.getTime() < now.getTime() - 15 * 60000) errors.push('The visit date and time cannot be in the past');
    else if (at.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86400000) errors.push(`Visits can be scheduled at most ${MAX_DAYS_AHEAD} days ahead`);
    else v.scheduledFor = at;

    const hour = Number(v.visitTime.slice(0, 2));
    if (v.visitType && v.visitType !== 'teleconsult' && (hour < HOURS.from || hour >= HOURS.to)) {
      errors.push('Home and clinic visits must start between 06:00 and 19:59');
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

/** Closing a visit: { status: completed|cancelled|no_show, outcome?, resolveCase? } */
function validateVisitClose(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['Body must be a JSON object'] };
  if (!CLOSE_STATUSES.includes(b.status)) errors.push(`status must be one of: ${CLOSE_STATUSES.join(', ')}`);
  const outcome = str(b.outcome);
  if (b.status === 'completed' && outcome.length < 3) errors.push('outcome is required when completing a visit (what was found / done)');
  if (outcome.length > 2000) errors.push('outcome must be at most 2000 characters');
  if (b.resolveCase !== undefined && typeof b.resolveCase !== 'boolean') errors.push('resolveCase must be true or false');
  if (b.resolveCase && b.status !== 'completed') errors.push('resolveCase can only be used when status is completed');
  return errors.length ? { ok: false, errors } : { ok: true, value: { status: b.status, outcome: outcome || null, resolveCase: Boolean(b.resolveCase) } };
}

module.exports = { validateVisit, validateVisitClose, VISIT_TYPES };
