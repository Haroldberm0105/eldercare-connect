'use strict';

/**
 * User credential store for the gateway's OAuth 2.0 token endpoint.
 *
 * Passwords are stored as scrypt hashes: "scrypt$<saltHex>$<hashHex>".
 * Generate one with:  node scripts/hash-password.js "<password>"
 *
 * For a larger deployment, replace this JSON file with a dedicated identity
 * provider (Keycloak, Auth0, Cognito) and switch JWT_ALGORITHM to RS256 so the
 * gateway only needs the IdP's public key.
 */
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

const KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

let cache;
function loadUsers() {
  if (!cache) {
    const raw = JSON.parse(fs.readFileSync(config.usersFile, 'utf8'));
    cache = new Map(raw.map((u) => [u.username.toLowerCase(), u]));
  }
  return cache;
}

// Spend the same time on unknown usernames to avoid user-enumeration by timing.
const DUMMY_HASH = hashPassword('timing-equalizer');

function findByCredentials(username, password) {
  const user = loadUsers().get(String(username || '').toLowerCase());
  const ok = verifyPassword(String(password || ''), user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok || user.disabled) return null;
  return user;
}

function findById(id) {
  for (const u of loadUsers().values()) if (u.id === id) return u.disabled ? null : u;
  return null;
}

/** Safe listing for the Admin View - never includes password hashes. */
function listUsers() {
  return [...loadUsers().values()].map((u) => ({
    id: u.id, username: u.username, name: u.name, role: u.role, patients: u.patients || [], scopes: u.scopes || [], disabled: Boolean(u.disabled),
  }));
}

module.exports = { hashPassword, verifyPassword, findByCredentials, findById, listUsers };
