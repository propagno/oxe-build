"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectionEngine = void 0;
function isoToDate(iso) {
    if (!iso)
        return '—';
    return iso.slice(0, 10);
}
function statusIcon(status) {
    switch (status) {
        case 'completed': return '✓';
        case 'failed': return '✗';
        case 'blocked': return '⊘';
        case 'running': return '⟳';
        default: return '○';
    }
}
function verifyIcon(status) {
    switch (status) {
        case 'pass': return '✓ PASS';
        case 'fail': return '✗ FAIL';
        case 'skip': return '— SKIP';
        case 'error': return '! ERROR';
        default: return status;
    }
}
class ProjectionEngine {
    projectPlan(state, graph) {
        const run = state.run;
        const lines = [
            '# OXE — Plano de Execução',
            '',
            '<!-- Gerado automaticamente pelo Projection Engine — não editar diretamente -->',
            '',
            '## Resumo',
            '',
            `- **Run:** ${run?.run_id ?? '—'}`,
            `- **Status:** ${run?.status ?? 'sem run'}`,
            `- **Iniciado em:** ${isoToDate(run?.started_at)}`,
            `- **Nós:** ${graph.metadata.node_count} tarefas em ${graph.metadata.wave_count} onda(s)`,
            '',
            '## Ondas e tarefas',
            '',
        ];
        for (const wave of graph.waves) {
            lines.push(`### Onda ${wave.wave_number}`);
            lines.push('');
            lines.push('| ID | Título | Status | Dependências |');
            lines.push('|----|--------|--------|--------------|');
            for (const nodeId of wave.node_ids) {
                const node = graph.nodes.get(nodeId);
                const wItem = state.workItems.get(nodeId);
                const status = wItem?.status ?? 'pending';
                const deps = node?.depends_on.join(', ') || '—';
                lines.push(`| ${nodeId} | ${node?.title ?? nodeId} | ${statusIcon(status)} ${status} | ${deps} |`);
            }
            lines.push('');
        }
        if (state.completedWorkItems.size > 0 || state.failedWorkItems.size > 0) {
            lines.push('## Progresso');
            lines.push('');
            lines.push(`- **Concluídos:** ${[...state.completedWorkItems].join(', ') || '—'}`);
            lines.push(`- **Falhos:** ${[...state.failedWorkItems].join(', ') || '—'}`);
            lines.push(`- **Bloqueados:** ${[...state.blockedWorkItems].join(', ') || '—'}`);
            lines.push('');
        }
        return lines.join('\n');
    }
    projectVerify(state, results, checkResults) {
        const run = state.run;
        const lines = [
            '# OXE — Verificação',
            '',
            '<!-- Gerado automaticamente pelo Projection Engine — não editar diretamente -->',
            '',
            '## Auditoria de pré-execução',
            '',
            `- **Run:** ${run?.run_id ?? '—'}`,
            `- **Iniciado em:** ${isoToDate(run?.started_at)}`,
            `- **Concluído em:** ${isoToDate(run?.ended_at)}`,
            `- **Status:** ${run?.status ?? '—'}`,
            '',
        ];
        if (results.length > 0) {
            lines.push('## Critérios de aceite');
            lines.push('');
            lines.push('| ID | Check | Status | Evidências |');
            lines.push('|----|-------|--------|------------|');
            for (const r of results) {
                const evidenceList = r.evidence_refs.join(', ') || '—';
                lines.push(`| ${r.check_id} | ${r.summary ?? r.check_id} | ${verifyIcon(r.status)} | ${evidenceList} |`);
            }
            lines.push('');
        }
        if (checkResults && checkResults.length > 0) {
            lines.push('## Resultados dos checks executados');
            lines.push('');
            lines.push('| Check | Aceite | Status | Duração |');
            lines.push('|-------|--------|--------|---------|');
            for (const cr of checkResults) {
                lines.push(`| ${cr.check_id} | ${cr.acceptance_ref ?? '—'} | ${verifyIcon(cr.status)} | ${cr.duration_ms}ms |`);
            }
            lines.push('');
        }
        const passed = results.filter((r) => r.status === 'pass').length;
        const failed = results.filter((r) => r.status === 'fail').length;
        const allPass = failed === 0 && results.length > 0;
        lines.push('## Conclusão');
        lines.push('');
        lines.push(`- **Total de critérios:** ${results.length}`);
        lines.push(`- **Aprovados:** ${passed}`);
        lines.push(`- **Reprovados:** ${failed}`);
        lines.push('');
        lines.push(allPass
            ? '> ✓ **Verificação concluída com sucesso.** Todos os critérios foram atendidos.'
            : `> ✗ **Verificação com falhas.** ${failed} critério(s) não atendido(s).`);
        lines.push('');
        return lines.join('\n');
    }
    projectState(state) {
        const run = state.run;
        const completed = [...state.completedWorkItems];
        const failed = [...state.failedWorkItems];
        const blocked = [...state.blockedWorkItems];
        const lines = [
            '# OXE — Estado',
            '',
            '<!-- Gerado automaticamente pelo Projection Engine — não editar diretamente -->',
            '',
            '## Fase atual',
            '',
            `- **Status da run:** ${run?.status ?? 'sem run ativa'}`,
            `- **Run ID:** ${run?.run_id ?? '—'}`,
            `- **Modo:** ${run?.mode ?? '—'}`,
            '',
            '## Runtime operacional',
            '',
            `- **runtime_status:** ${run?.status ?? '—'}`,
            `- **active_run_ref:** ${run?.run_id ?? '—'}`,
            '',
            '## Progresso',
            '',
            `- **Concluídos (${completed.length}):** ${completed.join(', ') || '—'}`,
            `- **Falhos (${failed.length}):** ${failed.join(', ') || '—'}`,
            `- **Bloqueados (${blocked.length}):** ${blocked.join(', ') || '—'}`,
            '',
            `- **lifecycleStatus:** ${run?.status === 'completed' ? 'closed' : run?.status === 'running' ? 'executing' : 'pending_execute'}`,
            '',
        ];
        return lines.join('\n');
    }
    projectRunSummary(state) {
        const run = state.run;
        const completed = [...state.completedWorkItems];
        const failed = [...state.failedWorkItems];
        const blocked = [...state.blockedWorkItems];
        const totalAttempts = [...state.attempts.values()].reduce((s, a) => s + a.length, 0);
        const lines = [
            `## Run Summary — ${run?.run_id ?? 'unknown'}`,
            '',
            `**Status:** ${run?.status ?? '—'}  `,
            `**Mode:** ${run?.mode ?? '—'}  `,
            `**Started:** ${isoToDate(run?.started_at)}  `,
            `**Ended:** ${isoToDate(run?.ended_at)}  `,
            '',
            `**Completed:** ${completed.length} tasks  `,
            `**Failed:** ${failed.length} tasks  `,
            `**Blocked:** ${blocked.length} tasks  `,
            `**Total attempts:** ${totalAttempts}  `,
            '',
        ];
        if (completed.length > 0) {
            lines.push(`**✓ Completed:** ${completed.join(', ')}`);
        }
        if (failed.length > 0) {
            lines.push(`**✗ Failed:** ${failed.join(', ')}`);
        }
        if (blocked.length > 0) {
            lines.push(`**⊘ Blocked:** ${blocked.join(', ')}`);
        }
        return lines.join('\n');
    }
    projectPRSummary(state, graph) {
        const run = state.run;
        const completed = [...state.completedWorkItems];
        const failed = [...state.failedWorkItems];
        const lines = [
            '## Summary',
            '',
        ];
        if (completed.length > 0) {
            for (const id of completed) {
                const node = graph.nodes.get(id);
                lines.push(`- ✓ ${node?.title ?? id} (\`${id}\`)`);
            }
        }
        if (failed.length > 0) {
            lines.push('');
            lines.push('**⚠️ Incomplete tasks:**');
            for (const id of failed) {
                const node = graph.nodes.get(id);
                lines.push(`- ✗ ${node?.title ?? id} (\`${id}\`)`);
            }
        }
        lines.push('');
        lines.push('## Test plan');
        lines.push('');
        for (const wave of graph.waves) {
            lines.push(`- [ ] Wave ${wave.wave_number}: ${wave.node_ids.join(', ')}`);
        }
        lines.push('');
        lines.push(`**Run:** \`${run?.run_id ?? '—'}\` | **Status:** ${run?.status ?? '—'}`);
        lines.push('');
        lines.push('🤖 Generated with [OXE Runtime](https://github.com/propagno/oxe-build)');
        return lines.join('\n');
    }
}
exports.ProjectionEngine = ProjectionEngine;
