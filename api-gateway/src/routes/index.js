'use strict';

/**
 * API routing contracts (Section 10 - "Major System APIs").
 *
 * Every route: authenticate (JWT) -> authorize (RBAC) -> [patient scope] -> forward.
 *
 * | Method | Public path                         | Roles                               | Upstream service       |
 * |--------|-------------------------------------|-------------------------------------|------------------------|
 * | POST   | /api/checkins                       | caregiver                           | Daily Check-In Logger  |
 * | GET    | /api/patients/:id/history           | caregiver, family, clinic, admin    | Daily Check-In Logger  |
 * | POST   | /api/alerts/dispatch                | clinic, admin                       | Family Alert & Notif.  |
 * | GET    | /api/clinic/queue                   | clinic, admin                       | Clinic Risk Queue      |
 * Supporting routes used by the dashboards:
 * | GET    | /api/patients/:id                   | caregiver, family, clinic, admin    | Daily Check-In Logger  |
 * | GET    | /api/alerts/notifications           | family, caregiver                   | Family Alert & Notif.  |
 * | POST   | /api/alerts/weather-check           | clinic, admin                       | Family Alert & Notif.  |
 * | PATCH  | /api/clinic/queue/:itemId           | clinic                              | Clinic Risk Queue      |
 * | GET    | /api/clinic/patients/:id/emr-history| clinic, admin                       | Clinic Risk Queue      |
 */
const express = require('express');
const { authenticate } = require('../middleware/authMiddleware');
const { authorize, requirePatientAccess, requireBodyPatientAccess } = require('../middleware/roleMiddleware');
const { ROLES } = require('../config/roles');
const { forwardTo } = require('../lib/proxy');

const router = express.Router();

// Everything under /api requires a valid access token.
router.use(authenticate);

/* ----------------------------- Daily Check-In Logger ----------------------------- */

router.post(
  '/checkins',
  authorize(ROLES.CAREGIVER),
  requireBodyPatientAccess('patientId'),
  forwardTo('checkin'),
);

router.get(
  '/patients/:id/history',
  authorize(ROLES.CAREGIVER, ROLES.FAMILY, ROLES.CLINIC, ROLES.ADMIN),
  requirePatientAccess('id'),
  forwardTo('checkin'),
);

router.get(
  '/patients/:id',
  authorize(ROLES.CAREGIVER, ROLES.FAMILY, ROLES.CLINIC, ROLES.ADMIN),
  requirePatientAccess('id'),
  forwardTo('checkin'),
);

/* -------------------------- Family Alert & Notification -------------------------- */

router.post(
  '/alerts/dispatch',
  authorize(ROLES.CLINIC, ROLES.ADMIN),
  forwardTo('alert'),
);

router.post(
  '/alerts/weather-check',
  authorize(ROLES.CLINIC, ROLES.ADMIN),
  forwardTo('alert'), // runs the OpenWeatherMap x patient-profile mashup on demand
);

router.get(
  '/alerts/notifications',
  authorize(ROLES.FAMILY, ROLES.CAREGIVER),
  forwardTo('alert'), // the service filters by the forwarded X-User-Patients header
);

/* -------------------------------- Clinic Risk Queue ------------------------------- */

router.get(
  '/clinic/queue',
  authorize(ROLES.CLINIC, ROLES.ADMIN),
  forwardTo('clinic'),
);

router.patch(
  '/clinic/queue/:itemId',
  authorize(ROLES.CLINIC),
  forwardTo('clinic'),
);

router.get(
  '/clinic/patients/:id/emr-history',
  authorize(ROLES.CLINIC, ROLES.ADMIN),
  forwardTo('clinic'),
);

module.exports = router;
