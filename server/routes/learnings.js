import { Router } from 'express';
import {
  getLearningStats,
  getLearningExamples,
  deleteLearningExample,
  getGuidelines,
  listRepoGuidelines,
  getExamplesSinceCuration,
  markCurationComplete,
} from '../lib/fileStore.js';
import { launchCurationAgent, getCurationStatus } from '../lib/agentLauncher.js';

export const learningsRouter = Router();

// Get learning stats
learningsRouter.get('/stats', async (_req, res) => {
  try {
    const stats = await getLearningStats();
    const newExamples = await getExamplesSinceCuration();
    stats.newSinceCuration = newExamples.length;
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

// Launch curation agent
learningsRouter.post('/curate', async (_req, res) => {
  try {
    const result = await launchCurationAgent();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get curation agent status
learningsRouter.get('/curate/status', async (_req, res) => {
  try {
    const status = getCurationStatus();
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
