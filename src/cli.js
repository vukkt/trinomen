import { Command } from 'commander';
import { password } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { route } from './agents/router.js';
import { work } from './agents/worker.js';
import { review } from './agents/reviewer.js';
import { loadConfig, saveConfig, hasKeys } from './lib/config.js';
import { getUsage, resetUsage } from './lib/budget.js';
import { refinementLoop } from './agents/loop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);

const program = new Command();

program
  .name('trinomen')
  .description('Three-agent CLI: route, generate, review')
  .version(pkg.version);

program
  .command('init')
  .description('configure API keys')
  .action(async () => {
    const googleApiKey = await password({
      message: 'Google API key (https://aistudio.google.com/apikey):',
      mask: '*',
    });
    const groqApiKey = await password({
      message: 'Groq API key (https://console.groq.com/keys):',
      mask: '*',
    });
    saveConfig({ googleApiKey, groqApiKey });
    console.log(chalk.green('✓ saved to ~/.trinomen/config.json'));
  });

program
  .command('status')
  .description("show today's usage")
  .action(() => {
    const usage = getUsage();
    if (usage.length === 0) {
      console.log(chalk.dim('no usage today'));
      return;
    }
    console.log(chalk.bold('\nUsage (last 24h)\n'));
    for (const u of usage) {
      console.log(`  ${chalk.cyan(u.provider)}/${u.model}`);
      console.log(`    requests: ${u.requests}`);
      console.log(`    tokens:   ${u.tokens.toLocaleString()}`);
    }
    console.log();
  });

program
  .command('reset')
  .description('clear usage history')
  .action(() => {
    resetUsage();
    console.log(chalk.green('✓ usage cleared'));
  });

program
  .argument('[prompt...]', 'your question or request')
  .option('--no-review', 'skip reviewer stage')
  .option('-i, --intent <type>', 'force intent: question|code|review|explain')
  .option('-v, --verbose', 'show agent metadata')
  .option('--loop', 'enable refinement loop (slower, higher quality)')
  .option('--max-iterations <n>', 'max loop iterations', '3')
  .action(async (promptParts, opts) => {
    const config = loadConfig();
    if (!hasKeys(config)) {
      console.error(chalk.red('✗ missing API keys. run: trinomen init'));
      process.exit(1);
    }

    if (!promptParts || promptParts.length === 0) {
      program.help();
      return;
    }

    const prompt = promptParts.join(' ');

    try {
      const spin = ora({ text: 'routing...', spinner: 'dots' }).start();
      const { decision, meta: routerMeta } = opts.intent
        ? {
            decision: {
              intent: opts.intent,
              needsReview: opts.intent === 'code',
              complexity: 'normal',
            },
            meta: null,
          }
        : await route(prompt);

      if (opts.loop && decision.intent === 'code') {
        spin.stop();
        const result = await refinementLoop(prompt, {
          maxIterations: parseInt(opts.maxIterations, 10),
          verbose: opts.verbose,
        });

        console.log(result.code);

        if (result.hitMax) {
          console.log(
            chalk.yellow(
              `\n⚠ hit max iterations (${result.iterations}). Final verdict: ${result.finalVerdict}`,
            ),
          );
          if (result.gateResult?.typecheck.errors?.length) {
            console.log(chalk.dim('Remaining typecheck errors:'));
            result.gateResult.typecheck.errors.forEach((e) =>
              console.log(chalk.dim('  ' + e)),
            );
          }
        } else {
          console.log(
            chalk.green(
              `\n✓ converged after ${result.iterations} iteration(s)`,
            ),
          );
        }
        return;
      }

      spin.text = `working (${decision.intent})...`;
      const { text, meta: workerMeta } = await work(decision.intent, prompt, {
        complexity: decision.complexity,
      });

      const shouldReview = opts.review !== false && decision.needsReview;
      let reviewResult = null;
      if (shouldReview) {
        spin.text = 'reviewing...';
        reviewResult = await review(prompt, text);
      }

      spin.stop();

      if (opts.verbose) {
        console.log(
          chalk.dim(
            `router:   ${routerMeta?.provider || 'forced'}/${routerMeta?.model || ''}`,
          ),
        );
        console.log(
          chalk.dim(`intent:   ${decision.intent} (${decision.complexity})`),
        );
        console.log(
          chalk.dim(`worker:   ${workerMeta.provider}/${workerMeta.model}`),
        );
        if (reviewResult) {
          console.log(
            chalk.dim(
              `reviewer: ${reviewResult.meta.provider}/${reviewResult.meta.model}`,
            ),
          );
        }
        console.log();
      }

      console.log(text);

      if (reviewResult) {
        const { verdict, issues, patch } = reviewResult.review;
        const verdictColor =
          verdict === 'ship'
            ? chalk.green
            : verdict === 'fix'
              ? chalk.yellow
              : chalk.red;
        console.log(chalk.bold('\n— review —'));
        console.log(`verdict: ${verdictColor(verdict)}`);
        for (const issue of issues) {
          const sevColor =
            issue.severity === 'CRITICAL'
              ? chalk.red
              : issue.severity === 'HIGH'
                ? chalk.yellow
                : chalk.blue;
          console.log(
            `  ${sevColor(issue.severity)} L${issue.line}: ${issue.problem}`,
          );
          console.log(`    fix: ${issue.fix}`);
        }
        if (patch) {
          console.log(chalk.bold('\npatch:'));
          console.log(patch);
        }
      }
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

program.parse();
