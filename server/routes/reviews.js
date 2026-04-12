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
  syncWorktree,
  checkStaleness,
  readAllResolutions,
  updateResolutionStatus,
  markResolutionPosted,
  updateFeedbackAdoThreadStatus,
} from '../lib/fileStore.js';
import { getPRDetails, replyToThread, updateThreadStatus } from '../lib/adoClient.js';
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
    const review = await getReview(req.params.repo, req.params.prId);
    res.json(review);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Review not found' });
    res.status(500).json({ error: err.message });
  }
});

// Sync worktree to latest origin (fetch + reset)
reviewsRouter.post('/:repo/:prId/sync', async (req, res) => {
  try {
    const result = await syncWorktree(req.params.repo, req.params.prId);
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Review not found' });
    res.status(500).json({ error: err.message });
  }
});

// Check if PR has new commits (staleness)
reviewsRouter.get('/:repo/:prId/staleness', async (req, res) => {
  try {
    const result = await checkStaleness(req.params.repo, req.params.prId);
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Review not found' });
    res.status(500).json({ error: err.message });
  }
});

// Sync ADO replies for the whole PR without blocking the main review payload
reviewsRouter.post('/:repo/:prId/sync-ado-replies', async (req, res) => {
  try {
    const result = await syncAdoReplies(req.params.repo, req.params.prId);
    res.json(result);
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

    // Sync metadata fields back if missing or changed
    const review = await getReview(repo, prId);
    const metaUpdates = {};
    if (review.metadata.title !== info.title) metaUpdates.title = info.title;
    if (!review.metadata.author && pr.createdBy?.uniqueName) metaUpdates.author = pr.createdBy.uniqueName;
    if (!review.metadata.sourceBranch && info.sourceBranch) metaUpdates.sourceBranch = info.sourceBranch;
    if (!review.metadata.targetBranch && info.targetBranch) metaUpdates.targetBranch = info.targetBranch;
    if (Object.keys(metaUpdates).length > 0) {
      await updateMetadata(repo, prId, metaUpdates);
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
      adoThreadStatus: item.adoThreadStatus || null,
      status: item.status,
      replies: item.adoReplies || [],
    });
  } catch (err) {
    if (err.message?.includes('not found')) return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- Resolution proposals ---

// Get all resolution proposals for a PR
reviewsRouter.get('/:repo/:prId/resolutions', async (req, res) => {
  try {
    const result = await readAllResolutions(req.params.repo, req.params.prId);
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Review not found' });
    res.status(500).json({ error: err.message });
  }
});

// Post a single accepted resolution to ADO (reply + resolve thread)
reviewsRouter.post('/:repo/:prId/resolutions/:feedbackId/post', async (req, res) => {
  try {
    const { repo, prId, feedbackId } = req.params;
    const { proposals } = await readAllResolutions(repo, prId);
    const proposal = proposals.find(p => p.feedbackId === feedbackId);
    if (!proposal) return res.status(404).json({ error: 'Resolution proposal not found' });
    if (proposal.accepted !== 'accepted') return res.status(400).json({ error: 'Proposal must be accepted before posting' });
    if (proposal.posted) return res.status(409).json({ error: 'Already posted' });

    const review = await getReview(repo, prId);
    const item = review.feedback.items.find(i => i.id === feedbackId);
    if (!item?.adoThreadId) return res.status(400).json({ error: 'Feedback has no ADO thread to reply to' });

    // Post the reply
    const replyContent = (proposal.proposedReply || 'This has been addressed.') +
      '\n\n---\n<sub>Resolution confirmed by PR Review Agent.</sub>';
    await replyToThread(repo, prId, item.adoThreadId, replyContent);

    // Update thread status
    const threadStatus = proposal.proposedThreadStatus || 'fixed';
    await updateThreadStatus(repo, prId, item.adoThreadId, threadStatus);

    // Mark as posted locally and update ADO thread status
    await markResolutionPosted(repo, prId, feedbackId);
    await updateFeedbackAdoThreadStatus(repo, prId, feedbackId, threadStatus);

    res.json({ success: true, threadId: item.adoThreadId, status: threadStatus });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Resolve ADO thread without posting a reply comment
reviewsRouter.post('/:repo/:prId/resolutions/:feedbackId/resolve-only', async (req, res) => {
  try {
    const { repo, prId, feedbackId } = req.params;
    const { proposals } = await readAllResolutions(repo, prId);
    const proposal = proposals.find(p => p.feedbackId === feedbackId);
    if (!proposal) return res.status(404).json({ error: 'Resolution proposal not found' });
    if (proposal.posted) return res.status(409).json({ error: 'Already posted' });

    const review = await getReview(repo, prId);
    const item = review.feedback.items.find(i => i.id === feedbackId);
    if (!item?.adoThreadId) return res.status(400).json({ error: 'Feedback has no ADO thread to resolve' });

    // Only update thread status — no reply
    const threadStatus = proposal.proposedThreadStatus || 'fixed';
    await updateThreadStatus(repo, prId, item.adoThreadId, threadStatus);

    // Mark as posted locally and update ADO thread status
    await markResolutionPosted(repo, prId, feedbackId);
    await updateFeedbackAdoThreadStatus(repo, prId, feedbackId, threadStatus);

    res.json({ success: true, threadId: item.adoThreadId, status: threadStatus });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Accept, dismiss, or undismiss a resolution proposal
reviewsRouter.post('/:repo/:prId/resolutions/:feedbackId/:action', async (req, res) => {
  try {
    const { repo, prId, feedbackId, action } = req.params;
    const statusMap = { accept: 'accepted', dismiss: 'dismissed', undismiss: null };
    if (!(action in statusMap)) {
      return res.status(400).json({ error: 'Action must be accept, dismiss, or undismiss' });
    }
    const edits = req.body || {};
    const result = await updateResolutionStatus(repo, prId, feedbackId, statusMap[action], edits);
    if (!result) return res.status(404).json({ error: 'Resolution proposal not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk accept all resolved proposals
reviewsRouter.post('/:repo/:prId/resolutions-accept-all', async (req, res) => {
  try {
    const { repo, prId } = req.params;
    const { verdicts } = req.body || {};
    const filter = verdicts || ['resolved'];
    const { proposals } = await readAllResolutions(repo, prId);
    const toAccept = proposals.filter(p => filter.includes(p.verdict) && p.accepted !== 'accepted' && !p.posted);
    const results = [];
    for (const p of toAccept) {
      const result = await updateResolutionStatus(repo, prId, p.feedbackId, 'accepted');
      if (result) results.push(result);
    }
    res.json({ accepted: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post all accepted resolutions to ADO
reviewsRouter.post('/:repo/:prId/resolutions-post-accepted', async (req, res) => {
  try {
    const { repo, prId } = req.params;
    const { proposals } = await readAllResolutions(repo, prId);
    const toPost = proposals.filter(p => p.accepted === 'accepted' && !p.posted);

    const review = await getReview(repo, prId);
    const results = [];
    const errors = [];

    for (const proposal of toPost) {
      try {
        const item = review.feedback.items.find(i => i.id === proposal.feedbackId);
        if (!item?.adoThreadId) {
          errors.push({ feedbackId: proposal.feedbackId, error: 'No ADO thread' });
          continue;
        }

        const replyContent = (proposal.proposedReply || 'This has been addressed.') +
          '\n\n---\n<sub>Resolution confirmed by PR Review Agent.</sub>';
        await replyToThread(repo, prId, item.adoThreadId, replyContent);
        await updateThreadStatus(repo, prId, item.adoThreadId, proposal.proposedThreadStatus || 'fixed');
        await markResolutionPosted(repo, prId, proposal.feedbackId);
        results.push({ feedbackId: proposal.feedbackId, threadId: item.adoThreadId });
      } catch (err) {
        errors.push({ feedbackId: proposal.feedbackId, error: err.message });
      }
    }

    res.json({ posted: results.length, failed: errors.length, results, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
