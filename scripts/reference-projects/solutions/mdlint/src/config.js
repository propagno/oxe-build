'use strict';
const fs = require('fs');
const path = require('path');
const DEFAULTS = { rules: { 'heading-increment': true, 'no-trailing-spaces': true, 'line-length': { max: 100 }, 'no-duplicate-heading': true } };
function loadConfig(dir, file = '.mdlintrc.json') {
  const full = path.resolve(dir, file);
  if (!fs.existsSync(full)) return JSON.parse(JSON.stringify(DEFAULTS));
  let user;
  try { user = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { throw new Error(`invalid config ${file}: ${e.message}`); }
  return { rules: { ...DEFAULTS.rules, ...((user && user.rules) || {}) } };
}
module.exports = { loadConfig, DEFAULTS };
