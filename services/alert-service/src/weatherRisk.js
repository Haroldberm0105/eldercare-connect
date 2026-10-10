'use strict';

/**
 * Pure weather-risk math used by the mashup (no I/O, no dependencies - unit tested).
 */

/** Conditions that make heat exposure dangerous (Section 11 - "elderly with cardiovascular conditions"). */
const HEAT_RISK_CONDITIONS = (process.env.HEAT_RISK_CONDITIONS || 'hypertension,cardiovascular,heart_disease,diabetes,kidney_disease,copd')
  .split(',').map((s) => s.trim().toLowerCase());

const HEAT_INDEX_THRESHOLD_C = Number(process.env.HEAT_INDEX_THRESHOLD_C || 40);
const STORM_WIND_MS = Number(process.env.STORM_WIND_MS || 17.2); // tropical-storm force (~62 km/h)

// OpenWeatherMap condition codes: https://openweathermap.org/weather-conditions
const SEVERE_CONDITION_IDS = new Set([202, 212, 221, 232, 502, 503, 504, 522, 531, 771, 781]);
const ALERT_KEYWORDS = /(typhoon|tropical (storm|depression|cyclone)|cyclone|hurricane|storm surge|signal no|severe (storm|thunderstorm)|flood|tornado)/i;

/**
 * Heat index in deg C from air temperature (deg C) and relative humidity (%).
 * NOAA / Rothfusz regression with Steadman fallback and NOAA adjustments.
 */
function computeHeatIndexC(tempC, humidity) {
  if (typeof tempC !== 'number' || typeof humidity !== 'number') return null;
  const T = (tempC * 9) / 5 + 32;
  const R = humidity;
  let hi = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T
      - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    if (R < 13 && T >= 80 && T <= 112) hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    else if (R > 85 && T >= 80 && T <= 87) hi += ((R - 85) / 10) * ((87 - T) / 5);
  }
  return Math.round((((hi - 32) * 5) / 9) * 10) / 10;
}

/** PAGASA-style heat-index bands. */
function heatLevel(hiC) {
  if (hiC >= 52) return 'extreme_danger';
  if (hiC >= 42) return 'danger';
  if (hiC >= 33) return 'extreme_caution';
  if (hiC >= 27) return 'caution';
  return 'normal';
}

/**
 * Normalises an OpenWeatherMap "current weather" response (+ optional One Call alerts)
 * into the platform's internal risk-profile schema (Section 15 - Protocol Mediation #1).
 */
function toRiskProfile(owm, { zipCode, countryCode, alerts = [] } = {}) {
  const tempC = owm.main && owm.main.temp;
  const humidity = owm.main && owm.main.humidity;
  const feelsLike = owm.main && owm.main.feels_like;
  const computed = computeHeatIndexC(tempC, humidity);
  // Use the more conservative (higher) of OWM's feels_like and our NOAA heat index.
  const heatIndexC = [computed, feelsLike].filter((v) => typeof v === 'number').reduce((a, b) => Math.max(a, b), -Infinity);
  const windMs = (owm.wind && Math.max(owm.wind.speed || 0, owm.wind.gust || 0)) || 0;
  const conditions = (owm.weather || []).map((w) => ({ id: w.id, main: w.main, description: w.description }));

  return {
    zipCode,
    countryCode,
    locationName: owm.name || null,
    coordinates: owm.coord ? { lat: owm.coord.lat, lon: owm.coord.lon } : null,
    observedAt: owm.dt ? new Date(owm.dt * 1000).toISOString() : new Date().toISOString(),
    temperatureC: tempC,
    humidity,
    feelsLikeC: feelsLike,
    heatIndexC: Number.isFinite(heatIndexC) ? Math.round(heatIndexC * 10) / 10 : null,
    windMs,
    conditions,
    alerts: alerts.map((a) => ({ event: a.event, sender: a.sender_name, start: a.start, end: a.end, description: a.description })),
  };
}

/** Decides which hazards are active for a risk profile. */
function evaluateWeatherRisk(profile, { heatThresholdC = HEAT_INDEX_THRESHOLD_C, stormWindMs = STORM_WIND_MS } = {}) {
  const heatTriggered = typeof profile.heatIndexC === 'number' && profile.heatIndexC > heatThresholdC;

  const stormReasons = [];
  for (const a of profile.alerts || []) if (ALERT_KEYWORDS.test(`${a.event} ${a.description || ''}`)) stormReasons.push(`official advisory "${a.event}"`);
  for (const c of profile.conditions || []) if (SEVERE_CONDITION_IDS.has(c.id)) stormReasons.push(c.description);
  if (profile.windMs >= stormWindMs) stormReasons.push(`winds up to ${profile.windMs} m/s (${Math.round(profile.windMs * 3.6)} km/h)`);

  return {
    heat: { triggered: heatTriggered, heatIndexC: profile.heatIndexC, thresholdC: heatThresholdC, level: profile.heatIndexC !== null ? heatLevel(profile.heatIndexC) : null },
    storm: { triggered: stormReasons.length > 0, reasons: stormReasons },
  };
}

function isHeatVulnerable(patient) {
  return (patient.conditions || []).some((c) => HEAT_RISK_CONDITIONS.includes(String(c).toLowerCase()));
}

function isStormVulnerable(patient) {
  return Boolean(patient.mobilityRestricted);
}

module.exports = {
  computeHeatIndexC, heatLevel, toRiskProfile, evaluateWeatherRisk, isHeatVulnerable, isStormVulnerable,
  HEAT_INDEX_THRESHOLD_C, HEAT_RISK_CONDITIONS,
};
