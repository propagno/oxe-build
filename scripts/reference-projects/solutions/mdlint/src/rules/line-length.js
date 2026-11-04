'use strict';
const id = 'line-length';
function check(doc, options = {}) {
  const max = options.max || 100;
  return doc.lines
    .filter((l) => !l.inCode && l.text.length > max && !/^https?:\/\/\S+$/.test(l.text.trim()))
    .map((l) => ({ rule: id, line: l.number, message: `line is ${l.text.length} characters (max ${max})` }));
}
module.exports = { id, check };
