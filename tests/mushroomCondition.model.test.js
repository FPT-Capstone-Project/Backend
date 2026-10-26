const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('condition queries work without CO2 columns and migration preserves other data', async (t) => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/mushroomCondition.model');
  const originalDb = require.cache[dbPath];
  const originalModel = require.cache[modelPath];
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/011_drop_condition_co2.sql'), 'utf8');

  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    await db.exec("INSERT INTO mushroom_types(name, growing_days) VALUES ('Oyster', 20)");
    require.cache[dbPath] = { exports: { query: (...args) => db.query(...args) } };
    delete require.cache[modelPath];
    const model = require('../src/models/mushroomCondition.model');

    await t.test('creates, reads, updates and deletes conditions on the fresh schema', async () => {
      const created = await model.create({
        mushroomTypeId: 1, temperatureMin: 20, temperatureMax: 28,
        humidityMin: 80, humidityMax: 95,
      });
      assert.equal(Object.hasOwn(created, 'co2_min'), false);
      assert.equal(Object.hasOwn(created, 'co2_max'), false);
      assert.deepEqual(await model.findById(created.condition_id), created);
      assert.deepEqual(await model.findAll({ mushroomTypeId: 1 }), [created]);
      assert.deepEqual(await model.findByMushroomTypeId(1), [created]);
      const updated = await model.updateById(created.condition_id, { humidity_min: 85 });
      assert.equal(Number(updated.humidity_min), 85);
      await assert.rejects(
        () => model.updateById(created.condition_id, { humidity_min: 99 }),
        /chk_humidity_range/,
      );
      assert.equal((await model.removeById(created.condition_id)).condition_id, created.condition_id);
      assert.equal(await model.findById(created.condition_id), null);
    });

    await t.test('migration is repeatable when columns were already deleted', async () => {
      await db.exec(migration);
      await db.exec(migration);
      assert.deepEqual(await model.findAll(), []);
    });

    await t.test('migration removes legacy columns while keeping temperature and humidity', async () => {
      await db.exec(`
        ALTER TABLE mushroom_conditions
          ADD COLUMN co2_min NUMERIC(10,2),
          ADD COLUMN co2_max NUMERIC(10,2),
          ADD CONSTRAINT chk_co2_range CHECK (co2_min <= co2_max);
        INSERT INTO mushroom_conditions
          (mushroom_type_id, temperature_min, temperature_max, humidity_min, humidity_max, co2_min, co2_max)
        VALUES (1, 20, 28, 80, 95, 350, 500);
      `);
      await db.exec(migration);
      await db.exec(migration);
      const { rows: [row] } = await db.query('SELECT * FROM mushroom_conditions');
      assert.equal(Object.hasOwn(row, 'co2_min'), false);
      assert.equal(Object.hasOwn(row, 'co2_max'), false);
      assert.equal(Number(row.temperature_min), 20);
      assert.equal(Number(row.temperature_max), 28);
      assert.equal(Number(row.humidity_min), 80);
      assert.equal(Number(row.humidity_max), 95);
      assert.equal((await model.findAll()).length, 1);
      await assert.rejects(
        () => model.updateById(row.condition_id, { temperature_max: 10 }),
        /chk_temperature_range/,
      );
    });
  } finally {
    if (originalDb) require.cache[dbPath] = originalDb;
    else delete require.cache[dbPath];
    if (originalModel) require.cache[modelPath] = originalModel;
    else delete require.cache[modelPath];
    await db.close();
  }
});
