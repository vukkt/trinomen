import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CONFIG_DIR = path.join(os.homedir(), '.trinomen');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      fileConfig = {};
    }
  }

  return {
    googleApiKey: process.env.GOOGLE_API_KEY || fileConfig.googleApiKey,
    groqApiKey: process.env.GROQ_API_KEY || fileConfig.groqApiKey,
    configDir: CONFIG_DIR,
  };
}

export function saveConfig(updates) {
  ensureConfigDir();
  const current = fs.existsSync(CONFIG_FILE)
    ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    : {};
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ ...current, ...updates }, null, 2),
    { mode: 0o600 }, // owner read/write only — keys are sensitive
  );
}

export function hasKeys(config) {
  return Boolean(config.googleApiKey && config.groqApiKey);
}
