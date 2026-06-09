# trinomen

> Three agents, zero dollars. A multi-agent LLM pipeline in your terminal — router → worker → reviewer — running entirely on free Groq and Gemini tiers.

Ask a question, get an answer. Ask for code, get code that has been **classified, generated, reviewed, and (optionally) typechecked in a loop until it passes** — each stage handled by a different model picked for that job.

```
$ trinomen "write a useDebounce hook in TypeScript"

  ┌─────────┐      ┌─────────┐      ┌──────────┐
  │ router  │ ───→ │ worker  │ ───→ │ reviewer │
  │ gpt-oss │      │ gemini  │      │ gpt-oss  │
  │   20b   │      │  flash  │      │   120b   │
  └─────────┘      └─────────┘      └──────────┘
   classifies       generates        audits

— review —
verdict: ship
```

## Why

- **Right-sized models.** A 20B model classifies intent in milliseconds; a strong generalist writes the code; a 120B reasoning model audits it. No single model does a job a cheaper one could.
- **Free-tier native.** Every request is logged to a local SQLite database, and calls are budgeted against ~95% of each provider's daily free-tier caps. When one provider runs dry, the pipeline falls back to the other automatically.
- **Adversarial by design.** The worker and reviewer run on *different providers*, so the reviewer has no incentive to rubber-stamp its own output. Reviews come back as structured JSON: verdict (`ship` / `fix` / `reject`), severity-tagged issues, and a patch.
- **Verified, not vibed.** With `--loop`, generated TypeScript is written to a sandbox and run through `tsc --strict`. Typecheck errors and review issues are fed back to the worker until the code converges or hits the iteration cap.

## Install

```bash
npm i -g trinomen
trinomen init
```

You need two free API keys (no credit card for either):

- [Google AI Studio](https://aistudio.google.com/apikey)
- [Groq Console](https://console.groq.com/keys)

Keys are stored in `~/.trinomen/config.json` (mode `0600`), or read from the `GOOGLE_API_KEY` / `GROQ_API_KEY` environment variables, which take precedence.

## Use

```bash
# anything — the router decides what kind of request it is
trinomen "what is the event loop"
trinomen "write a JWT auth middleware for express"
trinomen "review this: function add(a,b){ return a+b }"

# refinement loop: generate → typecheck → review → repeat until clean
trinomen --loop "write a useLocalStorage hook with cross-tab sync"

# skip the reviewer for quick stuff
trinomen --no-review "one-liner to dedupe an array"

# see which model handled each stage
trinomen -v "explain this reduce call: arr.reduce((a, b) => a + b, 0)"

# check today's token spend per provider/model
trinomen status
```

## How it works

1. **Router** (`openai/gpt-oss-20b` on Groq) classifies the prompt into `question` / `code` / `review` / `explain`, scores complexity, and decides whether a review pass is worth the tokens. Trivial requests skip review entirely.
2. **Worker** (`gemini-2.5-flash`) generates the answer with an intent-specific system prompt. Output token budget scales with the routed complexity (512 → 2048 → 4096), so a syntax question never burns a refactor-sized budget.
3. **Reviewer** (`openai/gpt-oss-120b` on Groq) audits non-trivial code against a strict React/TypeScript rubric. It is prompted to flag only *provable* failures — concrete failing inputs or attack vectors — and a clean review is a valid result.

Every role has a fallback chain on the other provider, so a rate limit or malformed response degrades gracefully instead of failing the run:

| Role     | Primary                    | Fallback                |
| -------- | -------------------------- | ----------------------- |
| router   | Groq `gpt-oss-20b`         | `gemini-2.5-flash-lite` |
| worker   | `gemini-2.5-flash`         | Groq `llama-3.3-70b`    |
| reviewer | Groq `gpt-oss-120b`        | `gemini-2.5-flash`      |

### The refinement loop (`--loop`)

For code requests, `--loop` turns the pipeline into a convergence loop:

```
worker → extract code → tsc --strict (sandbox) → reviewer
   ↑                                                 │
   └── typecheck errors + review issues ─────────────┘
```

The loop exits when the code typechecks **and** the reviewer says `ship`, or after `--max-iterations` (default 3). The sandbox is a throwaway npm project in `~/.trinomen/sandbox` with `typescript`, `react`, and strict-mode `tsconfig` — created once on first use.

### Budget tracking

Every call records its token usage to `~/.trinomen/budget.db` (SQLite). Before each call, the rolling 24-hour spend is checked against conservative per-model caps; models over budget are skipped in favor of their fallback. `trinomen status` shows the current spend, `trinomen reset` clears it.

## Commands & flags

| Command               | Description              |
| --------------------- | ------------------------ |
| `trinomen "<prompt>"` | Run the pipeline         |
| `trinomen init`       | Configure API keys       |
| `trinomen status`     | Show last-24h usage      |
| `trinomen reset`      | Clear usage history      |

| Flag                   | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `--loop`               | Refinement loop: typecheck + review until clean   |
| `--max-iterations <n>` | Loop iteration cap (default 3)                    |
| `--no-review`          | Skip the reviewer stage                           |
| `-i, --intent <type>`  | Bypass the router: `question\|code\|review\|explain` |
| `-v, --verbose`        | Show which provider/model handled each stage      |

## Library usage

The agents are importable directly:

```js
import { route, work, review } from 'trinomen';

const { decision } = await route('write a binary search in TS');
const { text } = await work(decision.intent, 'write a binary search in TS');
const { review: verdict } = await review('write a binary search in TS', text);
```

## Development

```bash
git clone https://github.com/vukkt/trinomen.git
cd trinomen && npm install
npm test          # live router eval (skips cleanly if no keys configured)
node bin/cli.js "hello"
```

Stack: Node ≥ 18, ESM, [Vercel AI SDK](https://ai-sdk.dev) v6 with zod-validated structured outputs, `better-sqlite3` for budget persistence, `commander` + `ora` + `chalk` for the CLI.

## License

MIT © Vuk Topalovic
