'use strict';
const { parseMarkdown } = require('../parse.js');
const id = 'no-trailing-spaces';
function check(doc) {
  return doc.lines.filter((l) => !l.inCode && /[ \t]$/.test(l.text)).map((l) => ({ rule: id, line: l.number, message: 'trailing whitespace' }));
}
function fix(text) {
  const doc = parseMarkdown(text);
  const parts = String(text).split(/(\r?\n)/);
  let n = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const line = doc.lines[n++];
    if (line && !line.inCode) parts[i] = parts[i].replace(/[ \t]+$/, '');
  }
  return parts.join('');
}
module.exports = { id, check, fix };
