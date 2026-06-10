// Benchmark: is the pipeline worth its tokens?
//
// Three arms, same worker model, same system prompt, same token budget:
//   A  one-shot        single generation, no feedback
//   B  tsc-retry       regenerate with typecheck errors fed back (no reviewer)
//   C  full pipeline   typecheck gate + LLM reviewer feedback (trinomen --loop)
//
// Arm B is the ablation: if it matches arm C, the reviewer is dead weight.
//
// Scoring is functional, not cosmetic: every task has a hidden test suite
// (never shown to any model) that the compiled output must pass.
//
// Usage: node test/benchmark.js   (requires configured API keys)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { work } from '../src/agents/worker.js';
import { ensureSandbox, SANDBOX_DIR } from '../src/agents/gate.js';
import { refinementLoop, extractCode } from '../src/agents/loop.js';
import { getUsage } from '../src/lib/budget.js';
import { loadConfig, hasKeys } from '../src/lib/config.js';

if (!hasKeys(loadConfig())) {
  console.log('⊘ skipping (no API keys configured)');
  process.exit(0);
}

const TASKS = [
  {
    name: 'debounce',
    prompt:
      'write a TypeScript function debounce. Rapid calls collapse into one invocation with the latest arguments after the delay. The exact export must be: export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): ((...args: A) => void) & { cancel(): void }. Calling cancel() drops any pending invocation.',
    test: `import { debounce } from './generated';
import assert from 'node:assert/strict';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function main() {
  const calls: number[][] = [];
  const d = debounce((...args: [number]) => { calls.push(args); }, 30);
  d(1); d(2); d(3);
  await sleep(80);
  assert.equal(calls.length, 1, 'rapid calls collapse to one');
  assert.deepEqual(calls[0], [3], 'latest arguments win');
  d(4);
  await sleep(80);
  assert.equal(calls.length, 2, 'works again after firing');
  d(5);
  d.cancel();
  await sleep(80);
  assert.equal(calls.length, 2, 'cancel drops the pending call');
  console.log('PASS');
}
main().catch((err) => { console.error(String(err && err.message)); process.exit(1); });`,
  },
  {
    name: 'TypedEventEmitter',
    prompt:
      'write a TypeScript class TypedEventEmitter<Events extends Record<string, unknown[]>> with methods on<K extends keyof Events>(event: K, handler: (...args: Events[K]) => void): void, off with the same parameters, and emit<K extends keyof Events>(event: K, ...args: Events[K]): void — fully type-safe per event name. Export as named export TypedEventEmitter.',
    test: `import { TypedEventEmitter } from './generated';
import assert from 'node:assert/strict';
type Events = { greet: [name: string]; tick: [] };
const em = new TypedEventEmitter<Events>();
const seen: string[] = [];
const onGreet = (name: string) => { seen.push(name); };
em.on('greet', onGreet);
em.emit('greet', 'ada');
em.emit('greet', 'bob');
assert.deepEqual(seen, ['ada', 'bob'], 'handlers receive emitted args in order');
em.off('greet', onGreet);
em.emit('greet', 'eve');
assert.deepEqual(seen, ['ada', 'bob'], 'off removes the handler');
let ticks = 0;
em.on('tick', () => { ticks++; });
em.on('tick', () => { ticks += 10; });
em.emit('tick');
assert.equal(ticks, 11, 'multiple handlers all fire');
console.log('PASS');`,
  },
  {
    name: 'paginate',
    prompt:
      'write a TypeScript function paginate(totalItems: number, pageSize: number, requestedPage: number): { page: number; totalPages: number; startIndex: number; endIndex: number }. totalPages is at least 1. page is requestedPage clamped to [1, totalPages]. startIndex is (page - 1) * pageSize. endIndex is exclusive: min(startIndex + pageSize, totalItems). Export as named export paginate.',
    test: `import { paginate } from './generated';
import assert from 'node:assert/strict';
assert.deepEqual(paginate(95, 10, 2), { page: 2, totalPages: 10, startIndex: 10, endIndex: 20 });
assert.deepEqual(paginate(95, 10, 10), { page: 10, totalPages: 10, startIndex: 90, endIndex: 95 }, 'short last page');
assert.equal(paginate(95, 10, 99).page, 10, 'clamps above');
assert.equal(paginate(95, 10, -3).page, 1, 'clamps below');
assert.deepEqual(paginate(0, 10, 1), { page: 1, totalPages: 1, startIndex: 0, endIndex: 0 }, 'zero items');
console.log('PASS');`,
  },
  {
    name: 'deepEqual',
    prompt:
      'write a TypeScript function deepEqual(a: unknown, b: unknown): boolean that deeply compares primitives, plain objects and arrays. NaN is equal to NaN. null and undefined are NOT equal to each other. Two objects are equal only if they have the same set of own enumerable keys with deeply equal values. Export as named export deepEqual.',
    test: `import { deepEqual } from './generated';
import assert from 'node:assert/strict';
assert.equal(deepEqual(1, 1), true);
assert.equal(deepEqual('a', 'b'), false);
assert.equal(deepEqual(NaN, NaN), true, 'NaN equals NaN');
assert.equal(deepEqual(null, undefined), false, 'null is not undefined');
assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true, 'nested structures');
assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false, 'extra key matters');
assert.equal(deepEqual([1, 2], [2, 1]), false, 'array order matters');
console.log('PASS');`,
  },
  {
    name: 'LRUCache',
    prompt:
      'write a TypeScript class LRUCache<K, V> with constructor(capacity: number), get(key: K): V | undefined and set(key: K, value: V): void. get refreshes the recency of the key. set evicts the least-recently-used entry when capacity is exceeded. Export as named export LRUCache.',
    test: `import { LRUCache } from './generated';
import assert from 'node:assert/strict';
const c = new LRUCache<string, number>(2);
c.set('a', 1);
c.set('b', 2);
assert.equal(c.get('a'), 1);
c.set('c', 3);
assert.equal(c.get('b'), undefined, 'least-recently-used entry evicted (a was refreshed by get)');
assert.equal(c.get('a'), 1);
assert.equal(c.get('c'), 3);
c.set('a', 9);
assert.equal(c.get('a'), 9, 'set overwrites existing keys');
console.log('PASS');`,
  },
];

