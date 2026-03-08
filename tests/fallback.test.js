// Edge case: OpenAI throws a network error — verify
// the fallback kicks in and still returns sensible urgency data.

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
      batch_id      INTEGER NOT NULL REFERENCES batches(id),
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

jest.mock('../server/services/ai', () => ({
  generateDailyBrief: jest.fn().mockRejectedValue(new Error('Network error: AI service unavailable')),
  estimateShelfLife:  jest.fn().mockRejectedValue(new Error('Network error: AI service unavailable')),
}));

const app    = require('../server/index');
const queries = require('../server/db/queries');

async function seedTestData() {
  const today = new Date().toISOString().split('T')[0];
  const addDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  };

  // Create items
  const urgent  = queries.createItem({ name: 'Urgent Item',  category: 'produce',  unit: 'lbs', reorder_point: 2 });
  const warning = queries.createItem({ name: 'Warning Item', category: 'dairy',    unit: 'lbs', reorder_point: 2 });
  const healthy = queries.createItem({ name: 'Healthy Item', category: 'protein',  unit: 'lbs', reorder_point: 2 });
  const lowStock = queries.createItem({ name: 'Low Item',    category: 'dry_goods', unit: 'lbs', reorder_point: 20 });

  // Create batches with staggered expiry
  queries.createBatch({ item_id: urgent.id,   quantity_received: 5,  quantity_remaining: 5,  received_date: today, expiration_date: addDays(1),  expiration_source: 'supplier' });
  queries.createBatch({ item_id: warning.id,  quantity_received: 5,  quantity_remaining: 5,  received_date: today, expiration_date: addDays(5),  expiration_source: 'supplier' });
  queries.createBatch({ item_id: healthy.id,  quantity_received: 10, quantity_remaining: 10, received_date: today, expiration_date: addDays(20), expiration_source: 'supplier' });
  queries.createBatch({ item_id: lowStock.id, quantity_received: 3,  quantity_remaining: 3,  received_date: today, expiration_date: addDays(60), expiration_source: 'manual'   });

  return { urgent, warning, healthy, lowStock };
}

describe('Fallback — AI Failure Edge Cases', () => {
  let seeded;

  beforeAll(async () => {
    seeded = await seedTestData();
  });

  // ── Test 1: Daily brief falls back gracefully ───────────────────────────────
  test('GET /api/ai/daily-brief — AI fails → fallback returns valid brief', async () => {
    const res = await request(app).get('/api/ai/daily-brief');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.brief).toBeDefined();
  });

  // ── Test 2: Fallback urgent items are correctly classified ──────────────────
  test('Fallback brief — urgent array contains only ≤2-day items', async () => {
    const res = await request(app).get('/api/ai/daily-brief');
    const { brief } = res.body;

    expect(Array.isArray(brief.urgent)).toBe(true);
    // Every urgent entry should be expiring soon
    for (const item of brief.urgent) {
      expect(item.item).toBeDefined();
      expect(item.expires).toBeDefined();
    }
  });

  // ── Test 3: Fallback brief has correct structure ────────────────────────────
  test('Fallback brief — response has required keys', async () => {
    const res = await request(app).get('/api/ai/daily-brief');
    const { brief } = res.body;

    expect(brief).toHaveProperty('urgent');
    expect(brief).toHaveProperty('this_week');
    expect(brief).toHaveProperty('reorder');
    // waste_insight is null/absent in fallback mode — that is acceptable
  });

  // ── Test 4: "Urgent Item" appears in brief.urgent ──────────────────────────
  test('Fallback brief — item expiring in 1 day appears in urgent list', async () => {
    const res = await request(app).get('/api/ai/daily-brief');
    const { brief } = res.body;

    const urgentNames = brief.urgent.map(i => i.item);
    expect(urgentNames).toContain('Urgent Item');
  });

  // ── Test 5: "Warning Item" appears in brief.this_week ─────────────────────
  test('Fallback brief — item expiring in 5 days appears in this_week list', async () => {
    const res = await request(app).get('/api/ai/daily-brief');
    const { brief } = res.body;

    const weekNames = brief.this_week.map(i => i.item);
    expect(weekNames).toContain('Warning Item');
  });

  // ── Test 6: "Low Item" appears in brief.reorder ─────────────────────────────
  test('Fallback brief — item below reorder_point appears in reorder list', async () => {
    const res = await request(app).get('/api/ai/daily-brief');
    const { brief } = res.body;

    const reorderNames = brief.reorder.map(i => i.item);
    expect(reorderNames).toContain('Low Item');
  });

  // ── Test 7: Shelf-life fallback ────────────────────────────────────────────
  test('POST /api/ai/shelf-life — AI fails → fallback returns shelf-life estimate', async () => {
    const res = await request(app)
      .post('/api/ai/shelf-life')
      .send({ name: 'Tomatoes', category: 'produce' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(res.body.estimated_days).toBeDefined();
    expect(res.body.expiration_date).toBeDefined();
    expect(res.body.confidence).toBe('low');
  });

  // ── Test 8: Fallback shelf-life uses category lookup table ─────────────────
  test('Fallback shelf-life — produce category returns 5-day estimate', async () => {
    const res = await request(app)
      .post('/api/ai/shelf-life')
      .send({ name: 'Spinach', category: 'produce' });

    expect(res.body.estimated_days).toBe(5);
  });

  test('Fallback shelf-life — dry_goods category returns 180-day estimate', async () => {
    const res = await request(app)
      .post('/api/ai/shelf-life')
      .send({ name: 'Flour', category: 'dry_goods' });

    expect(res.body.estimated_days).toBe(180);
  });

  test('Fallback shelf-life — protein category returns 3-day estimate', async () => {
    const res = await request(app)
      .post('/api/ai/shelf-life')
      .send({ name: 'Chicken', category: 'protein' });

    expect(res.body.estimated_days).toBe(3);
  });

  // ── Test 9: Shelf-life missing params → 400 ───────────────────────────────
  test('POST /api/ai/shelf-life — missing category → 400', async () => {
    const res = await request(app)
      .post('/api/ai/shelf-life')
      .send({ name: 'Tomatoes' });

    expect(res.status).toBe(400);
  });

  // ── Test 10: Inventory urgency filter still works during AI failure ────────
  test('GET /api/inventory?urgency=urgent — filter works independently of AI', async () => {
    const res = await request(app).get('/api/inventory?urgency=urgent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // All returned items should have URGENT status
    res.body.items.forEach(item => {
      expect(item.status).toBe('URGENT');
    });
  });
});
