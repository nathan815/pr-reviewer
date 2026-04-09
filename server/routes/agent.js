import { Router } from 'express';
import { launchReviewAgent, getAgentStatuses, getAgentOutput, killAgent, getConfig, setActiveProfile, saveConfig } from '../lib/agentLauncher.js';

export const agentRouter = Router();

// Launch a review agent for a PR URL
agentRouter.post('/launch', async (req, res) => {
  try {
    const { prUrl, force } = req.body;
    if (!prUrl) return res.status(400).json({ error: 'Must provide prUrl' });

    const result = await launchReviewAgent(prUrl, { force: !!force });
    const statusCode = result.status === 'already_running' || result.status === 'locked' ? 409 : 201;
    res.status(statusCode).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Kill a running agent
agentRouter.post('/kill/:repo/:prId', async (req, res) => {
  try {
    const result = await killAgent(req.params.repo, req.params.prId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get status of all running/completed agents
agentRouter.get('/status', (_req, res) => {
  res.json(getAgentStatuses());
});

// Get full output for a specific agent
agentRouter.get('/output/:repo/:prId', async (req, res) => {
  const output = await getAgentOutput(req.params.repo, req.params.prId);
  if (!output) return res.status(404).json({ error: 'No agent found for this PR' });
  res.json(output);
});

// Get config (profiles)
agentRouter.get('/config', async (_req, res) => {
  try {
    const config = await getConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Switch active profile
agentRouter.patch('/config/profile', async (req, res) => {
  try {
    const { profile } = req.body;
    if (!profile) return res.status(400).json({ error: 'Must provide profile name' });
    const config = await setActiveProfile(profile);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Save full config (profiles + activeProfile)
agentRouter.put('/config', async (req, res) => {
  try {
    const config = await saveConfig(req.body);
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
