---
name: oxe-update
agent: agent
description: Atualizar oxe-cc no projeto — verificar versão no npm, alinhar ficheiros OXE e validar com doctor
---

Executa o workflow **OXE update**. Lê e segue **integralmente**:

`oxe/workflows/update.md` (na raiz do repositório em contexto; ou `.oxe/workflows/update.md` se a instalação aninhou os workflows)

Na prática: na raiz do projeto, correr **`npx oxe-cc update --check`**, depois (se aplicável) **`npx oxe-cc update`** ou **`npx oxe-cc update --if-newer`**, e por fim **`npx oxe-cc doctor`**.
