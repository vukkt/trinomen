import chalk from 'chalk';
import { work } from './worker.js';
import { review } from './reviewer.js';
import { runGate } from './gate.js';

const MAX_ITERATIONS = 3;

export async function refinementLoop(prompt, opts = {}) {
  const max = Math.max(1, opts.maxIterations || MAX_ITERATIONS);
  const verbose = opts.verbose ?? false;

  let currentCode = null;
  const history = [];
  let iteration = 0;

  while (iteration < max) {
    iteration++;
    if (verbose) console.log(chalk.dim(`\n→ iteration ${iteration}/${max}`));

    const workerInput = iteration === 1
      ? prompt
      : buildRefinementPrompt(prompt, currentCode, history);

    // 'hard' budget: refinement prompts carry prior code + errors, and
    // truncated output would just fail the typecheck gate again
    const workResult = await work('code', workerInput, { complexity: 'hard' });
    currentCode = extractCode(workResult.text);
    if (verbose) console.log(chalk.dim(`  worker:    ${workResult.meta.provider}/${workResult.meta.model}`));

    const gateResult = await runGate(currentCode);
    if (verbose) {
      console.log(chalk.dim(`  typecheck: ${gateResult.typecheck.ok ? '✓' : '✗ ' + gateResult.typecheck.errors.length + ' errors'}`));
    }

    const reviewResult = await review(prompt, currentCode);
    const verdict = reviewResult.review.verdict;
    if (verbose) console.log(chalk.dim(`  review:    ${verdict} (${reviewResult.review.issues.length} issues)`));

    const allClean = gateResult.typecheck.ok && verdict === 'ship';
    if (allClean) {
      return { code: currentCode, iterations: iteration, finalVerdict: 'ship', history, hitMax: false };
    }

    history.push({
      iteration,
      code: currentCode,
      typecheckErrors: gateResult.typecheck.errors,
      reviewIssues: reviewResult.review.issues,
    });

    if (iteration === max) {
      return {
        code: currentCode,
        iterations: iteration,
        finalVerdict: verdict,
        gateResult,
        reviewResult: reviewResult.review,
        history,
        hitMax: true,
      };
    }
  }
}

function buildRefinementPrompt(originalPrompt, lastCode, history) {
  const last = history[history.length - 1];
  const sections = [
    `ORIGINAL REQUEST:\n${originalPrompt}`,
    `PREVIOUS ATTEMPT:\n\`\`\`tsx\n${lastCode}\n\`\`\``,
  ];

  if (last.typecheckErrors?.length) {
    sections.push(`TYPECHECK ERRORS:\n${last.typecheckErrors.join('\n')}`);
  }
  if (last.reviewIssues?.length) {
    const issues = last.reviewIssues
      .map(i => `[${i.severity}] L${i.line}: ${i.problem} → ${i.fix}`)
      .join('\n');
    sections.push(`REVIEW ISSUES:\n${issues}`);
  }

  sections.push(`Rewrite the code to fix ALL the above. Output a single fenced code block. No prose.`);
  return sections.join('\n\n');
}

function extractCode(text) {
  const match = text.match(/```(?:tsx|typescript|ts|jsx|javascript|js)?\n([\s\S]+?)```/);
  return match ? match[1].trim() : text.trim();
}
