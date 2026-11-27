'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

describe('v1.22.1 F1 A2 — OXB-221-02 (OB-26)', () => {
  it('A2: OXB-221-02 .gitattributes enforces eol=lf on text/code/markdown/json/yml and eol=crlf on Windows scripts', () => {
    const attrPath = path.join(ROOT, '.gitattributes');
    assert.equal(fs.existsSync(attrPath), true, '.gitattributes must exist at repository root');
    const txt = fs.readFileSync(attrPath, 'utf8');
    for (const ext of ['*.js', '*.cjs', '*.mjs', '*.ts', '*.json', '*.md', '*.yml', '*.yaml', '*.sh']) {
      const re = new RegExp(`^\\${ext}\\s+.*eol=lf\\b`, 'm');
      assert.match(txt, re, `.gitattributes must enforce eol=lf for ${ext}`);
    }
    for (const ext of ['*.cmd', '*.bat', '*.ps1']) {
      const re = new RegExp(`^\\${ext}\\s+.*eol=crlf\\b`, 'm');
      assert.match(txt, re, `.gitattributes must enforce eol=crlf for ${ext}`);
    }
    for (const ext of ['*.png', '*.vsix', '*.tgz']) {
      const re = new RegExp(`^\\${ext}\\s+binary\\b`, 'm');
      assert.match(txt, re, `.gitattributes must mark ${ext} as binary`);
    }
  });
});
