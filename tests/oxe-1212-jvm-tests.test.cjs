'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { declaredTestTitles } = require('../bin/lib/oxe-plan-json.cjs');

// 1.21.2 - OXB-150: F10's AttnUsageTest.kt was read as ONE test named "Notice" (a string literal in its body).

const KT = [
  'package com.oxespace.mobile.ui.theme',
  'import org.junit.Test',
  'class AttnUsageTest {',
  '  @Test fun theNoticeNeverUsesTheSun() { assertEquals("Notice", label()) }',
  '  @Test',
  '  fun theScanFindsTheUiSources() { test("not a test") }',
  '  @Test fun `the sun is never next to an error`() {}',
  '  @DisplayName("mostra o aviso") @Test fun showsNotice() {}',
  '}',
].join('\n');

describe('OXB-150: Kotlin/Java JUnit test discovery', () => {
  it('Kotlin: method names (incl. backticks) and @DisplayName; never string literals', () => {
    assert.deepEqual(declaredTestTitles(KT, 'AttnUsageTest.kt').sort(), ['mostra o aviso', 'showsNotice', 'the sun is never next to an error', 'theNoticeNeverUsesTheSun', 'theScanFindsTheUiSources'].sort());
  });
  it('Java: @Test void name() with modifiers and annotations in between', () => {
    const java = 'class T {\n  @Test\n  public void sumsTwo() {}\n  @Test @DisplayName("soma dois") void other() throws Exception {}\n}';
    assert.deepEqual(declaredTestTitles(java, 'T.java').sort(), ['other', 'soma dois', 'sumsTwo']);
  });
  it('JS/TS files keep the it()/test() literal discovery', () => {
    assert.deepEqual(declaredTestTitles("it('soma', () => {})", 'a.test.ts'), ['soma']);
  });
});
