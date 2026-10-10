'use strict';

/**
 * OAuth 2.0 token endpoint (RFC 6749).
 *
 *   POST /oauth/token
 *     grant_type=password       username, password            -> access + refresh token
 *     grant_type=refresh_token  refresh_token                 -> new access + refresh token
 *
 * Accepts application/json or application/x-www-form-urlencoded.
 * Errors use the RFC 6749 section 5.2 shape: { error, error_description }.
 *
 * Note: the "password" grant is used here because the Caregiver App, Family Dashboard and
 * Clinic Portal are first-party clients. If third-party clients are ever added, move to the
 * Authorization Code + PKCE flow through an external identity provider.
 */
const express = require('express');
const { findByCredentials, findById } = require('../auth/userStore');
const { tokenResponse, verifyRefreshToken } = require('../auth/tokenService');
const logger = require('../lib/logger');

const router = express.Router();

function oauthError(res, status, error, description) {
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ error, error_description: description });
}

router.post('/token', (req, res) => {
  const body = req.body || {};
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');

  switch (body.grant_type) {
    case 'password': {
      if (!body.username || !body.password) {
        return oauthError(res, 400, 'invalid_request', 'username and password are required');
      }
      const user = findByCredentials(body.username, body.password);
      if (!user) {
        logger.warn('login failed', { requestId: req.id, username: String(body.username).slice(0, 64) });
        return oauthError(res, 400, 'invalid_grant', 'Invalid username or password');
      }
      logger.info('login success', { requestId: req.id, userId: user.id, role: user.role });
      return res.json(tokenResponse(user));
    }

    case 'refresh_token': {
      if (!body.refresh_token) return oauthError(res, 400, 'invalid_request', 'refresh_token is required');
      try {
        const claims = verifyRefreshToken(body.refresh_token);
        const user = findById(claims.sub);
        if (!user) return oauthError(res, 400, 'invalid_grant', 'User no longer active');
        return res.json(tokenResponse(user));
      } catch {
        return oauthError(res, 400, 'invalid_grant', 'Refresh token is invalid or expired');
      }
    }

    default:
      return oauthError(res, 400, 'unsupported_grant_type', 'Supported grant types: password, refresh_token');
  }
});

module.exports = router;
