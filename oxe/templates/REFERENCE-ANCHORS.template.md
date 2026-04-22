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
    source_ref="external-ref: exemplo">
    <relevance>Por que esta referência sustenta a tarefa.</relevance>
    <action>copy | adapt | consult</action>
    <summary>Resumo semântico curto do trecho relevante ou do contrato.</summary>
  </anchor>
</reference_anchors>

## Regras

- Se não houver referência aplicável, usar `<reference_anchors ... status="not_applicable" ready="true">`.
- `critical="true"` exige `status="resolved"` antes do execute.
- `path` deve ser reproduzível no workspace ou materializado em `.oxe/investigations/externals/`.
