'use strict';
const crypto = require('crypto');
function checkBearer(header, token) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { checkBearer };
