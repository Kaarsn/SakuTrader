import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const portfolios = new Map();

router.use(requireAuth);

router.get('/', (req, res) => {
  const data = portfolios.get(req.user.email) || [];
  res.json({ items: data });
});

router.post('/', (req, res) => {
  const { ticker, quantity, avgPrice } = req.body;
  if (!ticker || !quantity || !avgPrice) {
    return res.status(400).json({ error: 'ticker, quantity, and avgPrice are required' });
  }

  const items = portfolios.get(req.user.email) || [];
  items.push({ ticker, quantity: Number(quantity), avgPrice: Number(avgPrice) });
  portfolios.set(req.user.email, items);

  return res.status(201).json({ items });
});

export default router;
