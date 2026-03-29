import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import analyzeRoutes from './routes/analyze.js';
import authRoutes from './routes/auth.js';
import portfolioRoutes from './routes/portfolio.js';
import backtestRoutes from './routes/backtest.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stock-ai-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/analysis', analyzeRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/backtest', backtestRoutes);

app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${port}`);
});
