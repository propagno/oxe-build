# OXE — Workflow: loop (execução iterativa até verificação passar)

> **[DEPRECATED v1.1.0]** Este comando foi incorporado por `/oxe-execute`.
> Use: `/oxe-execute --iterative` para ativar loop de retry até verify passar.
> Este alias continuará funcionando nesta versão por compatibilidade.

<objective>
Executar uma **onda do PLAN.md** em ciclo iterativo até que a verificação inline passe ou o limite de tentativas seja atingido. Complementa o **Modo B** (por onda) do **`execute.md`** com retries automáticos e diagnóstico inline de falhas.

Quando verify falha, não interrompe — diagnostica (2-3 hipóteses), corrige, tenta de novo. Escala para **`/oxe-forensics`** apenas quando esgota as tentativas.
</objective>

<context>
- Aplicar `oxe/workflows/references/reasoning-execution.md`. Cada iteração deve deixar explícitos o contexto lido, a hipótese testada e a validação executada.
- **Pré-requisito:** `.oxe/PLAN.md` existente com pelo menos 1 onda; `STATE.md` com fase ≥ `plan_ready`.
- **Máximo de iterações:** padrão = 3; configurável via argumento `max:<N>` (ex.: `/oxe-loop onda 2 max:5`). Nunca exceder 10.
- **Artefato:** não cria novos arquivos — atualiza `STATE.md` com campos `loop_*` e registra cada iteração como bloco inline no chat.
- **Escalação:** se esgotou tentativas e ainda falhou → registrar estado em STATE.md + sugerir `/oxe-forensics` com contexto das hipóteses já tentadas.
- **Não substitui** `/oxe-verify` global (4 camadas): o loop faz verificação **inline por onda** (comando `**Verificar:**` de cada Tn); o verify completo deve ser chamado ao final de todas as ondas.
</context>

<loop_state>
## Campos em STATE.md durante o loop

```yaml
loop_onda: 2              # número da onda sendo executada
loop_iteracao: 2/3        # tentativa atual / máximo
loop_status: retrying     # retrying | passed | escalated
loop_hipoteses: ["H1: ...", "H2: ..."]  # hipóteses da última falha
```

Limpar campos `loop_*` ao concluir com `passed` (ou manter `escalated` se escalou para forensics).
</loop_state>

<process>
1. Ler `.oxe/STATE.md` e `.oxe/PLAN.md`. Identificar a onda alvo (argumento do usuário ou próxima onda pendente em STATE).
2. Registrar em STATE.md: `loop_onda: N`, `loop_iteracao: 1/<max>`, `loop_status: retrying`.
3. **Iteração:**
   a. Listar tarefas da onda N com seus comandos `**Verificar:**`.
   b. Implementar todas as tarefas da onda (seguindo `execute.md` `<modo_solo>`).
   c. Executar os comandos `Verificar` de cada `Tn`.
   d. **Se todos passaram:** registrar `loop_status: passed`; limpar campos `loop_*`; atualizar STATE.md com onda concluída; informar usuário e sugerir próxima onda ou `/oxe-verify`.
   e. **Se algum falhou:**
      - Listar 2-3 hipóteses de causa (baseado no erro/output da verificação).
      - Registrar `loop_hipoteses` em STATE.md.
      - Incrementar iteração: `loop_iteracao: K+1/<max>`.
      - Se `K+1 > max`: ir para passo 4 (escalação).
      - Senão: aplicar fix para a hipótese mais provável → voltar a `c`.
4. **Escalação (tentativas esgotadas):**
   - Registrar `loop_status: escalated` em STATE.md.
   - Exibir no chat: tentativas realizadas, hipóteses testadas, evidência de cada falha.
   - Sugerir `/oxe-forensics` com contexto: "onda N falhou após <max> tentativas — hipóteses testadas: H1, H2, H3".
5. Em toda resposta ao utilizador, manter a ordem:
   - **Contexto lido**
   - **Validação executada**
   - **Resultado**
   - **Próximo passo**
</process>

<success_criteria>
- [ ] STATE.md tem campos `loop_*` atualizados a cada iteração.
- [ ] Cada falha gera 2-3 hipóteses registradas antes de tentar fix.
- [ ] Ao passar: campos `loop_*` limpos; onda marcada como concluída em STATE.md.
- [ ] Ao esgotar: `loop_status: escalated` + sugestão de `/oxe-forensics` com contexto completo.
- [ ] Nunca excede `max` iterações configurado.
- [ ] Não altera `.oxe/PLAN.md` (só implementa o que já está planejado).
</success_criteria>
