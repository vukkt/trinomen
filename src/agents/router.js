import { z } from 'zod';
import { callWithFallback } from '../lib/providers.js';
import { ROUTER_SYSTEM } from '../prompts/router.js';

const RouterSchema = z.object({
  intent: z.enum(['question', 'code', 'review', 'explain']),
  needsReview: z.boolean(),
  complexity: z.enum(['trivial', 'normal', 'hard']),
});

export async function route(prompt) {
  const result = await callWithFallback('router', {
    schema: RouterSchema,
    system: ROUTER_SYSTEM,
    prompt,
    temperature: 0,
    // generous: reasoning models spend tokens thinking before the JSON
    maxOutputTokens: 800,
  });

  return { decision: result.object, meta: result._meta };
}
