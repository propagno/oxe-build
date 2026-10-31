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
    if (ctx.implementationContract) {
        lines.push('', '## Contrato (IMPLEMENTATION-PACK)');
        lines.push('Siga estes caminhos, símbolos e contratos — o verify cobra os `exact_paths`.');
        lines.push('```json', truncate(asJson(ctx.implementationContract), budget.contract), '```');
    }
    if (ctx.fixture) {
        lines.push('', '## Fixture (FIXTURE-PACK)', '```json', truncate(asJson(ctx.fixture), budget.fixture), '```');
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
