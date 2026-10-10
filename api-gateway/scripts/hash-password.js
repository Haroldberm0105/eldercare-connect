#!/usr/bin/env node
'use strict';

// Usage: node scripts/hash-password.js "MyStrongPassword!"
// Paste the output into the "passwordHash" field of data/users.json.
const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "<password>"');
  process.exit(1);
}
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
console.log(`scrypt$${salt}$${hash}`);
