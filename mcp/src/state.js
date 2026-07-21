import fs from 'node:fs';
import path from 'node:path';

import { credentialsPath, pendingAuthPath, plansDir, stateDir } from './config.js';

export function readCredentials() {
  return readJson(credentialsPath);
}

export function writeCredentials(credentials) {
  writePrivateJson(credentialsPath, credentials);
}

export function clearCredentials() {
  fs.rmSync(credentialsPath, { force: true });
}

export function readPendingAuth() {
  return readJson(pendingAuthPath);
}

export function writePendingAuth(value) {
  writePrivateJson(pendingAuthPath, value);
}

export function clearPendingAuth() {
  fs.rmSync(pendingAuthPath, { force: true });
}

export function writePlan(plan) {
  const planPath = path.join(plansDir, `${plan.id}.json`);
  writePrivateJson(planPath, plan);
  return planPath;
}

export function readPlan(planId) {
  if (!/^(?:plan|status_plan)_[A-Za-z0-9-]+$/.test(String(planId))) return null;
  return readJson(path.join(plansDir, `${planId}.json`));
}

export function deletePlan(planId) {
  if (/^(?:plan|status_plan)_[A-Za-z0-9-]+$/.test(String(planId))) {
    fs.rmSync(path.join(plansDir, `${planId}.json`), { force: true });
  }
}

export function writeManifest(manifestPath, manifest) {
  writePrivateJson(manifestPath, manifest, 0o644);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function writePrivateJson(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  if (filePath.startsWith(stateDir)) fs.chmodSync(path.dirname(filePath), 0o700);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tempPath, filePath);
  fs.chmodSync(filePath, mode);
}
