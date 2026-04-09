import { Router } from 'express';
import { launchReviewAgent, getAgentStatuses, getConfig, setActiveProfile } from '../lib/agentLauncher.js';

export const agentRouter = Router();

// Launch a review agent for a PR URL
agentRouter.post('/launch', async (req, res) => {
  try {
    const { prUrl } = req.body;
    if (!prUrl) return res.status(400).json({ error: 'Must provide prUrl' });

    const result = await launchReviewAgent(prUrl);
    const status = result.status === 'already_running' ? 409 : 201;
    res.status(status).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get status of all running/completed agents
agentRouter.get('/status', (_req, res) => {
  res.json(getAgentStatuses());
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
