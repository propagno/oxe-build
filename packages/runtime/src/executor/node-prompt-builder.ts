import type { GraphNode } from '../compiler/graph-compiler';
import type { WorkspaceLease } from '../models/workspace';

export function buildNodePrompt(
  node: GraphNode,
  lease: WorkspaceLease,
  runId: string,
  attempt: number,
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

  lines.push('', 'Execute as ações acima usando as ferramentas disponíveis e confirme o resultado.');

  return lines.join('\n');
}
