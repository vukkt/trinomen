import { route } from '../src/agents/router.js';
import { loadConfig, hasKeys } from '../src/lib/config.js';

const config = loadConfig();
if (!hasKeys(config)) {
  console.log('⊘ skipping (no API keys configured)');
  process.exit(0);
}

const cases = [
  { input: 'what is a closure', expected: 'question' },
  { input: 'write a debounce function', expected: 'code' },
  { input: 'review this: const x = 1', expected: 'review' },
];

let pass = 0,
  fail = 0;

for (const c of cases) {
  try {
    const { decision } = await route(c.input);
    const ok = decision.intent === c.expected;
    console.log(
      `${ok ? '✓' : '✗'} "${c.input}" → ${decision.intent} (expected ${c.expected})`,
    );
    ok ? pass++ : fail++;
  } catch (err) {
    console.log(`✗ "${c.input}" → ERROR: ${err.message}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
