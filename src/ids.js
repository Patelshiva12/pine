'use strict';
const crypto = require('crypto');
const ALNUM = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pick = (alpha, n) => { const b = crypto.randomBytes(n); let s = ''; for (const x of b) s += alpha[x % alpha.length]; return s; };
module.exports = {
  orderId: () => 'o' + Date.now().toString(36) + pick(ALNUM, 4),
  itemKey: () => pick(ALNUM, 6),
  orderCode: () => pick(CODE, 4),
  guestToken: () => crypto.randomBytes(18).toString('base64url'),
  rand: n => pick(ALNUM, n),
};
