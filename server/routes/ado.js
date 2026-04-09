import { Router } from 'express';
import { postPRComment } from '../lib/adoClient.js';
import { getReview, markFeedbackPosted, batchUpdateFeedbackStatus } from '../lib/fileStore.js';

export const adoRouter = Router();

// Post a single accepted feedback item as an ADO PR comment
adoRouter.post('/post-comment', async (req, res) => {
  try {
    const { repo, prId, feedbackId } = req.body;
    if (!repo || !prId || !feedbackId) {
      return res.status(400).json({ error: 'Must provide repo, prId, feedbackId' });
    }

    const review = await getReview(repo, prId);
    const item = review.feedback.items.find(i => i.id === feedbackId);
    if (!item) return res.status(404).json({ error: 'Feedback item not found' });
    if (item.status === 'posted') return res.status(409).json({ error: 'Already posted' });

    const result = await postPRComment(repo, prId, {
      file: item.file,
      startLine: item.startLine,
      endLine: item.endLine,
      comment: item.comment,
      suggestion: item.suggestion,
    });

    await markFeedbackPosted(repo, prId, feedbackId, result.threadId);
    res.json({ success: true, threadId: result.threadId, url: result.url });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// Post all accepted feedback items for a PR
adoRouter.post('/post-accepted', async (req, res) => {
  try {
    const { repo, prId } = req.body;
    if (!repo || !prId) {
      return res.status(400).json({ error: 'Must provide repo and prId' });
    }

    const review = await getReview(repo, prId);
    const acceptedItems = review.feedback.items.filter(i => i.status === 'accepted');

    if (acceptedItems.length === 0) {
      return res.json({ success: true, posted: 0, message: 'No accepted items to post' });
    }

    const results = [];
    const errors = [];

    for (const item of acceptedItems) {
      try {
        const result = await postPRComment(repo, prId, {
          file: item.file,
          startLine: item.startLine,
          endLine: item.endLine,
          comment: item.comment,
          suggestion: item.suggestion,
        });
        await markFeedbackPosted(repo, prId, item.id, result.threadId);
        results.push({ id: item.id, threadId: result.threadId });
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      posted: results.length,
      failed: errors.length,
      results,
      errors,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});
