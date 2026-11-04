'use strict';
const id = 'heading-increment';
function check(doc) {
  const out = [];
  let prev = null;
  for (const h of doc.headings) {
    if (prev != null && h.level > prev + 1) out.push({ rule: id, line: h.line, message: `heading level ${h.level} after ${prev}` });
    prev = h.level;
  }
  return out;
}
module.exports = { id, check };
