import { Router } from 'express';
import {
  listAllReviews,
  getReview,
  updateFeedbackStatus,
  batchUpdateFeedbackStatus,
  readFileAtCommit,
  getExamplesSinceCuration,
  updateMetadata,
} from '../lib/fileStore.js';
import { getPRDetails } from '../lib/adoClient.js';
import { launchCurationAgent, getCurationStatus } from '../lib/agentLauncher.js';

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

// Fetch live PR info from ADO and sync metadata
reviewsRouter.get('/:repo/:prId/ado-info', async (req, res) => {
  try {
    const { repo, prId } = req.params;
    const pr = await getPRDetails(repo, prId);

    const prStatus = pr.status === 3 ? 'completed'
      : pr.status === 2 ? 'abandoned'
      : pr.status === 1 ? 'active'
      : 'unknown';

    const mergeStatus = pr.mergeStatus === 3 ? 'succeeded'
      : pr.mergeStatus === 2 ? 'conflicts'
      : pr.mergeStatus === 1 ? 'queued'
      : null;

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
