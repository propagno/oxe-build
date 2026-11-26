import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedOutput, windowsNullRedirects } from '../src/executor/built-in-tools';

// OxeSpace 14/11 (OxeChat F2 T5): `2>$null` through cmd.exe created a file named `$null` in the worktree.
describe('redirecionamento para o nulo no Windows', () => {
  test('$null e /dev/null viram nul; o resto do comando não muda', () => {
    assert.equal(windowsNullRedirects('git status 2>$null'), 'git status 2>nul');
    assert.equal(windowsNullRedirects('npm ls >/dev/null 2>&1'), 'npm ls >nul 2>&1');
    assert.equal(windowsNullRedirects('x 2>> /dev/null'), 'x 2>>nul');
    assert.equal(windowsNullRedirects('x &> /dev/null'), 'x >nul 2>&1');
    assert.equal(windowsNullRedirects('echo $nullable > out.txt'), 'echo $nullable > out.txt');
    assert.equal(windowsNullRedirects('cat /dev/null/x'), 'cat /dev/null/x');
  });
});

// OxeSpace 14/11 (P0): a command printing more than ~512 MB made Buffer.concat(...).toString() throw
// ERR_STRING_TOO_LONG and killed the whole run. The shell output is bounded: head + tail + what was cut.

describe('saída do run_command com limite', () => {
  test('pequena: sai inteira', () => {
    const o = new BoundedOutput(16, 1024);
    o.push(Buffer.from('abc'));
    o.push(Buffer.from('def'));
    assert.equal(o.text(), 'abcdef');
    assert.equal(o.overLimit, false);
  });

  test('grande: o começo, o fim e quantos bytes foram cortados', () => {
    const o = new BoundedOutput(8, 1 << 20);
    o.push(Buffer.from('HEAD1234'));
    for (let i = 0; i < 1000; i += 1) o.push(Buffer.from('xxxxxxxxxx'));
    o.push(Buffer.from('TAIL5678'));
    const t = o.text();
    assert.ok(t.startsWith('HEAD1234'), t.slice(0, 40));
    assert.ok(t.endsWith('TAIL5678'), t.slice(-40));
    assert.match(t, /\[… 10000 bytes cortados da saída \(10016 no total\)/);
    assert.ok(t.length < 400, `bounded (${t.length})`);
  });

  test('o limite duro é sinalizado; a memória fica limitada ao começo e ao fim', () => {
    const o = new BoundedOutput(1024, 64 * 1024);
    const chunk = Buffer.alloc(8 * 1024, 0x61);
    for (let i = 0; i < 20; i += 1) o.push(chunk);
    assert.equal(o.overLimit, true);
    assert.ok(o.text().length < 4 * 1024);
  });
});