const MAX_ITERATIONS = 3;
const BENCH_DIR = join(SANDBOX_DIR, '.bench-src');
const totalTokens = () => getUsage().reduce((sum, u) => sum + u.tokens, 0);
const secs = (ms) => (ms / 1000).toFixed(0) + 's';

// Compile generated code together with the hidden test suite, then run it.
// Lives in a subdirectory so it never leaks into the product gate's tsconfig.
function functionalGate(code, testSrc) {
  ensureSandbox();
  mkdirSync(join(BENCH_DIR, 'out'), { recursive: true });
  writeFileSync(join(BENCH_DIR, 'generated.ts'), code);
  writeFileSync(join(BENCH_DIR, 'case.test.ts'), testSrc);
  writeFileSync(
    join(BENCH_DIR, 'out', 'package.json'),
    '{"type":"commonjs"}',
  );

  try {
    execSync(
      '../node_modules/.bin/tsc generated.ts case.test.ts --ignoreConfig --outDir out --module commonjs --target es2022 --strict --esModuleInterop --skipLibCheck --types node',
      { cwd: BENCH_DIR, stdio: 'pipe', timeout: 60_000 },
    );
  } catch (err) {
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    return {
      compile: false,
      errors: out.split('\n').filter((l) => l.includes('error TS')).slice(0, 10),
      pass: false,
    };
  }

  try {
    execSync('node out/case.test.js', { cwd: BENCH_DIR, stdio: 'pipe', timeout: 15_000 });
    return { compile: true, errors: [], pass: true };
  } catch (err) {
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    return {
      compile: true,
      errors: [],
      pass: false,
      failMsg: out.split('\n').find((l) => l.trim()) || 'test crashed',
    };
  }
}

// Arm B: regenerate with compiler errors fed back. No reviewer involved.
async function tscRetryLoop(prompt, testSrc) {
  let code = null;
  let iterations = 0;
  let gate = null;
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const input =
      iterations === 1
        ? prompt
        : `ORIGINAL REQUEST:\n${prompt}\n\nPREVIOUS ATTEMPT:\n${code}\n\nTYPECHECK ERRORS:\n${gate.errors.join('\n')}\n\nRewrite the code to fix ALL the above. Output a single fenced code block. No prose.`;
    const result = await work('code', input, { complexity: 'hard' });
    code = extractCode(result.text);
    gate = functionalGate(code, testSrc);
    if (gate.compile) break;
  }
  return { ...gate, iterations };
}

const rows = [];

for (const { name, prompt, test } of TASKS) {
  console.log(`\n▶ ${name}`);
  const row = { name };

  for (const [arm, run] of [
    ['oneShot', async () => {
      const result = await work('code', prompt, { complexity: 'hard' });
      return { ...functionalGate(extractCode(result.text), test), iterations: 1 };
    }],
    ['tscRetry', () => tscRetryLoop(prompt, test)],
    ['pipeline', async () => {
      const result = await refinementLoop(prompt, { maxIterations: MAX_ITERATIONS });
      return { ...functionalGate(result.code, test), iterations: result.iterations };
    }],
  ]) {
    try {
      const tokens = totalTokens();
      const start = Date.now();
      const outcome = await run();
      row[arm] = { ...outcome, ms: Date.now() - start, tokens: totalTokens() - tokens };
      const o = row[arm];
      console.log(
        `  ${arm.padEnd(8)}: compile ${o.compile ? '✓' : '✗'} · tests ${o.pass ? '✓ PASS' : '✗ FAIL'}${o.failMsg ? ` (${o.failMsg.slice(0, 80)})` : ''} · ${o.iterations} iter · ${o.tokens} tok · ${secs(o.ms)}`,
      );
    } catch (err) {
      row[arm] = { compile: false, pass: false, iterations: 0, ms: 0, tokens: 0, skipped: true };
      console.log(`  ${arm.padEnd(8)}: ⊘ skipped (${err.message.split('\n')[0].slice(0, 100)})`);
    }
  }
  rows.push(row);
}

const mark = (o) => (o.skipped ? '⊘' : o.pass ? '✅' : o.compile ? '❌ tests' : '❌ compile');

console.log('\n\n## Results (markdown)\n');
console.log('| Task | One-shot | tsc-retry (no reviewer) | Full pipeline |');
console.log('| --- | --- | --- | --- |');
for (const r of rows) {
  console.log(`| ${r.name} | ${mark(r.oneShot)} | ${mark(r.tscRetry)} | ${mark(r.pipeline)} |`);
}

for (const arm of ['oneShot', 'tscRetry', 'pipeline']) {
  const done = rows.filter((r) => !r[arm].skipped);
  const passed = done.filter((r) => r[arm].pass).length;
  const tokens = done.reduce((sum, r) => sum + r[arm].tokens, 0);
  console.log(
    `${arm}: ${passed}/${done.length} functional pass · ${tokens} tokens total`,
  );
}
