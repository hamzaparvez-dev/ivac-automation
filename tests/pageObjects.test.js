/**
 * Fixture-free unit tests for page object helpers (mock Playwright page).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const {
  clickFirstMatch,
  fillFirstMatch,
  firstVisible,
} = require('../src/ivac/pageObjects');

test('clickFirstMatch clicks first matching selector', async () => {
  let clicked = null;
  const page = {
    async $(sel) {
      if (sel === '#second') return { async click() { clicked = sel; } };
      return null;
    },
  };
  const ok = await clickFirstMatch(page, ['#first', '#second'], null, 'screen');
  assert.strictEqual(ok, true);
  assert.strictEqual(clicked, '#second');
});

test('clickFirstMatch returns false when no selector matches', async () => {
  const page = { async $() { return null; } };
  const ok = await clickFirstMatch(page, ['a', 'b'], null, 'screen');
  assert.strictEqual(ok, false);
});

test('fillFirstMatch skips empty value', async () => {
  let filled = false;
  const page = {
    async $() {
      filled = true;
      return { async fill() {} };
    },
  };
  const ok = await fillFirstMatch(page, ['#x'], '', null, 'f');
  assert.strictEqual(ok, false);
  assert.strictEqual(filled, false);
});

test('fillFirstMatch uses first existing input', async () => {
  let value = null;
  const page = {
    async $(sel) {
      if (sel === '#b')
        return {
          async fill(v) {
            value = v;
          },
        };
      return null;
    },
  };
  const ok = await fillFirstMatch(page, ['#a', '#b'], 'hello', null, 'f');
  assert.strictEqual(ok, true);
  assert.strictEqual(value, 'hello');
});

test('firstVisible returns first visible element', async () => {
  const page = {
    async waitForSelector(sel, opts) {
      if (sel === 'bad') throw new Error('timeout');
      if (sel === 'good') return { selector: sel };
      throw new Error('timeout');
    },
  };
  const r = await firstVisible(page, ['bad', 'good'], 100);
  assert.ok(r);
  assert.strictEqual(r.selector, 'good');
});

test('firstVisible returns null when none match', async () => {
  const page = {
    async waitForSelector() {
      throw new Error('timeout');
    },
  };
  const r = await firstVisible(page, ['x'], 50);
  assert.strictEqual(r, null);
});
