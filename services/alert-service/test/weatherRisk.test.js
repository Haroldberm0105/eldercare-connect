'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeHeatIndexC, toRiskProfile, evaluateWeatherRisk, isHeatVulnerable, isStormVulnerable, heatLevel } = require('../src/weatherRisk');

test('heat index matches NOAA reference values', () => {
  // NOAA table: 90F / 70% RH -> 106F (41.1C); 96F / 65% RH -> 121F (49.4C)
  assert.ok(Math.abs(computeHeatIndexC(32.2, 70) - 41.1) <= 0.6, String(computeHeatIndexC(32.2, 70)));
  assert.ok(Math.abs(computeHeatIndexC(35.6, 65) - 49.4) <= 0.8, String(computeHeatIndexC(35.6, 65)));
  assert.ok(computeHeatIndexC(25, 40) < 27);
});

test('Manila-style humid afternoon exceeds the 40C threshold', () => {
  const owm = { name: 'Manila', coord: { lat: 14.6, lon: 120.98 }, dt: 1760076000, main: { temp: 33, humidity: 70, feels_like: 40.2 }, wind: { speed: 3 }, weather: [{ id: 801, main: 'Clouds', description: 'few clouds' }] };
  const profile = toRiskProfile(owm, { zipCode: '1012', countryCode: 'PH' });
  const risk = evaluateWeatherRisk(profile);
  assert.ok(profile.heatIndexC > 40);
  assert.strictEqual(risk.heat.triggered, true);
  assert.strictEqual(risk.storm.triggered, false);
});

test('mild day does not trigger', () => {
  const profile = toRiskProfile({ main: { temp: 28, humidity: 60, feels_like: 30 }, wind: { speed: 2 }, weather: [] }, { zipCode: '1012' });
  assert.strictEqual(evaluateWeatherRisk(profile).heat.triggered, false);
});

test('storm triggers on advisories, severe condition codes, or high wind', () => {
  const base = { main: { temp: 26, humidity: 95, feels_like: 27 }, weather: [] };
  assert.ok(evaluateWeatherRisk(toRiskProfile({ ...base, wind: { speed: 5 } }, { alerts: [{ event: 'Tropical Storm Warning Signal No. 2' }] })).storm.triggered);
  assert.ok(evaluateWeatherRisk(toRiskProfile({ ...base, wind: { speed: 5 }, weather: [{ id: 502, main: 'Rain', description: 'heavy intensity rain' }] })).storm.triggered);
  assert.ok(evaluateWeatherRisk(toRiskProfile({ ...base, wind: { speed: 9, gust: 20 } })).storm.triggered);
  assert.strictEqual(evaluateWeatherRisk(toRiskProfile({ ...base, wind: { speed: 5 } })).storm.triggered, false);
});

test('vulnerability matching and PAGASA heat bands', () => {
  assert.strictEqual(isHeatVulnerable({ conditions: ['Hypertension'] }), true);
  assert.strictEqual(isHeatVulnerable({ conditions: ['osteoarthritis'] }), false);
  assert.strictEqual(isStormVulnerable({ mobilityRestricted: true }), true);
  assert.strictEqual(heatLevel(43), 'danger');
  assert.strictEqual(heatLevel(53), 'extreme_danger');
});
