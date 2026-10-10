'use strict';

/**
 * Admin View backend (Section 17 - "Admin View", Section 15 - Logging/Monitoring).
 * GET /api/admin/health : integration health of every downstream service + circuit-breaker states.
 * GET /api/admin/users  : user accounts and role assignments (no password hashes).
 */
const express = require('express');
const axios = require('axios');
const config = require('../config');
const { authenticate } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/roleMiddleware');
const { ROLES } = require('../config/roles');
const { breakerSnapshots } = require('../lib/resilientHttp');
const { listUsers } = require('../auth/userStore');

const router = express.Router();

async function probe(name, baseUrl) {
  const started = Date.now();
  try {
    const { data, status } = await axios.get(`${baseUrl}/health`, { timeout: 2000, validateStatus: () => true });
    return { name, status: status === 200 ? 'up' : 'degraded', httpStatus: status, latencyMs: Date.now() - started, details: data };
  } catch (err) {
    return { name, status: 'down', error: err.code || err.message, latencyMs: Date.now() - started };
  }
}

router.get('/health', authenticate, authorize(ROLES.ADMIN), async (req, res) => {
  const services = await Promise.all(Object.entries(config.services).map(([k, url]) => probe(k, url)));
  const overall = services.every((s) => s.status === 'up') ? 'up' : 'degraded';
  res.json({ gateway: 'up', overall, services, circuitBreakers: breakerSnapshots(), checkedAt: new Date().toISOString() });
});

// GET /api/admin/users : accounts and role assignments (Section 17 - Admin View). Read-only;
// accounts are changed in data/users.json (or the external IdP), never through an API that could leak hashes.
router.get('/users', authenticate, authorize(ROLES.ADMIN), (req, res) => {
  const users = listUsers();
  const byRole = users.reduce((acc, u) => ({ ...acc, [u.role]: (acc[u.role] || 0) + 1 }), {});
  res.json({ total: users.length, byRole, users });
});

module.exports = router;
