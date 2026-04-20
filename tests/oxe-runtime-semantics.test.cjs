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

// Helper: first available slug from registry (used by multiple tests)
function firstAvailableSlug() {
  const contracts = runtimeSemantics.getAllWorkflowContracts();
  return contracts.length ? contracts[0].workflow_slug : null;
}

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

  test('execute e verify wrappers expõem caminho runtime enterprise padrão', () => {
    for (const [slug, commands] of [
      ['execute', ['oxe-cc runtime compile --dir <projeto>', 'oxe-cc runtime project --dir <projeto>']],
      ['verify', ['oxe-cc runtime verify --dir <projeto>', 'oxe-cc runtime project --dir <projeto>']],
    ]) {
      const promptName = slug === 'oxe' ? 'oxe.prompt.md' : `oxe-${slug}.prompt.md`;
      const commandName = `${slug}.md`;
      const prompt = fs.readFileSync(path.join(PROMPTS_DIR, promptName), 'utf8');
      const command = fs.readFileSync(path.join(COMMANDS_DIR, commandName), 'utf8');

      assert.ok(prompt.includes('**Caminho runtime padrão:**'), `${promptName} deve expor caminho runtime padrão`);
      assert.ok(command.includes('**Caminho runtime padrão:**'), `${commandName} deve expor caminho runtime padrão`);

      for (const expectedCommand of commands) {
        assert.ok(prompt.includes(expectedCommand), `${promptName} deve citar ${expectedCommand}`);
        assert.ok(command.includes(expectedCommand), `${commandName} deve citar ${expectedCommand}`);
      }
    }
  });
});

