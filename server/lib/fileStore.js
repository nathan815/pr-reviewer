import fs from 'fs/promises';
import { execFileSync } from 'child_process';
import path from 'path';
import os from 'os';

const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');
const LEARNINGS_DIR = path.join(REVIEWS_ROOT, '.learnings');
const EXAMPLES_PATH = path.join(LEARNINGS_DIR, 'examples.jsonl');
const GUIDELINES_PATH = path.join(LEARNINGS_DIR, 'guidelines.md');
const EXTRA_INSTRUCTIONS_PATH = path.join(REVIEWS_ROOT, 'extra_instructions.md');

// Simple per-file mutex to prevent concurrent read-modify-write races
const fileLocks = new Map();
async function withFileLock(filePath, fn) {
  while (fileLocks.get(filePath)) {
    await fileLocks.get(filePath);
  }
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  fileLocks.set(filePath, promise);
  try {
    return await fn();
  } finally {
    fileLocks.delete(filePath);
    resolve();
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function reviewDir(repo, prId) {
  return path.join(REVIEWS_ROOT, repo, String(prId));
}

function runGit(worktreePath, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function normalizeBranchRef(ref) {
  if (!ref) return null;
  return ref.replace(/^refs\/heads\//, '');
}

function resolveHeadRef(worktreePath, commitSha) {
  return commitSha || runGit(worktreePath, ['rev-parse', 'HEAD'], { allowFailure: true });
}

function resolveBaseRef(worktreePath, targetBranch, headRef) {
  if (!targetBranch || !headRef) return null;

  const normalized = normalizeBranchRef(targetBranch);
  const candidates = [
    targetBranch,
    `refs/remotes/origin/${normalized}`,
    `origin/${normalized}`,
    `refs/heads/${normalized}`,
    normalized,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = runGit(worktreePath, ['rev-parse', '--verify', candidate], { allowFailure: true });
    if (!resolved) continue;

    const mergeBase = runGit(worktreePath, ['merge-base', headRef, resolved], { allowFailure: true });
    if (mergeBase) return mergeBase;
  }

  return null;
}

function readGitFile(worktreePath, ref, filePath) {
  if (!ref) return null;
  return runGit(worktreePath, ['show', `${ref}:${filePath}`], { allowFailure: true });
}

// Cache: maps feedbackId -> filePath per PR directory
const feedbackFileCache = new Map(); // key = dir, value = Map(itemId -> filePath)

/** Read all feedback files (feedback.json + feedback-*.json) and merge items */
async function readAllFeedback(dir) {
  const items = [];
  const fileMap = new Map(); // itemId -> filePath for updates
  try {
    const files = await fs.readdir(dir);
    const feedbackFiles = files.filter(f => f === 'feedback.json' || (f.startsWith('feedback-') && f.endsWith('.json')));
    // Sort so latest run files come last (items from later runs appear after earlier ones)
    feedbackFiles.sort();
    for (const file of feedbackFiles) {
      const filePath = path.join(dir, file);
      try {
        const data = await readJson(filePath);
        const fileItems = data.items || [];
        for (const item of fileItems) {
          items.push(item);
          fileMap.set(item.id, filePath);
        }
      } catch { /* skip malformed files */ }
    }
  } catch {}
  // Update cache
  feedbackFileCache.set(dir, fileMap);
  return { items, fileMap };
}

/** Find which feedback file contains an item, using cache with fallback re-scan */
async function findFeedbackFile(dir, feedbackId) {
  // Try cache first
  const cached = feedbackFileCache.get(dir);
  if (cached?.has(feedbackId)) return cached.get(feedbackId);
  // Cache miss — re-scan
  const { fileMap } = await readAllFeedback(dir);
  const filePath = fileMap.get(feedbackId);
  if (!filePath) throw new Error(`Feedback item ${feedbackId} not found`);
  return filePath;
}

/** Find which feedback file contains an item and update it */
async function updateFeedbackItem(dir, feedbackId, updateFn) {
  const filePath = await findFeedbackFile(dir, feedbackId);

  return withFileLock(filePath, async () => {
    const feedback = await readJson(filePath);
    const item = feedback.items.find(i => i.id === feedbackId);
    if (!item) throw new Error(`Feedback item ${feedbackId} not found`);
    const result = updateFn(item);
    await writeJson(filePath, feedback);
    return result !== undefined ? result : item;
  });
}

/** List all reviewed PRs across all repos */
export async function listAllReviews() {
  const reviews = [];
  try {
    const repos = await fs.readdir(REVIEWS_ROOT);
    for (const repo of repos) {
      const repoPath = path.join(REVIEWS_ROOT, repo);
      const stat = await fs.stat(repoPath);
      if (!stat.isDirectory()) continue;

      const prIds = await fs.readdir(repoPath);
      for (const prId of prIds) {
        const prPath = path.join(repoPath, prId);
        const prStat = await fs.stat(prPath);
        if (!prStat.isDirectory()) continue;

        try {
          const metadata = await readJson(path.join(prPath, 'metadata.json'));
          const { items } = await readAllFeedback(prPath);
          const risk = await readJson(path.join(prPath, 'risk-assessment.json')).catch(() => ({ overallRisk: 'unknown', areas: [] }));

          reviews.push({
            repo,
            prId: Number(prId),
            ...metadata,
            feedbackCount: items.length,
            pendingCount: items.filter(i => i.status === 'pending').length,
            acceptedCount: items.filter(i => i.status === 'accepted').length,
            postedCount: items.filter(i => i.status === 'posted').length,
            overallRisk: risk.overallRisk,
          });
        } catch {
          // Skip malformed review directories
        }
      }
    }
  } catch {
    // Reviews root doesn't exist yet
  }
  return reviews.sort((a, b) => new Date(b.reviewedAt || 0) - new Date(a.reviewedAt || 0));
}

/** Get full review data for a single PR */
export async function getReview(repo, prId) {
  const dir = reviewDir(repo, prId);
  const [metadata, feedbackResult, risk, overview] = await Promise.all([
    readJson(path.join(dir, 'metadata.json')),
    readAllFeedback(dir),
    readJson(path.join(dir, 'risk-assessment.json')).catch(() => ({ overallRisk: 'unknown', areas: [] })),
    fs.readFile(path.join(dir, 'overview.md'), 'utf-8').catch(() => ''),
  ]);
  return { repo, prId: Number(prId), metadata, feedback: { items: feedbackResult.items }, risk, overview };
}

/** Update the status of a single feedback item */
export async function updateFeedbackStatus(repo, prId, feedbackId, newStatus, userNote) {
  const dir = reviewDir(repo, prId);
  const item = await updateFeedbackItem(dir, feedbackId, (item) => {
    item.status = newStatus;
    if (userNote !== undefined) item.userNote = userNote;
  });

  // Record learning example on accept/noted/reject
  if (newStatus === 'accepted' || newStatus === 'noted' || newStatus === 'rejected') {
    await recordLearningExample(repo, prId, item, newStatus, userNote);
  }

  // Remove learning example on reset to pending
  if (newStatus === 'pending') {
    await removeLearningExample(repo, prId, feedbackId);
  }

  return item;
}

/** Update feedback item with ADO thread ID after posting */
export async function markFeedbackPosted(repo, prId, feedbackId, adoThreadId) {
  const dir = reviewDir(repo, prId);
  return updateFeedbackItem(dir, feedbackId, (item) => {
    item.status = 'posted';
    item.adoThreadId = adoThreadId;
  });
}

/** Batch update: set multiple feedback items to a status */
export async function batchUpdateFeedbackStatus(repo, prId, feedbackIds, newStatus) {
  const dir = reviewDir(repo, prId);
  const { fileMap } = await readAllFeedback(dir);

  // Group IDs by source file
  const byFile = new Map();
  for (const id of feedbackIds) {
    const filePath = fileMap.get(id);
    if (!filePath) continue;
    if (!byFile.has(filePath)) byFile.set(filePath, []);
    byFile.get(filePath).push(id);
  }

  const updated = [];
  for (const [filePath, ids] of byFile) {
    await withFileLock(filePath, async () => {
      const feedback = await readJson(filePath);
      for (const id of ids) {
        const item = feedback.items.find(i => i.id === id);
        if (item) { item.status = newStatus; updated.push(item); }
      }
      await writeJson(filePath, feedback);
    });
  }
  return updated;
}

/** Write a full review (used by the Copilot skill) */
export async function writeReview(repo, prId, { metadata, feedback, risk, overview }) {
  const dir = reviewDir(repo, prId);
  await ensureDir(dir);

  const writes = [];
  if (metadata) writes.push(writeJson(path.join(dir, 'metadata.json'), metadata));
  if (feedback) writes.push(writeJson(path.join(dir, 'feedback.json'), feedback));
  if (risk) writes.push(writeJson(path.join(dir, 'risk-assessment.json'), risk));
  if (overview) writes.push(fs.writeFile(path.join(dir, 'overview.md'), overview, 'utf-8'));
  await Promise.all(writes);
}

/** Delete all feedback — moves feedback.json to deleted/ subfolder with timestamp */
export async function deleteAllFeedback(repo, prId) {
  const dir = reviewDir(repo, prId);
  const { items } = await readAllFeedback(dir);
  const count = items.length;
  if (count === 0) return { deleted: 0 };

  // Move all feedback files to deleted/ subfolder
  const deletedDir = path.join(dir, 'deleted');
  await ensureDir(deletedDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const files = await fs.readdir(dir);
  const feedbackFiles = files.filter(f => f === 'feedback.json' || (f.startsWith('feedback-') && f.endsWith('.json')));
  for (const file of feedbackFiles) {
    await fs.copyFile(path.join(dir, file), path.join(deletedDir, `${file.replace('.json', '')}-${timestamp}.json`));
    await fs.unlink(path.join(dir, file));
  }

  return { deleted: count };
}

/** Update specific fields in metadata.json */
export async function updateMetadata(repo, prId, updates) {
  const dir = reviewDir(repo, prId);
  const metaPath = path.join(dir, 'metadata.json');
  const metadata = await readJson(metaPath);
  Object.assign(metadata, updates);
  await writeJson(metaPath, metadata);
  return metadata;
}

/** Read a file at a specific commit, falling back to HEAD then worktree */
export async function readFileAtCommit(repo, prId, filePath, commitSha) {
  const dir = reviewDir(repo, prId);
  const worktreePath = path.join(dir, 'worktree');
  const ref = resolveHeadRef(worktreePath, commitSha);

  if (ref) {
    const content = readGitFile(worktreePath, ref, filePath);
    if (content !== null) return content;
  }

  // Final fallback: read from worktree on disk
  return fs.readFile(path.join(worktreePath, filePath), 'utf-8');
}

/** Build diff/source payload for a file in the PR worktree */
export async function getFileDiff(repo, prId, filePath, commitSha, contextLines = 3) {
  const dir = reviewDir(repo, prId);
  const worktreePath = path.join(dir, 'worktree');
  const metadata = await readJson(path.join(dir, 'metadata.json'));

  const headRef = resolveHeadRef(worktreePath, commitSha || metadata.commitSha);
  const baseRef = resolveBaseRef(worktreePath, metadata.targetBranch, headRef);

  const oldSourceFromBase = readGitFile(worktreePath, baseRef, filePath) ?? '';
  let newSource = readGitFile(worktreePath, headRef, filePath);
  if (newSource === null) {
    try {
      newSource = await fs.readFile(path.join(worktreePath, filePath), 'utf-8');
    } catch {
      newSource = '';
    }
  }

  const oldSource = baseRef ? oldSourceFromBase : newSource;
  const diffText = baseRef
    ? runGit(
        worktreePath,
        [
          '--no-pager',
          'diff',
          '--no-ext-diff',
          `--unified=${Math.max(0, Number(contextLines) || 0)}`,
          baseRef,
          headRef,
          '--',
          filePath,
        ],
        { allowFailure: true }
      ) || ''
    : '';

  return {
    path: filePath,
    headRef,
    baseRef,
    oldSource,
    newSource,
    diffText,
    baseUnavailable: !baseRef,
  };
}

/** Add a discussion message to a feedback item */
export async function addDiscussionMessage(repo, prId, feedbackId, role, message, extra = {}) {
  const dir = reviewDir(repo, prId);
  const filePath = await findFeedbackFile(dir, feedbackId);

  return withFileLock(filePath, async () => {
    const feedback = await readJson(filePath);
    const item = feedback.items.find(i => i.id === feedbackId);
    if (!item) throw new Error(`Feedback item ${feedbackId} not found`);
    if (!item.discussion) item.discussion = [];
    const entry = { role, message, timestamp: new Date().toISOString(), ...extra };
    item.discussion.push(entry);
    await writeJson(filePath, feedback);
    return entry;
  });
}

/** Update a feedback item's content fields and record edit history */
export async function updateFeedbackContent(repo, prId, feedbackId, updates) {
  const dir = reviewDir(repo, prId);
  const filePath = await findFeedbackFile(dir, feedbackId);

  return withFileLock(filePath, async () => {
    const feedback = await readJson(filePath);
    const item = feedback.items.find(i => i.id === feedbackId);
    if (!item) throw new Error(`Feedback item ${feedbackId} not found`);

    if (!item.editHistory) item.editHistory = [];
    const snapshot = {};
    const changes = [];
    const editableFields = ['title', 'comment', 'suggestion', 'severity', 'category', 'startLine', 'endLine', 'file'];
    for (const field of editableFields) {
      if (updates[field] !== undefined && updates[field] !== item[field]) {
        snapshot[field] = item[field];
        changes.push({
          field,
          previous: item[field],
          current: updates[field],
        });
        item[field] = updates[field];
      }
    }

    let editSummary = null;
    if (Object.keys(snapshot).length > 0) {
      const editedAt = new Date().toISOString();
      item.editHistory.push({
        previous: snapshot,
        editedAt,
        editedBy: 'discussion-agent',
      });
      editSummary = {
        editedAt,
        changes,
      };
    }

    await writeJson(filePath, feedback);
    return { item, editSummary };
  });
}

// Helpers
async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// --- Learnings ---

/** Append a learning example when user accepts/rejects feedback */
async function recordLearningExample(repo, prId, item, decision, userNote) {
  await ensureDir(LEARNINGS_DIR);
  const example = {
    timestamp: new Date().toISOString(),
    repo,
    prId,
    decision,
    userNote: userNote || null,
    feedbackId: item.id,
    category: item.category,
    severity: item.severity,
    title: item.title,
    comment: item.comment,
    suggestion: item.suggestion || null,
    file: item.file,
    startLine: item.startLine,
    endLine: item.endLine,
  };
  await fs.appendFile(EXAMPLES_PATH, JSON.stringify(example) + '\n', 'utf-8');
}

/** Remove learning examples for a specific feedback item (on reset) */
async function removeLearningExample(repo, prId, feedbackId) {
  try {
    const raw = await fs.readFile(EXAMPLES_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const filtered = lines.filter(line => {
      const ex = JSON.parse(line);
      return !(ex.repo === repo && String(ex.prId) === String(prId) && ex.feedbackId === feedbackId);
    });
    await fs.writeFile(EXAMPLES_PATH, filtered.length ? filtered.join('\n') + '\n' : '', 'utf-8');
  } catch {
    // No examples file yet — nothing to remove
  }
}

/** Get all learning examples */
export async function getLearningExamples() {
  try {
    const raw = await fs.readFile(EXAMPLES_PATH, 'utf-8');
    return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/** Get learning stats summary */
export async function getLearningStats() {
  const examples = await getLearningExamples();
  const accepted = examples.filter(e => e.decision === 'accepted' || e.decision === 'noted');
  const rejected = examples.filter(e => e.decision === 'rejected');

  const byCat = {};
  for (const ex of examples) {
    if (!byCat[ex.category]) byCat[ex.category] = { accepted: 0, noted: 0, rejected: 0 };
    if (ex.decision === 'accepted' || ex.decision === 'noted') byCat[ex.category].accepted++;
    if (ex.decision === 'noted') byCat[ex.category].noted++;
    if (ex.decision === 'rejected') byCat[ex.category].rejected++;
  }

  return {
    total: examples.length,
    accepted: accepted.length,
    noted: examples.filter(e => e.decision === 'noted').length,
    rejected: rejected.length,
    acceptRate: examples.length ? Math.round(accepted.length / examples.length * 100) : 0,
    byCategory: byCat,
    withNotes: examples.filter(e => e.userNote).length,
  };
}

/** Read the curated guidelines (global, per-repo, or both) */
export async function getGuidelines(repo) {
  const global = await fs.readFile(GUIDELINES_PATH, 'utf-8').catch(() => null);
  let perRepo = null;
  if (repo) {
    perRepo = await fs.readFile(
      path.join(LEARNINGS_DIR, 'repo', repo, 'guidelines.md'), 'utf-8'
    ).catch(() => null);
  }
  return { global, perRepo };
}

/** List all repos that have repo-specific guidelines */
export async function listRepoGuidelines() {
  const repoDir = path.join(LEARNINGS_DIR, 'repo');
  try {
    const repos = await fs.readdir(repoDir);
    const result = [];
    for (const repo of repos) {
      const gp = path.join(repoDir, repo, 'guidelines.md');
      const exists = await fs.stat(gp).then(() => true).catch(() => false);
      if (exists) result.push(repo);
    }
    return result;
  } catch {
    return [];
  }
}

/** Get examples added since last curation */
export async function getExamplesSinceCuration() {
  const lastCuratedAt = await fs.readFile(
    path.join(LEARNINGS_DIR, '.last-curated'), 'utf-8'
  ).catch(() => '1970-01-01T00:00:00Z');
  const cutoff = new Date(lastCuratedAt.trim()).getTime();
  const all = await getLearningExamples();
  return all.filter(e => new Date(e.timestamp).getTime() > cutoff);
}

/** Mark curation as complete — snapshot existing guidelines to history */
export async function markCurationComplete() {
  await ensureDir(LEARNINGS_DIR);
  const historyDir = path.join(LEARNINGS_DIR, 'history');
  await ensureDir(historyDir);

  // Archive current global guidelines before overwrite
  const { global } = await getGuidelines();
  if (global) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(historyDir, `guidelines-${ts}.md`), global, 'utf-8');
  }

  await fs.writeFile(path.join(LEARNINGS_DIR, '.last-curated'), new Date().toISOString(), 'utf-8');
}

// --- Extra Instructions ---

export async function getExtraInstructions() {
  try {
    return await fs.readFile(EXTRA_INSTRUCTIONS_PATH, 'utf-8');
  } catch {
    return '';
  }
}

export async function setExtraInstructions(content) {
  await ensureDir(REVIEWS_ROOT);
  await fs.writeFile(EXTRA_INSTRUCTIONS_PATH, content, 'utf-8');
}
