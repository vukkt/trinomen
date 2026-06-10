import { route } from '../src/agents/router.js';
import { loadConfig, hasKeys } from '../src/lib/config.js';

const config = loadConfig();
if (!hasKeys(config)) {
  console.log('⊘ skipping (no API keys configured)');
  process.exit(0);
}

// intent is always checked; needsReview only when specified, since it is
// the decision that gates the most expensive stage of the pipeline.
const cases = [
  { input: 'what is a closure', expected: 'question', needsReview: false },
  { input: 'write a debounce function', expected: 'code' },
  { input: 'review this: const x = 1', expected: 'review' },
  { input: 'explain how this useEffect works', expected: 'explain' },
  {
    input: 'write a JWT auth middleware for express with refresh token rotation',
    expected: 'code',
    needsReview: true,
  },
  {
    input: 'add a console.log to this function',
    expected: 'code',
    needsReview: false,
  },
];

let pass = 0,
  fail = 0;

for (const c of cases) {
  try {
    const { decision } = await route(c.input);
    let ok = decision.intent === c.expected;
    let detail = decision.intent;
    if (ok && c.needsReview !== undefined && decision.needsReview !== c.needsReview) {
      ok = false;
      detail += `, needsReview=${decision.needsReview} (expected ${c.needsReview})`;
    }
    console.log(`${ok ? '✓' : '✗'} "${c.input}" → ${detail}`);
    ok ? pass++ : fail++;
  } catch (err) {
    console.log(`✗ "${c.input}" → ERROR: ${err.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
