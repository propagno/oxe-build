import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type {
  OxePlugin,
  ToolProvider,
  ToolInvocationInput,
  ToolInvocationResult,
  PreInvokeResult,
  VerifierProvider,
  VerificationInput,
} from './plugin-abi';
import type { VerificationResult } from '../models/verification-result';
import { CURRENT_ABI_VERSION } from './plugin-manifest';

interface CapabilityManifest {
  id: string;
  entrypoint: string | null;
  sideEffects: string[];
  evidenceOutputs: string[];
  checkTypes: string[];
  dir: string;
  timeoutMs: number;
  preInvokeHook: string | null;
  postInvokeHook: string | null;
}

const DEFAULT_CAPABILITY_TIMEOUT_MS = 60_000;

export async function runCapabilityAsync(
  program: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
  onChunk?: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn(program, args, { cwd, env, stdio: 'pipe' });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      onChunk?.(chunk.toString(), 'stdout');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      onChunk?.(chunk.toString(), 'stderr');
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: '', stderr: String(err), timedOut: false });
    });
  });
}

function parseFrontmatter(text: string): Record<string, string> {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function parseArrayField(value: string | undefined): string[] {
  const raw = String(value || '').trim();
  if (!raw || raw === '[]') return [];
  if (/^\[.*\]$/.test(raw)) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter(Boolean);
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function loadCapabilityManifests(projectRoot: string): CapabilityManifest[] {
  const capabilitiesDir = path.join(projectRoot, '.oxe', 'capabilities');
  if (!fs.existsSync(capabilitiesDir)) return [];
  return fs
    .readdirSync(capabilitiesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(capabilitiesDir, entry.name);
      const manifestPath = path.join(dir, 'CAPABILITY.md');
      if (!fs.existsSync(manifestPath)) return null;
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const fm = parseFrontmatter(raw);
      const id = String(fm.id || '').trim();
      if (!id) return null;
      const rawTimeout = parseInt(String(fm.timeout_ms || ''), 10);
      return {
        id,
        entrypoint: String(fm.entrypoint || '').trim() || null,
        sideEffects: parseArrayField(fm.side_effects),
        evidenceOutputs: parseArrayField(fm.evidence_outputs),
        checkTypes: parseArrayField(fm.check_types || fm.supports_checks),
        dir,
        timeoutMs: isNaN(rawTimeout) ? DEFAULT_CAPABILITY_TIMEOUT_MS : rawTimeout,
        preInvokeHook: String(fm.pre_invoke_hook || '').trim() || null,
        postInvokeHook: String(fm.post_invoke_hook || '').trim() || null,
      };
    })
    .filter((item): item is CapabilityManifest => Boolean(item));
}

function resolveEntrypoint(projectRoot: string, manifest: CapabilityManifest): string | null {
  if (!manifest.entrypoint) return null;
  if (path.isAbsolute(manifest.entrypoint)) return manifest.entrypoint;
  const capabilityRelative = path.join(manifest.dir, manifest.entrypoint);
  if (fs.existsSync(capabilityRelative)) return capabilityRelative;
  const projectRelative = path.join(projectRoot, manifest.entrypoint);
  if (fs.existsSync(projectRelative)) return projectRelative;
  return capabilityRelative;
}

function resolveEvidencePaths(projectRoot: string, manifest: CapabilityManifest): string[] {
  return manifest.evidenceOutputs
    .map((entry) => {
      const capabilityRelative = path.join(manifest.dir, entry);
      if (fs.existsSync(capabilityRelative)) return path.relative(projectRoot, capabilityRelative);
      const projectRelative = path.join(projectRoot, entry);
      if (fs.existsSync(projectRelative)) return path.relative(projectRoot, projectRelative);
      return path.relative(projectRoot, projectRelative);
    })
    .map((entry) => entry.replace(/\\/g, '/'));
}

function inferToolKind(sideEffects: string[]): ToolProvider['kind'] {
  if (sideEffects.some((effect) => /db|infra|network|external/i.test(effect))) return 'external_operation';
  if (sideEffects.some((effect) => /write|mutat|git/i.test(effect))) return 'mutation';
  if (sideEffects.some((effect) => /verify|test|evidence/i.test(effect))) return 'verification';
  if (sideEffects.some((effect) => /analysis|scan|read/i.test(effect))) return 'analysis';
  return 'read';
}

function buildToolProvider(projectRoot: string, manifest: CapabilityManifest): ToolProvider {
  return {
    name: manifest.id,
    kind: inferToolKind(manifest.sideEffects),
    idempotent: !manifest.sideEffects.some((effect) => /write|mutat|git|db|infra/i.test(effect)),
    supports(actionType: string): boolean {
      return actionType === manifest.id || actionType === `capability:${manifest.id}`;
    },
    async invoke(input: ToolInvocationInput): Promise<ToolInvocationResult> {
      const entrypoint = resolveEntrypoint(projectRoot, manifest);
      if (!entrypoint) {
        return {
          success: false,
          output: '',
          evidence_paths: [],
          side_effects_applied: [],
          error: `Capability ${manifest.id} does not declare an entrypoint`,
        };
      }
      const ext = path.extname(entrypoint).toLowerCase();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OXE_CAPABILITY_INPUT: JSON.stringify(input.params || {}),
        OXE_CAPABILITY_RUN_ID: input.run_id,
        OXE_CAPABILITY_WORK_ITEM_ID: input.work_item_id,
        OXE_CAPABILITY_ATTEMPT_ID: input.attempt_id,
        OXE_CAPABILITY_WORKSPACE_ROOT: input.workspace_root,
      };
      let program = entrypoint;
      let args: string[] = [];
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
        program = process.execPath;
        args = [entrypoint];
      } else if (ext === '.ps1') {
        program = 'powershell';
        args = ['-File', entrypoint];
      }
      const result = await runCapabilityAsync(program, args, env, projectRoot, manifest.timeoutMs);
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      if (result.timedOut) {
        return {
          success: false,
          output,
          evidence_paths: resolveEvidencePaths(projectRoot, manifest),
          side_effects_applied: manifest.sideEffects,
          error: `Capability ${manifest.id} timed out after ${manifest.timeoutMs}ms`,
        };
      }
      return {
        success: result.exitCode === 0,
        output,
        evidence_paths: resolveEvidencePaths(projectRoot, manifest),
        side_effects_applied: manifest.sideEffects,
        error: result.exitCode === 0 ? undefined : (result.stderr || result.stdout || `Capability exited with status ${result.exitCode}`),
      };
    },

    async preInvoke(input: ToolInvocationInput): Promise<PreInvokeResult> {
      if (!manifest.preInvokeHook) return { allowed: true };
      const hookPath = path.isAbsolute(manifest.preInvokeHook)
        ? manifest.preInvokeHook
        : path.join(manifest.dir, manifest.preInvokeHook);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OXE_CAPABILITY_INPUT: JSON.stringify(input.params || {}),
        OXE_CAPABILITY_RUN_ID: input.run_id,
        OXE_CAPABILITY_WORK_ITEM_ID: input.work_item_id,
        OXE_CAPABILITY_ATTEMPT_ID: input.attempt_id,
        OXE_CAPABILITY_WORKSPACE_ROOT: input.workspace_root,
      };
      const ext = path.extname(hookPath).toLowerCase();
      let program = hookPath;
      let args: string[] = [];
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') { program = process.execPath; args = [hookPath]; }
      else if (ext === '.ps1') { program = 'powershell'; args = ['-File', hookPath]; }
      const result = await runCapabilityAsync(program, args, env, projectRoot, 10_000);
      return result.exitCode === 0
        ? { allowed: true }
        : { allowed: false, reason: result.stderr || result.stdout || `pre_invoke_hook exited with status ${result.exitCode}` };
    },

    async postInvoke(input: ToolInvocationInput, _result: ToolInvocationResult): Promise<void> {
      if (!manifest.postInvokeHook) return;
      const hookPath = path.isAbsolute(manifest.postInvokeHook)
        ? manifest.postInvokeHook
        : path.join(manifest.dir, manifest.postInvokeHook);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        OXE_CAPABILITY_INPUT: JSON.stringify(input.params || {}),
        OXE_CAPABILITY_RUN_ID: input.run_id,
        OXE_CAPABILITY_WORK_ITEM_ID: input.work_item_id,
        OXE_CAPABILITY_ATTEMPT_ID: input.attempt_id,
        OXE_CAPABILITY_WORKSPACE_ROOT: input.workspace_root,
        OXE_INVOKE_SUCCESS: _result.success ? '1' : '0',
      };
      const ext = path.extname(hookPath).toLowerCase();
      let program = hookPath;
      let args: string[] = [];
      if (ext === '.js' || ext === '.cjs' || ext === '.mjs') { program = process.execPath; args = [hookPath]; }
      else if (ext === '.ps1') { program = 'powershell'; args = ['-File', hookPath]; }
      await runCapabilityAsync(program, args, env, projectRoot, 10_000).catch(() => {});
    },
  };
}

