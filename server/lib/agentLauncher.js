import fs from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeReview } from './fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

// Track running agent processes: key = `${repo}/${prId}`
const runningAgents = new Map();

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

/** Parse an ADO PR URL into { org, project, repo, prId } */
export function parsePrUrl(url) {
  // HTTPS: https://dev.azure.com/{org}/[DefaultCollection/]{project}/_git/{repo}/pullrequest/{prId}
  const httpsMatch = url.match(
    /dev\.azure\.com\/([^/]+)\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/
  );
  if (httpsMatch) {
    return { org: httpsMatch[1], project: httpsMatch[2], repo: httpsMatch[3], prId: Number(httpsMatch[4]) };
  }

  // Visual Studio format: https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}/pullrequest/{prId}
  const vsMatch = url.match(
    /([^/]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)/
  );
  if (vsMatch) {
    return { org: vsMatch[1], project: vsMatch[2], repo: vsMatch[3], prId: Number(vsMatch[4]) };
  }

  return null;
}

/** Build the command + args from config, substituting {{prUrl}} */
async function buildCommand(prUrl) {
  const config = await loadConfig();
  const profile = config.profiles?.[config.activeProfile] || config.reviewCommand;

  const program = profile.program;
  const args = profile.args.map(a => a.replace(/\{\{prUrl\}\}/g, prUrl));
  return { program, args, profileName: config.activeProfile || 'default' };
}

/** Launch a background agent to review a PR */
export async function launchReviewAgent(prUrl) {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) throw new Error('Could not parse PR URL. Expected ADO format.');

  const { repo, prId } = parsed;
  const key = `${repo}/${prId}`;

  // Don't launch duplicates
  if (runningAgents.has(key)) {
    const existing = runningAgents.get(key);
    if (existing.status === 'running') {
      return { repo, prId, status: 'already_running', pid: existing.pid };
    }
  }

  // Write initial metadata with review_requested status
  await writeReview(repo, prId, {
    metadata: {
      prId,
      repo,
      title: `PR #${prId}`,
      author: '',
      sourceBranch: '',
      targetBranch: '',
      url: prUrl,
      reviewedAt: new Date().toISOString(),
      status: 'review_requested',
    },
  });

  const { program, args, profileName } = await buildCommand(prUrl);

  const child = spawn(program, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: false,
    cwd: process.env.HOME || process.env.USERPROFILE,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  const agentInfo = {
    pid: child.pid,
    status: 'running',
    repo,
    prId,
    prUrl,
    profileName,
    startedAt: new Date().toISOString(),
    stdout: () => stdout,
    stderr: () => stderr,
  };

  runningAgents.set(key, agentInfo);

  child.on('close', (code) => {
    agentInfo.status = code === 0 ? 'completed' : 'failed';
    agentInfo.exitCode = code;
    agentInfo.completedAt = new Date().toISOString();
    console.log(`[agent] Review of ${key} ${agentInfo.status} (exit ${code})`);
  });

  child.on('error', (err) => {
    agentInfo.status = 'failed';
    agentInfo.error = err.message;
    agentInfo.completedAt = new Date().toISOString();
    console.error(`[agent] Failed to launch for ${key}: ${err.message}`);
  });

  console.log(`[agent] Launched ${profileName} for ${key} (PID ${child.pid})`);
  return { repo, prId, status: 'launched', pid: child.pid, profileName };
}

/** Get status of all tracked agents (includes last N chars of output) */
export function getAgentStatuses() {
  const statuses = [];
  for (const [key, info] of runningAgents) {
    const stdout = info.stdout();
    const stderr = info.stderr();
    statuses.push({
      key,
      repo: info.repo,
      prId: info.prId,
      prUrl: info.prUrl,
      pid: info.pid,
      status: info.status,
      profileName: info.profileName,
      startedAt: info.startedAt,
      completedAt: info.completedAt || null,
      exitCode: info.exitCode ?? null,
      error: info.error || null,
      outputTail: stdout.slice(-500),
      stderrTail: stderr.slice(-500),
      outputLength: stdout.length,
    });
  }
  return statuses;
}

/** Get full output for a specific agent */
export function getAgentOutput(repo, prId) {
  const key = `${repo}/${prId}`;
  const info = runningAgents.get(key);
  if (!info) return null;
  return {
    key,
    status: info.status,
    pid: info.pid,
    startedAt: info.startedAt,
    completedAt: info.completedAt || null,
    exitCode: info.exitCode ?? null,
    error: info.error || null,
    stdout: info.stdout(),
    stderr: info.stderr(),
  };
}

/** Get config (profiles + active) for the UI settings */
export async function getConfig() {
  return loadConfig();
}

/** Update active profile */
export async function setActiveProfile(profileName) {
  const config = await loadConfig();
  if (!config.profiles?.[profileName]) {
    throw new Error(`Profile "${profileName}" not found. Available: ${Object.keys(config.profiles || {}).join(', ')}`);
  }
  config.activeProfile = profileName;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}
