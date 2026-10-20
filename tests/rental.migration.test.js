const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(
  path.join(__dirname, '../migrations/007_backfill_paid_rentals.sql'),
  'utf8',
);

test('fresh rental schema backfills paid orders idempotently', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    await db.exec(`
      INSERT INTO roles(role_name) VALUES ('Customer');
      INSERT INTO users(role_id, email, password_hash, full_name)
      VALUES (1, 'customer@example.test', 'hash', 'Test Customer');
      INSERT INTO rental_packages(package_name, duration_days, price)
      VALUES ('Test rental', 30, 500000);
      INSERT INTO mushroom_types(name, growing_days, price)
      VALUES ('Test mushroom', 20, 30000);
      INSERT INTO orders(user_id, subtotal, total_amount, status, payment_status)
      VALUES
        (1, 530000, 530000, 'CONFIRMED', 'PAID'),
        (1, 30000, 30000, 'CONFIRMED', 'PAID');
      INSERT INTO order_items(order_id, item_type, rental_package_id, quantity, unit_price, total_price)
      VALUES (1, 'RENTAL', 1, 1, 530000, 530000);
      UPDATE order_items SET mushroom_type_id = 1 WHERE order_id = 1;
      INSERT INTO order_items(order_id, item_type, mushroom_type_id, quantity, unit_price, total_price)
      VALUES (2, 'MUSHROOM', 1, 1, 30000, 30000);
    `);

    await db.exec(migration);
    await db.exec(migration);

    const result = await db.query(
      `SELECT rental_id, order_id, user_id, duration_days, start_date, end_date, status
       FROM rentals WHERE order_id = 1`,
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].order_id, 1);
    assert.equal(result.rows[0].user_id, 1);
    assert.equal(result.rows[0].duration_days, 30);
    assert.equal(result.rows[0].start_date, null);
    assert.equal(result.rows[0].end_date, null);
    assert.equal(result.rows[0].status, 'CONFIRMED');
    const mushroomOnlyOrder = await db.query(
      'SELECT COUNT(*)::int AS count FROM rentals WHERE order_id = 2',
    );
    assert.equal(mushroomOnlyOrder.rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test('legacy rental rows migrate to order-based records and backfill missing paid rentals', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE orders (
        order_id INT PRIMARY KEY,
        user_id INT NOT NULL,
        status VARCHAR(30) NOT NULL,
        payment_status VARCHAR(30) NOT NULL
      );
      CREATE TABLE users (
        user_id INT PRIMARY KEY,
        full_name VARCHAR(100),
        email VARCHAR(100),
        phone VARCHAR(30)
      );
      CREATE TABLE mushroom_types (
        mushroom_type_id INT PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
      CREATE TABLE rental_packages (
        package_id INT PRIMARY KEY,
        package_name VARCHAR(100) NOT NULL,
        duration_days INT NOT NULL
      );
      CREATE TABLE order_items (
        order_item_id INT PRIMARY KEY,
        order_id INT NOT NULL,
        rental_package_id INT,
        mushroom_type_id INT,
        item_type VARCHAR(20) NOT NULL
      );
      CREATE TABLE cultivation_rooms (
        room_id INT PRIMARY KEY,
        room_code VARCHAR(30),
        room_name VARCHAR(100)
      );
      CREATE TABLE cultivation_trays (
        tray_id INT PRIMARY KEY,
        tray_code VARCHAR(30),
        tray_name VARCHAR(100),
        room_id INT
      );
      CREATE TABLE rentals (
        rental_id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        order_item_id INT NOT NULL,
        package_id INT NOT NULL,
        tray_id INT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_rentals_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(order_item_id),
        CONSTRAINT fk_rentals_package FOREIGN KEY (package_id) REFERENCES rental_packages(package_id),
        CONSTRAINT fk_rentals_tray FOREIGN KEY (tray_id) REFERENCES cultivation_trays(tray_id),
        CONSTRAINT chk_rental_dates CHECK (end_date >= start_date),
        CONSTRAINT chk_rental_status CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED'))
      );
      INSERT INTO orders VALUES
        (1, 10, 'CONFIRMED', 'PAID'),
        (2, 20, 'CONFIRMED', 'PAID');
      INSERT INTO users VALUES
        (10, 'Customer One', 'one@example.test', '100'),
        (20, 'Customer Two', 'two@example.test', '200');
      INSERT INTO mushroom_types VALUES (1, 'Oyster mushroom');
      INSERT INTO rental_packages VALUES (1, '30 days', 30);
      INSERT INTO order_items VALUES
        (101, 1, 1, NULL, 'RENTAL'),
        (102, 2, 1, 1, 'RENTAL'),
        (103, 1, NULL, 1, 'MUSHROOM');
      INSERT INTO rentals (user_id, order_item_id, package_id, start_date, end_date)
      VALUES (10, 101, 1, '2026-01-01', '2026-01-31');
    `);

    await db.exec(migration);
    await db.exec(migration);

    const result = await db.query(
      `SELECT rental_id, order_id, user_id, duration_days, start_date, end_date, status
       FROM rentals ORDER BY order_id`,
    );
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map((row) => ({
      order_id: row.order_id,
      user_id: row.user_id,
      duration_days: row.duration_days,
      status: row.status,
    })), [
      { order_id: 1, user_id: 10, duration_days: 30, status: 'CONFIRMED' },
      { order_id: 2, user_id: 20, duration_days: 30, status: 'CONFIRMED' },
    ]);
    const preservedDates = await db.query(
      `SELECT to_char(start_date, 'YYYY-MM-DD HH24:MI:SS') AS start_date,
              to_char(end_date, 'YYYY-MM-DD HH24:MI:SS') AS end_date
       FROM rentals WHERE order_id = 1`,
    );
    assert.equal(preservedDates.rows[0].start_date, '2026-01-01 00:00:00');
    assert.equal(preservedDates.rows[0].end_date, '2026-01-31 00:00:00');

    const dbPath = require.resolve('../src/config/db');
    const modelPath = require.resolve('../src/models/rental.model');
    const originalDbModule = require.cache[dbPath];
    delete require.cache[modelPath];
    require.cache[dbPath] = { exports: { query: (...args) => db.query(...args) } };
    try {
      const rentalModel = require('../src/models/rental.model');
      const rentals = await Promise.all([
        rentalModel.findByIdForAdmin(result.rows[0].rental_id),
        rentalModel.findByIdForAdmin(result.rows[1].rental_id),
      ]);
      assert.equal(rentals[0].customer_name, 'Customer One');
      assert.equal(rentals[0].customer_email, 'one@example.test');
      assert.equal(rentals[0].duration_days, 30);
      assert.equal(rentals[0].mushroom_name, 'Oyster mushroom');
      assert.equal(rentals[0].mushroom_type_id, 1);
      assert.equal(rentals[1].customer_name, 'Customer Two');
      assert.equal(rentals[1].package_name, '30 days');
      assert.equal(rentals[1].mushroom_name, 'Oyster mushroom');
    } finally {
      delete require.cache[modelPath];
      if (originalDbModule) require.cache[dbPath] = originalDbModule;
      else delete require.cache[dbPath];
    }
  } finally {
    await db.close();
  }
});
