import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import analyzeRoutes from './routes/analyze.js';
import authRoutes from './routes/auth.js';
import portfolioRoutes from './routes/portfolio.js';
import backtestRoutes from './routes/backtest.js';
import { getArticleById } from './services/newsService.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const isDevelopment = process.env.NODE_ENV !== 'production';

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: isDevelopment ? 2000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDevelopment && isLocalRequest(req)
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stock-ai-backend' });
});

// Endpoint untuk read full article
app.get('/api/news/:articleId', (req, res) => {
  const { articleId } = req.params;
  const article = getArticleById(articleId);
  
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  
  res.json(article);
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
