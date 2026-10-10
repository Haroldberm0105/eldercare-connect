#!/usr/bin/env node
// One-command local setup: creates every service's .env from its .env.example with
//   - one freshly generated INTERNAL_SERVICE_TOKEN shared by all services
//   - freshly generated JWT_SECRET / JWT_REFRESH_SECRET for the gateway
//   - DATABASE_URL pointing at your local PostgreSQL (password URL-encoded for you)
//   - REDIS_URL blank (in-memory SMS queue) and SMS_DRY_RUN=true
//
//   node scripts/setup-local.js "YourPostgresPassword"            # create missing .env files
//   node scripts/setup-local.js "YourPostgresPassword" --force    # overwrite existing .env files
//   Options: --db-host localhost --db-port 5432 --db-user postgres --redis redis://localhost:6379
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const VALUE_FLAGS = ['--db-host', '--db-port', '--db-user', '--redis'];
const password = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
if (!password) {
  console.error('Usage: node scripts/setup-local.js "YourPostgresPassword" [--force] [--db-port 5432] [--db-user postgres]');
  process.exit(1);
}
const force = args.includes('--force');
const host = flag('db-host', 'localhost');
const port = flag('db-port', '5432');
const user = flag('db-user', 'postgres');
const redis = flag('redis', '');

const rand = (n) => crypto.randomBytes(n).toString('base64url');
const internalToken = `ec-internal-${crypto.randomBytes(24).toString('hex')}`;
const dbUrl = (db) => `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;

const root = path.join(__dirname, '..');
const SERVICES = {
  'api-gateway': { INTERNAL_SERVICE_TOKEN: internalToken, JWT_SECRET: rand(48), JWT_REFRESH_SECRET: rand(48) },
  'services/checkin-service': { INTERNAL_SERVICE_TOKEN: internalToken, DATABASE_URL: dbUrl('checkin_db') },
  'services/alert-service': { INTERNAL_SERVICE_TOKEN: internalToken, DATABASE_URL: dbUrl('alert_db'), REDIS_URL: redis, SMS_DRY_RUN: 'true' },
  'services/clinic-risk-service': { INTERNAL_SERVICE_TOKEN: internalToken, DATABASE_URL: dbUrl('clinic_db') },
  'services/legacy-emr-adapter': { INTERNAL_SERVICE_TOKEN: internalToken },
};

let skipped = 0;
for (const [dir, overrides] of Object.entries(SERVICES)) {
  const example = path.join(root, dir, '.env.example');
  const target = path.join(root, dir, '.env');
  if (fs.existsSync(target) && !force) {
    console.log(`skip    ${dir}/.env (already exists - use --force to overwrite)`);
    skipped += 1;
    continue;
  }
  const lines = fs.readFileSync(example, 'utf8').split(/\r?\n/);
  const seen = new Set();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && Object.prototype.hasOwnProperty.call(overrides, m[1])) { seen.add(m[1]); return `${m[1]}=${overrides[m[1]]}`; }
    return line;
  });
  for (const [k, v] of Object.entries(overrides)) if (!seen.has(k)) out.push(`${k}=${v}`);
  fs.writeFileSync(target, out.join('\n'));
  console.log(`created ${dir}/.env`);
}

if (skipped === Object.keys(SERVICES).length) {
  console.log('\nNothing changed. Your existing .env files were kept.');
} else {
  console.log('\nDone. INTERNAL_SERVICE_TOKEN for SoapUI (project property "internalToken"):');
  console.log(`  ${internalToken}`);
  if (skipped) console.log('\nNote: some .env files were skipped, so tokens may now differ between services. Re-run with --force to regenerate all of them together.');
}
