# Layout sugerido — pasta `docs/` em repositórios brownfield

> Template opcional (não faz parte do núcleo OXE em `.oxe/`). Copie ou adapte à raiz de `docs/` quando documentar sistemas legado (mainframe + cliente + integrações). Referência cruzada: `oxe/workflows/references/legacy-brownfield.md`.

## Objetivo

- Um **índice por intenção do leitor** (executivo, técnico, negócio, migração).
- **Pares** técnico / negocial quando compliance ou PO precisam do mesmo fluxo em linguagens diferentes.
- **Glossário e referência cruzada** separados de narrativa longa.
- **Comparativos** explícitos para modernização (host vs baixa plataforma).

## Estrutura de pastas (exemplo)

| Caminho sugerido | Conteúdo |
|------------------|----------|
| `docs/README.md` | Como navegar; ligação ao índice geral. |
| `docs/INDICE-GERAL.md` | Tabela **Objetivo → documento** (visão curta, wiki, fluxo X, glossário, VB6, etc.). |
| `docs/<wiki|enciclopedia>/` | Documentação enciclopédica por camadas ou domínio (prefixos `00-`, `05-` opcionais). |
| `docs/tecnico/` | Aprofundamento por tema (pipelines, jobs, tabelas). |
| `docs/negocio/` | Pares dos documentos em `tecnico/` em linguagem de negócio. |
| `docs/glossary/` | Glossário, dicionário de dados, matrizes de dependência, códigos de erro. |
| `docs/baixa-plataforma/` ou `docs/desktop-client/` | Cliente legado (ex. VB6), SPs, integração com host, roadmap. |
| `docs/<tema>/comparativo-detalhado/` | Tabelas **mainframe × cliente** por área funcional. |
| `docs/<fluxo>/USn/` | Histórias de utilizador, anexos Mermaid, scripts de apoio (opcional). |

Ajuste nomes ao produto; o importante é **papéis claros** e links relativos entre pares.

## Taxonomia de plataforma (recomendado no texto)

| Termo | Uso |
|-------|-----|
| **Alta plataforma** / host | Mainframe, JCL, COBOL, DB2 z/OS, schedulers. |
| **Baixa plataforma** | Servidores distribuídos, middle-office, transferência de ficheiros, gateways. |
| **Externo** | Reguladores, câmaras, mercado (ex. câmaras de clearing, bolsas). |

Incluir esta secção em documentos de arquitetura ou em `INTEGRATIONS.md` do scan OXE quando aplicável.

## Frontmatter YAML (opcional)

```yaml
---
titulo: "Título curto"
tipo: tecnico | negocio | indice | comparativo
area: nome-do-dominio
tags: [tag1, tag2]
ultima_revisao: "YYYY-MM"
---
```

Não é validado pelo `oxe-cc doctor`; serve para convenção humana e futuras ferramentas.

## Ligação ao OXE

- O **scan** deve, se existir `docs/` com `INDICE-GERAL.md` ou `README.md`, resumir esta estrutura em `.oxe/codebase/OVERVIEW.md` e `STRUCTURE.md` com link ao índice.
- **SPEC/PLAN** de migração podem exigir entregáveis sob `docs/tecnico/` e `docs/negocio/` via critérios **A*** .
