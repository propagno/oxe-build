"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NODE_CONTEXT_BUDGET = void 0;
exports.truncate = truncate;
exports.renderNodeContext = renderNodeContext;
exports.DEFAULT_NODE_CONTEXT_BUDGET = {
    taskBody: 3000,
    contract: 3000,
    fixture: 1500,
    filesTotal: 8000,
    gitStatus: 1000,
    lessons: 1500,
    interfaces: 4000,
    acceptance: 6000,
    repoRules: 3500,
    handoffs: 2500,
};
function truncate(text, limit) {
    if (text.length <= limit)
        return text;
    return `${text.slice(0, limit)}\n… [truncado: ${text.length - limit} caracteres omitidos]`;
}
function asJson(value) {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 1);
}
/** Markdown sections appended to the node prompt; empty when there is no context. */
function renderNodeContext(ctx, budget = exports.DEFAULT_NODE_CONTEXT_BUDGET) {
    if (!ctx)
        return [];
    const lines = [];
    if (ctx.taskBody && ctx.taskBody.trim()) {
        lines.push('', '## Tarefa no PLAN', truncate(ctx.taskBody.trim(), budget.taskBody));
    }
    const accepts = (ctx.acceptanceTests ?? []).filter((t) => t && t.path);
    if (accepts.length > 0) {
        lines.push('', '## Testes de aceite do plano (congelados)');
        lines.push('Estes testes definem o comportamento exigido e foram escritos antes da execução. Implemente o código para que passem exatamente como estão — inclusive nomes, assinaturas e formato de retorno. Não os edite: a escrita é negada e o verify reprova qualquer alteração (`acceptance_tampered`). Pode escrever testes próprios adicionais em outros arquivos.');
        let used = 0;
        const limit = budget.acceptance ?? exports.DEFAULT_NODE_CONTEXT_BUDGET.acceptance;
        for (const test of accepts) {
            lines.push(`- ${test.criterion}: \`${test.path}\`${test.command ? ` — \`${test.command}\`` : ''}`);
            if (test.content && used < limit) {
                const body = truncate(test.content, Math.max(0, limit - used));
                used += body.length;
                lines.push('```', body, '```');
            }
        }
    }
    const rules = (ctx.repoRules ?? []).filter((r) => r && r.text && r.text.trim());
    if (rules.length > 0) {
        lines.push('', '## Regras do repositório');
        lines.push('O próprio repositório cobra estas regras (testes de governança, políticas, AGENTS.md/CLAUDE.md) no gate da fase e na CI. Escreva de acordo desde a primeira vez; não afrouxe nenhum desses testes nem edite listas de exceção para passar.');
        const bySource = new Map();
        for (const rule of rules)
            bySource.set(rule.source, [...(bySource.get(rule.source) ?? []), rule.text.trim()]);
        const body = [...bySource.entries()].map(([source, texts]) => [`- \`${source}\``, ...texts.map((t) => `  - ${t}`)].join('\n')).join('\n');
        lines.push(truncate(body, budget.repoRules ?? exports.DEFAULT_NODE_CONTEXT_BUDGET.repoRules));
    }
    const handoffs = (ctx.handoffs ?? []).filter((h) => h && h.phase && h.text && h.text.trim());
    if (handoffs.length > 0) {
        lines.push('', '## O que as fases anteriores deixaram');
        lines.push('Notas de handoff das fases já fechadas do programa (dossiê). São decisões, limites e armadilhas já conhecidas: respeite-as e não as redescubra.');
        const body = handoffs.map((h) => `### ${h.phase}\n${h.text.trim()}`).join('\n\n');
        lines.push(truncate(body, budget.handoffs ?? exports.DEFAULT_NODE_CONTEXT_BUDGET.handoffs));
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
        lines.push(truncate(body, budget.interfaces ?? exports.DEFAULT_NODE_CONTEXT_BUDGET.interfaces));
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
