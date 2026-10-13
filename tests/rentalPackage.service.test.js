const test = require('node:test');
const assert = require('node:assert/strict');

function loadService({ mushroomTypeExists = true, deleteError = null } = {}) {
  const packageModelPath = require.resolve('../src/models/rentalPackage.model');
  const typeModelPath = require.resolve('../src/models/mushroomType.model');
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
  const typeModel = {
    findById: async () => (mushroomTypeExists ? { mushroom_type_id: 1 } : null),
  };

  delete require.cache[packageModelPath];
  delete require.cache[typeModelPath];
  delete require.cache[servicePath];
  require.cache[packageModelPath] = { exports: packageModel };
  require.cache[typeModelPath] = { exports: typeModel };
  return require('../src/services/rentalPackage.service');
}

test('creates a rental package for an existing mushroom type', async () => {
  const service = loadService();
  const result = await service.createRentalPackage({
    mushroomTypeId: 1,
    packageName: ' Standard ',
    durationDays: 30,
    price: 500000,
  });

  assert.equal(result.package_id, 2);
  assert.equal(result.packageName, 'Standard');
  assert.equal(result.status, 'ACTIVE');
});

test('rejects invalid duration and unknown mushroom type', async () => {
  const service = loadService();
  await assert.rejects(
    () => service.createRentalPackage({ mushroomTypeId: 1, packageName: 'Standard', durationDays: 0, price: 1 }),
    { statusCode: 400 },
  );

  const missingTypeService = loadService({ mushroomTypeExists: false });
  await assert.rejects(
    () => missingTypeService.createRentalPackage({ mushroomTypeId: 1, packageName: 'Standard', durationDays: 30, price: 1 }),
    { statusCode: 404, message: 'Mushroom type not found' },
  );
});

test('returns conflict when deleting a package referenced by an order or rental', async () => {
  const service = loadService({ deleteError: { code: '23503' } });
  await assert.rejects(
    () => service.deleteRentalPackage(1),
    { statusCode: 409 },
  );
});