#!/usr/bin/env node
/**
 * Fake OpenWeatherMap server for demos and failure testing (zero dependencies).
 * Lets you show the heatwave / typhoon mashup on demand, regardless of real weather.
 *
 *   node testing/mocks/fake-openweathermap.js            (listens on :4999)
 *
 * Then start the alert service with:
 *   OPENWEATHER_API_KEY=demo-key
 *   OPENWEATHER_BASE_URL=http://localhost:4999
 * and trigger: POST /api/alerts/weather-check  (Clinic Portal -> "Run weather check")
 *
 * Scenarios (matching the demo patients' zip codes):
 *   1012 (Tondo)        -> heatwave: 34 C, 70% humidity -> heat index ~47 C  -> P-1001 (hypertension) warned
 *   1119 (Quezon City)  -> typhoon: 24 m/s wind, gusts 31, heavy rain        -> P-1002 (mobility-restricted) warned
 *   anything else       -> normal weather
 * Override per run with env vars: SCENARIO_1012=normal|heat|storm, SCENARIO_1119=..., or SCENARIO_ALL=...
 * Stop this server to demonstrate the "OpenWeatherMap down -> cached data" fallback.
 */
'use strict';
const http = require('http');

const PORT = Number(process.env.PORT || 4999);
const KEY = process.env.FAKE_OWM_KEY || 'demo-key';

const SCENARIOS = {
  heat: { name: 'Heatwave', main: { temp: 34, humidity: 70, feels_like: 44 }, wind: { speed: 3 }, weather: [{ id: 800, main: 'Clear', description: 'clear sky' }] },
  storm: { name: 'Typhoon', main: { temp: 27, humidity: 95, feels_like: 30 }, wind: { speed: 24, gust: 31 }, weather: [{ id: 502, main: 'Rain', description: 'heavy intensity rain' }] },
  normal: { name: 'Normal', main: { temp: 29, humidity: 60, feels_like: 31 }, wind: { speed: 2 }, weather: [{ id: 801, main: 'Clouds', description: 'few clouds' }] },
};
const DEFAULTS = { 1012: 'heat', 1119: 'storm' };
const NAMES = { 1012: 'Tondo', 1119: 'Quezon City', 1008: 'Sampaloc' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.searchParams.get('appid') !== KEY) return send(401, { cod: 401, message: 'Invalid API key (fake server expects FAKE_OWM_KEY)' });
  if (url.pathname === '/data/3.0/onecall') return send(200, { alerts: [] });
  if (url.pathname !== '/data/2.5/weather') return send(404, { cod: '404', message: 'not found' });

  const zip = (url.searchParams.get('zip') || '').split(',')[0];
  const scenario = process.env.SCENARIO_ALL || process.env[`SCENARIO_${zip}`] || DEFAULTS[zip] || 'normal';
  const s = SCENARIOS[scenario] || SCENARIOS.normal;
  console.log(`${new Date().toISOString()} zip=${zip || '(coords)'} scenario=${scenario}`);
  return send(200, {
    coord: { lat: 14.6, lon: 120.98 },
    dt: Math.floor(Date.now() / 1000),
    name: NAMES[zip] || s.name,
    main: s.main,
    wind: s.wind,
    weather: s.weather,
  });
}).listen(PORT, () => console.log(`fake OpenWeatherMap listening on :${PORT} (api key: ${KEY})`));
