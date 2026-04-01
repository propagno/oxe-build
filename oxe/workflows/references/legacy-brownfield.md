# Referência OXE — Repositórios legado (brownfield)

Documento de apoio aos workflows **scan**, **spec**, **plan**, **execute** e **verify** quando o projeto **não** é uma aplicação web/Node típica: **mainframe** (COBOL, JCL, copybooks), **cliente desktop** (ex. VB6), **stored procedures** / DDL em SQL, e integrações por ficheiro ou fila.

## 1. Deteção rápida (sinais no repo)

| Sinal | Extensões / pastas comuns |
|-------|---------------------------|
| COBOL | `*.cbl`, `*.cob`, `*.cobol` |
| JCL | `*.jcl`, `*.prc`, pasta `jcl/`, `proc/` |
| Copybooks | `*.cpy`, pastas `cpy/`, `copy/`, `copylib/` |
| Binder / load | `*.clb`, pastas `clb/` (quando existirem) |
| VB6 / Win32 legado | `*.frm`, `*.vbp`, `*.bas`, `*.cls`, `*.ctl` |
| SQL host | `*.sql`, pastas `sql/`, `DB_DDL/`, `stored_procedures/` |
| Documentação já existente | `docs/`, `src/docs/`, `glossary/` com inventários |

**Não assumir** nomes fixos: `cpy` vs `copy` vs `includes` é comum — o scan deve **descrever o que existe** em `STRUCTURE.md` e, se útil, sugerir `scan_focus_globs` em `.oxe/config.json`.

## 2. Scan — o que preencher nos sete ficheiros

### OVERVIEW

- Fluxo de negócio em 5–15 tópicos (batch vs online vs desktop).
- Referência explícita a documentação humana já no repo (índices, enciclopédias).

### STACK

- Runtime real (z/OS, IMS, CICS, DB2, etc.) **como inferido** dos fontes e docs — marcar quando for inferência.
- VB6, ODBC/ADO, SQL Server/DB2 conforme aparecer em código ou comentários.

### STRUCTURE

- Árvore lógica: `jcl/` → programas → datasets/VSAM/DB2; copybooks e sinónimos de pasta; módulos VB6 por serviço/projeto.
- Nota quando pastas esperadas (`cpy`, `clb`) **não** existirem mas equivalentes existirem (`copy/`).
- **`docs/` rica:** se existir `docs/INDICE-GERAL.md`, `docs/README.md`, `docs/**/00-*INDICE*` ou enciclopédia por camadas, descrever o **papel de cada subpasta** (`tecnico/`, `negocio/`, `glossary/`, `baixa-plataforma/`, comparativos) e o caminho do índice mestre — não tratar `docs/` como “só Markdown”.

### TESTING

- Se não houver `npm test` / CI: declarar **honestamente** (*não detetado* ou *não verificado neste clone*).
- Listar scripts locais (ex. análise JCL em Python/BAT) como verificação **opcional**, com caminho em backticks.

### INTEGRATIONS

- Sistemas externos (ex. troca de mensagens, CNAB, filas), **sem valores** de segredos.
- Pontes **host ↔ desktop** (ficheiros, BD partilhada, serviços COM/XML).
- **Taxonomia de plataforma** (quando fizer sentido): subsecção explícita **Alta plataforma** (host/mainframe), **Baixa plataforma** (distribuído, middle-office, cliente), **Externo** (reguladores, câmaras, mercado). Usar a mesma linguagem em OVERVIEW se o repo for híbrido.

### CONVENTIONS

- Prefixos de programas, convenções JCL (`JOB`, `EXEC PGM=`), padrões de copybook.

### CONCERNS

- Volume de fontes, EOL de VB6, ausência de testes automáticos, acoplamento DB2, gaps documentados no próprio repo.

## 3. Config (`.oxe/config.json`)

Sugerir ao utilizador padrões como (ajustar ao repo real):

```json
"scan_focus_globs": [
  "jcl/**",
  "**/*.jcl",
  "cpy/**",
  "copy/**",
  "src/**/*.cbl",
  "**/*.frm",
  "**/*.vbp",
  "**/DB_DDL/**/*.sql"
],
"scan_ignore_globs": [
  ".mypy_cache/**",
  "**/node_modules/**"
]
```

Para specs de **documentação/migração**, `spec_required_sections` pode incluir cabeçalhos adicionais, por exemplo:

- `## Contratos de dados` (copybooks, tabelas, mensagens)
- `## Fluxos batch` (cadeias JCL / jobs)
- `## Integrações desktop-DB` (VB6, procedures, ODBC)

## 4. Spec — epicos úteis

Dividir por **trilhas** comunicáveis:

1. Batch: JCL → COBOL → ficheiros / DB2.
2. Online: transações IMS/CICS (quando identificáveis).
3. Desktop + SQL: ecrãs / módulos → procedures ou tabelas.

Critérios **A*** devem ser verificáveis por: leitura de ficheiro, Grep, checklist humano, ou execução em ambiente (quando existir) — não exigir `npm test` se o projeto não tiver.

## 5. Plan — bloco **Verificar** (legado)

Quando não houver comando único de teste:

```markdown
- **Verificar:**
  - Comando: `—` (projeto sem suíte única; ver Manual)
  - Manual: Confirmar em `STRUCTURE.md` que cadeia X está referenciada; Grep `COPY NOMECOPY` nos `.cbl` listados; revisão humana do diagrama em `docs/...`
```

Mapear **cada** critério A* a pelo menos uma tarefa ou registar **gap** explícito no plano.

### Molde de comparativo (migração host ↔ cliente)

Para SPEC/PLAN de paridade ou modernização, um entregável útil é uma **matriz comparativa** (Markdown em `docs/` ou `.oxe/`). Classificar cada funcionalidade ou fluxo:

| Classificação | Significado |
|----------------|-------------|
| Equivalente | Mesmo resultado; pode diferir batch vs online. |
| Mesma função, implementação diferente | Comportamento alinhado; caminhos de código distintos. |
| Só no host | Não reproduzido (ou não encontrado) no cliente. |
| Só no cliente | Não reproduzido (ou não encontrado) no host. |

Incluir colunas **Host (programa/job/tabela)** e **Cliente (form/SP/serviço)** com paths do repo. Vincular tarefas **Tn** aos critérios **A*** que exigem cobertura da matriz (ex. “todas as linhas da coluna X documentadas”).

## 6. Execute

- Ondas funcionam igual; reforçar **pré-requisitos** (acesso a mainframe, IDE VB6) quando a tarefa depender de ambiente fora do Git.
- Se a “implementação” for só documentação/diagramas, o entregável são ficheiros `.md` (ou anexos) com caminhos nos **Arquivos prováveis**.

## 7. Verify

- Evidência válida: trecho de `Read`, resultado de `Grep`, confirmação de existência de ficheiros, checklist assinado no `VERIFY.md`.
- Se um comando do PLAN falhar por ambiente ausente, registar **não executado aqui** e manter o comando para o utilizador — não marcar como “passou” sem evidência.

## 8. Anti-patterns

- Inventar nomes de transação CICS ou jobs não presentes no repo.
- Tratar ausência de `package.json` como “projeto vazio”.
- Omitir `TESTING.md` ou preencher com comandos genéricos que não se aplicam.

## 9. Layout opcional da pasta `docs/`

Modelo de pastas, índice por intenção, pares técnico/negócio e convenções de frontmatter YAML: **`oxe/templates/DOCS_BROWNFIELD_LAYOUT.md`** (no projeto instalado: `.oxe/templates/DOCS_BROWNFIELD_LAYOUT.md` quando copiado pelo `oxe-cc`).
