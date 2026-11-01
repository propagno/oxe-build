# Backlog do oxe-build: validação pelo OxeVoice

Construímos o **OxeVoice 1.5** (voz nativa cross-OS no oxespace) usando o oxe-build de ponta a ponta, no fluxo recomendado pelo manual:

```text
/oxe-spec → runtime program init/start → /oxe-plan (PLAN.json + aceite congelado) → plan lint
          → runtime execute (claude -p) → runtime verify → runtime program close
```

Todo problema que aparece no caminho vira uma entrada aqui. Cada entrada tem a evidência, o impacto e uma proposta que vai além do conserto pontual. Não basta remover o sintoma: a pergunta é o que o fluxo deveria ser.

Status possíveis: `aberto`, `em andamento`, `resolvido (<commit>)`, `proposta`.

---

## OXB-001: o executor escrevia o próprio teste de aceite (falso verde)

- **Status:** resolvido (1.19, aceite congelado).
- **Evidência:** e2e real `e2e-program --real` de 2026-10-31.
  - O executor entendeu "createApi devolve handle" como `{ handle }` e escreveu um teste que concordava com essa leitura.
  - O verify deu verde, e o oráculo independente reprovou a F2.
- **Correção:** `PLAN.json.acceptance_tests`.
  - O teste é escrito no `/oxe-plan` e tem o hash congelado no compile.
  - Vai para o prompt como SPEC executável, e o executor tem a escrita negada.
  - O verify reprova com `acceptance_tampered` ou `acceptance_missing`.
  - `e2e-program` ganhou os cenários `misread-interface` e `tampered-acceptance`.
- **Fora da caixa:**
  - Separar os papéis **autor do aceite** e **implementador**, com agentes e modelos diferentes. O aceite pode ser gerado por um "adversarial spec agent" que tenta quebrar as interpretações ambíguas da SPEC antes do plano fechar.
  - Medir **ambiguidade da SPEC**: quantas leituras distintas N agentes produzem para o mesmo A*. Um A* com divergência alta bloqueia o plano até ser esclarecido.

## OXB-002: `writeRunState` descartava campos sem avisar

- **Status:** resolvido (1.19).
- **Evidência:** `acceptance_lock` e `verification_regression` sumiam da run, porque a função grava só uma lista fixa de campos. O lock nunca era persistido, e o teste de mutação do aceite fechava a fase.
- **Fora da caixa:** dar à run state um schema versionado e validado (o mesmo validador do PLAN.json), com teste de round-trip. Campo desconhecido vira erro em dev e aviso em produção, nunca perda silenciosa.

## OXB-003: comandos do runtime recriam arquivos `.oxe/` que o usuário apagou

- **Status:** aberto.
- **Evidência:** `runtime providers` na raiz do repo recriou o `.oxe/STATE.md` a partir do template.
- **Fora da caixa:** comandos de leitura nunca escrevem. Separar `runtime` em leitura (puro) e escrita (com journal), e escrever só no que o comando declara como efeito colateral.

## OXB-004: `runtime verify --json` emite o banner antes do JSON

- **Status:** aberto.
- **Evidência:** a saída não é JSON válido, então os benchmarks leem a run do disco.
- **Fora da caixa:** toda saída `--json` vira contrato versionado (`oxe*Schema`), testado por um snapshot de schema no CI. O banner vai para stderr.

---

## Melhorias de fluxo em observação durante o OxeVoice

Hipóteses a confirmar com dados das fases:

- **Custo e turnos por fase:** o coordenador do oxespace pede um ASK quando uma fase passa de 2× os turnos planejados. Proposta: o PLAN.json declara `budget.turns` por tarefa, o runtime aplica o limite e emite `BudgetExceeded`, que vira gate humano.
- **Coordenação multi-time:** o oxespace tem "hot files" disputados por outras equipes. Proposta: o PLAN.json declara `contested_paths`, o scheduler serializa as tarefas que tocam esses arquivos e o `program close` exige um ASK registrado antes do PR.
- **Validação cross-OS:** voz nativa depende do SO. Proposta: um verify por matriz (`runs_on: [windows, macos, linux]`) delegado ao CI, em que a fase só fecha com evidência das 3 plataformas.