describe('runtime semantics — funções utilitárias puras', () => {
  test('RUNTIME_METADATA_KEYS contém exatamente 9 chaves', () => {
    assert.strictEqual(runtimeSemantics.RUNTIME_METADATA_KEYS.length, 9);
    assert.ok(runtimeSemantics.RUNTIME_METADATA_KEYS.includes('oxe_workflow_slug'));
    assert.ok(runtimeSemantics.RUNTIME_METADATA_KEYS.includes('oxe_semantics_hash'));
    assert.ok(runtimeSemantics.RUNTIME_METADATA_KEYS.includes('oxe_contract_version'));
  });

  test('CONTRACT_VERSION é uma string semver', () => {
    assert.strictEqual(typeof runtimeSemantics.CONTRACT_VERSION, 'string');
    assert.match(runtimeSemantics.CONTRACT_VERSION, /^\d+\.\d+\.\d+$/);
  });

  test('REQUIRED_CONTRACT_FIELDS lista os campos obrigatórios esperados', () => {
    const fields = runtimeSemantics.REQUIRED_CONTRACT_FIELDS;
    assert.ok(Array.isArray(fields));
    for (const field of ['reasoning_mode', 'output_contract', 'tool_profile', 'required_artifacts']) {
      assert.ok(fields.includes(field), `REQUIRED_CONTRACT_FIELDS deve incluir ${field}`);
    }
  });

  test('slugFromPromptFilename extrai slug corretamente', () => {
    assert.strictEqual(runtimeSemantics.slugFromPromptFilename('oxe-plan.prompt.md'), 'plan');
    assert.strictEqual(runtimeSemantics.slugFromPromptFilename('oxe-execute.prompt.md'), 'execute');
    assert.strictEqual(runtimeSemantics.slugFromPromptFilename('oxe.prompt.md'), 'oxe'); // sem prefixo oxe-, mas strip do sufixo
    assert.strictEqual(runtimeSemantics.slugFromPromptFilename('oxe-verify.prompt.md'), 'verify');
  });

  test('slugFromCommandFilename extrai slug corretamente', () => {
    assert.strictEqual(runtimeSemantics.slugFromCommandFilename('oxe-plan.md'), 'plan');
    assert.strictEqual(runtimeSemantics.slugFromCommandFilename('plan.md'), 'plan');
    assert.strictEqual(runtimeSemantics.slugFromCommandFilename('oxe-verify.md'), 'verify');
    assert.strictEqual(runtimeSemantics.slugFromCommandFilename('verify.md'), 'verify');
  });

  test('splitFrontmatter separa frontmatter do corpo', () => {
    const raw = '---\nfoo: bar\nbaz: qux\n---\nbody content here';
    const result = runtimeSemantics.splitFrontmatter(raw);
    assert.strictEqual(result.frontmatter, 'foo: bar\nbaz: qux');
    assert.strictEqual(result.body, 'body content here');
  });

  test('splitFrontmatter retorna body vazio sem frontmatter', () => {
    const raw = 'just body text without frontmatter';
    const result = runtimeSemantics.splitFrontmatter(raw);
    assert.strictEqual(result.frontmatter, '');
    assert.ok(result.body.includes('just body text'));
  });

  test('splitFrontmatter normaliza BOM e CRLF', () => {
    const raw = '\uFEFF---\r\nkey: value\r\n---\r\nbody';
    const result = runtimeSemantics.splitFrontmatter(raw);
    assert.ok(result.frontmatter.includes('key: value'));
    assert.ok(result.body.includes('body'));
  });

  test('parseFrontmatterMap extrai pares chave-valor', () => {
    const raw = '---\nfoo: bar\nbaz: "quoted"\n---\nbody';
    const result = runtimeSemantics.parseFrontmatterMap(raw);
    assert.strictEqual(result.foo, 'bar');
    assert.strictEqual(result.baz, 'quoted');
  });

  test('parseFrontmatterMap retorna objeto vazio sem frontmatter', () => {
    const result = runtimeSemantics.parseFrontmatterMap('no frontmatter here');
    assert.deepStrictEqual(result, {});
  });

  test('buildContextPackPaths retorna caminhos corretos para slug', () => {
    const paths = runtimeSemantics.buildContextPackPaths('plan');
    assert.strictEqual(paths.markdown, '.oxe/context/packs/plan.md');
    assert.strictEqual(paths.json, '.oxe/context/packs/plan.json');
    assert.ok(paths.inspectCommand.includes('plan'));
    assert.ok(paths.inspectCommand.includes('oxe-cc context inspect'));
  });

  test('buildContextTiers constrói minimal/standard/full corretamente', () => {
    const required = ['.oxe/STATE.md', '.oxe/PLAN.md'];
    const optional = ['.oxe/codebase/project_summary.md', '.oxe/codebase/phase_summary.md', 'extra1.md', 'extra2.md', 'extra3.md'];
    const tiers = runtimeSemantics.buildContextTiers(required, optional);
    assert.ok(Array.isArray(tiers.minimal));
    assert.ok(Array.isArray(tiers.standard));
    assert.ok(Array.isArray(tiers.full));
    assert.ok(tiers.minimal.length >= required.length, 'minimal deve incluir required');
    assert.ok(tiers.full.length >= tiers.standard.length, 'full deve ser >= standard');
    assert.ok(tiers.standard.length >= tiers.minimal.length, 'standard deve ser >= minimal');
    for (const item of required) {
      assert.ok(tiers.minimal.includes(item), `minimal deve conter ${item}`);
      assert.ok(tiers.full.includes(item), `full deve conter ${item}`);
    }
  });

  test('buildContextTiers deduplica entradas', () => {
    const required = ['a.md', 'a.md', 'b.md'];
    const optional = ['b.md', 'c.md'];
    const tiers = runtimeSemantics.buildContextTiers(required, optional);
    const fullUniq = new Set(tiers.full);
    assert.strictEqual(fullUniq.size, tiers.full.length, 'full não deve ter duplicatas');
  });

  test('pickRuntimeMetadata filtra apenas chaves do schema', () => {
    const frontmatter = {
      oxe_workflow_slug: 'plan',
      oxe_reasoning_mode: 'planning',
      extra_key: 'should_be_ignored',
      another_extra: 'also_ignored',
    };
    const result = runtimeSemantics.pickRuntimeMetadata(frontmatter);
    assert.strictEqual(result.oxe_workflow_slug, 'plan');
    assert.strictEqual(result.oxe_reasoning_mode, 'planning');
    assert.strictEqual(result.extra_key, undefined);
    assert.strictEqual(result.another_extra, undefined);
  });

  test('renderRuntimeMetadataLines retorna array de linhas com formato chave: valor', () => {
    const meta = {
      oxe_workflow_slug: 'plan',
      oxe_reasoning_mode: 'planning',
      oxe_contract_version: '2.0.0',
    };
    const lines = runtimeSemantics.renderRuntimeMetadataLines(meta);
    assert.ok(Array.isArray(lines));
    assert.strictEqual(lines.length, runtimeSemantics.RUNTIME_METADATA_KEYS.length);
    assert.ok(lines[0].startsWith('oxe_workflow_slug:'));
    assert.ok(lines[0].includes('plan'));
  });
});

