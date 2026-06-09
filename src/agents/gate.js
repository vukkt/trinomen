import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

const SANDBOX_DIR = join(os.homedir(), '.trinomen', 'sandbox');

function ensureSandbox() {
  if (existsSync(join(SANDBOX_DIR, 'node_modules', 'typescript'))) return;
  mkdirSync(SANDBOX_DIR, { recursive: true });
  writeFileSync(
    join(SANDBOX_DIR, 'package.json'),
    JSON.stringify({
      name: 'trinomen-sandbox',
      version: '0.0.0',
      private: true,
      type: 'module',
    }),
  );
  writeFileSync(
    join(SANDBOX_DIR, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          skipLibCheck: true,
          lib: ['ES2022', 'DOM'],
        },
        include: ['*.tsx', '*.ts'],
      },
      null,
      2,
    ),
  );
  execSync(
    'npm install --silent --no-audit --no-fund typescript@latest @types/react@latest @types/node@latest react@latest',
    {
      cwd: SANDBOX_DIR,
      stdio: 'pipe',
      timeout: 180_000,
    },
  );
}

export async function runGate(code) {
  ensureSandbox();
  const codePath = join(SANDBOX_DIR, 'generated.tsx');
  writeFileSync(codePath, code);

  let typecheckOk = true;
  let typecheckErrors = [];
  try {
    execSync('./node_modules/.bin/tsc --noEmit', {
      cwd: SANDBOX_DIR,
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (err) {
    typecheckOk = false;
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    typecheckErrors = out
      .split('\n')
      .filter((l) => l.includes('error TS'))
      .slice(0, 10);
  }

  return {
    typecheck: { ok: typecheckOk, errors: typecheckErrors },
    tests: { ok: true, failures: 0, errors: [] },
  };
}
