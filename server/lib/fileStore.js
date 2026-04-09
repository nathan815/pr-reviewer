import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');

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
export async function updateFeedbackStatus(repo, prId, feedbackId, newStatus) {
  const dir = reviewDir(repo, prId);
  const feedbackPath = path.join(dir, 'feedback.json');
  const feedback = await readJson(feedbackPath);

  const item = feedback.items.find(i => i.id === feedbackId);
  if (!item) throw new Error(`Feedback item ${feedbackId} not found`);

  item.status = newStatus;
  await writeJson(feedbackPath, feedback);
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

/** Read a file from the worktree for diff display */
export async function readWorktreeFile(repo, prId, filePath) {
  const fullPath = path.join(reviewDir(repo, prId), 'worktree', filePath);
  return fs.readFile(fullPath, 'utf-8');
}

// Helpers
async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}
