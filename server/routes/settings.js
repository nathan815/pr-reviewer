import { Router } from 'express';
import { getExtraInstructions, setExtraInstructions } from '../lib/fileStore.js';

export const settingsRouter = Router();

settingsRouter.get('/extra-instructions', async (_req, res) => {
  try {
    const content = await getExtraInstructions();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

settingsRouter.put('/extra-instructions', async (req, res) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    await setExtraInstructions(content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
