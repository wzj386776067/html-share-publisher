#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const supportedClients = ['codex', 'workbuddy', 'trae', 'codebuddy', 'generic'];

export function configureClients(options) {
  const context = normalizeOptions(options);
  const selectedClients = selectClients(context.client, context);
  const serverConfigFor = (clientName) => ({
    command: context.nodePath,
    args: [context.serverPath],
    env: {
      HTML_SHARE_API_BASE: context.apiBase,
      HTML_SHARE_CLIENT_NAME: clientName
    }
  });
  const configured = [];
  const skills = [];
  const warnings = [];

  const genericPath = path.join(context.installRoot, 'mcp-config.json');
  writeMcpConfig(genericPath, serverConfigFor('Generic MCP client'));
  configured.push({ client: 'generic', path: genericPath });

  if (selectedClients.includes('codex')) {
    const skillPath = path.join(context.codexHome, 'skills', 'html-share-publisher');
    installSkill(context.skillSource, skillPath);
    skills.push({ client: 'codex', path: skillPath });
    if (!context.skipCommandRegistration) {
      const codex = findExecutable('codex', context.env, context.platform);
      if (!codex) throw new Error('Codex was selected but the codex command is not available.');
      registerCodex(codex, serverConfigFor('Codex'), context.platform);
      configured.push({ client: 'codex', path: 'codex mcp: html-share' });
    }
  }

  if (selectedClients.includes('workbuddy')) {
    const configPath = path.join(context.home, '.workbuddy', 'mcp.json');
    writeMcpConfig(configPath, serverConfigFor('WorkBuddy'));
    configured.push({ client: 'workbuddy', path: configPath });
    warnings.push('WorkBuddy uses MCP self-instructions; restart WorkBuddy after installation.');
  }

  if (selectedClients.includes('trae')) {
    for (const configPath of traeConfigPaths(context)) {
      writeMcpConfig(configPath, serverConfigFor('TRAE'));
      configured.push({ client: 'trae', path: configPath });
    }
    for (const skillPath of traeSkillPaths(context)) {
      installSkill(context.skillSource, skillPath);
      skills.push({ client: 'trae', path: skillPath });
    }
  }

  if (selectedClients.includes('codebuddy')) {
    const configRoot = context.env.CODEBUDDY_CONFIG_DIR || path.join(context.home, '.codebuddy');
    const configPath = path.join(configRoot, '.mcp.json');
    const skillPath = path.join(configRoot, 'skills', 'html-share-publisher');
    writeMcpConfig(configPath, serverConfigFor('CodeBuddy'));
    installSkill(context.skillSource, skillPath);
    configured.push({ client: 'codebuddy', path: configPath });
    skills.push({ client: 'codebuddy', path: skillPath });
  }

  return { selectedClients, configured, skills, warnings };
}

export function selectClients(requested, context) {
  const tokens = String(requested || 'auto')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes('all')) return [...supportedClients];
  if (!tokens.includes('auto')) {
    const invalid = tokens.filter((value) => !supportedClients.includes(value));
    if (invalid.length) throw new Error(`Unsupported client: ${invalid.join(', ')}`);
    return [...new Set(tokens)];
  }

  const detected = [];
  if (findExecutable('codex', context.env, context.platform)) detected.push('codex');
  if (exists(path.join(context.home, '.workbuddy')) || appExists('workbuddy', context)) detected.push('workbuddy');
  if (
    exists(path.join(context.home, '.trae'))
    || exists(path.join(context.home, '.trae-cn'))
    || appExists('trae', context)
  ) detected.push('trae');
  if (exists(path.join(context.home, '.codebuddy')) || findExecutable('codebuddy', context.env, context.platform)) {
    detected.push('codebuddy');
  }
  return detected.length ? detected : ['generic'];
}

