'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const runtimeSemantics = require('../bin/lib/oxe-runtime-semantics.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const PROMPTS_DIR = path.join(REPO_ROOT, '.github', 'prompts');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands', 'oxe');
const REFERENCES_DIR = path.join(REPO_ROOT, 'oxe', 'workflows', 'references');

function parseFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(front, `Frontmatter ausente em ${filePath}`);
  /** @type {Record<string, string>} */
  const map = {};
  for (const line of front[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (m) map[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { frontmatter: map, text: raw };
}

describe('runtime semantics metadata', () => {
  test('reasoning references exist', () => {
    for (const ref of Object.values(runtimeSemantics.MODE_REFERENCES)) {
      assert.ok(fs.existsSync(path.join(REPO_ROOT, ref)), `${ref} deve existir`);
    }
    assert.ok(fs.existsSync(path.join(REFERENCES_DIR, 'reasoning-discovery.md')));
  });

  test('prompt and command wrappers expose identical runtime metadata per slug', () => {
    const promptFiles = fs
      .readdirSync(PROMPTS_DIR)
      .filter((name) => (name === 'oxe.prompt.md' || name.startsWith('oxe-')) && name.endsWith('.prompt.md'))
      .sort();

    for (const promptName of promptFiles) {
      const slug = runtimeSemantics.slugFromPromptFilename(promptName);
      const commandName = `${slug}.md`;
      const prompt = parseFrontmatter(path.join(PROMPTS_DIR, promptName));
      const command = parseFrontmatter(path.join(COMMANDS_DIR, commandName));
      const expected = runtimeSemantics.getRuntimeMetadataForSlug(slug);

      for (const key of runtimeSemantics.RUNTIME_METADATA_KEYS) {
        assert.strictEqual(prompt.frontmatter[key], expected[key], `${promptName} deve ter ${key}`);
        assert.strictEqual(command.frontmatter[key], expected[key], `${commandName} deve ter ${key}`);
      }

      assert.ok(
        prompt.text.includes('<!-- oxe-reasoning-contract:start -->'),
        `${promptName} deve incluir bloco de contrato`
      );
      assert.ok(
        command.text.includes('<!-- oxe-reasoning-contract:start -->'),
        `${commandName} deve incluir bloco de contrato`
      );
      assert.ok(
        prompt.text.includes(`.oxe/context/packs/${slug}.md`),
        `${promptName} deve expor o context pack prioritário`
      );
      assert.ok(
        command.text.includes(`.oxe/context/packs/${slug}.json`),
        `${commandName} deve expor o context pack estruturado`
      );
      assert.ok(
        prompt.text.includes('Regra pack-first'),
        `${promptName} deve declarar a regra pack-first`
      );
      assert.ok(
        command.text.includes('Regra pack-first'),
        `${commandName} deve declarar a regra pack-first`
      );
    }
  });
});