describe('runtime semantics — contratos e registry', () => {
  test('getAllWorkflowContracts retorna array não vazio de contratos', () => {
    const contracts = runtimeSemantics.getAllWorkflowContracts();
    assert.ok(Array.isArray(contracts));
    assert.ok(contracts.length > 0, 'deve haver ao menos um workflow no registry');
  });

  test('getAllWorkflowContracts retorna contratos em ordem alfabética', () => {
    const contracts = runtimeSemantics.getAllWorkflowContracts();
    const slugs = contracts.map((c) => c.workflow_slug);
    const sorted = [...slugs].sort();
    assert.deepStrictEqual(slugs, sorted, 'contratos devem estar em ordem alfabética');
  });

  test('getWorkflowContract retorna null para slug desconhecido', () => {
    const result = runtimeSemantics.getWorkflowContract('slug-que-nao-existe-xyz');
    assert.strictEqual(result, null);
  });

  test('getWorkflowContract retorna contrato completo para slug válido', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug, 'deve haver ao menos um slug disponível');
    const contract = runtimeSemantics.getWorkflowContract(slug);
    assert.ok(contract, `contrato para "${slug}" não deve ser null`);
    assert.strictEqual(contract.workflow_slug, slug);
    assert.ok(typeof contract.reasoning_mode === 'string');
    assert.ok(Array.isArray(contract.required_artifacts));
    assert.ok(Array.isArray(contract.optional_artifacts));
    assert.ok(contract.context_tiers && typeof contract.context_tiers === 'object');
    assert.ok(Array.isArray(contract.context_tiers.minimal));
    assert.ok(Array.isArray(contract.context_tiers.standard));
    assert.ok(Array.isArray(contract.context_tiers.full));
  });

  test('computeSemanticsHash retorna hash hex de 16 chars para slug válido', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const hash = runtimeSemantics.computeSemanticsHash(slug);
    assert.ok(typeof hash === 'string', 'hash deve ser string');
    assert.strictEqual(hash.length, 16, 'hash deve ter 16 chars');
    assert.match(hash, /^[0-9a-f]+$/, 'hash deve ser hex lowercase');
  });

  test('computeSemanticsHash é determinístico para o mesmo slug', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const h1 = runtimeSemantics.computeSemanticsHash(slug);
    const h2 = runtimeSemantics.computeSemanticsHash(slug);
    assert.strictEqual(h1, h2, 'hash deve ser determinístico');
  });

  test('computeSemanticsHash retorna null para slug desconhecido', () => {
    const result = runtimeSemantics.computeSemanticsHash('slug-inexistente-xyz');
    assert.strictEqual(result, null);
  });

  test('getRuntimeMetadataForSlug retorna metadados corretos para slug válido', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const meta = runtimeSemantics.getRuntimeMetadataForSlug(slug);
    assert.strictEqual(meta.oxe_workflow_slug, slug);
    assert.ok(typeof meta.oxe_reasoning_mode === 'string');
    assert.ok(typeof meta.oxe_contract_version === 'string');
    assert.ok(typeof meta.oxe_semantics_hash === 'string');
    assert.strictEqual(meta.oxe_context_tier, 'standard', 'tier padrão deve ser standard');
  });

  test('getRuntimeMetadataForSlug respeita opção de tier', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const metaMinimal = runtimeSemantics.getRuntimeMetadataForSlug(slug, { tier: 'minimal' });
    const metaFull = runtimeSemantics.getRuntimeMetadataForSlug(slug, { tier: 'full' });
    assert.strictEqual(metaMinimal.oxe_context_tier, 'minimal');
    assert.strictEqual(metaFull.oxe_context_tier, 'full');
  });

  test('getRuntimeMetadataForSlug retorna fallback para slug desconhecido', () => {
    const meta = runtimeSemantics.getRuntimeMetadataForSlug('slug-desconhecido-xyz');
    assert.strictEqual(meta.oxe_workflow_slug, 'slug-desconhecido-xyz');
    assert.ok(typeof meta.oxe_semantics_hash === 'string', 'fallback deve ter hash');
    assert.ok(typeof meta.oxe_contract_version === 'string');
  });

  test('validateWorkflowContractsRegistry retorna array vazio para registry válido', () => {
    const issues = runtimeSemantics.validateWorkflowContractsRegistry();
    assert.ok(Array.isArray(issues));
    assert.strictEqual(issues.length, 0, `registry deve ser válido, issues: ${JSON.stringify(issues)}`);
  });

  test('validateWorkflowContractsRegistry reporta erros para registry inválido', () => {
    const issuesNull = runtimeSemantics.validateWorkflowContractsRegistry(null);
    assert.ok(issuesNull.length > 0, 'null deve gerar issues');

    const issuesMissingVersion = runtimeSemantics.validateWorkflowContractsRegistry({
      workflows: {},
    });
    assert.ok(issuesMissingVersion.length > 0, 'falta contract_version deve gerar issue');

    const issuesMissingWorkflows = runtimeSemantics.validateWorkflowContractsRegistry({
      contract_version: '1.0.0',
    });
    assert.ok(issuesMissingWorkflows.length > 0, 'falta workflows deve gerar issue');
  });

  test('buildReasoningContractBlock inclui marcadores obrigatórios', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const meta = runtimeSemantics.getRuntimeMetadataForSlug(slug);
    const block = runtimeSemantics.buildReasoningContractBlock(meta);
    assert.ok(block.includes('<!-- oxe-reasoning-contract:start -->'), 'deve incluir marcador start');
    assert.ok(block.includes('<!-- oxe-reasoning-contract:end -->'), 'deve incluir marcador end');
    assert.ok(block.includes('Regra pack-first'), 'deve declarar regra pack-first');
    assert.ok(block.includes(`.oxe/context/packs/${slug}.md`), 'deve referenciar context pack markdown');
    assert.ok(block.includes(`.oxe/context/packs/${slug}.json`), 'deve referenciar context pack json');
  });

  test('buildReasoningContractBlock sem includeReference omite referência canónica', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const meta = runtimeSemantics.getRuntimeMetadataForSlug(slug);
    const blockSem = runtimeSemantics.buildReasoningContractBlock(meta, { includeReference: false });
    assert.ok(!blockSem.includes('Referência canónica'), 'deve omitir referência quando includeReference=false');
  });

  test('auditWrapperText detecta drift em wrapper com frontmatter errado', () => {
    const slug = firstAvailableSlug();
    assert.ok(slug);
    const fakeRaw = `---\noxe_workflow_slug: ${slug}\noxe_reasoning_mode: WRONG_MODE\n---\nbody`;
    const result = runtimeSemantics.auditWrapperText(slug, fakeRaw);
    assert.strictEqual(result.slug, slug);
    assert.ok(!result.ok, 'deve detectar drift no reasoning_mode');
    assert.ok(result.issues.length > 0, 'deve ter pelo menos 1 issue');
  });

  test('auditRuntimeTargets audita targets do projeto e retorna estrutura válida', () => {
    const result = runtimeSemantics.auditRuntimeTargets(REPO_ROOT);
    assert.ok(typeof result === 'object', 'deve retornar objeto');
    assert.ok(typeof result.ok === 'boolean', 'deve ter campo ok');
    assert.ok(typeof result.contractVersion === 'string', 'deve ter contractVersion');
    assert.ok(Array.isArray(result.registryIssues), 'deve ter registryIssues como array');
    assert.ok(typeof result.targets === 'object', 'deve ter targets');
    assert.ok('copilot-prompts' in result.targets, 'deve ter target copilot-prompts');
    assert.ok('commands' in result.targets, 'deve ter target commands');
  });
});
