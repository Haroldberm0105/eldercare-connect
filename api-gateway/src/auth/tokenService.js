'use strict';

/** Issues OAuth 2.0 access / refresh tokens as signed JWTs. */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

function signingKey() {
  if (config.jwt.algorithm === 'HS256') return config.jwt.secret;
  if (!config.jwt.privateKey) {
    throw new Error('RS256 mode without JWT_PRIVATE_KEY: tokens must be issued by your external IdP');
  }
  return config.jwt.privateKey;
}

function issueAccessToken(user) {
  const claims = {
    typ: 'access',
    name: user.name,
    role: user.role,
    patients: user.patients || [],
    scope: (user.scopes || []).join(' '),
  };
  return jwt.sign(claims, signingKey(), {
    algorithm: config.jwt.algorithm,
    subject: user.id,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.accessTtl,
    jwtid: crypto.randomUUID(),
  });
}

function issueRefreshToken(user) {
  return jwt.sign({ typ: 'refresh' }, config.jwt.refreshSecret, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: config.jwt.issuer,
    audience: `${config.jwt.audience}:refresh`,
    expiresIn: config.jwt.refreshTtl,
    jwtid: crypto.randomUUID(),
  });
}

function verifyRefreshToken(token) {
  const claims = jwt.verify(token, config.jwt.refreshSecret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: `${config.jwt.audience}:refresh`,
  });
  if (claims.typ !== 'refresh') throw new Error('not a refresh token');
  return claims;
}

/** RFC 6749 section 5.1 token response. */
function tokenResponse(user) {
  const accessToken = issueAccessToken(user);
  const { exp, iat } = jwt.decode(accessToken);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: exp - iat,
    refresh_token: issueRefreshToken(user),
    scope: (user.scopes || []).join(' '),
    role: user.role,
  };
}

module.exports = { issueAccessToken, issueRefreshToken, verifyRefreshToken, tokenResponse };
