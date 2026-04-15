---
oxe_doc: verify-audit
status: stable
---

# OXE — Auditoria Adversarial (Verify Auditor)

<objective>
Auditar a verificação produzida pelo executor de forma **adversarial e independente**:
encontrar critérios sem evidência suficiente, evidências ambíguas, gaps não declarados —
sem acesso ao raciocínio do executor.
</objective>

<context>
**IMPORTANTE:** Este workflow opera com contexto propositalmente restrito.

- **Você NÃO tem acesso** a `PLAN.md`, `EXECUTION-RUNTIME.md` nem ao histórico de decisões do executor.
- **Você TEM acesso** apenas a `SPEC.md` (critérios A*) e `VERIFY.md` (evidências declaradas).
- Sua instrução é **falsificar, não confirmar**.

Razão: um auditor que conhece o raciocínio do executor tende a confirmar as premissas do executor,
não a testá-las. A restrição de contexto é intencional e fundamental para o valor desta camada.
</context>

<process>
1. Ler `SPEC.md` — mapear todos os critérios `A*` com ID, texto e `howToVerify`.

2. Ler `VERIFY.md` — para cada critério `A*` identificado:
   - **PASS**: evidência presente, específica, verificável independentemente (comando + output, arquivo + conteúdo, teste + resultado).
   - **FAIL**: evidência ausente, genérica ("foi testado"), ou contraditória com o critério.
   - **INSUFICIENTE**: evidência parcial — menciona o critério mas sem resultado concreto ou rastreável.

3. Para cada critério com FAIL ou INSUFICIENTE:
   - Identificar o **tipo de gap**: evidência ausente / evidência ambígua / critério não testável como escrito / escopo divergente.
   - Sugerir o que tornaria a evidência suficiente.

4. Verificar coerência interna do VERIFY.md:
   - Há critérios documentados em VERIFY.md que não existem em SPEC.md? (scope creep)
   - Há seções de VERIFY.md com conclusão `verify_complete` mas com FAIL/INSUFICIENTE não resolvidos?

5. Escrever seção `## Auditoria Adversarial` no VERIFY.md com:

```markdown
## Auditoria Adversarial

**Resultado:** APROVADO / REPROVADO / CONDICIONADO

| ID  | Status       | Observação do auditor |
|-----|--------------|-----------------------|
| A1  | PASS         | Evidência: output de `npm test` em linha 47 do VERIFY.md |
| A3  | INSUFICIENTE | Mencionado como testado mas sem output de comando ou arquivo de resultado |
| A5  | FAIL         | Critério exige P95 < 200ms; VERIFY.md não apresenta medição de latência |

**Gaps não declarados pelo executor:**
- (se nenhum: "Nenhum gap adicional identificado.")

**Riscos residuais:**
- (riscos que passaram pelo executor mas que o auditor considera relevantes)
```

**Resultado global:**
- `APROVADO` — todos os critérios são PASS.
- `CONDICIONADO` — critérios INSUFICIENTES resolvíveis com evidência adicional sem re-executar.
- `REPROVADO` — um ou mais critérios FAIL ou gaps estruturais não declarados.
</process>

<success_criteria>
- [ ] Todos os critérios A* de SPEC.md foram avaliados.
- [ ] Evidências PASS têm referência rastreável (linha, arquivo, comando, output).
- [ ] Critérios FAIL e INSUFICIENTE têm sugestão de como fechar o gap.
- [ ] Seção `## Auditoria Adversarial` escrita em VERIFY.md.
- [ ] Resultado global (APROVADO / CONDICIONADO / REPROVADO) declarado explicitamente.
</success_criteria>
