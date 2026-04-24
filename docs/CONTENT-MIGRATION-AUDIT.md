# Content Migration Audit

Este documento registra a triagem interna de conteúdo usado como insumo para fortalecer o OXE. Ele não é instalado em projetos de usuário e não deve ser referenciado por templates, workflows, comandos, README ou agentes finais.

## Rules

- Public artifacts must use OXE naming, paths, commands and runtime contracts only.
- No public template/workflow/command/agent may reference legacy product names, paths, tool commands or command namespaces.
- Source material is reauthored, not copied literally.

## Templates

| Source theme | Decision | OXE target |
|--------------|----------|------------|
| Detailed phase plan contract | merge | `PLAN.template.md`, `IMPLEMENTATION-PACK.*`, `/oxe-plan` |
| Context and discovery templates | merge | context packs, `RESEARCH.template.md`, `INVESTIGATION.template.md`, `REFERENCE-ANCHORS.template.md` |
| Requirements, project, roadmap, state | merge | `SPEC.template.md`, `ROADMAP.template.md`, `STATE.md` |
| Validation, verification and UAT | merge | `/oxe-verify`, runtime evidence, `VERIFY.md` projection |
| UI contract | merge | `/oxe-spec --ui`, `/oxe-ui-spec`, `/oxe-ui-review` |
| Debug templates | merge | `/oxe-debug`, `/oxe-forensics`, `oxe-debugger` |
| Session summaries and setup | merge | `SUMMARY.template.md`, `RESUME.template.md`, checkpoints |
| Runtime-specific instruction files | inspiration_only | OXE multi-runtime generators |
| Developer profile/preferences | reject | future consented profile feature only |

## Workflows

| Source theme | Decision | OXE target |
|--------------|----------|------------|
| New project and milestone discovery | merge | `/oxe-spec`, `/oxe-plan` |
| Phase planning and review loop | merge | `/oxe-plan`, rationality gate |
| Plan execution by wave/task | merge | `/oxe-execute` |
| Verification, validation gaps and UAT | merge | `/oxe-verify` |
| Codebase mapping and research | merge | `/oxe-scan`, `/oxe-spec --research` |
| Debug and incident diagnosis | merge | `/oxe-debug`, `/oxe-forensics` |
| UI design and review | merge | `/oxe-spec --ui`, `/oxe-ui-review` |
| Progress, next, pause and resume | merge | `/oxe`, `/oxe-next`, `/oxe-session` |
| Workstreams and isolated workspace concepts | merge | `/oxe-workstream`, runtime agents |
| Autonomous workflow | reject | OXE keeps governed execution |
| PR branch/ship workflow | inspiration_only | OXE keeps local commit and separate `runtime promote` |
| Community/settings/update flows | reject | OXE already has administrative UX |

## Commands

Legacy command wrappers are not copied. They are used only as intent inventory and mapped into canonical OXE workflows before generated surfaces are regenerated.

## Agents

Specialized agents were reauthored as OXE-native contracts in `oxe/agents/`. They use `.oxe/`, OXE workflows, runtime enterprise, evidence store, personas and `plan-agents.json` only.

