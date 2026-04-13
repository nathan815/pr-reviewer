import { Router } from 'express';
import {
  getLearningStats,
  getLearningExamples,
  deleteLearningExample,
  getGuidelines,
  listRepoGuidelines,
  getExamplesSinceLearning,
  markLearningComplete,
} from '../lib/fileStore.js';
import { launchLearningAgent, getLearningStatus } from '../lib/agentLauncher.js';

export const learningsRouter = Router();

// Get learning stats
learningsRouter.get('/stats', async (_req, res) => {
  try {
    const stats = await getLearningStats();
    const newExamples = await getExamplesSinceLearning();
    stats.newSinceLearning = newExamples.length;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all examples
learningsRouter.get('/examples', async (_req, res) => {
  try {
    const examples = await getLearningExamples();
    res.json(examples);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current guidelines (global + per-repo)
learningsRouter.get('/guidelines', async (req, res) => {
  try {
    const { repo } = req.query;
    const { global: globalGuidelines, perRepo } = await getGuidelines(repo);
    const repos = await listRepoGuidelines();
    res.json({ global: globalGuidelines, perRepo, reposWithGuidelines: repos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Launch learning agent
learningsRouter.post('/learn', async (_req, res) => {
  try {
    const result = await launchLearningAgent();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get learning agent status
learningsRouter.get('/learn/status', async (_req, res) => {
  try {
    const status = getLearningStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a single signal
learningsRouter.delete('/examples', async (req, res) => {
  try {
    const { repo, prId, feedbackId, timestamp } = req.body;
    if (!repo || !prId || !feedbackId || !timestamp) {
      return res.status(400).json({ error: 'repo, prId, feedbackId, and timestamp are required' });
    }
    await deleteLearningExample(repo, prId, feedbackId, timestamp);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
