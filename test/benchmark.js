// Benchmark: one-shot generation vs the full trinomen refinement pipeline.
//
// Both arms use the same worker model, system prompt, and token budget —
// the only difference is the pipeline's typecheck gate + reviewer feedback
// loop. Scoring is objective: does the output pass `tsc --strict`?
//
// Usage: node test/benchmark.js   (requires configured API keys)

import { work } from '../src/agents/worker.js';
import { runGate } from '../src/agents/gate.js';
import { refinementLoop, extractCode } from '../src/agents/loop.js';
import { getUsage } from '../src/lib/budget.js';
import { loadConfig, hasKeys } from '../src/lib/config.js';

if (!hasKeys(loadConfig())) {
  console.log('⊘ skipping (no API keys configured)');
  process.exit(0);
}

const TASKS = [
  'write a useDebounce hook in TypeScript',
  'write a useLocalStorage hook with cross-tab sync via the storage event',
  'write a typed useFetch hook with AbortController cleanup and a discriminated union state (idle/loading/success/error)',
  'write a TypeScript class TypedEventEmitter<Events extends Record<string, unknown[]>> where on, off and emit are fully type-safe per event name',
  'write a usePagination hook that takes totalItems and pageSize and returns page, next, prev and goto, always clamped to the valid range',
];

const totalTokens = () => getUsage().reduce((sum, u) => sum + u.tokens, 0);
const secs = (ms) => (ms / 1000).toFixed(0) + 's';

const rows = [];

for (const task of TASKS) {
  console.log(`\n▶ ${task}`);
  try {
  let tokens = totalTokens();
  let start = Date.now();
  const shot = await work('code', task, { complexity: 'hard' });
  const shotGate = await runGate(extractCode(shot.text));
  const oneShot = {
    pass: shotGate.typecheck.ok,
    errors: shotGate.typecheck.errors.length,
    ms: Date.now() - start,
    tokens: totalTokens() - tokens,
  };
  console.log(
    `  one-shot: ${oneShot.pass ? '✓ typechecks' : `✗ ${oneShot.errors} tsc errors`} (${secs(oneShot.ms)}, ${oneShot.tokens} tokens)`,
  );

  tokens = totalTokens();
  start = Date.now();
  const result = await refinementLoop(task, { maxIterations: 3 });
  const finalGate = result.hitMax ? result.gateResult : null;
  const pipeline = {
    pass: result.hitMax ? finalGate.typecheck.ok : true,
    iterations: result.iterations,
    verdict: result.finalVerdict,
    ms: Date.now() - start,
    tokens: totalTokens() - tokens,
  };
  console.log(
    `  pipeline: ${pipeline.pass ? '✓ typechecks' : '✗ fails'} + verdict "${pipeline.verdict}" in ${pipeline.iterations} iteration(s) (${secs(pipeline.ms)}, ${pipeline.tokens} tokens)`,
  );

  rows.push({ task, oneShot, pipeline });
  } catch (err) {
    console.log(`  ⊘ skipped: ${err.message}`);
  }
}

console.log('\n\n## Results (markdown)\n');
console.log(
  '| Task | One-shot tsc | Pipeline tsc | Verdict | Iter. | One-shot cost | Pipeline cost |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const { task, oneShot, pipeline } of rows) {
  const short = task.length > 60 ? task.slice(0, 57) + '…' : task;
  console.log(
    `| ${short} | ${oneShot.pass ? '✅' : `❌ (${oneShot.errors})`} | ${pipeline.pass ? '✅' : '❌'} | ${pipeline.verdict} | ${pipeline.iterations} | ${oneShot.tokens} tok / ${secs(oneShot.ms)} | ${pipeline.tokens} tok / ${secs(pipeline.ms)} |`,
  );
}

const shotPass = rows.filter((r) => r.oneShot.pass).length;
const pipePass = rows.filter((r) => r.pipeline.pass).length;
console.log(
  `\none-shot: ${shotPass}/${rows.length} typecheck · pipeline: ${pipePass}/${rows.length} typecheck`,
);
