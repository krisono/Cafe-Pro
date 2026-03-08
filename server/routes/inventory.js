const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { validateItem } = require('../middleware/validation');

router.get('/', (req, res) => {
  try {
    const { category, search, urgency } = req.query;
    let items = queries.getAllItems({ category, search });
    const today = new Date().toISOString().split('T')[0];

    items = items.map(item => ({
      ...item,
      status: getStatus(item, today),
    }));

    if (urgency) {
      const map = { urgent: 'URGENT', warning: 'WARNING', healthy: 'HEALTHY', low: 'LOW' };
      const target = map[urgency.toLowerCase()];
      if (target) items = items.filter(i => i.status === target);
    }

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const item = queries.getItemById(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const today = new Date().toISOString().split('T')[0];
    item.status = getStatus(item, today);
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', validateItem, (req, res) => {
  try {
    const item = queries.createItem(req.body);
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', validateItem, (req, res) => {
  try {
    const item = queries.updateItem(Number(req.params.id), req.body);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const deleted = queries.deleteItem(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/batches', (req, res) => {
  try {
    const item_id = Number(req.params.id);
    const { quantity, expiration_date, received_date } = req.body;
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    if (!quantity || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive' });
    }
    if (!expiration_date || !ISO_DATE.test(expiration_date)) {
      return res.status(400).json({ error: 'expiration_date must be a valid ISO date (YYYY-MM-DD)' });
    }

    const item = queries.getItemById(item_id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const batch = queries.createBatch({
      item_id,
      quantity_received: Number(quantity),
      quantity_remaining: Number(quantity),
      received_date: received_date || new Date().toISOString().split('T')[0],
      expiration_date,
      expiration_source: 'manual',
      supplier_name: null,
      delivery_id: null,
    });

    res.status(201).json({ batch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update expiration date and/or quantity_remaining on a specific batch
router.patch('/batches/:batchId', (req, res) => {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const { expiration_date, quantity_remaining } = req.body;

  if (expiration_date !== undefined && !ISO_DATE.test(expiration_date)) {
    return res.status(400).json({ error: 'expiration_date must be a valid ISO date (YYYY-MM-DD)' });
  }
  if (quantity_remaining !== undefined && (isNaN(Number(quantity_remaining)) || Number(quantity_remaining) < 0)) {
    return res.status(400).json({ error: 'quantity_remaining must be a non-negative number' });
  }
  if (expiration_date === undefined && quantity_remaining === undefined) {
    return res.status(400).json({ error: 'Provide expiration_date or quantity_remaining to update' });
  }

  try {
    const batchId = Number(req.params.batchId);
    let batch;
    if (expiration_date !== undefined) {
      batch = queries.updateBatchExpiry(batchId, expiration_date);
    }
    if (quantity_remaining !== undefined) {
      batch = queries.updateBatchQuantity(batchId, Number(quantity_remaining));
    }
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    res.json({ batch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getStatus(item, today) {
  if (!item.oldest_expiration) return item.total_stock < item.reorder_point ? 'LOW' : 'HEALTHY';
  const diff = daysBetween(today, item.oldest_expiration);
  if (diff <= 2)  return 'URGENT';
  if (diff <= 7)  return 'WARNING';
  if (item.total_stock < item.reorder_point) return 'LOW';
  return 'HEALTHY';
}

function daysBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  return Math.ceil((b - a) / (1000 * 60 * 60 * 24));
}

module.exports = router;
