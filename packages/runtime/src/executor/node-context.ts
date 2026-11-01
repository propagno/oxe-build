import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';
import type { ExportedSymbol } from '../verification/contract-exports';

/**
 * What the executor knows about a node beyond its title and actions. Without it every attempt spent
 * turns rediscovering the workspace and drifted from the IMPLEMENTATION-PACK (1.17 benchmark, T3).
 */
export interface WorkspaceFileSnapshot {
  path: string;
  exists: boolean;
  bytes?: number;
  /** First lines of the file, already truncated. */
  head?: string;
}

export interface NodeExecutionContext {
  /** The task's own section of PLAN.md. */
  taskBody?: string | null;
  /** The task's IMPLEMENTATION-PACK entry (paths, symbols, contracts). */
  implementationContract?: unknown;
  /** The task's FIXTURE-PACK entry. */
  fixture?: unknown;
  /** Files in the task's scope and contract, as they are now. */
  workspaceFiles?: WorkspaceFileSnapshot[];
  /** `git status --porcelain` of the workspace. */
  gitStatus?: string | null;
  /**
   * Public surface of modules the task consumes (closed program phases + completed dependencies):
   * exports and signatures instead of raw files, so the prompt does not grow with the codebase.
   */
  interfaces?: ModuleInterface[];
  lessons?: string[];
}

export interface ModuleInterface {
  file: string;
  exports: ExportedSymbol[];
  /** Program phase that delivered it; null for a dependency of the current run. */
  phase?: string | null;
}

export type NodeContextProvider = (node: GraphNode, lease: WorkspaceLease) => NodeExecutionContext | null;

export interface NodeContextBudget {
  taskBody: number;
  contract: number;
  fixture: number;
  filesTotal: number;
  gitStatus: number;
  lessons: number;
  interfaces?: number;
}

export const DEFAULT_NODE_CONTEXT_BUDGET: NodeContextBudget = {
  taskBody: 3000,
  contract: 3000,
  fixture: 1500,
  filesTotal: 8000,
  gitStatus: 1000,
  lessons: 1500,
  interfaces: 4000,
};

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [truncado: ${text.length - limit} caracteres omitidos]`;
}

function asJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 1);
}

/** Markdown sections appended to the node prompt; empty when there is no context. */
export function renderNodeContext(ctx: NodeExecutionContext | null | undefined, budget: NodeContextBudget = DEFAULT_NODE_CONTEXT_BUDGET): string[] {
  if (!ctx) return [];
  const lines: string[] = [];

  if (ctx.taskBody && ctx.taskBody.trim()) {
    lines.push('', '## Tarefa no PLAN', truncate(ctx.taskBody.trim(), budget.taskBody));
  }

  if (ctx.implementationContract) {
    lines.push('', '## Contrato (IMPLEMENTATION-PACK)');
    lines.push('Siga estes caminhos, símbolos e contratos — o verify cobra os `exact_paths`.');
    lines.push('```json', truncate(asJson(ctx.implementationContract), budget.contract), '```');
  }

  if (ctx.fixture) {
    lines.push('', '## Fixture (FIXTURE-PACK)');
    // `.oxe/` is OXE's local state (usually gitignored): product code reading it breaks in CI.
    lines.push('Os `ref` abaixo são artefatos do OXE em `.oxe/`, que não fazem parte do produto: copie os dados necessários para dentro do escopo da tarefa (ex.: `test/fixtures/`). Código e testes do produto nunca leem `.oxe/` — o verify reprova.');
    lines.push('```json', truncate(asJson(ctx.fixture), budget.fixture), '```');
  }

  const files = ctx.workspaceFiles ?? [];
  if (files.length > 0) {
    lines.push('', '## Estado atual do workspace');
    let used = 0;
    for (const file of files) {
      if (!file.exists) {
        lines.push(`- \`${file.path}\` — não existe ainda`);
        continue;
      }
      lines.push(`- \`${file.path}\` — ${file.bytes ?? 0} bytes`);
      if (file.head && used < budget.filesTotal) {
        const head = truncate(file.head, Math.max(0, budget.filesTotal - used));
        used += head.length;
        lines.push('```', head, '```');
      }
    }
  }

  const modules = (ctx.interfaces ?? []).filter((m) => m && m.file && Array.isArray(m.exports) && m.exports.length > 0);
  if (modules.length > 0) {
    lines.push('', '## Interfaces disponíveis');
    lines.push('Módulos já entregues que esta tarefa pode consumir. Importe por estes nomes; não reimplemente nem mude a assinatura sem a tarefa pedir.');
    const body = modules
      .map((m) => {
        const origin = m.phase ? ` (fase ${m.phase})` : '';
        const symbols = m.exports.map((e) => `  - \`${e.name}${e.signature && e.signature !== 'class' ? e.signature : ''}\`${e.signature === 'class' ? ' — class' : ''}`);
        return [`- \`${m.file}\`${origin}`, ...symbols].join('\n');
      })
      .join('\n');
    lines.push(truncate(body, budget.interfaces ?? DEFAULT_NODE_CONTEXT_BUDGET.interfaces!));
  }

  if (ctx.gitStatus && ctx.gitStatus.trim()) {
    lines.push('', '## git status', '```', truncate(ctx.gitStatus.trim(), budget.gitStatus), '```');
  }

  const lessons = (ctx.lessons ?? []).filter((l) => l.trim());
  if (lessons.length > 0) {
    lines.push('', '## Lições de ciclos anteriores');
    lines.push(truncate(lessons.map((l) => `- ${l.trim()}`).join('\n'), budget.lessons));
  }

  return lines;
}
