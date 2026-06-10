import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point HOME at a throwaway dir BEFORE importing modules that resolve
// ~/.trinomen at import time, so tests never touch real user data.
process.env.HOME = mkdtempSync(join(tmpdir(), 'trinomen-test-'));
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;

const { extractCode } = await import('../src/agents/loop.js');
const { loadConfig, saveConfig, hasKeys } = await import('../src/lib/config.js');
const { canCall, record, getUsage, resetUsage } = await import('../src/lib/budget.js');

describe('extractCode', () => {
  test('extracts a tagged fenced block', () => {
    const text = 'here you go:\n```tsx\nconst x = 1;\n```\nenjoy';
    assert.equal(extractCode(text), 'const x = 1;');
  });

  test('extracts an untagged fenced block', () => {
    assert.equal(extractCode('```\nlet y = 2;\n```'), 'let y = 2;');
  });

  test('returns trimmed text when there is no fence', () => {
    assert.equal(extractCode('  const z = 3;  '), 'const z = 3;');
  });

  test('takes only the first block when several exist', () => {
    const text = '```ts\nfirst();\n```\nand\n```ts\nsecond();\n```';
    assert.equal(extractCode(text), 'first();');
  });
});

describe('config', () => {
  test('hasKeys is false on a fresh config', () => {
    assert.equal(hasKeys(loadConfig()), false);
  });

  test('saveConfig/loadConfig roundtrip', () => {
    saveConfig({ googleApiKey: 'g-123', groqApiKey: 'q-456' });
    const config = loadConfig();
    assert.equal(config.googleApiKey, 'g-123');
    assert.equal(config.groqApiKey, 'q-456');
    assert.equal(hasKeys(config), true);
  });

  test('config file is private (0600)', () => {
    const mode = statSync(join(process.env.HOME, '.trinomen', 'config.json')).mode;
    assert.equal(mode & 0o777, 0o600);
  });

  test('environment variables take precedence over the file', () => {
    process.env.GOOGLE_API_KEY = 'env-google';
    assert.equal(loadConfig().googleApiKey, 'env-google');
    delete process.env.GOOGLE_API_KEY;
  });

  test('saveConfig merges instead of overwriting', () => {
    saveConfig({ googleApiKey: 'g-789' });
    const raw = JSON.parse(
      readFileSync(join(process.env.HOME, '.trinomen', 'config.json'), 'utf8'),
    );
    assert.equal(raw.googleApiKey, 'g-789');
    assert.equal(raw.groqApiKey, 'q-456');
  });
});

describe('budget', () => {
  test('unknown models are always allowed', () => {
    assert.equal(canCall('nobody', 'no-model'), true);
  });

  test('records accumulate into getUsage', () => {
    record('google', 'gemini-2.5-flash', 100);
    record('google', 'gemini-2.5-flash', 150);
    const usage = getUsage();
    const row = usage.find((u) => u.model === 'gemini-2.5-flash');
    assert.equal(row.tokens, 250);
    assert.equal(row.requests, 2);
  });

  test('canCall blocks when the request cap is reached', () => {
    // gemini-2.5-flash rpd cap is 240
    for (let i = 0; i < 240; i++) record('google', 'gemini-2.5-flash', 1);
    assert.equal(canCall('google', 'gemini-2.5-flash'), false);
  });

  test('canCall blocks when estimated tokens would exceed the token cap', () => {
    resetUsage();
    // gemini-2.5-flash tpd cap is 900_000
    record('google', 'gemini-2.5-flash', 899_500);
    assert.equal(canCall('google', 'gemini-2.5-flash', 100), true);
    assert.equal(canCall('google', 'gemini-2.5-flash', 1000), false);
  });

  test('resetUsage clears everything', () => {
    resetUsage();
    assert.equal(getUsage().length, 0);
  });
});
