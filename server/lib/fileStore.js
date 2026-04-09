import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');
const LEARNINGS_DIR = path.join(REVIEWS_ROOT, '.learnings');
const EXAMPLES_PATH = path.join(LEARNINGS_DIR, 'examples.jsonl');
const GUIDELINES_PATH = path.join(LEARNINGS_DIR, 'guidelines.md');
const EXTRA_INSTRUCTIONS_PATH = path.join(REVIEWS_ROOT, 'extra_instructions.md');

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function reviewDir(repo, prId) {
  return path.join(REVIEWS_ROOT, repo, String(prId));
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
          const feedback = await readJson(path.join(prPath, 'feedback.json')).catch(() => ({ items: [] }));
          const risk = await readJson(path.join(prPath, 'risk-assessment.json')).catch(() => ({ overallRisk: 'unknown', areas: [] }));

          reviews.push({
            repo,
            prId: Number(prId),
            ...metadata,
            feedbackCount: feedback.items?.length || 0,
            pendingCount: feedback.items?.filter(i => i.status === 'pending').length || 0,
            acceptedCount: feedback.items?.filter(i => i.status === 'accepted').length || 0,
            postedCount: feedback.items?.filter(i => i.status === 'posted').length || 0,
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
  const [metadata, feedback, risk, overview] = await Promise.all([
    readJson(path.join(dir, 'metadata.json')),
    readJson(path.join(dir, 'feedback.json')).catch(() => ({ items: [] })),
    readJson(path.join(dir, 'risk-assessment.json')).catch(() => ({ overallRisk: 'unknown', areas: [] })),
    fs.readFile(path.join(dir, 'overview.md'), 'utf-8').catch(() => ''),
  ]);
  return { repo, prId: Number(prId), metadata, feedback, risk, overview };
}

/** Update the status of a single feedback item */
export async function updateFeedbackStatus(repo, prId, feedbackId, newStatus, userNote) {
  const dir = reviewDir(repo, prId);
  const feedbackPath = path.join(dir, 'feedback.json');
  const feedback = await readJson(feedbackPath);

  const item = feedback.items.find(i => i.id === feedbackId);
  if (!item) throw new Error(`Feedback item ${feedbackId} not found`);

  item.status = newStatus;
  if (userNote !== undefined) item.userNote = userNote;
  await writeJson(feedbackPath, feedback);

  // Record learning example on accept/reject
  if (newStatus === 'accepted' || newStatus === 'rejected') {
    await recordLearningExample(repo, prId, item, newStatus, userNote);
  }

  return item;
}

/** Update feedback item with ADO thread ID after posting */
export async function markFeedbackPosted(repo, prId, feedbackId, adoThreadId) {
  const dir = reviewDir(repo, prId);
  const feedbackPath = path.join(dir, 'feedback.json');
  const feedback = await readJson(feedbackPath);

  const item = feedback.items.find(i => i.id === feedbackId);
  if (!item) throw new Error(`Feedback item ${feedbackId} not found`);

  item.status = 'posted';
  item.adoThreadId = adoThreadId;
  await writeJson(feedbackPath, feedback);
  return item;
}

/** Batch update: set multiple feedback items to a status */
export async function batchUpdateFeedbackStatus(repo, prId, feedbackIds, newStatus) {
  const dir = reviewDir(repo, prId);
  const feedbackPath = path.join(dir, 'feedback.json');
  const feedback = await readJson(feedbackPath);

  const updated = [];
  for (const id of feedbackIds) {
    const item = feedback.items.find(i => i.id === id);
    if (item) {
      item.status = newStatus;
      updated.push(item);
    }
  }
  await writeJson(feedbackPath, feedback);
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

/** Read a file at a specific commit, falling back to HEAD then worktree */
export async function readFileAtCommit(repo, prId, filePath, commitSha) {
  const dir = reviewDir(repo, prId);
  const worktreePath = path.join(dir, 'worktree');
  const { execFileSync } = await import('child_process');

  // Resolve the ref: explicit commit > HEAD of worktree
  const ref = commitSha || (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, encoding: 'utf-8' }).trim();
    } catch { return null; }
  })();

  if (ref) {
    try {
      return execFileSync(
        'git', ['show', `${ref}:${filePath}`],
        { cwd: worktreePath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      );
    } catch {
      // Fall through to worktree read
    }
  }

  // Final fallback: read from worktree on disk
  return fs.readFile(path.join(worktreePath, filePath), 'utf-8');
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
  const accepted = examples.filter(e => e.decision === 'accepted');
  const rejected = examples.filter(e => e.decision === 'rejected');

  const byCat = {};
  for (const ex of examples) {
    if (!byCat[ex.category]) byCat[ex.category] = { accepted: 0, rejected: 0 };
    byCat[ex.category][ex.decision]++;
  }

  return {
    total: examples.length,
    accepted: accepted.length,
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
