# OXE — Reference Anchors

> Materialização de referências críticas usadas pelo plano. Toda referência externa, predecessor, layout ou contrato que sustente uma tarefa deve virar âncora reproduzível aqui.

<reference_anchors version="1" ready="false" status="not_ready">
  <anchor
    id="RA-01"
    task="T1"
    critical="true"
    status="resolved"
    source_type="local"
    path=".oxe/investigations/externals/exemplo.txt"
    visual_ref="not_applicable"
    extraction_confidence="not_applicable"
    reproducibility="local_file"
    snippet_ref="lines 10-30"
    source_ref="external-ref: exemplo">
    <relevance>Por que esta referência sustenta a tarefa.</relevance>
    <action>copy | adapt | consult</action>
    <summary>Resumo semântico curto do trecho relevante ou do contrato.</summary>
    <critical_fields>IDs, colunas, offsets, eventos ou contratos que não podem ser improvisados.</critical_fields>
    <limitations>Limitações da referência. Para imagem/anexo visual, registrar se depende de inspeção do runtime hospedeiro.</limitations>
    <derived_requirements>R-ID/A* derivados desta referência, quando aplicável.</derived_requirements>
  </anchor>
</reference_anchors>

## Regras

- Se não houver referência aplicável, usar `<reference_anchors ... status="not_applicable" ready="true">`.
- `critical="true"` exige `status="resolved"` antes do execute.
- `path` deve ser reproduzível no workspace ou materializado em `.oxe/investigations/externals/`.
- Referência solta em texto não é evidência. Se o path/range/snippet não puder ser materializado, marcar `status="missing"` e derrubar readiness.
- Anchors podem ser locais, externos materializados, predecessor interno, contrato público, fixture ou decisão registrada.
- Para imagens/anexos visuais, usar `source_type="visual_attachment|screenshot|mockup|image_description"` e ligar `visual_ref` a `VISUAL-INPUTS.md/json`.
- Âncora visual crítica só pode ficar `resolved` quando a extração textual for suficiente para executar sem reabrir a imagem.
