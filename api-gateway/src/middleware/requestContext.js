'use strict';

/** Assigns/propagates X-Request-Id and writes one structured access-log line per request. */
const crypto = require('crypto');
const logger = require('../lib/logger');

const ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && ID_RE.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      userId: req.user && req.user.id,
      role: req.user && req.user.role,
    });
  });
  next();
}

module.exports = { requestContext };
