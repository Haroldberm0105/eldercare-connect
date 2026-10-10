#!/usr/bin/env node
// Copies shared helpers (logger, resilient HTTP client, internal auth) into each service's src/lib,
// so every service stays independently buildable and deployable. Run after editing anything in shared/ (npm run sync-shared).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = {
  'services/checkin-service': ['logger.js', 'resilientHttp.js', 'internalAuth.js'],
  'services/alert-service': ['logger.js', 'resilientHttp.js', 'internalAuth.js'],
  'services/clinic-risk-service': ['logger.js', 'resilientHttp.js', 'internalAuth.js'],
  'services/legacy-emr-adapter': ['logger.js', 'resilientHttp.js', 'internalAuth.js'],
  'api-gateway': ['logger.js', 'resilientHttp.js'],
};
for (const [dir, files] of Object.entries(targets)) {
  const lib = path.join(root, dir, 'src', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(root, 'shared', f), path.join(lib, f));
}
console.log('shared helpers synced');
