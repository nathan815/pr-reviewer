import { Router } from 'express';
import {
  listAllReviews,
  getReview,
  updateFeedbackStatus,
  batchUpdateFeedbackStatus,
  readFileAtCommit,
  getExamplesSinceCuration,
} from '../lib/fileStore.js';
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

// Update a single feedback item's status
reviewsRouter.patch('/:repo/:prId/feedback/:feedbackId', async (req, res) => {
  try {
    const { status, userNote } = req.body;
    if (!['pending', 'accepted', 'rejected', 'posted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: pending, accepted, rejected, posted' });
    }
    const item = await updateFeedbackStatus(
      req.params.repo, req.params.prId, req.params.feedbackId, status, userNote
    );
    res.json(item);

    // Check auto-curation threshold (fire-and-forget)
    if (status === 'accepted' || status === 'rejected') {
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
