import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatCompletionsUrl } from '../src/executor/stream-completion';

// Regressão: `new URL('/chat/completions', base)` descartava o prefixo `/v1` e o runtime batia
// em `https://api.anthropic.com/chat/completions` (404) com a configuração padrão.

describe('buildChatCompletionsUrl', () => {
  test('preserva o prefixo /v1 da base', () => {
    assert.equal(buildChatCompletionsUrl('https://api.anthropic.com/v1').href, 'https://api.anthropic.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('https://api.openai.com/v1/').href, 'https://api.openai.com/v1/chat/completions');
    assert.equal(buildChatCompletionsUrl('http://127.0.0.1:8787/v1').href, 'http://127.0.0.1:8787/v1/chat/completions');
  });

  test('base sem path continua funcionando', () => {
    assert.equal(buildChatCompletionsUrl('http://localhost:11434').href, 'http://localhost:11434/chat/completions');
    assert.equal(buildChatCompletionsUrl('http://localhost:11434///').href, 'http://localhost:11434/chat/completions');
  });
});
