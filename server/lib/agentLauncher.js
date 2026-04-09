import fs from 'fs/promises';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { writeReview, getReview } from './fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');

// Track running agent processes: key = `${repo}/${prId}`
const runningAgents = new Map();

// Load persisted agent states on module init
await loadPersistedAgentStates();

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

/** Build the command + args from config, substituting {{prUrl}} and appending extra prompt */
async function buildCommand(prUrl, extraPrompt) {
  const config = await loadConfig();
  const profile = config.profiles?.[config.activeProfile] || config.reviewCommand;

  const program = profile.program;
  const args = profile.args.map(a => {
    let val = a.replace(/\{\{prUrl\}\}/g, prUrl);
    // Append extra prompt to the -p argument if provided
    if (extraPrompt && a.includes('{{prUrl}}')) {
      val += '\n\nAdditional instructions from user:\n' + extraPrompt;
    }
    return val;
  });
  return { program, args, profileName: config.activeProfile || 'default' };
}

/** Launch a background agent to review a PR. Use force=true to relaunch. */
export async function launchReviewAgent(prUrl, { force = false, extraPrompt = '' } = {}) {
  const parsed = parsePrUrl(prUrl);
  if (!parsed) throw new Error('Could not parse PR URL. Expected ADO format.');

  const { repo, prId } = parsed;
  const key = `${repo}/${prId}`;

  // Check for in-memory running agent
  if (runningAgents.has(key)) {
    const existing = runningAgents.get(key);
    if (existing.status === 'running' && !force) {
      return { repo, prId, status: 'already_running', pid: existing.pid };
    }
    // Archive old run before replacing
    if (force && existing.status !== 'running') {
      await archiveAgentState(repo, prId);
    }
  }

  // Check for lockfile from another process
  const lockPath = path.join(REVIEWS_ROOT, repo, String(prId), '.review.lock');
  if (!force) {
    const lockInfo = await readLock(lockPath);
    if (lockInfo && isLockAlive(lockInfo)) {
      return { repo, prId, status: 'locked', lockedBy: lockInfo.pid, lockedAt: lockInfo.startedAt };
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

  // Write lockfile
  const lockData = { pid: process.pid, startedAt: new Date().toISOString(), prUrl };
  await writeLock(lockPath, lockData);

  const { program, args, profileName } = await buildCommand(prUrl, extraPrompt);

  // Build a single shell command string with proper quoting
  const shellCmd = [program, ...args.map(a => a.includes(' ') ? `"${a}"` : a)].join(' ');

  const child = spawn(shellCmd, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: false,
    cwd: process.env.HOME || process.env.USERPROFILE,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  // Update lock with actual child PID
  lockData.pid = child.pid;
  await writeLock(lockPath, lockData).catch(() => {});

  const agentInfo = {
    pid: child.pid,
    _child: child,
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
  await persistAgentState(agentInfo);

  // Periodically persist state while running so output survives restarts
  const persistInterval = setInterval(() => {
    if (agentInfo.status === 'running') {
      persistAgentState(agentInfo).catch(() => {});
    } else {
      clearInterval(persistInterval);
    }
  }, 5000);

  child.on('close', async (code) => {
    clearInterval(persistInterval);
    agentInfo.status = code === 0 ? 'completed' : 'failed';
    agentInfo.exitCode = code;
    agentInfo.completedAt = new Date().toISOString();
    removeLock(lockPath).catch(() => {});
    await persistAgentState(agentInfo);
    if (code !== 0) await markMetadataFailed(repo, prId, `Agent exited with code ${code}`);
    console.log(`[agent] Review of ${key} ${agentInfo.status} (exit ${code})`);
  });

  child.on('error', async (err) => {
    clearInterval(persistInterval);
    agentInfo.status = 'failed';
    agentInfo.error = err.message;
    agentInfo.completedAt = new Date().toISOString();
    removeLock(lockPath).catch(() => {});
    await persistAgentState(agentInfo);
    await markMetadataFailed(repo, prId, err.message);
    console.error(`[agent] Failed to launch for ${key}: ${err.message}`);
  });

  console.log(`[agent] Launched ${profileName} for ${key} (PID ${child.pid})`);
  return { repo, prId, status: 'launched', pid: child.pid, profileName };
}

/** Get status of all tracked agents (includes last N chars of output) */
export function getAgentStatuses() {
  const statuses = [];
  for (const [key, info] of runningAgents) {
    const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
    const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
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
export async function getAgentOutput(repo, prId) {
  const key = `${repo}/${prId}`;
  const info = runningAgents.get(key);
  if (info) {
    const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
    const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
    return {
      key,
      status: info.status,
      pid: info.pid,
      startedAt: info.startedAt,
      completedAt: info.completedAt || null,
      exitCode: info.exitCode ?? null,
      error: info.error || null,
      stdout,
      stderr,
    };
  }

  // Fall back to persisted state on disk
  const statePath = path.join(REVIEWS_ROOT, repo, String(prId), 'agent-state.json');
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Get history of past agent runs for a PR */
export async function getAgentHistory(repo, prId) {
  const historyPath = path.join(REVIEWS_ROOT, repo, String(prId), 'agent-history.json');
  try {
    const raw = await fs.readFile(historyPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Kill a running agent */
export async function killAgent(repo, prId) {
  const key = `${repo}/${prId}`;
  const info = runningAgents.get(key);
  if (!info) throw new Error('No agent found for this PR');
  if (info.status !== 'running') throw new Error(`Agent is not running (status: ${info.status})`);

  if (info._child) {
    info._child.kill('SIGTERM');
    // Give it a moment, then force kill
    setTimeout(() => {
      try { info._child.kill('SIGKILL'); } catch {}
    }, 3000);
  } else {
    try { process.kill(info.pid, 'SIGTERM'); } catch {}
  }

  info.status = 'killed';
  info.completedAt = new Date().toISOString();
  info.error = 'Killed by user';
  const lockPath = path.join(REVIEWS_ROOT, repo, String(prId), '.review.lock');
  removeLock(lockPath).catch(() => {});
  await persistAgentState(info);
  await markMetadataFailed(repo, prId, 'Killed by user');
  return { repo, prId, status: 'killed' };
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

/** Save full config (profiles + activeProfile) */
export async function saveConfig(newConfig) {
  const config = await loadConfig();
  if (newConfig.profiles) config.profiles = newConfig.profiles;
  if (newConfig.activeProfile) config.activeProfile = newConfig.activeProfile;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  return config;
}

// --- Lockfile helpers ---

async function readLock(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function writeLock(lockPath, data) {
  const dir = path.dirname(lockPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function removeLock(lockPath) {
  await fs.unlink(lockPath).catch(() => {});
}

function isLockAlive(lockInfo) {
  if (!lockInfo?.pid) return false;
  try {
    process.kill(lockInfo.pid, 0); // signal 0 = check if alive
    return true;
  } catch { return false; }
}

// --- Agent state persistence ---

function agentStatePath(repo, prId) {
  return path.join(REVIEWS_ROOT, repo, String(prId), 'agent-state.json');
}

async function persistAgentState(info) {
  const statePath = agentStatePath(info.repo, info.prId);
  const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
  const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
  const data = {
    key: `${info.repo}/${info.prId}`,
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
    stdout,
    stderr,
  };
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[agent] Failed to persist state for ${info.repo}/${info.prId}: ${err.message}`);
  }
}

async function markMetadataFailed(repo, prId, reason) {
  try {
    const review = await getReview(repo, prId);
    if (review?.metadata) {
      review.metadata.status = 'review_failed';
      review.metadata.failReason = reason;
      await writeReview(repo, prId, { metadata: review.metadata });
    }
  } catch (err) {
    console.error(`[agent] Failed to mark metadata as failed for ${repo}/${prId}: ${err.message}`);
  }
}

/** Archive the current agent state to history before relaunching */
async function archiveAgentState(repo, prId) {
  const statePath = agentStatePath(repo, prId);
  const historyPath = path.join(path.dirname(statePath), 'agent-history.json');
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const current = JSON.parse(raw);
    let history = [];
    try {
      const histRaw = await fs.readFile(historyPath, 'utf-8');
      history = JSON.parse(histRaw);
    } catch {}
    history.push(current);
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8');
  } catch {}
}

/** Load persisted agent states from disk on startup */
async function loadPersistedAgentStates() {
  try {
    const repos = await fs.readdir(REVIEWS_ROOT).catch(() => []);
    for (const repo of repos) {
      const repoPath = path.join(REVIEWS_ROOT, repo);
      const stat = await fs.stat(repoPath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const prIds = await fs.readdir(repoPath).catch(() => []);
      for (const prId of prIds) {
        const statePath = path.join(repoPath, prId, 'agent-state.json');
        try {
          const raw = await fs.readFile(statePath, 'utf-8');
          const data = JSON.parse(raw);
          const key = `${repo}/${prId}`;

          // If it was 'running' but the server restarted, mark as failed
          // but preserve any output captured so far
          if (data.status === 'running') {
            data.status = 'failed';
            data.error = 'Server restarted while agent was running';
            data.completedAt = new Date().toISOString();
            // stdout/stderr already in data from last persist — keep them
            await fs.writeFile(statePath, JSON.stringify(data, null, 2), 'utf-8');
            await markMetadataFailed(repo, prId, 'Server restarted while agent was running');
          }

          // Store in memory with persisted stdout/stderr as strings
          runningAgents.set(key, {
            ...data,
            _stdout: data.stdout || '',
            _stderr: data.stderr || '',
          });
        } catch { /* no agent-state.json, skip */ }
      }
    }
    console.log(`[agent] Loaded ${runningAgents.size} persisted agent state(s)`);
  } catch (err) {
    console.error(`[agent] Error loading persisted states: ${err.message}`);
  }
}

// --- Curation Agent ---

let curationAgent = null;

export async function launchCurationAgent() {
  if (curationAgent?.status === 'running') {
    return { status: 'already_running', pid: curationAgent.pid };
  }

  const config = await loadConfig();
  const profileName = config.activeProfile || 'copilot-cli';
  const profile = config.profiles[profileName];
  if (!profile) throw new Error(`Profile ${profileName} not found`);

  const { getGuidelines, getExamplesSinceCuration, getLearningExamples, listRepoGuidelines } = await import('./fileStore.js');
  const { global: globalGuidelines } = await getGuidelines();
  const reposWithGuidelines = await listRepoGuidelines();
  const newExamples = await getExamplesSinceCuration();
  const allExamples = await getLearningExamples();

  if (newExamples.length === 0 && globalGuidelines) {
    return { status: 'skipped', reason: 'No new examples since last curation' };
  }

  // Group examples by repo for the agent to see patterns
  const repos = [...new Set(allExamples.map(e => e.repo))];

  // Build the curation prompt
  const formatExample = e =>
    `[${e.decision.toUpperCase()}] (${e.category}/${e.severity}) [${e.repo}] "${e.title}" — ${e.comment}${e.userNote ? `\n  User note: ${e.userNote}` : ''}`;

  const statsBlock = [
    `Total examples: ${allExamples.length} (${allExamples.filter(e=>e.decision==='accepted').length} accepted, ${allExamples.filter(e=>e.decision==='noted').length} noted, ${allExamples.filter(e=>e.decision==='rejected').length} rejected)`,
    `Repos: ${repos.join(', ')}`,
  ].join('\n');

  let prompt = `You are a reviewer guidelines curator. Your job is to maintain two levels of reviewer guidelines based on the user's accept/reject/note decisions on PR review comments:\n\n`;
  prompt += `1. **Global guidelines** at ~/pr-reviews/.learnings/guidelines.md — rules that apply across all repos\n`;
  prompt += `2. **Per-repo guidelines** at ~/pr-reviews/.learnings/repo/{repoName}/guidelines.md — rules specific to a codebase\n\n`;
  prompt += `Decision types:\n`;
  prompt += `- **ACCEPTED** — the user wants this kind of comment posted to ADO\n`;
  prompt += `- **NOTED** — the user found this informational/useful for themselves, but does NOT want it posted to ADO. Future reviews should still generate these but auto-categorize them as notes.\n`;
  prompt += `- **REJECTED** — the user did not find this comment useful\n\n`;
  prompt += `${statsBlock}\n\n`;

  // Include existing guidelines
  if (globalGuidelines) {
    prompt += `## Current Global Guidelines (build on these, do not discard)\n\`\`\`\n${globalGuidelines}\n\`\`\`\n\n`;
  }
  for (const repo of reposWithGuidelines) {
    const { perRepo } = await getGuidelines(repo);
    if (perRepo) {
      prompt += `## Current ${repo} Guidelines (build on these)\n\`\`\`\n${perRepo}\n\`\`\`\n\n`;
    }
  }

  // Include examples
  if (globalGuidelines) {
    const examplesBlock = newExamples.map(formatExample).join('\n');
    prompt += `## New Examples Since Last Curation (${newExamples.length} items)\n${examplesBlock}\n\n`;
  } else {
    const allBlock = allExamples.map(formatExample).join('\n');
    prompt += `## All Examples (${allExamples.length} items)\n${allBlock}\n\n`;
  }

  prompt += `## Instructions\n`;
  prompt += `1. Analyze the examples and identify which patterns are universal vs repo-specific\n`;
  prompt += `2. A pattern is repo-specific if it only appears in one repo AND relates to that repo's specific tech/conventions\n`;
  prompt += `3. Everything else goes in global guidelines\n`;
  prompt += `4. If existing guidelines exist, MERGE new learnings in — keep all still-valid rules, refine or remove contradicted ones\n`;
  prompt += `5. Write updated global guidelines to ~/pr-reviews/.learnings/guidelines.md\n`;
  prompt += `6. For each repo with specific patterns, write to ~/pr-reviews/.learnings/repo/{repoName}/guidelines.md\n`;
  prompt += `7. After writing all files, write the current ISO timestamp to ~/pr-reviews/.learnings/.last-curated\n\n`;
  prompt += `## Guidelines format\n`;
  prompt += `Each guidelines file should have these sections:\n`;
  prompt += `- **DO comment on** — patterns the reviewer wants flagged\n`;
  prompt += `- **DON'T comment on** — patterns the reviewer does not want\n`;
  prompt += `- **Severity calibration** — what severity levels to use for different issue types\n`;
  prompt += `- **Style & tone** — how comments should be phrased\n`;
  prompt += `- **Category-specific notes** — per-category preferences\n`;
  prompt += `- **Auto-note patterns** — types of comments that should be generated as informational notes (not for ADO posting) based on NOTED examples\n`;
  prompt += `Include specific examples from the data to illustrate each rule.\n`;
  prompt += `For per-repo files, focus on what's unique to that codebase (tech stack, naming conventions, patterns used, etc.).\n`;

  // Build args — replace the review prompt with curation prompt
  const args = [...profile.args];
  const promptIdx = args.indexOf('-p');
  if (promptIdx !== -1) {
    args[promptIdx + 1] = prompt;
  } else {
    args.push('-p', prompt);
  }

  const cmdStr = `${profile.program} ${args.map(a => a.includes(' ') || a.includes('\n') ? `"${a.replace(/"/g, '\\"')}"` : a).join(' ')}`;
  const child = spawn(cmdStr, [], { shell: true, cwd: os.homedir() });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', d => { stdout += d.toString(); });
  child.stderr?.on('data', d => { stderr += d.toString(); });

  curationAgent = {
    status: 'running',
    pid: child.pid,
    startedAt: new Date().toISOString(),
    stdout: () => stdout,
    stderr: () => stderr,
  };

  child.on('close', async (code) => {
    curationAgent.status = code === 0 ? 'completed' : 'failed';
    curationAgent.exitCode = code;
    curationAgent.completedAt = new Date().toISOString();
    curationAgent._stdout = stdout;
    curationAgent._stderr = stderr;
    console.log(`[curation] Agent ${curationAgent.status} (exit ${code})`);
  });

  child.on('error', (err) => {
    curationAgent.status = 'failed';
    curationAgent.error = err.message;
    curationAgent.completedAt = new Date().toISOString();
    curationAgent._stdout = stdout;
    curationAgent._stderr = stderr;
  });

  return { status: 'launched', pid: child.pid };
}

export function getCurationStatus() {
  if (!curationAgent) return { status: 'idle', message: 'No curation has been run' };
  const out = typeof curationAgent.stdout === 'function' ? curationAgent.stdout() : (curationAgent._stdout || '');
  const err = typeof curationAgent.stderr === 'function' ? curationAgent.stderr() : (curationAgent._stderr || '');
  return {
    status: curationAgent.status,
    pid: curationAgent.pid,
    startedAt: curationAgent.startedAt,
    completedAt: curationAgent.completedAt || null,
    exitCode: curationAgent.exitCode ?? null,
    error: curationAgent.error || null,
    outputTail: out.slice(-2000),
    stderrTail: err.slice(-1000),
  };
}
