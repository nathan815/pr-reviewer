import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  listAllReviews,
  getReview,
  getFeedbackItem,
  updateFeedbackStatus,
  batchUpdateFeedbackStatus,
  deleteAllFeedback,
  readFileAtCommit,
  getFileDiff,
  getExamplesSinceCuration,
  updateMetadata,
  syncAdoReplies,
} from '../lib/fileStore.js';
import { getPRDetails } from '../lib/adoClient.js';
import { launchCurationAgent, getCurationStatus, launchDiscussionAgent, getDiscussionStatus } from '../lib/agentLauncher.js';

const REVIEWS_ROOT = path.join(os.homedir(), 'pr-reviews');
const AUTO_CURATE_THRESHOLD = 20; // auto-curate after this many new decisions

export const reviewsRouter = Router();

// List all reviews
reviewsRouter.get('/', async (_req, res) => {
  try {
    const reviews = await listAllReviews();
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single review
reviewsRouter.get('/:repo/:prId', async (req, res) => {
  try {
    await syncAdoReplies(req.params.repo, req.params.prId).catch(() => {});
    const review = await getReview(req.params.repo, req.params.prId);
    res.json(review);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Review not found' });
    res.status(500).json({ error: err.message });
  }
});

// Get lockfile status for a PR
reviewsRouter.get('/:repo/:prId/lock-status', async (req, res) => {
  const lockPath = path.join(REVIEWS_ROOT, req.params.repo, String(req.params.prId), '.review.lock');
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    const lock = JSON.parse(raw);
    // Check if the process is still alive
    let alive = false;
    if (lock.pid) {
      try { process.kill(lock.pid, 0); alive = true; } catch { /* not running */ }
    }
    res.json({ locked: true, alive, ...lock });
  } catch {
    res.json({ locked: false });
  }
});

// Fetch live PR info from ADO and sync metadata
reviewsRouter.get('/:repo/:prId/ado-info', async (req, res) => {
  try {
    const { repo, prId } = req.params;
    const pr = await getPRDetails(repo, prId);

    const statusMap = { 1: 'active', 2: 'abandoned', 3: 'completed', active: 'active', abandoned: 'abandoned', completed: 'completed' };
    const mergeMap = { 1: 'queued', 2: 'conflicts', 3: 'succeeded', queued: 'queued', conflicts: 'conflicts', succeeded: 'succeeded' };
    const prStatus = statusMap[pr.status] || 'unknown';
    const mergeStatus = mergeMap[pr.mergeStatus] || null;

    const info = {
      title: pr.title,
      author: pr.createdBy?.displayName || pr.createdBy?.uniqueName,
      authorAvatar: pr.createdBy?.imageUrl,
      sourceBranch: pr.sourceRefName?.replace('refs/heads/', ''),
      targetBranch: pr.targetRefName?.replace('refs/heads/', ''),
      prStatus,
      mergeStatus,
      isDraft: pr.isDraft || false,
      reviewers: (pr.reviewers || []).map(r => ({
        name: r.displayName,
        vote: r.vote, // 10=approved, 5=approved-with-suggestions, -5=wait, -10=rejected, 0=none
      })),
      createdAt: pr.creationDate,
      closedAt: pr.closedDate,
    };

    // Sync title back to metadata if changed
    const review = await getReview(repo, prId);
    if (review.metadata.title !== info.title) {
      await updateMetadata(repo, prId, { title: info.title });
    }

    res.json(info);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Update a single feedback item's status
reviewsRouter.patch('/:repo/:prId/feedback/:feedbackId', async (req, res) => {
  try {
    const { status, userNote } = req.body;
    if (!['pending', 'accepted', 'noted', 'rejected', 'posted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: pending, accepted, noted, rejected, posted' });
    }
    const item = await updateFeedbackStatus(
      req.params.repo, req.params.prId, req.params.feedbackId, status, userNote
    );
    res.json(item);

    // Check auto-curation threshold (fire-and-forget)
    if (status === 'accepted' || status === 'noted' || status === 'rejected') {
      getExamplesSinceCuration().then(examples => {
        if (examples.length >= AUTO_CURATE_THRESHOLD && getCurationStatus().status !== 'running') {
          console.log(`[auto-curate] ${examples.length} new decisions — launching curation agent`);
          launchCurationAgent().catch(err =>
            console.error(`[auto-curate] Failed: ${err.message}`)
          );
        }
      }).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch update feedback statuses
reviewsRouter.post('/:repo/:prId/feedback/batch-update', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids?.length || !status) {
      return res.status(400).json({ error: 'Must provide ids[] and status' });
    }
    const updated = await batchUpdateFeedbackStatus(req.params.repo, req.params.prId, ids, status);
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all feedback (moves to deleted/ subfolder)
reviewsRouter.post('/:repo/:prId/feedback/delete-all', async (req, res) => {
  try {
    const result = await deleteAllFeedback(req.params.repo, req.params.prId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a file (at specific commit or from worktree)
reviewsRouter.get('/:repo/:prId/file', async (req, res) => {
  try {
    const { path: filePath, commit } = req.query;
    if (!filePath) return res.status(400).json({ error: 'path query parameter required' });
    const content = await readFileAtCommit(req.params.repo, req.params.prId, filePath, commit);
    res.type('text/plain').send(content);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: err.message });
  }
});

// Read diff/source payload for a file in the PR
reviewsRouter.get('/:repo/:prId/file-diff', async (req, res) => {
  try {
    const { path: filePath, commit, context } = req.query;
    if (!filePath) return res.status(400).json({ error: 'path query parameter required' });
    const diff = await getFileDiff(req.params.repo, req.params.prId, filePath, commit, context);
    res.json(diff);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    res.status(500).json({ error: err.message });
  }
});

// Start a discussion on a feedback item
reviewsRouter.post('/:repo/:prId/feedback/:feedbackId/discuss', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Must provide message' });
    const result = await launchDiscussionAgent(
      req.params.repo, req.params.prId, req.params.feedbackId, message.trim()
    );
    res.status(result.status === 'already_running' ? 409 : 201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get discussion agent status for a feedback item
reviewsRouter.get('/:repo/:prId/feedback/:feedbackId/discuss', async (req, res) => {
  const status = getDiscussionStatus(req.params.repo, req.params.prId, req.params.feedbackId);
  res.json(status || { status: 'idle' });
});

// Get the synced ADO thread replies for a feedback item
reviewsRouter.get('/:repo/:prId/feedback/:feedbackId/ado-thread', async (req, res) => {
  try {
    const { repo, prId, feedbackId } = req.params;
    await syncAdoReplies(repo, prId, feedbackId).catch(() => {});
    const item = await getFeedbackItem(repo, prId, feedbackId);
    res.json({
      feedbackId: item.id,
      adoThreadId: item.adoThreadId || null,
      status: item.status,
      replies: item.adoReplies || [],
    });
  } catch (err) {
    if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});
