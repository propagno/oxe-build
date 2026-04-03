# Guia de autoria — workflows OXE (`oxe/workflows/*.md`)

Texto para **mantenedores** e **contribuidores** que editam os passos canónicos do OXE. Os ficheiros são a **fonte única** do comportamento que Cursor, Copilot e outros clientes delegam.

## 1. Orientação por resultado (outcome-first)

- Declare **o que** deve existir no fim (ficheiros em `.oxe/`, critérios verificáveis), não uma coreografia minuciosa de cliques que o modelo já sabe fazer.
- Inclua passos concretos só onde houver **um caminho certo**: comandos exatos, caminhos de ficheiro, políticas de segurança, ou integração com ferramentas específicas.
- Pergunta útil: *se remover este parágrafo, o resultado em disco piora de forma previsível?* Se não, considere enxugar.

## 2. Estrutura recomendada (tags XML-like)

Padrão habitual:

| Bloco | Função |
|-------|--------|
| `<objective>` | Resultado esperado e limites do passo (obrigatório). |
| `<context>` | Regras do repo, caminhos, o que não fazer, ligação a `config.json` se aplicável. |
| `<process>` | Passos numerados ou fases. |
| `<success_criteria>` | Checklist com `- [ ]` verificável. |

**Exceções legítimas no pacote canónico:**

- **`plan.md`** — pode incluir `<format_plan>` entre context e process para o formato do `PLAN.md`, e **`<plan_quality_gate>`** entre `format_plan` e `process` (checklist obrigatória antes de fechar o plano).
- **`help.md`** — usa `<output>` em vez de `<process>` / `<success_criteria>` porque agrega várias secções de documentação para o utilizador.
- **`review-pr.md`** — foco em análise no chat; critérios de sucesso alinham com o mesmo padrão `<success_criteria>` que os demais.

Mantenha tags **abertas e fechadas** explicitamente (evita ambiguidade para leitores humanos e para validação automática leve).

## 3. Progressive disclosure (ficheiros longos)

- Se um workflow ultrapassar **~400–500 linhas** ou repetir a mesma referência muitas vezes, extraia para:
  - `oxe/workflows/references/<nome>.md` (no pacote), ou
  - trechos reutilizáveis em `oxe/templates/` (ex.: [`SPEC.template.md`](SPEC.template.md), [`CONFIG.md`](CONFIG.md)).
- Exemplo publicado: [`legacy-brownfield.md`](../workflows/references/legacy-brownfield.md) — COBOL, JCL, copybooks, VB6, SP; consumido por **scan**, **spec**, **plan**, **execute**, **verify**.
- Template opcional de pasta `docs/` brownfield: [`DOCS_BROWNFIELD_LAYOUT.md`](DOCS_BROWNFIELD_LAYOUT.md) (copiado para `.oxe/templates/` na instalação).
- O `SKILL.md` principal do passo deve permanecer o **mapa**: objetivo, contexto essencial, sequência, critérios de sucesso.

## 4. Comandos Cursor e prompts Copilot (frontmatter)

Ficheiros em `.cursor/commands/` e `.github/prompts/` costumam ter YAML inicial:

```yaml
---
description: Resumo de 5–8 palavras. Use quando o utilizador pedir X, Y ou Z.
---
```

- **Resumo:** o que o passo faz.
- **Gatilhos:** frases ou intenções que devem ativar o comando (evita disparar em tudo).

O corpo do ficheiro deve **apontar** para o workflow em `oxe/workflows/<passo>.md` (ou `.oxe/workflows/`) sem duplicar a lógica por completo.

## 5. Script vs agente

| Cabeça | Onde vive |
|--------|-----------|
| Comandos reproduzíveis (`npm test`, `git diff`, migrações) | Documentados no workflow e, no **plano**, no bloco **Verificar** de cada tarefa. |
| Julgamento (prioridades, texto de SPEC, desenho de API) | No Markdown do workflow e no contexto dado ao modelo. |

Evite pedir ao modelo que **valide** estruturas que um script pode validar (JSON, contagem de ficheiros); isso pode ir para `oxe-cc doctor`, SDK ou CI.

## 6. Coerência com artefactos `.oxe/`

- Não apagar dados sensíveis do utilizador sem instrução explícita.
- Respeitar [`CONFIG.md`](CONFIG.md) e `.oxe/config.json` quando mencionar preferências de fluxo.
- Atualizar **STATE.md** apenas quando o passo for parte do fluxo principal (exceções como `review-pr` estão documentadas no próprio workflow).

**Frontmatter em artefactos (SPEC/PLAN):** os templates `SPEC.template.md` e `PLAN.template.md` podem incluir YAML no topo (`oxe_doc`, `status`, `updated`, `inputs`) para retomada após contexto longo. Isto é **independente** do frontmatter YAML dos **prompts** Cursor/Copilot (secção 4). O `doctor` continua a validar secções `## …` no **corpo** Markdown abaixo do frontmatter.

## 7. Revisão de um workflow

Para uma revisão guiada contra este guia, siga o workflow **`workflow-authoring.md`** no mesmo diretório (após instalação/atualização do pacote `oxe-cc`).

---

*Documento interno do projeto OXE — práticas genéricas de autoria de prompts e workflows; não incorpora código de terceiros.*
