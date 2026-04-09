import fs from 'fs/promises';
import { createWriteStream, readSync, statSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { writeReview, getReview, addDiscussionMessage, updateFeedbackContent } from './fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');

// --- Log file helpers for detached agent output ---

/** Read the last N bytes of a file synchronously (for status tails) */
function readFileTailSync(filePath, bytes = 2048) {
  try {
    const s = statSync(filePath);
    if (s.size === 0) return '';
    const fd = openSync(filePath, 'r');
    const len = Math.min(s.size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, s.size - len);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch { return ''; }
}

/** Get file size without reading content */
function getFileSize(filePath) {
  try { return statSync(filePath).size; } catch { return 0; }
}

/** Read entire log file asynchronously (for full output view) */
async function readLogFile(filePath) {
  try { return await fs.readFile(filePath, 'utf-8'); } catch { return ''; }
}

// Track running agent processes: key = `${repo}/${prId}`
const runningAgents = new Map();

// Track discussion agents: key = `${repo}/${prId}/${feedbackId}`
const discussionAgents = new Map();

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

  // Write initial metadata with agent_review_requested status
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
      status: 'agent_review_requested',
    },
  });

  const { program, args, profileName } = await buildCommand(prUrl, extraPrompt);

  // Build a single shell command string with proper quoting
  const shellCmd = [program, ...args.map(a => a.includes(' ') ? `"${a}"` : a)].join(' ');

  // Set up log files for output persistence (survives server restarts)
  const prDir = path.join(REVIEWS_ROOT, repo, String(prId));
  await fs.mkdir(prDir, { recursive: true });
  const stdoutLogPath = path.join(prDir, 'agent-stdout.log');
  const stderrLogPath = path.join(prDir, 'agent-stderr.log');
  const stdoutLog = createWriteStream(stdoutLogPath);
  const stderrLog = createWriteStream(stderrLogPath);

  // Spawn with pipes — agent survives server Ctrl+C on Windows (proven behavior)
  const child = spawn(shellCmd, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    cwd: process.env.HOME || process.env.USERPROFILE,
  });

  // Tee output to both in-memory and log files
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); stdoutLog.write(d); });
  child.stderr.on('data', d => { stderr += d.toString(); stderrLog.write(d); });

  // Write lockfile with agent metadata and log file paths
  const lockData = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    prUrl,
    profileName,
    command: shellCmd,
    logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath },
  };
  await writeLock(lockPath, lockData);

  const agentInfo = {
    pid: child.pid,
    _child: child,
    status: 'running',
    repo,
    prId,
    prUrl,
    profileName,
    command: shellCmd,
    startedAt: new Date().toISOString(),
    logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath },
    stdout: () => stdout,
    stderr: () => stderr,
  };

  runningAgents.set(key, agentInfo);
  await persistAgentState(agentInfo);

  child.on('close', async (code) => {
    stdoutLog.end();
    stderrLog.end();
    agentInfo.status = code === 0 ? 'completed' : 'failed';
    agentInfo.exitCode = code;
    agentInfo.completedAt = new Date().toISOString();
    removeLock(lockPath).catch(() => {});
    await persistAgentState(agentInfo);
    if (code !== 0) await markMetadataFailed(repo, prId, `Agent exited with code ${code}`);
    console.log(`[agent] Review of ${key} ${agentInfo.status} (exit ${code})`);
  });

  child.on('error', async (err) => {
    stdoutLog.end();
    stderrLog.end();
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

// --- Discussion agents ---

/** Launch a lightweight discussion agent for a single feedback item */
export async function launchDiscussionAgent(repo, prId, feedbackId, userMessage) {
  const key = `${repo}/${prId}/${feedbackId}`;

  // Don't allow concurrent discussions on the same item
  const existing = discussionAgents.get(key);
  if (existing?.status === 'running') {
    return { status: 'already_running', key };
  }

  // Load context
  const review = await getReview(repo, prId);
  const item = review.feedback.items?.find(i => i.id === feedbackId);
  if (!item) throw new Error(`Feedback item ${feedbackId} not found`);

  // Record user message
  await addDiscussionMessage(repo, prId, feedbackId, 'user', userMessage);

  // Build response file path
  const responseFile = path.join(REVIEWS_ROOT, repo, String(prId), `discussion-${feedbackId}.json`);

  // Build context for the agent
  const otherItems = review.feedback.items
    .filter(i => i.id !== feedbackId)
    .map(i => `- [${i.severity}/${i.category}] ${i.file}:${i.startLine}: ${i.title}`)
    .join('\n');

  const discussionHistory = (item.discussion || [])
    .map(d => `${d.role}: ${d.message}`)
    .join('\n\n');

  const prompt = `You are a code review discussion assistant. A reviewer has a question about a specific piece of feedback on a pull request.

## Feedback Item Under Discussion
Title: ${item.title}
File: ${item.file} (lines ${item.startLine}-${item.endLine || item.startLine})
Category: ${item.category} | Severity: ${item.severity}
Comment: ${item.comment}
Suggestion: ${item.suggestion || '(none)'}

## PR Overview
${review.overview || '(no overview available)'}

## Other Feedback Items (for context)
${otherItems || '(none)'}

## Discussion So Far
${discussionHistory || '(new discussion)'}

## Instructions
1. Read the relevant source code file at the path shown above to understand the context. The worktree is at: ${path.join(REVIEWS_ROOT, repo, String(prId), 'worktree')}
2. Answer the reviewer's question thoughtfully and concisely.
3. If after discussion you believe the feedback item should be revised (title, comment, suggestion, severity, or category), include the updates in updatedItem.
4. Write your response as JSON to: ${responseFile}

Response JSON format:
{
  "response": "Your answer to the reviewer...",
  "updatedItem": null
}

If the feedback should be revised, set updatedItem to an object with ONLY the changed fields.
Editable fields: title, comment, suggestion, severity, category, startLine, endLine, file.
{
  "response": "Your answer...",
  "updatedItem": { "comment": "revised comment...", "startLine": 42, "endLine": 45 }
}

CRITICAL RULES:
- ONLY write to the response file path above. Do NOT edit feedback.json, overview.md, metadata.json, or any other review files.
- The server will read your response file and apply any edits to feedback.json on your behalf, tracking edit history.
- If you edit feedback.json directly, edit history will be lost and the review state may become corrupted.
- Write ONLY valid JSON to the response file, nothing else.`;

  const config = await loadConfig();
  const profile = config.profiles?.[config.activeProfile] || Object.values(config.profiles)[0];
  const program = profile.program;

  // Build args: same model but with scoped permissions instead of --yolo
  const baseArgs = [];
  for (const a of profile.args) {
    if (a === '-p' || a.includes('{{prUrl}}')) continue;
    if (a === '--yolo' || a === '--allow-all' || a === '--allow-all-tools' || a === '--allow-all-paths') continue;
    baseArgs.push(a);
  }
  const args = baseArgs.filter(a => !a.startsWith('--allow-tool') && !a.startsWith('--deny-tool'));

  // Scoped permissions: read anything, only write the response file
  const responseFilePosix = responseFile.replace(/\\/g, '/');
  args.push(
    '--allow-tool=read',
    '--allow-tool=grep',
    '--allow-tool=glob',
    '--allow-tool=view',
    `--allow-tool=write(${responseFilePosix})`,
    `--allow-tool=create(${responseFilePosix})`,
    '--no-ask-user',
    '-p', prompt,
  );

  const reviewDirPath = path.join(REVIEWS_ROOT, repo, String(prId));

  // Use spawn with args array (not shell string) to avoid Windows command-line length limit
  const child = spawn(program, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: false,
    cwd: reviewDirPath,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

  const displayCmd = [program, ...args.map(a => a === prompt ? '"<prompt>"' : a)].join(' ');

  const agentInfo = {
    key, repo, prId, feedbackId,
    pid: child.pid,
    status: 'running',
    command: displayCmd,
    startedAt: new Date().toISOString(),
    stdout: () => stdout,
    stderr: () => stderr,
  };
  discussionAgents.set(key, agentInfo);
  await persistDiscussionAgentState(agentInfo);

  child.on('close', async (code) => {
    agentInfo.status = code === 0 ? 'completed' : 'failed';
    agentInfo.exitCode = code;
    agentInfo.completedAt = new Date().toISOString();

    // Try to read the response file
    try {
      const raw = await fs.readFile(responseFile, 'utf-8');
      const parsed = JSON.parse(raw);
      agentInfo.response = parsed.response;

      // Record agent response in discussion thread
      if (parsed.response) {
        await addDiscussionMessage(repo, prId, feedbackId, 'agent', parsed.response);
      }

      // Apply edits if the agent suggested them
      if (parsed.updatedItem && typeof parsed.updatedItem === 'object') {
        await updateFeedbackContent(repo, prId, feedbackId, parsed.updatedItem);
        agentInfo.updatedFields = Object.keys(parsed.updatedItem);
      }

      // Clean up response file
      await fs.unlink(responseFile).catch(() => {});
    } catch (err) {
      // Agent didn't write a valid response file — record error as discussion message
      const fallback = `Discussion agent finished but did not produce a structured response (exit code ${code}).`;
      await addDiscussionMessage(repo, prId, feedbackId, 'agent', fallback);
      agentInfo.response = fallback;
    }

    await persistDiscussionAgentState(agentInfo);
    console.log(`[discussion] ${key} ${agentInfo.status} (exit ${code})`);
  });

  child.on('error', async (err) => {
    agentInfo.status = 'failed';
    agentInfo.error = err.message;
    agentInfo.completedAt = new Date().toISOString();
    await addDiscussionMessage(repo, prId, feedbackId, 'agent', `Discussion agent failed: ${err.message}`);
    await persistDiscussionAgentState(agentInfo);
    console.error(`[discussion] Failed for ${key}: ${err.message}`);
  });

  console.log(`[discussion] Launched for ${key} (PID ${child.pid})`);
  return { status: 'launched', key, pid: child.pid };
}

/** Get discussion agent status */
export function getDiscussionStatus(repo, prId, feedbackId) {
  const key = `${repo}/${prId}/${feedbackId}`;
  const info = discussionAgents.get(key);
  if (!info) return null;
  return {
    key: info.key,
    status: info.status,
    pid: info.pid,
    startedAt: info.startedAt,
    completedAt: info.completedAt || null,
    exitCode: info.exitCode ?? null,
    error: info.error || null,
    response: info.response || null,
    updatedFields: info.updatedFields || null,
  };
}

/** Get status of all tracked agents (includes last N chars of output) */
export function getAgentStatuses() {
  const statuses = [];
  for (const [key, info] of runningAgents) {
    let stdout, stderr;
    if (typeof info.stdout === 'function') {
      stdout = info.stdout();
      stderr = typeof info.stderr === 'function' ? info.stderr() : '';
    } else if (info.logFiles) {
      stdout = readFileTailSync(info.logFiles.stdout);
      stderr = readFileTailSync(info.logFiles.stderr);
    } else {
      stdout = info._stdout || '';
      stderr = info._stderr || '';
    }
    statuses.push({
      key,
      repo: info.repo,
      prId: info.prId,
      prUrl: info.prUrl,
      pid: info.pid,
      status: info.status,
      profileName: info.profileName,
      command: info.command || null,
      startedAt: info.startedAt,
      completedAt: info.completedAt || null,
      exitCode: info.exitCode ?? null,
      error: info.error || null,
      outputTail: stdout.slice(-500),
      stderrTail: stderr.slice(-500),
      outputLength: info.logFiles ? getFileSize(info.logFiles.stdout) : stdout.length,
      agentType: 'review',
    });
  }
  // Include discussion agents
  for (const [key, info] of discussionAgents) {
    const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
    const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
    statuses.push({
      key,
      repo: info.repo,
      prId: info.prId,
      pid: info.pid,
      status: info.status,
      profileName: 'discussion',
      command: info.command || null,
      startedAt: info.startedAt,
      completedAt: info.completedAt || null,
      exitCode: info.exitCode ?? null,
      error: info.error || null,
      outputTail: stdout.slice(-500),
      stderrTail: stderr.slice(-500),
      outputLength: stdout.length,
      agentType: 'discussion',
      feedbackId: info.feedbackId,
    });
  }
  // Include curation agent
  if (curationAgent) {
    const stdout = typeof curationAgent.stdout === 'function' ? curationAgent.stdout() : (curationAgent._stdout || '');
    const stderr = typeof curationAgent.stderr === 'function' ? curationAgent.stderr() : (curationAgent._stderr || '');
    statuses.push({
      key: 'curation',
      repo: null,
      prId: null,
      pid: curationAgent.pid,
      status: curationAgent.status,
      profileName: 'curation',
      command: curationAgent.command || null,
      startedAt: curationAgent.startedAt,
      completedAt: curationAgent.completedAt || null,
      exitCode: curationAgent.exitCode ?? null,
      error: curationAgent.error || null,
      outputTail: stdout.slice(-500),
      stderrTail: stderr.slice(-500),
      outputLength: stdout.length,
      agentType: 'curation',
    });
  }
  return statuses;
}

/** Get full output for any agent by key */
export async function getAgentOutputByKey(key) {
  // Helper to extract output from an agent info object
  const extract = async (info) => {
    let stdout, stderr;
    if (info.logFiles) {
      stdout = await readLogFile(info.logFiles.stdout);
      stderr = await readLogFile(info.logFiles.stderr);
    } else {
      stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
      stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
    }
    return { key, status: info.status, pid: info.pid, stdout, stderr };
  };

  // Check review agents
  if (runningAgents.has(key)) return await extract(runningAgents.get(key));

  // Check discussion agents
  if (discussionAgents.has(key)) return await extract(discussionAgents.get(key));

  // Check curation agent
  if (key === 'curation' && curationAgent) return await extract(curationAgent);

  // Fall back to persisted state on disk (review agents only)
  const parts = key.split('/');
  if (parts.length === 2) {
    const statePath = path.join(REVIEWS_ROOT, parts[0], parts[1], 'agent-state.json');
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.logFiles) {
        data.stdout = await readLogFile(data.logFiles.stdout);
        data.stderr = await readLogFile(data.logFiles.stderr);
      }
      return data;
    } catch {}
  }

  return null;
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

function discussionAgentStatesPath(repo, prId) {
  return path.join(REVIEWS_ROOT, repo, String(prId), 'discussion-agents.json');
}

async function persistAgentState(info) {
  const statePath = agentStatePath(info.repo, info.prId);
  const data = {
    key: `${info.repo}/${info.prId}`,
    repo: info.repo,
    prId: info.prId,
    prUrl: info.prUrl,
    pid: info.pid,
    status: info.status,
    profileName: info.profileName,
    command: info.command || null,
    startedAt: info.startedAt,
    completedAt: info.completedAt || null,
    exitCode: info.exitCode ?? null,
    error: info.error || null,
  };
  // For log file agents, store paths instead of inline output
  if (info.logFiles) {
    data.logFiles = info.logFiles;
  } else {
    const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
    const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
    data.stdout = stdout;
    data.stderr = stderr;
  }
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[agent] Failed to persist state for ${info.repo}/${info.prId}: ${err.message}`);
  }
}

async function persistDiscussionAgentState(info) {
  const filePath = discussionAgentStatesPath(info.repo, info.prId);
  const stdout = typeof info.stdout === 'function' ? info.stdout() : (info._stdout || '');
  const stderr = typeof info.stderr === 'function' ? info.stderr() : (info._stderr || '');
  const entry = {
    key: info.key,
    repo: info.repo,
    prId: info.prId,
    feedbackId: info.feedbackId,
    pid: info.pid,
    status: info.status,
    command: info.command || null,
    startedAt: info.startedAt,
    completedAt: info.completedAt || null,
    exitCode: info.exitCode ?? null,
    error: info.error || null,
    response: info.response || null,
    stdout,
    stderr,
  };

  try {
    let agents = {};
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      agents = JSON.parse(raw);
    } catch { /* file doesn't exist yet */ }
    agents[info.feedbackId] = entry;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(agents, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[discussion] Failed to persist state for ${info.key}: ${err.message}`);
  }
}

