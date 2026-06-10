import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { generateText, generateObject } from 'ai';
import { canCall, record } from './budget.js';
import { loadConfig } from './config.js';

// SDK clients are created lazily so importing this module never requires
// API keys — `trinomen init`, `status`, and `--version` must work without them.
let clients = null;

function getClients() {
  if (!clients) {
    const config = loadConfig();
    if (!config.googleApiKey || !config.groqApiKey) {
      throw new Error('Missing API keys. Run: trinomen init');
    }
    clients = {
      google: createGoogleGenerativeAI({ apiKey: config.googleApiKey }),
      groq: createGroq({ apiKey: config.groqApiKey }),
    };
  }
  return clients;
}

// Router and reviewer need structured outputs (JSON schema), so their Groq
// entries must be models that support it: https://console.groq.com/docs/structured-outputs
export const MODELS = {
  router: [
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'google', model: 'gemini-2.5-flash-lite' },
  ],
  worker: [
    { provider: 'google', model: 'gemini-2.5-flash' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  ],
  reviewer: [
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'google', model: 'gemini-2.5-flash' },
  ],
};

function isRetryable(err) {
  const status = err?.statusCode ?? err?.status;
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return true;
  }
  const msg = err?.message?.toLowerCase() || '';
  return (
    msg.includes('rate') ||
    msg.includes('overload') ||
    msg.includes('high demand') ||
    msg.includes('unavailable') ||
    msg.includes('quota') ||
    // malformed structured output from one model is worth retrying on the next
    msg.includes('failed to validate json') ||
    err?.name === 'AI_NoObjectGeneratedError'
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callWithFallback(role, opts, { passes = 3 } = {}) {
  const sdks = getClients();
  let lastError;

  // Walk the fallback chain; if every provider fails transiently
  // (demand spikes, rate limits), back off and sweep the chain again.
  for (let pass = 0; pass < passes; pass++) {
    // second sweep waits long enough to clear per-minute quota windows
    if (pass > 0) await sleep(pass === 1 ? 5_000 : 30_000);

    for (const entry of MODELS[role]) {
      // ~4 chars per token for the input, plus the output budget
      const estimatedTokens =
        Math.ceil((opts.prompt?.length ?? 0) / 4) + (opts.maxOutputTokens ?? 1000);
      if (!canCall(entry.provider, entry.model, estimatedTokens)) continue;

      try {
        const model = sdks[entry.provider](entry.model);
        const result = opts.schema
          ? await generateObject({ model, maxRetries: 0, ...opts })
          : await generateText({ model, maxRetries: 0, ...opts });

        record(entry.provider, entry.model, result.usage?.totalTokens ?? 0);

        // pick fields explicitly: the SDK result exposes text/object via
        // prototype getters, which a spread would silently drop
        return {
          text: result.text,
          object: result.object,
          usage: result.usage,
          _meta: { provider: entry.provider, model: entry.model },
        };
      } catch (err) {
        lastError = err;
        if (isRetryable(err)) continue;
        throw err;
      }
    }
  }

  throw new Error(
    `All providers exhausted for role "${role}".` +
      (lastError ? ` Last error: ${lastError.message}` : ' Daily budget caps reached.'),
  );
}
