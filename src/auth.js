'use strict';
const jwt = require('jsonwebtoken');
const config = require('./config');
const { unauthorized, forbidden } = require('./errors');

function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, config.jwtSecret, { expiresIn: config.jwtTtl });
}
function verify(token) {
  try { return jwt.verify(token, config.jwtSecret); } catch (_) { return null; }
}
function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}
/** Attaches req.staff = {id, role, name} when a valid token is present. Never rejects. */
function optionalAuth(req, _res, next) {
  const t = tokenFrom(req);
  const p = t && verify(t);
  req.staff = p ? { id: p.sub, role: p.role, name: p.name } : null;
  next();
}
/** requireRole() = any signed-in staff; requireRole('admin') = admins only, etc. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.staff) return next(unauthorized());
    if (roles.length && !roles.includes(req.staff.role)) return next(forbidden());
    next();
  };
}
module.exports = { sign, verify, optionalAuth, requireRole };
