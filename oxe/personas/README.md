# OXE — Personas de Agentes

Esta pasta contém **definições de personas** para uso nos workflows `/oxe-plan-agent` e `/oxe-execute`.

## O que é uma persona OXE?

Uma persona define o **contrato de comportamento** de um contexto de agente focado. Não é um binário externo nem um serviço — é um conjunto de instruções estruturadas que qualquer LLM pode seguir ao executar tarefas de um blueprint OXE. Cada persona tem: identidade, princípios com razão e aplicação, skills e técnicas específicas, protocolo de ativação, gate de qualidade, e protocolo de handoff.

Personas são **especializações** — cada uma sabe muito sobre seu domínio e sabe exatamente quando escalar para outro domínio. A composição de personas em ondas é o que torna o `LlmTaskExecutor` eficaz em projetos complexos.

## Como usar

No `/oxe-plan-agent`, referencie personas por ID no campo `persona` de cada agente:

```json
{
  "id": "agent-backend",
  "role": "Backend Implementer",
  "persona": "executor",
  "scope": ["Implementar endpoints REST", "Escrever testes unitários"],
  "wave": 2
}
```

O workflow `/oxe-execute` carrega a persona correspondente e instrui o LLM a agir conforme as diretrizes definidas — incluindo o gate de qualidade e o protocolo de handoff da persona.

## Personas disponíveis

| ID | Nome | Foco principal | Quando usar |
|----|------|----------------|-------------|
| `executor` | Executor de Tarefas | Implementação precisa, commits atômicos, write set mínimo | Para toda tarefa `generate_patch`, `run_tests`, `run_lint` |
| `planner` | Planejador de Execução | Decomposição em GraphNode, design de ondas, confiança calibrada | Para gerar ou replanejar o PLAN.md |
| `verifier` | Verificador e Auditor | Auditoria sistemática em 4 camadas, cobertura A*, UAT | Para fechar o ciclo após execução |
| `researcher` | Pesquisador Técnico | Redução de incerteza, comparação de alternativas, POCs | Para Fase 2 da spec e tasks de investigação |
| `debugger` | Depurador e Analista de Falhas | RCA, reprodução controlada, hotfix mínimo | Quando verify falha e root cause não é óbvio |
| `architect` | Arquiteto de Software | Boundaries, contratos, dívida técnica, decisões D-NN | Antes do plan e em replanejamentos por mudança de estratégia |
| `ui-specialist` | Especialista em Interface | Componentes, estados, acessibilidade, design system | Para tarefas de frontend e UI |
| `db-specialist` | Especialista em Banco de Dados | Schema, migrations, índices, N+1, integridade | Para tarefas de banco de dados |

## Fluxo de colaboração entre personas

```
Arquiteto          → define estrutura e decisões D-NN
  ↓
Pesquisador        → reduz incertezas técnicas (Fase 2 da spec)
  ↓
Planejador         → decompõe em GraphNode, projeta ondas, gera PLAN.md
  ↓
Executor           → implementa Tn com write set mínimo e commits atômicos
  (DB Specialist para tarefas de banco | UI Specialist para tarefas de frontend)
  ↓
Verificador        → audita em 4 camadas, produz VERIFY.md e UAT
  ↓
Depurador          → diagnóstica e corrige se verify falhar (opcional)
```

## Gate de qualidade de cada persona

Toda persona tem um **gate de qualidade** — uma checklist que deve ser satisfeita antes de entregar o output. Isso garante que:
- O Executor não avança sem verify command executado com sucesso
- O Planejador não entrega plano com cobertura A* incompleta
- O Verificador não fecha ciclo sem evidência para cada critério
- O Depurador não entrega hotfix sem root cause identificado e reprodução confirmada

## Criando personas personalizadas

Copie qualquer arquivo `.md` desta pasta, altere o frontmatter e o conteúdo, e salve em `.oxe/personas/` no seu projeto. O OXE prioriza personas locais sobre as do pacote — o arquivo local sobrescreve o do pacote sem conflito.

**Estrutura obrigatória de uma persona:**

```markdown
---
oxe_persona: <id>
name: <nome legível>
version: <semver>
description: <descrição em 3+ frases — o que faz, quando usar, o que não faz>
tools: [lista de tools permitidas]
scope: <domínio>
tags: [tags]
---

# Persona: <Nome>

## Identidade
## Princípios de operação
## Skills e técnicas
## Protocolo de ativação
## Gate de qualidade
## Handoff e escalada
## Saída esperada
```
