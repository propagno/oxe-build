# Métodos de estresse da spec (OXB-143)

Catálogo usado por `oxe-cc spec stress`. Cada método tem um id, as palavras que indicam o ponto fraco que ele ataca e a instrução dada ao leitor independente. O leitor recebe só um resumo curto do objetivo e o texto do critério.

## premortem — Pré-mortem
- Ataca: entrega, release, upgrade, migração, dados, fluxo
- Tamanho: longo
- Instrução: Imagine que esta entrega foi ao ar e falhou feio seis semanas depois. Liste as causas mais prováveis que o texto do critério deixou passar, e para cada uma proponha a frase que deveria entrar no critério.

## adversary — Adversário
- Ataca: permissão, segurança, entrada, token, segredo, rede, arquivo, comando, usuário
- Tamanho: médio
- Instrução: Você quer fazer este critério passar sem que a funcionalidade funcione de verdade, ou abusar dela. Mostre como, e proponha a mudança no critério que fecha cada brecha.

## extreme-user — Usuário extremo
- Ataca: tela, interface, botão, lista, volume, acessibilidade, teclado, idioma, mobile
- Tamanho: médio
- Instrução: Pense no usuário mais extremo: mil itens, nenhum item, leitor de tela, só teclado, idioma longo, conexão lenta, tela pequena. Onde o critério não diz o que acontece? Proponha a frase que diz.

## boundary — Limites
- Ataca: limite, máximo, mínimo, tamanho, tempo, prazo, número, quantidade, data, fuso
- Tamanho: curto
- Instrução: Encontre cada valor no limite (zero, um, o máximo, um a mais, negativo, vazio, fuso, virada de dia) que o critério não cobre, e proponha a frase que o cobre.

## concurrency — Concorrência
- Ataca: simultâneo, paralelo, fila, sessão, sincronizar, duas abas, dois processos, retry, idempot
- Tamanho: médio
- Instrução: Duas pessoas (ou dois processos) fazem isso ao mesmo tempo, ou a mesma ação é repetida. O que o critério garante? Proponha a frase que define o resultado.

## regression — O que já existe
- Ataca: alterar, substituir, remover, refatorar, existente, compatível, legado
- Tamanho: curto
- Instrução: Esta mudança mexe em algo que já funciona. Liste o comportamento atual que o critério deveria preservar explicitamente, e proponha a frase que o preserva.
