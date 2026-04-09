import express from 'express';
import cors from 'cors';
import { reviewsRouter } from './routes/reviews.js';
import { adoRouter } from './routes/ado.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3847;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/reviews', reviewsRouter);
app.use('/api/ado', adoRouter);

// Serve built React client in production
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PR Review Agent running at http://localhost:${PORT}`);
});
