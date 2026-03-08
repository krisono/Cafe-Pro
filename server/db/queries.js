const { getDb } = require('./setup');

function getAllItems({ category, search } = {}) {
  const db = getDb();
  let sql = `
    SELECT
      i.id,
      i.name,
      i.category,
      i.unit,
      i.reorder_point,
      i.created_at,
      COALESCE(SUM(b.quantity_remaining), 0) AS total_stock,
      MIN(b.expiration_date)                  AS oldest_expiration
    FROM items i
    LEFT JOIN batches b ON b.item_id = i.id AND b.quantity_remaining > 0
  `;
  const params = [];
  const where = [];
  if (category) { where.push(`i.category = ?`); params.push(category); }
  if (search)   { where.push(`i.name LIKE ?`);  params.push(`%${search}%`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` GROUP BY i.id ORDER BY i.name`;
  return db.prepare(sql).all(...params);
}

function getItemById(id) {
  const db = getDb();
  const item = db.prepare(`
    SELECT i.*, COALESCE(SUM(b.quantity_remaining), 0) AS total_stock
    FROM items i
    LEFT JOIN batches b ON b.item_id = i.id AND b.quantity_remaining > 0
    WHERE i.id = ?
    GROUP BY i.id
  `).get(id);
  if (!item) return null;
  item.batches = getBatchesForItem(id);
  return item;
}

function createItem({ name, category, unit, reorder_point }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO items (name, category, unit, reorder_point)
    VALUES (?, ?, ?, ?)
  `).run(name, category, unit || 'count', reorder_point || 0);
  return getItemById(result.lastInsertRowid);
}

function updateItem(id, { name, category, unit, reorder_point }) {
  const db = getDb();
  const fields = [];
  const params = [];
  if (name !== undefined)          { fields.push('name = ?');          params.push(name); }
  if (category !== undefined)      { fields.push('category = ?');      params.push(category); }
  if (unit !== undefined)          { fields.push('unit = ?');           params.push(unit); }
  if (reorder_point !== undefined) { fields.push('reorder_point = ?'); params.push(reorder_point); }
  if (!fields.length) return getItemById(id);
  params.push(id);
  db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getItemById(id);
}

function deleteItem(id) {
  const db = getDb();
  const result = db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
  return result.changes > 0;
}

function getBatchesForItem(itemId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM batches
    WHERE item_id = ?
    ORDER BY expiration_date ASC, received_date ASC
  `).all(itemId);
}

function createBatch({ item_id, quantity_received, quantity_remaining, received_date, expiration_date, expiration_source, supplier_name, delivery_id }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO batches (item_id, quantity_received, quantity_remaining, received_date, expiration_date, expiration_source, supplier_name, delivery_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(item_id, quantity_received, quantity_remaining ?? quantity_received, received_date, expiration_date, expiration_source || 'manual', supplier_name || null, delivery_id || null);
  return db.prepare('SELECT * FROM batches WHERE id = ?').get(result.lastInsertRowid);
}

function getOldestBatchWithStock(itemId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM batches
    WHERE item_id = ? AND quantity_remaining > 0
    ORDER BY expiration_date ASC, received_date ASC
    LIMIT 1
  `).get(itemId);
}

function decrementBatch(batchId, amountUsed) {
  const db = getDb();
  db.prepare(`
    UPDATE batches
    SET quantity_remaining = quantity_remaining - ?
    WHERE id = ?
  `).run(amountUsed, batchId);
  return db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
}

function getDeliveries(limit = 50) {
  const db = getDb();
  const deliveries = db.prepare(`
    SELECT d.*, COUNT(b.id) AS batch_count
    FROM deliveries d
    LEFT JOIN batches b ON b.delivery_id = d.id
    GROUP BY d.id
    ORDER BY d.received_date DESC, d.id DESC
    LIMIT ?
  `).all(limit);

  const getBatches = db.prepare(`
    SELECT b.*, i.name AS item_name, i.unit
    FROM batches b
    JOIN items i ON i.id = b.item_id
    WHERE b.delivery_id = ?
    ORDER BY b.expiration_date ASC
  `);

  return deliveries.map(d => ({ ...d, batches: getBatches.all(d.id) }));
}

function createDelivery({ supplier_name, received_date, notes }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO deliveries (supplier_name, received_date, notes)
    VALUES (?, ?, ?)
  `).run(supplier_name, received_date, notes || null);
  return db.prepare('SELECT * FROM deliveries WHERE id = ?').get(result.lastInsertRowid);
}

function getDeliveryById(id) {
  return getDb().prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
}

function updateBatchExpiry(batchId, expiration_date) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE batches SET expiration_date = ?, expiration_source = 'manual' WHERE id = ?
  `).run(expiration_date, batchId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
}

function updateBatchQuantity(batchId, quantity_remaining) {
  const db = getDb();
  const result = db.prepare(`
    UPDATE batches SET quantity_remaining = ? WHERE id = ?
  `).run(quantity_remaining, batchId);
  if (result.changes === 0) return null;
  return db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
}

function logUsage({ batch_id, quantity_used, used_date }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO usage_log (batch_id, quantity_used, used_date)
    VALUES (?, ?, ?)
  `).run(batch_id, quantity_used, used_date || new Date().toISOString().split('T')[0]);
  return db.prepare('SELECT * FROM usage_log WHERE id = ?').get(result.lastInsertRowid);
}

function getRecentUsage(days = 30) {
  const db = getDb();
  return db.prepare(`
    SELECT u.*, b.item_id, i.name AS item_name
    FROM usage_log u
    JOIN batches b ON b.id = u.batch_id
    JOIN items i ON i.id = b.item_id
    WHERE u.used_date >= date('now', ?)
    ORDER BY u.used_date DESC
  `).all(`-${days} days`);
}

function getInventorySnapshot() {
  const db = getDb();
  const items = db.prepare(`
    SELECT
      i.id, i.name, i.category, i.unit, i.reorder_point,
      COALESCE(SUM(b.quantity_remaining), 0) AS total_stock,
      MIN(b.expiration_date)                  AS oldest_expiration
    FROM items i
    LEFT JOIN batches b ON b.item_id = i.id AND b.quantity_remaining > 0
    GROUP BY i.id
    ORDER BY oldest_expiration ASC
  `).all();

  const urgentBatches = db.prepare(`
    SELECT b.*, i.name AS item_name, i.category, i.unit
    FROM batches b
    JOIN items i ON i.id = b.item_id
    WHERE b.quantity_remaining > 0
      AND b.expiration_date <= date('now', '+7 days')
    ORDER BY b.expiration_date ASC
  `).all();

  const recentUsage = getRecentUsage(14);

  return { items, urgentBatches, recentUsage };
}

module.exports = {
  getAllItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  getBatchesForItem,
  createBatch,
  updateBatchExpiry,
  updateBatchQuantity,
  getOldestBatchWithStock,
  decrementBatch,
  createDelivery,
  getDeliveries,
  getDeliveryById,
  logUsage,
  getRecentUsage,
  getInventorySnapshot,
};
