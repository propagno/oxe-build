#!/usr/bin/env node
'use strict';

/**
 * OXB-132: writes oxe/workflows/compact/<name>.md for every workflow of size class `l` in oxe/workflows/size-budget.json.
 * `--check` exits 1 when a compact variant is missing or stale (CI / release).
 */

const fs = require('fs');
const path = require('path');
const lib = require('../bin/lib/oxe-workflow-budget.cjs');

const root = path.join(__dirname, '..');
const budget = JSON.parse(fs.readFileSync(lib.BUDGET_FILE, 'utf8'));
const check = process.argv.includes('--check');
const outDir = path.join(root, 'oxe', 'workflows', 'compact');
let stale = 0;
for (const [rel, size] of Object.entries(budget.files)) {
  if (size !== 'l' || !rel.startsWith('workflows/')) continue;
  const name = path.basename(rel);
  const text = fs.readFileSync(path.join(root, 'oxe', rel), 'utf8');
  const compact = lib.compactOf(name, text);
  const target = path.join(outDir, name);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === compact) continue;
  stale += 1;
  if (check) { console.error(`stale: oxe/workflows/compact/${name}`); continue; }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(target, compact);
  console.log(`wrote oxe/workflows/compact/${name} (${lib.lineCount(text)} → ${lib.lineCount(compact)} linhas)`);
}
if (check && stale) process.exit(1);