async function markMetadataFailed(repo, prId, reason) {
  try {
    const review = await getReview(repo, prId);
    if (review?.metadata) {
      review.metadata.status = 'agent_review_failed';
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
    // Prefer in-memory state (matches what status API returns) over disk
    const key = `${repo}/${prId}`;
    const memInfo = runningAgents.get(key);
    let current;
    if (memInfo) {
      let stdout, stderr;
      if (memInfo.logFiles) {
        stdout = await readLogFile(memInfo.logFiles.stdout);
        stderr = await readLogFile(memInfo.logFiles.stderr);
      } else {
        stdout = typeof memInfo.stdout === 'function' ? memInfo.stdout() : (memInfo._stdout || '');
        stderr = typeof memInfo.stderr === 'function' ? memInfo.stderr() : (memInfo._stderr || '');
      }
      current = {
        key, repo, prId, prUrl: memInfo.prUrl, pid: memInfo.pid,
        status: memInfo.status, profileName: memInfo.profileName,
        command: memInfo.command || null,
        startedAt: memInfo.startedAt, completedAt: memInfo.completedAt || null,
        exitCode: memInfo.exitCode ?? null, error: memInfo.error || null,
        stdout, stderr,
      };
    } else {
      const raw = await fs.readFile(statePath, 'utf-8');
      current = JSON.parse(raw);
      if (current.logFiles) {
        current.stdout = await readLogFile(current.logFiles.stdout);
        current.stderr = await readLogFile(current.logFiles.stderr);
      }
    }
    current.archivedAt = new Date().toISOString();
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
        const prDir = path.join(repoPath, prId);

        // Check for lockfile — detect orphaned agents that survived a server restart
        const lockPath = path.join(prDir, '.review.lock');
        const lockInfo = await readLock(lockPath);
        const orphaned = lockInfo && isLockAlive(lockInfo);

        if (orphaned) {
          // Agent is still running! Create a shadow agent entry reading from log files.
          const key = `${repo}/${prId}`;
          const logFiles = lockInfo.logFiles || {
            stdout: path.join(prDir, 'agent-stdout.log'),
            stderr: path.join(prDir, 'agent-stderr.log'),
          };
          const agentInfo = {
            pid: lockInfo.pid,
            status: 'running',
            repo,
            prId: Number(prId),
            prUrl: lockInfo.prUrl,
            profileName: lockInfo.profileName || 'unknown',
            command: lockInfo.command || null,
            startedAt: lockInfo.startedAt,
            orphaned: true,
            logFiles,
          };
          runningAgents.set(key, agentInfo);
          startOrphanPoller(key, agentInfo, lockPath);
          console.log(`[agent] Re-attached to orphaned agent for ${key} (PID ${lockInfo.pid})`);
        } else {
          // No alive agent — load persisted state from agent-state.json
          const statePath = path.join(prDir, 'agent-state.json');
          try {
            const raw = await fs.readFile(statePath, 'utf-8');
            const data = JSON.parse(raw);
            const key = `${repo}/${prId}`;

            if (data.status === 'running') {
              // Check if the review actually completed despite the agent being killed
              try {
                const review = await getReview(repo, prId);
                if (review.metadata?.status === 'agent_review_done') {
                  data.status = 'completed';
                  data.completedAt = new Date().toISOString();
                  console.log(`[agent] ${key} review completed despite server restart`);
                } else {
                  data.status = 'failed';
                  data.error = 'Server restarted while agent was running';
                  data.completedAt = new Date().toISOString();
                  await markMetadataFailed(repo, prId, 'Server restarted while agent was running');
                }
              } catch {
                data.status = 'failed';
                data.error = 'Server restarted while agent was running';
                data.completedAt = new Date().toISOString();
                await markMetadataFailed(repo, prId, 'Server restarted while agent was running');
              }
              await fs.writeFile(statePath, JSON.stringify(data, null, 2), 'utf-8');
            }

            runningAgents.set(key, {
              ...data,
              _stdout: data.stdout || '',
              _stderr: data.stderr || '',
            });
          } catch { /* no agent-state.json, skip */ }

          // Clean up stale lockfile if PID is dead
          if (lockInfo && !isLockAlive(lockInfo)) {
            removeLock(lockPath).catch(() => {});
          }
        }

        // Load discussion agent states
        const discPath = path.join(prDir, 'discussion-agents.json');
        try {
          const raw = await fs.readFile(discPath, 'utf-8');
          const agents = JSON.parse(raw);
          for (const [feedbackId, data] of Object.entries(agents)) {
            if (data.status === 'running') {
              data.status = 'failed';
              data.error = 'Server restarted while agent was running';
              data.completedAt = new Date().toISOString();
            }
            discussionAgents.set(data.key, {
              ...data,
              _stdout: data.stdout || '',
              _stderr: data.stderr || '',
            });
          }
        } catch { /* no discussion-agents.json, skip */ }
      }
    }
    console.log(`[agent] Loaded ${runningAgents.size} review + ${discussionAgents.size} discussion persisted agent state(s)`);
  } catch (err) {
    console.error(`[agent] Error loading persisted states: ${err.message}`);
  }
}

