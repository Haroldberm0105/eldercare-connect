'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

const algorithm = (process.env.JWT_ALGORITHM || 'HS256').toUpperCase();
if (!['HS256', 'RS256'].includes(algorithm)) {
  throw new Error('JWT_ALGORITHM must be HS256 or RS256');
}

// PEM keys are usually stored in env vars with literal "\n" sequences.
const pem = (v) => (v ? v.replace(/\\n/g, '\n') : undefined);

const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()),

  jwt: {
    algorithm,
    // HS256: one shared secret. RS256: private key signs (gateway / IdP), public key verifies.
    secret: algorithm === 'HS256' ? required('JWT_SECRET') : undefined,
    privateKey: algorithm === 'RS256' ? pem(process.env.JWT_PRIVATE_KEY) : undefined,
    publicKey: algorithm === 'RS256' ? pem(required('JWT_PUBLIC_KEY')) : undefined,
    refreshSecret: required('JWT_REFRESH_SECRET'),
    issuer: process.env.JWT_ISSUER || 'eldercare-connect-auth',
    audience: process.env.JWT_AUDIENCE || 'eldercare-connect-api',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
  },

  internalServiceToken: required('INTERNAL_SERVICE_TOKEN'),

  services: {
    checkin: process.env.CHECKIN_SERVICE_URL || 'http://localhost:4001',
    alert: process.env.ALERT_SERVICE_URL || 'http://localhost:4002',
    clinic: process.env.CLINIC_SERVICE_URL || 'http://localhost:4003',
    legacyAdapter: process.env.LEGACY_ADAPTER_URL || 'http://localhost:4004',
  },

  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 5000),

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 300),
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  },

  usersFile: process.env.USERS_FILE || require('path').join(__dirname, '../../data/users.json'),
};

module.exports = config;
