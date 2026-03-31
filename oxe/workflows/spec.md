# OXE — Workflow: spec

<objective>
Registrar a intenção do utilizador em **`.oxe/SPEC.md`**: escopo, critérios de aceite mensuráveis, não-objetivos e suposições. A spec deve ser o contrato antes do plano.

Entrada: texto livre na mensagem ou caminho `@arquivo.md` / anexo para incorporar PRD/notas.
</objective>

<context>
**Pré-requisito:** preferencialmente **scan** já executado. Se não existir scan, mencionar na spec que o mapa está pendente.

Leia `.oxe/STATE.md` e, se existirem, trechos relevantes de `.oxe/codebase/OVERVIEW.md` e `STACK.md` para não contradizer o projeto real.
</context>

<process>
1. Resolver entrada: se começar com `@`, ler ficheiro; senão usar o texto da conversa.
2. Criar ou atualizar **`.oxe/SPEC.md`** usando `oxe/templates/SPEC.template.md` como esqueleto (substituir placeholders).
3. Incluir seções obrigatórias:
   - **Objetivo** — uma frase clara.
   - **Escopo** — bullet in / out.
   - **Critérios de aceite** — verificáveis (Given/When/Then ou checklist numerado).
   - **Não-objetivos** — o que não será feito.
   - **Suposições e riscos** — dependências técnicas ou de produto.
   - **Referências** — paths/arquivos tocados se já conhecidos.
4. Atualizar **`.oxe/STATE.md`**: fase `spec_ready`, próximo passo `oxe:plan`.
5. Responder com resumo da spec e no máximo 3 perguntas objetivas se algo crítico estiver ambíguo.
</process>

<success_criteria>
- [ ] `.oxe/SPEC.md` existe e critérios de aceite são testáveis ou observáveis.
- [ ] `STATE.md` atualizado.
- [ ] Ambiguidades críticas foram perguntadas ou registradas como suposição explícita.
</success_criteria>
