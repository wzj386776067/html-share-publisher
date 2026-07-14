import os from 'node:os';
import path from 'node:path';

export const apiBaseUrl = String(process.env.HTML_SHARE_API_BASE || 'https://share.bi-cheng.cn').replace(/\/+$/, '');
export const stateDir = process.env.HTML_SHARE_CONFIG_DIR
  ? path.resolve(process.env.HTML_SHARE_CONFIG_DIR)
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'html-share');

export const credentialsPath = path.join(stateDir, 'credentials.json');
export const pendingAuthPath = path.join(stateDir, 'pending-auth.json');
export const plansDir = path.join(stateDir, 'plans');
