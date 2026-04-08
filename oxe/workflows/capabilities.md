# OXE — Workflow: capabilities

<objective>
Gerir capabilities nativas do OXE: listar, explicar, instalar, remover e diagnosticar extensões opcionais em `.oxe/capabilities/`.
</objective>

<context>
- Capabilities são extensões do projeto, não substituem o núcleo do OXE.
- Cada capability vive em `.oxe/capabilities/<id>/` com manifesto próprio.
- O índice canónico é `.oxe/CAPABILITIES.md`.
</context>

<process>
1. Ler `.oxe/CAPABILITIES.md` e os manifestos em `.oxe/capabilities/` se existirem.
2. Se o pedido for `list` ou genérico, responder com capabilities instaladas, escopo e riscos.
3. Se o pedido for instalar ou remover, orientar o utilizador a usar `oxe-cc capabilities ...` ou o workflow equivalente aprovado pelo projeto.
4. Se o pedido for diagnóstico, apontar drift entre índice, manifestos e artefatos esperados.
</process>

<success_criteria>
- [ ] O estado do catálogo foi lido a partir dos artefatos reais.
- [ ] A resposta deixa claro o que é capability nativa e o que é núcleo do OXE.
</success_criteria>
