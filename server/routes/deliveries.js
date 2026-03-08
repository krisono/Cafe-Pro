const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const { validateDelivery } = require('../middleware/validation');

router.get('/', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const deliveries = queries.getDeliveries(limit);
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', validateDelivery, (req, res) => {
  try {
    const { supplier_name, received_date, notes, items } = req.body;

    const delivery = queries.createDelivery({ supplier_name, received_date, notes });

    // one per item
    const batches = items.map(it =>
      queries.createBatch({
        item_id: it.item_id,
        quantity_received: it.quantity,
        quantity_remaining: it.quantity,
        received_date,
        expiration_date: it.expiration_date,
        expiration_source: it.expiration_source || 'manual',
        supplier_name,
        delivery_id: delivery.id,
      })
    );

    res.status(201).json({ delivery, batches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
