const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('migration permits a mushroom on a rental item while preserving mushroom-only validation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE order_items (
        order_item_id SERIAL PRIMARY KEY,
        item_type VARCHAR(30) NOT NULL,
        rental_package_id INT,
        mushroom_type_id INT,
        CONSTRAINT chk_order_item_type CHECK (
          (
            item_type = 'RENTAL'
            AND rental_package_id IS NOT NULL
            AND mushroom_type_id IS NULL
          )
          OR
          (
            item_type = 'MUSHROOM'
            AND mushroom_type_id IS NOT NULL
            AND rental_package_id IS NULL
          )
        )
      );
    `);

    const migration = fs.readFileSync(
      path.join(__dirname, '../migrations/008_allow_mushroom_on_rental_item.sql'),
      'utf8',
    );
    await db.exec(migration);
    await db.exec(migration);

    await db.exec(`
      INSERT INTO order_items (item_type, rental_package_id, mushroom_type_id)
      VALUES ('RENTAL', 2, 2), ('MUSHROOM', NULL, 2);
    `);
    await assert.rejects(
      () => db.exec(`
        INSERT INTO order_items (item_type, rental_package_id, mushroom_type_id)
        VALUES ('MUSHROOM', 2, 2);
      `),
      /chk_order_item_type/,
    );

    const result = await db.query('SELECT COUNT(*)::int AS count FROM order_items');
    assert.equal(result.rows[0].count, 2);
  } finally {
    await db.close();
  }
});
