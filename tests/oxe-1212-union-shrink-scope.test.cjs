'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const planBuild = require('../bin/lib/oxe-plan-build.cjs');

// 1.21.2 — OXB-198: Union type shrink (`AppView` in `src/keyboard/keybindings.ts`) automatically includes
// exhaustive `Record<AppView, ...>` / `[K in AppView]` consumers (`src/app/viewSwitch.ts`, `src/components/Keyboard/ShortcutGuide.tsx`)
// in mode-removal tasks.

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content, 'utf8');
};

function makeOxespaceViewProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-1212-appview-'));
  dirs.push(dir);

  write(dir, 'src/keyboard/keybindings.ts', [
    "export type AppView = 'code' | 'thread' | 'data' | 'pods' | 'post';",
    'export const DEFAULT_VIEW: AppView = "code";',
    '',
  ].join('\n'));

  write(dir, 'src/app/viewSwitch.ts', [
    "import type { AppView } from '../keyboard/keybindings';",
    '',
    'export const VIEW_NAMES: Record<AppView, string> = {',
    "  code: 'OxeCode',",
    "  thread: 'OxeChat',",
    "  data: 'OxeQuery',",
    "  pods: 'OxePod',",
    "  post: 'OxePost',",
    '};',
    '',
  ].join('\n'));

  write(dir, 'src/components/Keyboard/ShortcutGuide.tsx', [
    "import { type AppView } from '@/keyboard/keybindings';",
    '',
    'const VIEW_NAMES: Record<AppView, string> = {',
    "  code: 'OxeCode',",
    "  thread: 'OxeChat',",
    "  data: 'OxeQuery',",
    "  pods: 'OxePod',",
    "  post: 'OxePost',",
    '};',
    'export function ShortcutGuide() { return VIEW_NAMES.code; }',
    '',
  ].join('\n'));

  // Partial<Record<AppView, string>> is NOT exhaustive, so it should NOT be forced into scope
  write(dir, 'src/components/OptionalBadge.tsx', [
    "import type { AppView } from '../keyboard/keybindings';",
    "export const BADGES: Partial<Record<AppView, string>> = { code: 'beta' };",
    '',
  ].join('\n'));

  write(dir, 'src/components/OxePost/PostPanel.tsx', 'export function PostPanel() { return null; }\n');
  write(dir, 'src/components/OxePod/PodPanel.tsx', 'export function PodPanel() { return null; }\n');

  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'initial');
  return dir;
}

describe('OXB-198: union type shrink (`AppView`) auto-injects exhaustive Record<AppView, ...> consumers', () => {
  it('injects viewSwitch.ts and ShortcutGuide.tsx into mode removal tasks touching keybindings.ts, skipping Partial<Record<...>>', () => {
    const root = makeOxespaceViewProject();
    const frontendDoc = {
      role: 'frontend',
      tasks: [
        {
          rid: 'R14',
          title: 'Remover modo OxePost',
          kind: 'remove',
          deleted: ['src/components/OxePost/PostPanel.tsx'],
          edited: ['src/keyboard/keybindings.ts'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A14'],
        },
        {
          rid: 'R15',
          title: 'Remover modo OxePod',
          kind: 'remove',
          deleted: ['src/components/OxePod/PodPanel.tsx'],
          edited: ['src/keyboard/keybindings.ts'],
          verify: { commands: ['npm run typecheck'] },
          acceptance: ['A15'],
        },
      ],
    };

    const res = planBuild.build([{ file: 'f2-removals-FRONTEND.json', doc: frontendDoc }], { root, phase: 'F2' });
    assert.deepEqual(res.errors, []);

    const t1 = res.plan.tasks.find((t) => t.rid === 'R14');
    const t2 = res.plan.tasks.find((t) => t.rid === 'R15');
    assert.ok(t1 && t2);

    for (const task of [t1, t2]) {
      assert.ok(task.files.includes('src/app/viewSwitch.ts'), `${task.id} includes src/app/viewSwitch.ts`);
      assert.ok(task.files.includes('src/components/Keyboard/ShortcutGuide.tsx'), `${task.id} includes ShortcutGuide.tsx`);
      assert.ok(!task.files.includes('src/components/OptionalBadge.tsx'), `${task.id} skips non-exhaustive Partial<Record<...>>`);

      const packEntry = res.pack.tasks.find((p) => p.id === task.id);
      assert.ok(packEntry.exact_paths.includes('src/app/viewSwitch.ts'));
      assert.ok(packEntry.exact_paths.includes('src/components/Keyboard/ShortcutGuide.tsx'));
    }

    // Because both R14 and R15 now touch keybindings.ts + viewSwitch.ts + ShortcutGuide.tsx, assignWaves serializes them
    assert.notEqual(t1.wave, t2.wave, 'tasks sharing coupled view files serialize into distinct waves');
  });
});
