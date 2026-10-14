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

/**
 * Explicit triage thresholds (documented in README section "Triage rules").
 *
 *   ROUTINE (P4)  latest check-in is normal (health severity score = 0) AND no active weather risk
 *                 (environment score = 0), regardless of EMR history. Also any case whose total < 35.
 *   URGENT  (P1)  latest check-in has a critical finding (health score >= 85: hypertensive crisis,
 *                 SpO2 < 90 %, fall, or several high findings at once) OR total >= 85.
 *   HIGH    (P2)  total 65-84      WATCH (P3)  total 35-64
 */
const THRESHOLDS = Object.freeze({ urgentHealth: 85, urgent: 85, high: 65, watch: 35 });
const CATEGORY = Object.freeze({ P1: 'urgent', P2: 'high', P3: 'watch', P4: 'routine' });

function priorityFor(score) {
  if (score >= THRESHOLDS.urgent) return 'P1';
  if (score >= THRESHOLDS.high) return 'P2';
  if (score >= THRESHOLDS.watch) return 'P3';
  return 'P4';
}

/** @returns {{ total:number, priority:'P1'|'P2'|'P3'|'P4', category:string, rule:string }} */
function classify(signals) {
  const health = signals.health || 0;
  const environment = signals.environment || 0;
  const total = totalScore(signals);
  const out = (priority, rule) => ({ total, priority, category: CATEGORY[priority], rule });

  if (health === 0 && environment === 0) return out('P4', 'Routine: latest vitals normal (severity score 0) and no active weather risk');
  if (health >= THRESHOLDS.urgentHealth) return out('P1', `Urgent: critical finding in latest check-in (health score ${health} >= ${THRESHOLDS.urgentHealth})`);
  const p = priorityFor(total);
  const band = { P1: `>= ${THRESHOLDS.urgent}`, P2: `${THRESHOLDS.high}-${THRESHOLDS.urgent - 1}`, P3: `${THRESHOLDS.watch}-${THRESHOLDS.high - 1}`, P4: `< ${THRESHOLDS.watch}` }[p];
  const label = { P1: 'Urgent', P2: 'High', P3: 'Watch', P4: 'Routine' }[p];
  return out(p, `${label}: combined risk score ${total} (${band})`);
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

module.exports = { environmentScore, vulnerabilityBonus, totalScore, priorityFor, classify, emrScore, VALID_TRANSITIONS, HIGH_RISK_CONDITIONS, THRESHOLDS, CATEGORY };
