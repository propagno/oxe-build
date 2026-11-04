#!/usr/bin/env node
'use strict';
const { run } = require('../src/cli.js');
process.exit(run(process.argv.slice(2), { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr }));
