#!/usr/bin/env node
// Puts your PostgreSQL password into the DATABASE_URL of all three service .env files at once.
//
//   node scripts/set-db-password.js "YourPostgresPassword"
//
// Special characters (@ # : / % ? etc.) are URL-encoded automatically.
// Safe to run again later with a different password.
'use strict';
const fs = require('fs');
const path = require('path');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/set-db-password.js "YourPostgresPassword"');
  process.exit(1);
}

const encoded = encodeURIComponent(password);
const root = path.join(__dirname, '..');
const files = ['services/checkin-service/.env', 'services/alert-service/.env', 'services/clinic-risk-service/.env'];

for (const rel of files) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${rel} - run: node scripts/setup-local.js "YourPostgresPassword"`);
    process.exitCode = 1;
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  // Replace whatever is between "postgres://postgres:" and "@localhost" on the DATABASE_URL line.
  const updated = text.replace(/^(DATABASE_URL=postgres:\/\/postgres:)(.*)(@localhost:\d+\/\w+)\s*$/m, (_, a, _old, c) => `${a}${encoded}${c}`);
  if (updated === text && !text.includes(`postgres:${encoded}@`)) {
    console.error(`Could not find a DATABASE_URL line in ${rel}`);
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(file, updated);
  console.log(`updated ${rel}`);
}
if (!process.exitCode) console.log('Done - all three DATABASE_URLs now use your password.');
