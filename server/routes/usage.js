const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { validateUsage } = require('../middleware/validation');

router.post('/', validateUsage, (req, res) => {
  try {
    const { item_id, quantity_used, used_date } = req.body;

    let remaining = Number(quantity_used);
    const usageLogs = [];
    const updatedBatches = [];

    // oldest expiry date goes first especially when dealig woth cold perishable items
    while (remaining > 0) {
      const batch = queries.getOldestBatchWithStock(item_id);
      if (!batch) {
        return res.status(422).json({
          error: 'Insufficient stock',
          message: `Only ${Number(quantity_used) - remaining} units available`,
        });
      }

      const consume = Math.min(remaining, batch.quantity_remaining);
      const updatedBatch = queries.decrementBatch(batch.id, consume);
      const log = queries.logUsage({
        batch_id: batch.id,
        quantity_used: consume,
        used_date: used_date || new Date().toISOString().split('T')[0],
      });

      usageLogs.push(log);
      updatedBatches.push(updatedBatch);
      remaining -= consume;
    }

    res.status(201).json({ usageLogs, updatedBatches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