function buildVerifierProvider(projectRoot: string, manifest: CapabilityManifest): VerifierProvider | null {
  if (!manifest.checkTypes.length) return null;
  return {
    name: `${manifest.id}-verifier`,
    supports(checkType: string): boolean {
      return manifest.checkTypes.includes(checkType);
    },
    async execute(input: VerificationInput): Promise<VerificationResult> {
      const tool = await buildToolProvider(projectRoot, manifest).invoke({
        action_type: `verify:${input.check_type}`,
        work_item_id: input.work_item_id,
        run_id: input.work_item_id,
        attempt_id: `${input.work_item_id}-verify`,
        params: {
          check_id: input.check_id,
          check_type: input.check_type,
          command: input.command,
          evidence_dir: input.evidence_dir,
        },
        workspace_root: input.workspace_root,
      });
      return {
        verification_id: `vr-${manifest.id}-${input.check_id}`,
        work_item_id: input.work_item_id,
        check_id: input.check_id,
        status: tool.success ? 'pass' : 'fail',
        evidence_refs: tool.evidence_paths,
        summary: tool.error || tool.output || null,
      };
    },
  };
}

export function createCapabilityPlugin(projectRoot: string, manifest: CapabilityManifest): OxePlugin {
  const verifierProvider = buildVerifierProvider(projectRoot, manifest);
  return {
    name: `capability:${manifest.id}`,
    version: '0.0.0',
    abi_version: CURRENT_ABI_VERSION,
    toolProviders: [buildToolProvider(projectRoot, manifest)],
    verifierProviders: verifierProvider ? [verifierProvider] : [],
  };
}

export function loadCapabilityPlugins(projectRoot: string): OxePlugin[] {
  return loadCapabilityManifests(projectRoot).map((manifest) => createCapabilityPlugin(projectRoot, manifest));
}
