#!/usr/bin/env node
'use strict';

const path = require('path');

const release = require('../bin/lib/oxe-release.cjs');

const PROJECT_ROOT = process.env.OXE_RELEASE_PROJECT_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PROJECT_ROOT)
  : path.join(__dirname, '..');
const PACKAGE_ROOT = process.env.OXE_RELEASE_PACKAGE_ROOT
  ? path.resolve(process.env.OXE_RELEASE_PACKAGE_ROOT)
  : path.join(__dirname, '..');

const writeManifest = process.argv.includes('--write-manifest');
const result = release.checkReleaseConsistency(PROJECT_ROOT, {
  packageRoot: PACKAGE_ROOT,
  writeManifest,
});

if (result.ok) {
  console.log(`release-doctor: OK (${result.manifest.versions.rootPackage.version})`);
  if (writeManifest) {
    console.log(`release-doctor: manifest escrito em ${result.manifestPath}`);
  }
  process.exit(0);
}

console.error('release-doctor: BLOCKED');
for (const blocker of result.blockers) {
  console.error(`- ${blocker}`);
}
for (const warning of result.warnings) {
  console.error(`! ${warning}`);
}
if (writeManifest) {
  console.error(`manifest: ${result.manifestPath}`);
}
process.exit(1);
