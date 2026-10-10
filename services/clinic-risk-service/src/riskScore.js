'use strict';

/**
 * Weighted triage score (Section 9: "combines internal severity (vitals trend) with external
 * environmental exposure ... into a weighted risk score"). Pure and unit tested.
 *
 *   base         = max(health, environment)          the worst single signal drives priority
 *   compounding  = 0.3 x min(health, environment)    both at once (e.g. high BP during a heatwave) is worse
 *   vulnerability= +5 per high-risk condition (max 10)
 *   emr          = 0..10 from legacy EMR history (recent admissions, chronic diagnoses)
 *   total        = min(100, base + compounding + vulnerability + emr)
 */
const HIGH_RISK_CONDITIONS = ['hypertension', 'cardiovascular', 'heart_disease', 'diabetes', 'copd', 'kidney_disease', 'stroke', 'dementia'];

function environmentScore(env = {}) {
  if (env.hazard === 'heat') {
    if (env.level === 'extreme_danger') return 80;
    if (env.level === 'danger') return 60;
    return 50;
  }
  if (env.hazard === 'storm') return 65;
  return 0;
}

function vulnerabilityBonus(conditions = [], mobilityRestricted = false) {
  const n = conditions.filter((c) => HIGH_RISK_CONDITIONS.includes(String(c).toLowerCase())).length + (mobilityRestricted ? 1 : 0);
  return Math.min(10, n * 5);
}

function totalScore({ health = 0, environment = 0, emr = 0, conditions = [], mobilityRestricted = false }) {
  const base = Math.max(health, environment);
  if (base === 0 && emr === 0) return 0;
  const compounding = 0.3 * Math.min(health, environment);
  return Math.min(100, Math.round(base + compounding + vulnerabilityBonus(conditions, mobilityRestricted) + Math.min(10, emr)));
}

function priorityFor(score) {
  if (score >= 85) return 'P1';
  if (score >= 65) return 'P2';
  if (score >= 40) return 'P3';
  return 'P4';
}

/** 0..10 risk boost from a normalised legacy EMR history (see legacy adapter JSON contract). */
function emrScore(history) {
  if (!history || !Array.isArray(history.visits)) return 0;
  const yearAgo = Date.now() - 365 * 86400000;
  const admissions = history.visits.filter((v) => v.type === 'admission' && new Date(v.date).getTime() >= yearAgo).length;
  const chronic = (history.diagnoses || []).filter((d) => d.chronic).length;
  return Math.min(10, admissions * 4 + chronic * 2);
}

const VALID_TRANSITIONS = {
  open: ['in_review', 'scheduled', 'resolved', 'dismissed'],
  in_review: ['scheduled', 'resolved', 'dismissed', 'open'],
  scheduled: ['resolved', 'in_review', 'dismissed'],
  resolved: [],
  dismissed: [],
};

module.exports = { environmentScore, vulnerabilityBonus, totalScore, priorityFor, emrScore, VALID_TRANSITIONS, HIGH_RISK_CONDITIONS };
