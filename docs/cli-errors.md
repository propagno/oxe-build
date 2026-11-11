# Erros da CLI: envelope e códigos de saída

Com `--json-errors`, ou com `OXE_JSON_ERRORS=1`, toda falha de qualquer comando do `oxe-cc` imprime **uma linha** no stderr com o envelope abaixo, no lugar da prosa. O comando sai com o código fixo do `kind`. Sem a flag, a saída humana não muda.

```json
{ "ok": false, "kind": "usage", "message": "Opção desconhecida: --zzz", "detail": "…", "command": "runtime execute", "hint": "veja oxe-cc <comando> --help", "exit": 2 }
```

| kind | exit | quando |
|---|---|---|
| `internal` | 1 | falha inesperada (exceção não tratada) |
| `usage` | 2 | opção ou subcomando desconhecido, argumento faltando |
| `validation` | 3 | entrada inválida ou recusada (schema, formato, campo obrigatório) |
| `not_found` | 4 | arquivo, id, tarefa ou `.oxe/` que não existe |
| `conflict` | 5 | o estado mudou ou já existe (lock, já respondido, plano velho) |
| `gate_failed` | 6 | o comando rodou e reprovou (lint, verify, gate, divergência) |
| `environment` | 7 | a máquina, não o código: ferramenta ausente, rede, memória, permissão |

- `stdout` continua com os dados do comando, inclusive com `--json`.
- O catálogo é fechado. Um `kind` novo é uma mudança de contrato, tem que entrar nesta tabela e em `bin/lib/oxe-cli-errors.cjs` (`KINDS`), e o teste `tests/oxe-1212-cli-errors.test.cjs` confere as duas.
