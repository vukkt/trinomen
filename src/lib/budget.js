import Database from 'better-sqlite3';
import path from 'node:path';
import { ensureConfigDir, loadConfig } from './config.js';

// Opened lazily so importing this module has no disk side effects.
let db = null;

function getDb() {
  if (!db) {
    ensureConfigDir();
    db = new Database(path.join(loadConfig().configDir, 'budget.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        requests INTEGER NOT NULL DEFAULT 1,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_lookup ON usage(provider, model, ts);
    `);
  }
  return db;
}

// Conservative caps (~95% of free tier limits)
const CAPS = {
  'groq:openai/gpt-oss-20b': { rpd: 950, tpd: 190_000 },
  'groq:openai/gpt-oss-120b': { rpd: 950, tpd: 190_000 },
  'groq:llama-3.3-70b-versatile': { rpd: 950, tpd: 95_000 },
  'google:gemini-2.5-flash': { rpd: 240, tpd: 900_000 },
  'google:gemini-2.5-flash-lite': { rpd: 950, tpd: 900_000 },
};

const DAY_MS = 86_400_000;

function key(provider, model) {
  return `${provider}:${model}`;
}

export function canCall(provider, model, estimatedTokens = 1000) {
  const cap = CAPS[key(provider, model)];
  if (!cap) return true; // unknown provider, allow

  const since = Date.now() - DAY_MS;
  const stats = getDb()
    .prepare(
      `
    SELECT COALESCE(SUM(tokens), 0) AS tokens,
           COALESCE(SUM(requests), 0) AS requests
    FROM usage
    WHERE provider = ? AND model = ? AND ts > ?
  `,
    )
    .get(provider, model, since);

  return stats.requests < cap.rpd && stats.tokens + estimatedTokens < cap.tpd;
}

export function record(provider, model, tokens) {
  getDb().prepare(
    'INSERT INTO usage (provider, model, tokens, requests, ts) VALUES (?, ?, ?, 1, ?)',
  ).run(provider, model, tokens, Date.now());
}

export function getUsage() {
  const since = Date.now() - DAY_MS;
  return getDb()
    .prepare(
      `
    SELECT provider, model,
           SUM(tokens) AS tokens,
           SUM(requests) AS requests
    FROM usage
    WHERE ts > ?
    GROUP BY provider, model
  `,
    )
    .all(since);
}

export function resetUsage() {
  getDb().prepare('DELETE FROM usage').run();
}
