'use strict';
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}
const bad = (msg, details) => new ApiError(400, 'bad_request', msg, details);
const unauthorized = (msg = 'Sign in with a staff PIN') => new ApiError(401, 'unauthorized', msg);
const forbidden = (msg = 'Your role cannot do this') => new ApiError(403, 'forbidden', msg);
const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);
const conflict = (msg, details) => new ApiError(409, 'conflict', msg, details);

/** Validate with a zod schema; throws 400 with field errors. */
function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const details = r.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
    throw bad('Invalid request: ' + details.map(d => `${d.path || 'body'} ${d.message}`).join('; '), details);
  }
  return r.data;
}

/** Wrap async route handlers so rejections reach the error middleware. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ApiError, bad, unauthorized, forbidden, notFound, conflict, parse, ah };
