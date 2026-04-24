#!/usr/bin/env node
/**
 * Lightweight scan for accidental secret-like patterns in OXE-packaged markdown.
 * Run from repo root: node scripts/oxe-assets-scan.cjs
 *
 * Tests / tooling: set OXE_ASSETS_SCAN_ROOT to an absolute path to scan that tree
 * (expects the same layout: oxe/, .github/, commands/, bin/lib/ under that root).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.OXE_ASSETS_SCAN_ROOT
  ? path.resolve(process.env.OXE_ASSETS_SCAN_ROOT)
  : path.join(__dirname, '..');
const PATTERNS = [
  { name: 'OpenAI-style key', re: /sk-[a-zA-Z0-9]{20,}/g },
  { name: 'Stripe live key', re: /sk_live_[a-zA-Z0-9]+/g },
  { name: 'AWS access key', re: /AKIA[A-Z0-9]{16}/g },
  { name: 'GitHub PAT ghp', re: /ghp_[a-zA-Z0-9]{36}/g },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'Legacy product name', re: /get shit done|get-shit-done|\bGSD\b/gi },
  { name: 'Legacy command namespace', re: /\/gsd|commands\/gsd|gsd-tools/gi },
  { name: 'Legacy state directory', re: /\.planning/gi },
];

const DIRS = [
  path.join(ROOT, 'oxe'),
  path.join(ROOT, '.github'),
  path.join(ROOT, 'commands'),
  path.join(ROOT, 'bin', 'lib'),
];

/** @param {string} dir */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, acc);
    else if (name.isFile() && (p.endsWith('.md') || p.endsWith('.prompt.md'))) acc.push(p);
  }
  return acc;
}

let failures = 0;
const files = DIRS.flatMap((d) => walk(d));
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      console.error(`[oxe-assets-scan] ${name} pattern in ${path.relative(ROOT, file)}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\noxe-assets-scan: ${failures} finding(s) — remove or redact before commit.`);
  process.exit(1);
}
console.log(`oxe-assets-scan: OK (${files.length} markdown files checked)`);
