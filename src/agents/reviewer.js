import { z } from 'zod';
import { callWithFallback } from '../lib/providers.js';
import { REVIEWER_SYSTEM } from '../prompts/reviewer.js';

const ReviewSchema = z.object({
  verdict: z.enum(['ship', 'fix', 'reject']),
  issues: z.array(
    z.object({
      severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']),
      line: z.number(),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
  patch: z.string().nullable(),
});

export async function review(originalPrompt, workerOutput) {
  const result = await callWithFallback('reviewer', {
    schema: ReviewSchema,
    system: REVIEWER_SYSTEM,
    prompt: `Original request:\n${originalPrompt}\n\nWorker output:\n${workerOutput}`,
    temperature: 0.1,
    // generous: reasoning models spend tokens thinking before the JSON
    maxOutputTokens: 1600,
  });

  return { review: result.object, meta: result._meta };
}
