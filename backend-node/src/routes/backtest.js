import express from 'express';

const router = express.Router();

router.post('/', (req, res) => {
  const { closes = [], initialCapital = 10000000 } = req.body;
  if (!Array.isArray(closes) || closes.length < 10) {
    return res.status(400).json({ error: 'closes array must contain at least 10 values' });
  }

  let cash = Number(initialCapital);
  let shares = 0;

  for (let i = 5; i < closes.length; i += 1) {
    const shortMa = closes.slice(i - 5, i).reduce((a, b) => a + b, 0) / 5;
    const longMa = closes.slice(i - 10, i).reduce((a, b) => a + b, 0) / 10;
    const price = closes[i];

    if (shortMa > longMa && cash > price) {
      const qty = Math.floor(cash / price);
      shares += qty;
      cash -= qty * price;
    } else if (shortMa < longMa && shares > 0) {
      cash += shares * price;
      shares = 0;
    }
  }

  const finalValue = cash + shares * closes[closes.length - 1];
  const totalReturnPct = ((finalValue - initialCapital) / initialCapital) * 100;

  return res.json({
    initialCapital,
    finalValue,
    totalReturnPct
  });
});

export default router;
