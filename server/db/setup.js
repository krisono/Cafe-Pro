const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'cafe-pro.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      category     TEXT    NOT NULL CHECK(category IN ('produce','dairy','protein','dry_goods','beverages')),
      unit         TEXT    NOT NULL DEFAULT 'count',
      reorder_point REAL   NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT    NOT NULL,
      received_date TEXT    NOT NULL,
      notes         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batches (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id             INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      quantity_received   REAL    NOT NULL,
      quantity_remaining  REAL    NOT NULL,
      received_date       TEXT    NOT NULL,
      expiration_date     TEXT    NOT NULL,
      expiration_source   TEXT    NOT NULL DEFAULT 'manual' CHECK(expiration_source IN ('supplier','ai_suggested','manual')),
      supplier_name       TEXT,
      delivery_id         INTEGER REFERENCES deliveries(id) ON DELETE SET NULL,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id      INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      quantity_used REAL    NOT NULL,
      used_date     TEXT    NOT NULL DEFAULT (date('now')),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // first run — load the seed file so there's something to look at
  const itemCount = database.prepare('SELECT COUNT(*) as count FROM items').get();
  if (itemCount.count === 0) {
    seedDatabase(database);
    console.log('Database seeded with initial data.');
  }

  console.log('Database initialized.');
  return database;
}

function seedDatabase(database) {
  const seedPath = path.join(__dirname, '..', '..', 'data', 'seed-inventory.json');
  if (!fs.existsSync(seedPath)) {
    console.warn('Seed file not found, skipping seed.');
    return;
  }

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insertItem = database.prepare(`
    INSERT INTO items (name, category, unit, reorder_point, created_at)
    VALUES (@name, @category, @unit, @reorder_point, @created_at)
  `);

  const insertDelivery = database.prepare(`
    INSERT INTO deliveries (supplier_name, received_date, notes, created_at)
    VALUES (@supplier_name, @received_date, @notes, @created_at)
  `);

  const insertBatch = database.prepare(`
    INSERT INTO batches (item_id, quantity_received, quantity_remaining, received_date, expiration_date, expiration_source, supplier_name, delivery_id, created_at)
    VALUES (@item_id, @quantity_received, @quantity_remaining, @received_date, @expiration_date, @expiration_source, @supplier_name, @delivery_id, @created_at)
  `);

  const insertUsage = database.prepare(`
    INSERT INTO usage_log (batch_id, quantity_used, used_date, created_at)
    VALUES (@batch_id, @quantity_used, @used_date, @created_at)
  `);

  const seedAll = database.transaction(() => {
    const itemIdMap = {};
    const deliveryIdMap = {};
    const batchIdMap = {};

    for (const item of seed.items) {
      const result = insertItem.run({
        name: item.name,
        category: item.category,
        unit: item.unit,
        reorder_point: item.reorder_point,
        created_at: item.created_at || new Date().toISOString(),
      });
      itemIdMap[item.seed_id] = result.lastInsertRowid;
    }

    for (const delivery of seed.deliveries) {
      const result = insertDelivery.run({
        supplier_name: delivery.supplier_name,
        received_date: delivery.received_date,
        notes: delivery.notes || null,
        created_at: delivery.created_at || new Date().toISOString(),
      });
      deliveryIdMap[delivery.seed_id] = result.lastInsertRowid;
    }

    for (const batch of seed.batches) {
      const result = insertBatch.run({
        item_id: itemIdMap[batch.item_seed_id],
        quantity_received: batch.quantity_received,
        quantity_remaining: batch.quantity_remaining,
        received_date: batch.received_date,
        expiration_date: batch.expiration_date,
        expiration_source: batch.expiration_source,
        supplier_name: batch.supplier_name || null,
        delivery_id: deliveryIdMap[batch.delivery_seed_id] || null,
        created_at: batch.created_at || new Date().toISOString(),
      });
      batchIdMap[batch.seed_id] = result.lastInsertRowid;
    }

    for (const log of seed.usage_log) {
      insertUsage.run({
        batch_id: batchIdMap[log.batch_seed_id],
        quantity_used: log.quantity_used,
        used_date: log.used_date,
        created_at: log.created_at || new Date().toISOString(),
      });
    }
  });

  seedAll();
}

module.exports = { getDb, initializeDatabase };