/** Poll an orphaned agent (survived server restart) until it exits */
function startOrphanPoller(key, agentInfo, lockPath) {
  const interval = setInterval(async () => {
    if (!isLockAlive({ pid: agentInfo.pid })) {
      clearInterval(interval);
      // Check metadata to determine if review completed successfully
      try {
        const review = await getReview(agentInfo.repo, agentInfo.prId);
        if (review.metadata?.status === 'agent_review_done') {
          agentInfo.status = 'completed';
        } else {
          agentInfo.status = 'failed';
          agentInfo.error = 'Agent process exited';
          await markMetadataFailed(agentInfo.repo, agentInfo.prId, 'Agent process exited');
        }
      } catch {
        agentInfo.status = 'failed';
        agentInfo.error = 'Agent process exited';
      }
      agentInfo.completedAt = new Date().toISOString();
      agentInfo.orphaned = false;
      await removeLock(lockPath).catch(() => {});
      await persistAgentState(agentInfo);
      console.log(`[agent] Orphaned agent ${key} ${agentInfo.status}`);
    }
  }, 10000);
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

  const displayCmd = `${profile.program} ${args.map(a => a === prompt ? '"<curation-prompt>"' : a).join(' ')}`;

  // Use spawn with args array to avoid Windows command-line length limit
  const child = spawn(profile.program, args, { shell: false, cwd: os.homedir() });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', d => { stdout += d.toString(); });
  child.stderr?.on('data', d => { stderr += d.toString(); });

  curationAgent = {
    status: 'running',
    pid: child.pid,
    command: displayCmd,
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


