import { callWithFallback } from '../lib/providers.js';
import { WORKER_SYSTEMS } from '../prompts/worker.js';

// Output budget scales with routed complexity so trivial requests
// don't burn the same tokens as architecture questions.
const TOKEN_BUDGETS = { trivial: 512, normal: 2048, hard: 4096 };

export async function work(intent, prompt, { complexity = 'normal' } = {}) {
  const system = WORKER_SYSTEMS[intent] || WORKER_SYSTEMS.question;

  const result = await callWithFallback('worker', {
    system,
    prompt,
    temperature: intent === 'code' ? 0.4 : 0.3,
    maxOutputTokens: TOKEN_BUDGETS[complexity] ?? TOKEN_BUDGETS.normal,
  });

  return {
    text: result.text,
    usage: result.usage,
    meta: result._meta,
  };
}
