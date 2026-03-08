// Happy path: create an item, log a delivery with two batches,
// then verify the batches come back sorted by expiration (FIFO).

const request = require('supertest');

process.env.NODE_ENV = 'test';

jest.mock('../server/db/setup', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      category      TEXT NOT NULL,
      unit          TEXT NOT NULL DEFAULT 'count',
      reorder_point REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT NOT NULL,
      received_date TEXT NOT NULL,
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS batches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      quantity_received   REAL NOT NULL,
      quantity_remaining  REAL NOT NULL,
      received_date       TEXT NOT NULL,
      expiration_date     TEXT NOT NULL,
      expiration_source   TEXT NOT NULL DEFAULT 'manual',
      supplier_name       TEXT,
      delivery_id         INTEGER,
      created_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS usage_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      quantity_used REAL NOT NULL,
      used_date     TEXT NOT NULL DEFAULT (date('now')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    getDb: () => db,
    initializeDatabase: () => db,
  };
});

const app = require('../server/index');

describe('Inventory — Happy Path', () => {
  let createdItemId;
  let delivery1Id, delivery2Id;

  // ── Step 1: Create a new item ───────────────────────────────────────────────
  test('POST /api/inventory — creates a new item', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Test Avocados', category: 'produce', unit: 'lbs', reorder_point: 5 });

    expect(res.status).toBe(201);
    expect(res.body.item).toBeDefined();
    expect(res.body.item.name).toBe('Test Avocados');
    expect(res.body.item.category).toBe('produce');
    createdItemId = res.body.item.id;
  });

  // ── Step 2: Log delivery with 2 batches (different expiration dates) ────────
  test('POST /api/deliveries — logs delivery with 2 batches', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        supplier_name: 'Test Farm',
        received_date: '2026-03-07',
        notes: 'Integration test delivery',
        items: [
          {
            item_id:          createdItemId,
            quantity:         10,
            expiration_date:  '2026-03-15',   // expires later
            expiration_source: 'supplier',
          },
          {
            item_id:          createdItemId,
            quantity:         8,
            expiration_date:  '2026-03-10',   // expires sooner → should be first in FIFO
            expiration_source: 'manual',
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.delivery).toBeDefined();
    expect(res.body.batches).toHaveLength(2);
    delivery1Id = res.body.delivery.id;
  });

  // ── Step 3: GET item — verify batches are FIFO ordered ──────────────────────
  test('GET /api/inventory/:id — batches returned in FIFO order (earliest expiration first)', async () => {
    const res = await request(app).get(`/api/inventory/${createdItemId}`);

    expect(res.status).toBe(200);
    expect(res.body.item).toBeDefined();
    expect(res.body.item.batches).toHaveLength(2);

    const batches = res.body.item.batches;

    // First batch should be the one expiring soonest (2026-03-10)
    expect(batches[0].expiration_date).toBe('2026-03-10');
    expect(batches[0].quantity_received).toBe(8);

    // Second batch should expire later (2026-03-15)
    expect(batches[1].expiration_date).toBe('2026-03-15');
    expect(batches[1].quantity_received).toBe(10);
  });

  // ── Step 4: Verify total stock is sum of both batches ──────────────────────
  test('GET /api/inventory/:id — total_stock sums all active batches', async () => {
    const res = await request(app).get(`/api/inventory/${createdItemId}`);
    expect(res.body.item.total_stock).toBe(18); // 10 + 8
  });

  // ── Step 5: Use item → FIFO decrements oldest batch first ──────────────────
  test('POST /api/usage — FIFO: oldest batch decremented first', async () => {
    const usageRes = await request(app)
      .post('/api/usage')
      .send({ item_id: createdItemId, quantity_used: 5 });

    expect(usageRes.status).toBe(201);
    expect(usageRes.body.usageLogs).toHaveLength(1);
    expect(usageRes.body.updatedBatches[0].quantity_remaining).toBe(3); // 8 - 5

    // Verify the oldest batch was decremented
    const inventoryRes = await request(app).get(`/api/inventory/${createdItemId}`);
    const batches = inventoryRes.body.item.batches;
    const oldest = batches.find(b => b.expiration_date === '2026-03-10');
    expect(oldest.quantity_remaining).toBe(3);
  });

  // ── Bonus: GET list with filters ───────────────────────────────────────────
  test('GET /api/inventory?category=produce — filters by category', async () => {
    const res = await request(app).get('/api/inventory?category=produce');
    expect(res.status).toBe(200);
    expect(res.body.items.every(i => i.category === 'produce')).toBe(true);
  });

  test('GET /api/inventory?search=Avocado — filters by search term', async () => {
    const res = await request(app).get('/api/inventory?search=Avocado');
    expect(res.status).toBe(200);
    expect(res.body.items.some(i => i.name.includes('Avocado'))).toBe(true);
  });

  // ── Validation ────────────────────────────────────────────────────────────
  test('POST /api/inventory with missing name → 400', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ category: 'produce' });
    expect(res.status).toBe(400);
  });

  test('POST /api/inventory with invalid category → 400', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Test Item', category: 'invalid_category' });
    expect(res.status).toBe(400);
  });

  test('GET /api/inventory/:id for non-existent item → 404', async () => {
    const res = await request(app).get('/api/inventory/999999');
    expect(res.status).toBe(404);
  });

  test('DELETE /api/inventory/:id — removes item', async () => {
    const res = await request(app).delete(`/api/inventory/${createdItemId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
