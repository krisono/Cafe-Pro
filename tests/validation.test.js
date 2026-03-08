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

  return { getDb: () => db, initializeDatabase: () => db };
});

const app = require('../server/index');

describe('Happy Path — complete create → deliver → use workflow', () => {
  let itemId;

  test('POST /api/inventory — valid item is created (201)', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Oat Milk', category: 'beverages', unit: 'gallons', reorder_point: 3 });

    expect(res.status).toBe(201);
    expect(res.body.item.name).toBe('Oat Milk');
    expect(res.body.item.unit).toBe('gallons');
    expect(res.body.item.reorder_point).toBe(3);
    itemId = res.body.item.id;
  });

  test('PUT /api/inventory/:id — valid update is accepted (200)', async () => {
    const res = await request(app)
      .put(`/api/inventory/${itemId}`)
      .send({ name: 'Oat Milk', category: 'beverages', unit: 'gallons', reorder_point: 5 });

    expect(res.status).toBe(200);
    expect(res.body.item.reorder_point).toBe(5);
  });

  test('POST /api/deliveries — valid delivery with correct dates and positive qty (201)', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        supplier_name: 'Beverage Hub',
        received_date: '2026-03-08',
        notes: 'Weekly restock',
        items: [
          { item_id: itemId, quantity: 6, expiration_date: '2026-04-08', expiration_source: 'supplier' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.delivery.supplier_name).toBe('Beverage Hub');
    expect(res.body.batches).toHaveLength(1);
    expect(res.body.batches[0].quantity_remaining).toBe(6);
  });

  test('POST /api/usage — valid usage decrements stock (201)', async () => {
    const res = await request(app)
      .post('/api/usage')
      .send({ item_id: itemId, quantity_used: 2 });

    expect(res.status).toBe(201);
    expect(res.body.usageLogs).toHaveLength(1);
    expect(res.body.updatedBatches[0].quantity_remaining).toBe(4);
  });
});

describe('Edge Cases — input validation rejects bad data with 400', () => {
  test('POST /api/inventory — missing name → 400 with message', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ category: 'produce' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
  });

  test('POST /api/inventory — invalid category → 400 with message', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Widget', category: 'junk_food' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  test('POST /api/inventory — negative reorder_point → 400', async () => {
    const res = await request(app)
      .post('/api/inventory')
      .send({ name: 'Butter', category: 'dairy', reorder_point: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reorder_point/);
  });

  test('PUT /api/inventory/:id — invalid category → 400', async () => {
    const res = await request(app)
      .put('/api/inventory/1')
      .send({ name: 'Butter', category: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  test('POST /api/deliveries — missing supplier_name → 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({ received_date: '2026-03-08', items: [{ item_id: 1, quantity: 5, expiration_date: '2026-04-01' }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/supplier_name/);
  });

  test('POST /api/deliveries — malformed received_date → 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        supplier_name: 'Test Co',
        received_date: '08-03-2026',
        items: [{ item_id: 1, quantity: 5, expiration_date: '2026-04-01' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/received_date/);
  });

  test('POST /api/deliveries — item quantity ≤ 0 → 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        supplier_name: 'Test Co',
        received_date: '2026-03-08',
        items: [{ item_id: 1, quantity: -3, expiration_date: '2026-04-01' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity/);
  });

  test('POST /api/deliveries — item expiration_date in wrong format → 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({
        supplier_name: 'Test Co',
        received_date: '2026-03-08',
        items: [{ item_id: 1, quantity: 5, expiration_date: 'April 1st 2026' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expiration_date/);
  });

  test('POST /api/deliveries — empty items array → 400', async () => {
    const res = await request(app)
      .post('/api/deliveries')
      .send({ supplier_name: 'Test Co', received_date: '2026-03-08', items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/items/);
  });

  test('POST /api/usage — missing item_id → 400', async () => {
    const res = await request(app)
      .post('/api/usage')
      .send({ quantity_used: 2 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/item_id/);
  });

  test('POST /api/usage — negative quantity_used → 400', async () => {
    const res = await request(app)
      .post('/api/usage')
      .send({ item_id: 1, quantity_used: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity_used/);
  });

  test('POST /api/usage — quantity_used of zero → 400', async () => {
    const res = await request(app)
      .post('/api/usage')
      .send({ item_id: 1, quantity_used: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity_used/);
  });

  test('GET /api/inventory/:id — non-existent id → 404 with message', async () => {
    const res = await request(app).get('/api/inventory/999999');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Item not found');
  });
});
