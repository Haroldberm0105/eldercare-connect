'use strict';

/**
 * JWT authentication middleware - validates OAuth 2.0 Bearer access tokens (RFC 6750).
 *
 * On success it sets `req.user = { id, name, role, patients, scope }`.
 * On failure it returns 401 with a standards-compliant WWW-Authenticate header.
 *
 * Checks performed:
 *   - Authorization header present and uses the "Bearer" scheme
 *   - signature valid, using ONLY the configured algorithm (blocks alg=none / alg-confusion)
 *   - exp / nbf (with small clock tolerance), iss and aud match configuration
 *   - token type is "access" (a refresh token cannot be used to call APIs)
 *   - required claims (sub, role) are present and the role is a known platform role
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { ALL_ROLES } = require('../config/roles');

const verifyKey = config.jwt.algorithm === 'HS256' ? config.jwt.secret : config.jwt.publicKey;

function unauthorized(res, error, description) {
  res.set('WWW-Authenticate', `Bearer realm="eldercare-connect", error="${error}", error_description="${description}"`);
  return res.status(401).json({ error, message: description });
}

function extractBearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return undefined;
  return token.trim();
}

function authenticate(req, res, next) {
  const token = extractBearerToken(req);
  if (token === null) return unauthorized(res, 'invalid_request', 'Missing Authorization header');
  if (token === undefined) return unauthorized(res, 'invalid_request', 'Authorization header must be: Bearer <token>');

  let claims;
  try {
    claims = jwt.verify(token, verifyKey, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      clockTolerance: 30,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'invalid_token', 'Access token has expired');
    return unauthorized(res, 'invalid_token', 'Access token is invalid');
  }

  if (claims.typ !== 'access') return unauthorized(res, 'invalid_token', 'Token is not an access token');
  if (!claims.sub || !ALL_ROLES.includes(claims.role)) {
    return unauthorized(res, 'invalid_token', 'Token is missing required claims');
  }

  req.user = {
    id: String(claims.sub),
    name: claims.name,
    role: claims.role,
    patients: Array.isArray(claims.patients) ? claims.patients.map(String) : [],
    scope: claims.scope ? String(claims.scope).split(' ') : [],
  };
  return next();
}

module.exports = { authenticate, extractBearerToken };
