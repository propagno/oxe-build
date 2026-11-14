# Referência — PRD, RFC, ADR e ALM no fluxo OXE

Detalhe dos passos que `spec.md`, `plan.md` e `discuss.md` citam de forma curta.

## RFC antes do plano

Escreva a proposta técnica **antes** do `/oxe-plan` quando a fase tiver:
- critério de risco **P0/P1** (coluna Risco da SPEC);
- componente ou dependência nova;
- mudança de contrato público.

Passos:
1. `oxe-cc rfc new --title "…"` gera `.oxe/rfc/RFC-<fase>-<n>-….md`, com resumo, motivação (ligada a US/R/A), proposta, alternativas recusadas com o motivo, riscos, implantação e rollback, e perguntas em aberto.
2. Responda as perguntas em aberto e obtenha o OK do usuário.
3. `oxe-cc rfc accept RFC-…` registra a decisão: o ADR, em `docs/adr/`, recebe o contexto, a proposta, os riscos e as alternativas recusadas.
4. O plano cita a decisão nas tarefas que a implementam (`decisions` no PLAN.json).

O `plan lint` avisa quando uma fase de risco não tem RFC aceito. Com `rfc: { "required": "risk" }` vira erro, e com `"always"` toda fase exige RFC.

## ALM (Jira / Azure DevOps)

Só se aplica com `alm.provider` no `.oxe/config.json` (ver `oxe/templates/CONFIG.md`). Sem ALM configurado, pule tudo isto.

- **Depois da spec aprovada:** `oxe-cc alm push --stories-only --dry-run`; mostre o resultado e, com o OK, rode sem `--dry-run`. Cria o épico (quando o config não define um) e as histórias do PRD, com a versão-alvo.
- **Depois do plano aprovado:** `oxe-cc alm push --tasks-only --dry-run`, e depois sem `--dry-run`. Cria uma tarefa no ALM por tarefa pendente, filha do épico e ligada à história dos critérios dela. Rodar de novo não duplica.
- **A partir daí** a chave do item entra no título do PR (`promote`), no assunto do commit de checkpoint e no nome do branch.
- **Os itens se movem sozinhos** em quatro momentos: tarefa iniciada, PR aberto, merge e deploy. `alm.track` limita isso às etapas que outra ferramenta não move.
- **Depois do deploy:** um defeito vira `oxe-cc alm defect --title "…" --origin US-n|Fn-Tn`, ligado ao item de origem.

Uma falha do ALM nunca derruba o comando do OXE: a escrita fica pendente para o próximo `oxe-cc alm sync`.

### Via MCP (`alm.transport: "mcp"`)

Com o Jira ou o Azure DevOps ligados à sessão por um servidor MCP, o `oxe-cc` não usa token nem rede. Os mesmos comandos (`alm push`, `sync`, `move`, `defect`, e o sync automático) decidem **o que** fazer e põem as operações numa fila. **Quem executa a fila é você, o agente**, com as ferramentas MCP da sessão:

1. Depois de cada comando que mexe no ALM (spec, plano, `runtime execute`, promote, deploy), rode `oxe-cc alm queue --json`.
2. Execute as operações **na ordem**. Os nomes das ferramentas variam por servidor:
   - **`ensure`:** rode primeiro a busca indicada em `search` (`jql` ou `wiql`).
     - Achou um item: é ele que vale; nunca crie outro. Se o item foi achado pelo código antigo (`adopt`), acrescente a ele o primeiro rótulo de `labels`.
     - Não achou: crie com `type`, `title`, `description`, `labels`, `parent` e `fix_version`. Se a operação traz `parent_ref` em vez de `parent`, o pai é o item que você acabou de criar para aquele ref; o `oxe-cc alm queue` já mostra a chave dele depois do ack.
     - Em seguida: `oxe-cc alm ack <id> --key <chave>` (no Azure, o número).
   - **`transition`:** mude o item `key` para o estado `state` (pelo nome) e publique os `comments` como comentário. Depois, `oxe-cc alm ack <id>`.
   - **`link`:** ligue `key` a `other_key` com o tipo `type` (Relates). Depois, `oxe-cc alm ack <id>`.
   - **`release_version`:** marque a versão `version` do projeto como lançada. Depois, `oxe-cc alm ack <id>`.
3. Se uma operação falhar, rode `oxe-cc alm ack <id> --error "…"` e siga para a próxima. Ela fica na fila com o erro registrado.
4. Se não houver ferramenta MCP para uma operação (por exemplo, ligar itens), avise o usuário e deixe a operação na fila.

Sem um agente na sessão, a fila espera: nada se perde e nada é feito duas vezes, porque a busca por rótulo vem antes de criar.
