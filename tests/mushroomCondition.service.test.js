const test = require('node:test');
const assert = require('node:assert/strict');

function loadService(existingCondition = false) {
  const conditionModelPath = require.resolve('../src/models/mushroomCondition.model');
  const typeModelPath = require.resolve('../src/models/mushroomType.model');
  const servicePath = require.resolve('../src/services/mushroomCondition.service');

  const conditionModel = {
    findById: async () => null,
    findByMushroomTypeId: async () => (existingCondition ? [{ condition_id: 1 }] : []),
    create: async (payload) => ({ ...payload, condition_id: 99 }),
    updateById: async () => null,
    removeById: async () => null,
  };

  const typeModel = {
    findById: async () => ({ mushroom_type_id: 1, name: 'King Oyster' }),
  };

  delete require.cache[conditionModelPath];
  delete require.cache[typeModelPath];
  delete require.cache[servicePath];

  require.cache[conditionModelPath] = { exports: conditionModel };
  require.cache[typeModelPath] = { exports: typeModel };

  return require('../src/services/mushroomCondition.service');
}

test('should reject when mushroom type already has a condition', async () => {
  const service = loadService(true);

  await assert.rejects(
    () => service.createMushroomCondition({
      mushroomTypeId: 1,
      temperatureMin: 18,
      temperatureMax: 24,
      humidityMin: 80,
      humidityMax: 90,
      co2Min: 350,
      co2Max: 500,
    }),
    {
      message: 'Nấm này đã có condition rồi',
    },
  );
});

test('should allow creating a condition when mushroom type has no condition yet', async () => {
  const service = loadService(false);

  const result = await service.createMushroomCondition({
    mushroomTypeId: 1,
    temperatureMin: 18,
    temperatureMax: 24,
    humidityMin: 80,
    humidityMax: 90,
    co2Min: 350,
    co2Max: 500,
  });

  assert.equal(result.condition_id, 99);
  assert.equal(result.mushroomTypeId, 1);
});

test('should reject when updating a condition to a mushroom type that already has a condition', async () => {
  const conditionModelPath = require.resolve('../src/models/mushroomCondition.model');
  const typeModelPath = require.resolve('../src/models/mushroomType.model');
  const servicePath = require.resolve('../src/services/mushroomCondition.service');

  const conditionModel = {
    findById: async (conditionId) => ({ condition_id: conditionId, mushroom_type_id: 1 }),
    findByMushroomTypeId: async (mushroomTypeId) => (mushroomTypeId === 2 ? [{ condition_id: 9 }] : []),
    create: async () => null,
    updateById: async () => ({ condition_id: 5, mushroom_type_id: 2 }),
    removeById: async () => null,
  };

  const typeModel = {
    findById: async (id) => ({ mushroom_type_id: id, name: `Type ${id}` }),
  };

  delete require.cache[conditionModelPath];
  delete require.cache[typeModelPath];
  delete require.cache[servicePath];

  require.cache[conditionModelPath] = { exports: conditionModel };
  require.cache[typeModelPath] = { exports: typeModel };

  const service = require('../src/services/mushroomCondition.service');

  await assert.rejects(
    () => service.updateMushroomCondition(5, { mushroomTypeId: 2 }),
    {
      message: 'Nấm này đã có condition rồi',
    },
  );
});
