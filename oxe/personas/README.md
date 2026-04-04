# OXE — Personas de Agentes

Esta pasta contém **definições de personas** para uso nos workflows `/oxe-plan-agent` e `/oxe-execute`.

## O que é uma persona OXE?

Uma persona define o **comportamento esperado** de um contexto de agente focado. Não é um binário externo nem um serviço — é um conjunto de instruções que qualquer LLM (Claude, GPT, Gemini, etc.) pode seguir ao executar tarefas de um blueprint OXE.

## Como usar

No `/oxe-plan-agent`, referencie personas por ID no campo `persona` de cada agente:

```json
{
  "id": "agent-backend",
  "role": "Backend Specialist",
  "persona": "executor",
  "scope": ["Implementar endpoints REST", "Escrever testes unitários"]
}
```

O workflow `/oxe-execute` carrega a persona correspondente e instrui o LLM a agir conforme as diretrizes definidas.

## Personas disponíveis

| ID | Papel | Foco |
|----|-------|------|
| `executor` | Implementador | Código funcional, commits atômicos, checklist do PLAN |
| `planner` | Planejador | Decomposição de tarefas, ondas, dependências |
| `verifier` | Verificador | Testes, critérios SPEC, evidências, UAT |
| `researcher` | Pesquisador | Investigação técnica, benchmarks, POCs |
| `debugger` | Depurador | Diagnóstico de falhas, root cause, hotfix |
| `architect` | Arquiteto | Estrutura, padrões, dívida técnica, escalabilidade |
| `ui-specialist` | Especialista UI | Componentes, acessibilidade, contratos de design |
| `db-specialist` | Especialista DB | Esquemas, migrações, queries, performance |

## Criando personas personalizadas

Copie qualquer arquivo `.md` desta pasta, altere o frontmatter e o conteúdo, e salve em `.oxe/personas/` no seu projeto. O OXE prioriza personas locais sobre as do pacote.
