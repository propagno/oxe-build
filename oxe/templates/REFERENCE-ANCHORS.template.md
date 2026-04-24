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
    snippet_ref="lines 10-30"
    source_ref="external-ref: exemplo">
    <relevance>Por que esta referência sustenta a tarefa.</relevance>
    <action>copy | adapt | consult</action>
    <summary>Resumo semântico curto do trecho relevante ou do contrato.</summary>
    <critical_fields>IDs, colunas, offsets, eventos ou contratos que não podem ser improvisados.</critical_fields>
  </anchor>
</reference_anchors>

## Regras

- Se não houver referência aplicável, usar `<reference_anchors ... status="not_applicable" ready="true">`.
- `critical="true"` exige `status="resolved"` antes do execute.
- `path` deve ser reproduzível no workspace ou materializado em `.oxe/investigations/externals/`.
- Referência solta em texto não é evidência. Se o path/range/snippet não puder ser materializado, marcar `status="missing"` e derrubar readiness.
- Anchors podem ser locais, externos materializados, predecessor interno, contrato público, fixture ou decisão registrada.
