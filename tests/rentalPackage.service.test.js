const test = require('node:test');
const assert = require('node:assert/strict');

function loadService({ deleteError = null } = {}) {
  const packageModelPath = require.resolve('../src/models/rentalPackage.model');
  const servicePath = require.resolve('../src/services/rentalPackage.service');

  const packageModel = {
    findAll: async (filters) => filters,
    findById: async () => ({ package_id: 1 }),
    create: async (data) => ({ package_id: 2, ...data }),
    updateById: async (id, data) => ({ package_id: id, ...data }),
    removeById: async () => {
      if (deleteError) throw deleteError;
      return { package_id: 1 };
    },
  };
  delete require.cache[packageModelPath];
  delete require.cache[servicePath];
  require.cache[packageModelPath] = { exports: packageModel };
  return require('../src/services/rentalPackage.service');
}

test('creates a rental package without a mushroom type dependency', async () => {
  const service = loadService();
  const result = await service.createRentalPackage({
    packageName: ' Standard ',
    durationDays: 30,
    price: 500000,
  });

  assert.equal(result.package_id, 2);
  assert.equal(result.packageName, 'Standard');
  assert.equal(result.status, 'ACTIVE');
});

test('rejects an invalid duration', async () => {
  const service = loadService();
  await assert.rejects(
    () => service.createRentalPackage({ packageName: 'Standard', durationDays: 0, price: 1 }),
    { statusCode: 400 },
  );

});

test('returns conflict when deleting a package referenced by an order or rental', async () => {
  const service = loadService({ deleteError: { code: '23503' } });
  await assert.rejects(
    () => service.deleteRentalPackage(1),
    { statusCode: 409 },
  );
});