'use strict';

/**
 * Role-Based Access Control (RBAC) middleware - enforced at the API Gateway (Section 12).
 *
 *   authorize(ROLES.CLINIC, ROLES.ADMIN)   -> only those roles may call the route
 *   requirePatientAccess('id')             -> caregivers / family members may only touch
 *                                             patients listed in their token's `patients` claim
 *   requireBodyPatientAccess('patientId')  -> same check for a patient id sent in the JSON body
 *
 * Always mount AFTER authenticate (authMiddleware.js), which populates req.user.
 */
const { ALL_ROLES, PATIENT_SCOPED_ROLES } = require('../config/roles');
const logger = require('../lib/logger');

function forbidden(req, res, message) {
  logger.warn('rbac denied', { requestId: req.id, userId: req.user && req.user.id, role: req.user && req.user.role, method: req.method, path: req.originalUrl });
  return res.status(403).json({ error: 'forbidden', message });
}

function authorize(...allowedRoles) {
  const unknown = allowedRoles.filter((r) => !ALL_ROLES.includes(r));
  if (unknown.length) throw new Error(`authorize(): unknown role(s) ${unknown.join(', ')}`);

  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized', message: 'Authentication required' });
    if (!allowedRoles.includes(req.user.role)) {
      return forbidden(req, res, `Role "${req.user.role}" is not permitted to access this resource`);
    }
    return next();
  };
}

function canAccessPatient(user, patientId) {
  if (!PATIENT_SCOPED_ROLES.includes(user.role)) return true;
  return user.patients.includes(String(patientId));
}

function requirePatientAccess(paramName = 'id') {
  return function patientParamGuard(req, res, next) {
    const patientId = req.params[paramName];
    if (!patientId) return res.status(400).json({ error: 'bad_request', message: `Missing :${paramName}` });
    if (!canAccessPatient(req.user, patientId)) {
      return forbidden(req, res, 'You are not assigned to this patient');
    }
    return next();
  };
}

function requireBodyPatientAccess(fieldName = 'patientId') {
  return function patientBodyGuard(req, res, next) {
    const patientId = req.body && req.body[fieldName];
    if (!patientId) return res.status(400).json({ error: 'bad_request', message: `"${fieldName}" is required` });
    if (!canAccessPatient(req.user, patientId)) {
      return forbidden(req, res, 'You are not assigned to this patient');
    }
    return next();
  };
}

module.exports = { authorize, requirePatientAccess, requireBodyPatientAccess, canAccessPatient };
