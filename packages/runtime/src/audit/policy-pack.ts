import path from 'path';
import fs from 'fs';
import type { PolicyRule, EnvironmentGuardrail } from '../policy/policy-engine';
import { PolicyEngine } from '../policy/policy-engine';

export interface PolicyPack {
  pack_id: string;
  org_id: string;
  name: string;
  version: string;
  policies: PolicyRule[];
  guardrail: EnvironmentGuardrail;
  created_at: string;
}

function packDir(projectRoot: string): string {
  return path.join(projectRoot, '.oxe', 'policy-packs');
}

function packFilePath(projectRoot: string, packId: string): string {
  return path.join(packDir(projectRoot), `${packId}.json`);
}

export function savePolicyPack(projectRoot: string, pack: PolicyPack): void {
  const dir = packDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(packFilePath(projectRoot, pack.pack_id), JSON.stringify(pack, null, 2), 'utf8');
}

export function loadPolicyPack(projectRoot: string, packId: string): PolicyPack | null {
  const p = packFilePath(projectRoot, packId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as PolicyPack;
  } catch {
    return null;
  }
}

export function listPolicyPacks(projectRoot: string): PolicyPack[] {
  const dir = packDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as PolicyPack;
      } catch {
        return null;
      }
    })
    .filter((p): p is PolicyPack => p !== null);
}

export function applyPolicyPack(engine: PolicyEngine, pack: PolicyPack): PolicyEngine {
  let result = engine.withGuardrail(pack.guardrail);
  for (const rule of pack.policies) {
    result = result.withRule(rule);
  }
  return result;
}
