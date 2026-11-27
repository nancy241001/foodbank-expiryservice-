// Token check for THIS backend. Separate backends do not share memory, so each one checks
// the login token itself. Tokens are ISSUED by the auth service (Momen); this backend only
// VERIFIES them with the shared JWT_SECRET (stored in Secrets Manager, never in code).
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

// 401 = "we don't know who you are" (no token, bad token, expired token).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    logger.warn('AUTH_MISSING_TOKEN', { method: req.method, path: req.originalUrl, ip: req.ip });
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    req.user = { id: Number(payload.sub), role: payload.role, name: payload.name };
    req.token = token; // forwarded when this service calls another service on the user's behalf
    return next();
  } catch (err) {
    logger.warn('AUTH_INVALID_TOKEN', { method: req.method, path: req.originalUrl, ip: req.ip, reason: err.name });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// 403 = "we know who you are, but your role is not allowed to do this".
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      logger.warn('ACCESS_DENIED_ROLE', {
        userId: req.user && req.user.id, role: req.user && req.user.role,
        method: req.method, path: req.originalUrl, status: 403,
      });
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
