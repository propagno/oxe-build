import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';

export interface NodePromptOptions {
  previousError?: string | null;
}

export function buildNodePrompt(
  node: GraphNode,
  lease: WorkspaceLease,
  runId: string,
  attempt: number,
  options: NodePromptOptions = {},
): string {
  const lines: string[] = [
    `# Tarefa: ${node.title}`,
    '',
    `**Run:** ${runId} | **Attempt:** ${attempt}`,
    `**Workspace:** ${lease.root_path}`,
  ];

  if (node.mutation_scope.length > 0) {
    lines.push(`**Escopo de mutação:** ${node.mutation_scope.join(', ')}`);
  }

  if (attempt > 1 && options.previousError) {
    lines.push('', '## Contexto da tentativa anterior');
    lines.push(`Esta é a tentativa **${attempt}**. A tentativa anterior falhou:`);
    lines.push('', '```');
    lines.push(String(options.previousError).slice(0, 2000));
    lines.push('```', '');
    lines.push('Analise o erro e tente uma abordagem diferente.');
  }

  if (node.actions.length > 0) {
    lines.push('', '## Ações requeridas');
    for (const action of node.actions) {
      let line = `- ${action.type}`;
      if (action.command) line += `: \`${action.command}\``;
      if (action.targets?.length) line += ` em ${action.targets.join(', ')}`;
      lines.push(line);
    }
  }

  if (node.verify.must_pass.length > 0) {
    lines.push('', '## Critérios de aceite');
    for (const criterion of node.verify.must_pass) {
      lines.push(`- ${criterion}`);
    }
  }

  if (node.verify.command) {
    lines.push('', `**Verificação:** \`${node.verify.command}\``);
  }

  lines.push('', '## Conclusão da tarefa');
  lines.push('Quando **todas** as ações estiverem concluídas, chame `finish_task` com um resumo do que foi realizado.');
  lines.push('NÃO chame `finish_task` antes de completar todas as ações requeridas.');
  lines.push('', 'Execute as ações acima usando as ferramentas disponíveis.');

  return lines.join('\n');
}