export function writeMcpConfig(configPath, serverConfig) {
  let config = {};
  if (exists(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot update invalid JSON config ${configPath}: ${error.message}`);
    }
  }
  if (config.mcpServers != null && (typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
    throw new Error(`Cannot update ${configPath}: mcpServers must be an object.`);
  }
  config.mcpServers = { ...(config.mcpServers || {}), 'html-share': serverConfig };
  atomicWriteJson(configPath, config);
}

function normalizeOptions(options) {
  const home = path.resolve(options.home || os.homedir());
  const env = { ...process.env, ...(options.env || {}) };
  return {
    client: options.client || 'auto',
    home,
    env,
    platform: options.platform || process.platform,
    appData: options.appData || env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    installRoot: path.resolve(options.installRoot),
    skillSource: path.resolve(options.skillSource),
    serverPath: path.resolve(options.serverPath),
    nodePath: path.resolve(options.nodePath || process.execPath),
    apiBase: String(options.apiBase || 'https://share.bi-cheng.cn').replace(/\/+$/, ''),
    codexHome: path.resolve(options.codexHome || env.CODEX_HOME || path.join(home, '.codex')),
    skipCommandRegistration: Boolean(options.skipCommandRegistration)
  };
}

function traeConfigPaths(context) {
  if (context.platform === 'win32') {
    return [
      path.join(context.appData, 'Trae', 'User', 'settings', 'mcp.json'),
      path.join(context.appData, 'TRAE SOLO CN', 'User', 'mcp.json')
    ];
  }
  if (context.platform === 'darwin') {
    return [
      path.join(context.home, 'Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json'),
      path.join(context.home, 'Library', 'Application Support', 'TRAE SOLO CN', 'User', 'mcp.json')
    ];
  }
  const configHome = context.env.XDG_CONFIG_HOME || path.join(context.home, '.config');
  return [path.join(configHome, 'Trae', 'User', 'settings', 'mcp.json')];
}

function traeSkillPaths(context) {
  const paths = [];
  const internationalRoot = path.join(context.home, '.trae');
  const chinaRoot = path.join(context.home, '.trae-cn');
  if (exists(internationalRoot) || !exists(chinaRoot)) {
    paths.push(path.join(internationalRoot, 'skills', 'html-share-publisher'));
  }
  if (exists(chinaRoot) || !exists(internationalRoot)) {
    paths.push(path.join(chinaRoot, 'skills', 'html-share-publisher'));
  }
  return paths;
}

function appExists(client, context) {
  if (context.platform === 'darwin') {
    const names = client === 'workbuddy' ? ['WorkBuddy.app'] : ['Trae.app', 'TRAE.app', 'TRAE SOLO CN.app'];
    return names.some((name) => exists(path.join('/Applications', name)));
  }
  if (context.platform === 'win32') {
    const marker = client === 'workbuddy' ? 'workbuddy' : 'trae';
    return Object.values(context.env).some((value) => String(value).toLowerCase().includes(marker));
  }
  return false;
}

function findExecutable(command, env, platform) {
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, platform === 'win32' ? `${command}${extension.toLowerCase()}` : command);
      if (exists(candidate)) return candidate;
      if (platform === 'win32') {
        const upperCandidate = path.join(directory, `${command}${extension.toUpperCase()}`);
        if (exists(upperCandidate)) return upperCandidate;
      }
    }
  }
  return '';
}

function registerCodex(codexPath, serverConfig, platform) {
  const run = (args, allowFailure = false) => {
    const result = spawnSync(codexPath, args, {
      encoding: 'utf8',
      shell: platform === 'win32',
      windowsHide: true
    });
    if (!allowFailure && result.status !== 0) {
      throw new Error(`Codex MCP registration failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
    return result;
  };
  if (run(['mcp', 'get', 'html-share'], true).status === 0) run(['mcp', 'remove', 'html-share']);
  run([
    'mcp', 'add', 'html-share',
    '--env', `HTML_SHARE_API_BASE=${serverConfig.env.HTML_SHARE_API_BASE}`,
    '--env', `HTML_SHARE_CLIENT_NAME=${serverConfig.env.HTML_SHARE_CLIENT_NAME}`,
    '--', serverConfig.command, ...serverConfig.args
  ]);
}

function installSkill(source, target) {
  const parent = path.dirname(target);
  const temporary = path.join(parent, `.html-share-publisher-install-${process.pid}`);
  fs.mkdirSync(parent, { recursive: true });
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temporary, target);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
}

function exists(value) {
  return fs.existsSync(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--skip-command-registration') {
      result.skipCommandRegistration = true;
      continue;
    }
    if (!key.startsWith('--') || index + 1 >= argv.length) throw new Error(`Invalid argument: ${key}`);
    result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[index + 1];
    index += 1;
  }
  return result;
}

const invokedPath = process.argv[1] ? fs.realpathSync(path.resolve(process.argv[1])) : '';
const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try {
    const result = configureClients(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
