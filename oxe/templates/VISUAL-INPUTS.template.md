# OXE — Visual Inputs

> Extração textual estruturada de imagens/anexos visuais usados na SPEC. O OXE não interpreta pixels nativamente; este artefato registra o que o agente hospedeiro conseguiu inspecionar e o que virou requisito.

## Status

- **Status:** ready | partial | blocked | not_applicable
- **Runtime com visão:** supported | unsupported | unknown
- **Critical gaps abertos:** nenhum | listar

## Entradas

### VI-01 — (nome curto da imagem)

- **Source ref:** chat-attachment | path relativo | URL | textual_only
- **Source kind:** visual_attachment | screenshot | mockup | image_description
- **Runtime support:** vision_supported | vision_unavailable | unknown
- **Inspection status:** inspected | partial | unavailable | not_applicable
- **Reproducibility:** local_file | materialized_copy | chat_attachment_only | textual_only
- **Critical:** true | false
- **Confidence:** 0.00–1.00
- **Visual summary:** descrição objetiva do que aparece.
- **Detected text:** textos legíveis extraídos da imagem, ou `not_applicable`.
- **Layout regions:** header, sidebar, content, footer, cards, modals etc.
- **UI components:** botões, campos, tabelas, cards, menus, gráficos etc.
- **States inferred:** loading, empty, error, success, disabled, hover, selected etc.
- **Ambiguities:** o que não foi possível confirmar visualmente.
- **Derived requirements:** R-ID/A* que dependem desta imagem.
- **Limitations:** limitações da inspeção ou do runtime.

## Regras

- Imagem crítica para UI, layout, fluxo ou regra funcional exige `inspection_status: inspected`, descrição suficiente e requisitos derivados explícitos.
- Anexo efêmero de chat deve ser tratado como `chat_attachment_only`; não é referência reproduzível por padrão.
- Se o runtime não suportar visão, usar `inspection_status: unavailable` e bloquear requisitos visuais críticos até o usuário fornecer descrição textual suficiente.
- Não inventar detalhes invisíveis na imagem; registrar como `Ambiguities`.
