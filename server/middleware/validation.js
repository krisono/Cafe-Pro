const VALID_CATEGORIES = ['produce', 'dairy', 'protein', 'dry_goods', 'beverages'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── helpers ──────────────────────────────────────────────────────────────────
function isPositiveNumber(v) {
  return v !== undefined && v !== null && v !== '' && Number(v) > 0 && isFinite(Number(v));
}
function isNonNegativeNumber(v) {
  return v !== undefined && v !== null && v !== '' && Number(v) >= 0 && isFinite(Number(v));
}
function isInteger(v) {
  return Number.isInteger(Number(v));
}

// ── POST / PUT /api/inventory ─────────────────────────────────────────────────
function validateItem(req, res, next) {
  const { name, category, unit, reorder_point } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required and must be a non-empty string' });
  }
  if (!category || !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: `category is required and must be one of: ${VALID_CATEGORIES.join(', ')}`,
    });
  }
  if (unit !== undefined && (typeof unit !== 'string' || !unit.trim())) {
    return res.status(400).json({ error: 'unit must be a non-empty string' });
  }
  if (reorder_point !== undefined && !isNonNegativeNumber(reorder_point)) {
    return res.status(400).json({ error: 'reorder_point must be a non-negative number' });
  }

  req.body.name = name.trim();
  next();
}

// ── POST /api/deliveries ─────────────────────────────────────────────────────
function validateDelivery(req, res, next) {
  const { supplier_name, received_date, items } = req.body;

  if (!supplier_name || typeof supplier_name !== 'string' || !supplier_name.trim()) {
    return res.status(400).json({ error: 'supplier_name is required and must be a non-empty string' });
  }
  if (!received_date || !ISO_DATE.test(received_date)) {
    return res.status(400).json({ error: 'received_date is required and must be a valid ISO date (YYYY-MM-DD)' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }

  for (const [i, it] of items.entries()) {
    if (!it.item_id || !isInteger(it.item_id)) {
      return res.status(400).json({ error: `items[${i}].item_id is required and must be an integer` });
    }
    if (!isPositiveNumber(it.quantity)) {
      return res.status(400).json({ error: `items[${i}].quantity must be a positive number` });
    }
    if (!it.expiration_date || !ISO_DATE.test(it.expiration_date)) {
      return res.status(400).json({ error: `items[${i}].expiration_date must be a valid ISO date (YYYY-MM-DD)` });
    }
  }

  req.body.supplier_name = supplier_name.trim();
  next();
}

// ── POST /api/usage ───────────────────────────────────────────────────────────
function validateUsage(req, res, next) {
  const { item_id, quantity_used } = req.body;

  if (!item_id || !isInteger(item_id)) {
    return res.status(400).json({ error: 'item_id is required and must be an integer' });
  }
  if (!isPositiveNumber(quantity_used)) {
    return res.status(400).json({ error: 'quantity_used must be a positive number' });
  }

  next();
}

// ── POST /api/batches (standalone) ───────────────────────────────────────────
function validateBatch(req, res, next) {
  const { item_id, quantity_received, expiration_date } = req.body;

  if (!item_id || !isInteger(item_id)) {
    return res.status(400).json({ error: 'item_id is required and must be an integer' });
  }
  if (!isPositiveNumber(quantity_received)) {
    return res.status(400).json({ error: 'quantity_received must be a positive number' });
  }
  if (!expiration_date || !ISO_DATE.test(expiration_date)) {
    return res.status(400).json({ error: 'expiration_date must be a valid ISO date (YYYY-MM-DD)' });
  }
  next();
}

module.exports = { validateItem, validateBatch, validateDelivery, validateUsage };
