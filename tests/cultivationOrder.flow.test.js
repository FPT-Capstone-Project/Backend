const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

function loadModels(db) {
  const dbPath = require.resolve('../src/config/db');
  const reservationPath = require.resolve('../src/models/cultivationReservation.model');
  const orderPath = require.resolve('../src/models/order.model');
  const paymentPath = require.resolve('../src/models/payment.model');
  const client = {
    query: (query, values = []) => db.query(query, values),
    release: () => {},
  };

  delete require.cache[dbPath];
  delete require.cache[reservationPath];
  delete require.cache[orderPath];
  delete require.cache[paymentPath];
  require.cache[dbPath] = {
    exports: {
      connect: async () => client,
      query: (query, values = []) => db.query(query, values),
    },
  };

  return {
    orderModel: require('../src/models/order.model'),
    paymentModel: require('../src/models/payment.model'),
  };
}

test('holds trays and spawn, then consumes both on successful PayOS payment', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE rental_packages (
        package_id SERIAL PRIMARY KEY,
        package_name VARCHAR NOT NULL,
        duration_days INTEGER NOT NULL,
        price NUMERIC NOT NULL,
        status VARCHAR NOT NULL
      );
      CREATE TABLE mushroom_types (
        mushroom_type_id SERIAL PRIMARY KEY,
        name VARCHAR NOT NULL,
        growing_days INTEGER NOT NULL,
        price NUMERIC NOT NULL,
        status VARCHAR NOT NULL
      );
      CREATE TABLE cultivation_floors (
        floor_id SERIAL PRIMARY KEY,
        status VARCHAR NOT NULL
      );
      CREATE TABLE cultivation_trays (
        tray_id SERIAL PRIMARY KEY,
        floor_id INTEGER,
        status VARCHAR NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE orders (
        order_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        subtotal NUMERIC NOT NULL DEFAULT 0,
        discount NUMERIC NOT NULL DEFAULT 0,
        shipping_fee NUMERIC NOT NULL DEFAULT 0,
        total_amount NUMERIC NOT NULL DEFAULT 0,
        status VARCHAR NOT NULL DEFAULT 'PENDING',
        payment_status VARCHAR NOT NULL DEFAULT 'UNPAID',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE order_items (
        order_item_id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        rental_package_id INTEGER,
        mushroom_type_id INTEGER,
        quantity INTEGER NOT NULL,
        unit_price NUMERIC NOT NULL,
        total_price NUMERIC NOT NULL
      );
      CREATE TABLE tray_reservations (
        reservation_id SERIAL PRIMARY KEY,
        order_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        spawn_quantity INTEGER NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'HELD',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMP,
        CHECK (spawn_quantity = quantity * 3)
      );
      CREATE TABLE spawn_inventory (
        inventory_id SERIAL PRIMARY KEY,
        mushroom_type_id INTEGER NOT NULL UNIQUE,
        quantity NUMERIC NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE payments (
        payment_id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        amount NUMERIC NOT NULL,
        payment_method VARCHAR NOT NULL,
        transaction_code VARCHAR,
        status VARCHAR NOT NULL DEFAULT 'PENDING',
        paid_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        payos_payment_link_id TEXT,
        payos_checkout_url TEXT,
        payos_qr_code TEXT,
        expires_at TIMESTAMPTZ
      );
      CREATE TABLE cultivation_protocols (
        protocol_id SERIAL PRIMARY KEY,
        mushroom_type_id INTEGER NOT NULL,
        status VARCHAR NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE cultivation_sessions (
        session_id SERIAL PRIMARY KEY,
        mushroom_type_id INTEGER NOT NULL,
        start_at TIMESTAMP NOT NULL,
        duration_days INTEGER NOT NULL,
        status VARCHAR NOT NULL,
        harvest_date DATE,
        order_item_id INTEGER NOT NULL,
        protocol_id INTEGER
      );
      CREATE TABLE inventory_transactions (
        transaction_id SERIAL PRIMARY KEY,
        inventory_id INTEGER NOT NULL,
        session_id INTEGER,
        transaction_type VARCHAR NOT NULL,
        quantity NUMERIC NOT NULL,
        quantity_before NUMERIC NOT NULL,
        quantity_after NUMERIC NOT NULL,
        notes TEXT
      );
      CREATE TABLE cultivation_session_trays (
        session_tray_id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL,
        tray_id INTEGER NOT NULL,
        status VARCHAR NOT NULL
      );
      CREATE TABLE cultivation_progress (
        progress_id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL,
        current_stage VARCHAR NOT NULL,
        progress_percent NUMERIC NOT NULL,
        start_date DATE,
        expected_harvest_date DATE,
        description TEXT
      );
      CREATE TABLE notifications (
        notification_id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        notification_type VARCHAR NOT NULL,
        title VARCHAR NOT NULL,
        message TEXT NOT NULL,
        reference_type VARCHAR,
        reference_id INTEGER
      );

      INSERT INTO rental_packages (package_name, duration_days, price, status)
      VALUES ('Basic', 15, 100, 'ACTIVE');
      INSERT INTO mushroom_types (name, growing_days, price, status)
      VALUES ('Oyster', 12, 20, 'ACTIVE');
      INSERT INTO cultivation_floors (status) VALUES ('ACTIVE');
      INSERT INTO cultivation_trays (floor_id, status) VALUES (1, 'AVAILABLE'), (1, 'AVAILABLE');
      INSERT INTO spawn_inventory (mushroom_type_id, quantity) VALUES (1, 10);
    `);

    const { orderModel, paymentModel } = loadModels(db);
    const order = await orderModel.createCultivationOrder({
      userId: 7,
      packageId: 1,
      mushroomTypeId: 1,
      quantity: 2,
      holdMinutes: 15,
    });
    const held = await db.query('SELECT quantity, spawn_quantity, status FROM tray_reservations');
    assert.deepEqual(held.rows[0], { quantity: 2, spawn_quantity: 6, status: 'HELD' });

    const { payment } = await paymentModel.createOrGetPayosPayment(order.order_id, 7, 15);
    assert.equal(
      Number(payment.expires_at_epoch),
      Math.floor(new Date(payment.expires_at).getTime() / 1000),
    );
    const paid = await paymentModel.markPayosPaymentAsPaid(payment.payment_id, 240, 'PAYOS-1');
    assert.equal(paid.status, 'PAID');

    const inventory = await db.query('SELECT quantity FROM spawn_inventory WHERE inventory_id = 1');
    const reservation = await db.query('SELECT status FROM tray_reservations');
    const trays = await db.query("SELECT COUNT(*)::int AS count FROM cultivation_trays WHERE status = 'OCCUPIED'");
    const transactions = await db.query("SELECT transaction_type, quantity FROM inventory_transactions");
    const orderState = await db.query('SELECT status, payment_status FROM orders WHERE order_id = 1');
    assert.equal(Number(inventory.rows[0].quantity), 4);
    assert.equal(reservation.rows[0].status, 'CONSUMED');
    assert.equal(trays.rows[0].count, 2);
    assert.equal(transactions.rows[0].transaction_type, 'OUT');
    assert.equal(Number(transactions.rows[0].quantity), 6);
    assert.deepEqual(orderState.rows[0], { status: 'PROCESSING', payment_status: 'PAID' });
  } finally {
    await db.close();
  }
});
