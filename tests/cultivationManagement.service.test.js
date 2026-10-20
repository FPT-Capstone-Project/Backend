const test = require('node:test');
const assert = require('node:assert/strict');

function loadRoomService({ deleteError = null } = {}) {
  const modelPath = require.resolve('../src/models/cultivationRoom.model');
  const servicePath = require.resolve('../src/services/cultivationRoom.service');
  const model = {
    findAll: async (filters) => filters,
    findById: async () => ({ room_id: 1 }),
    create: async (data) => ({ room_id: 2, ...data }),
    updateById: async (id, data) => ({ room_id: id, ...data }),
    removeById: async () => {
      if (deleteError) throw deleteError;
      return { room_id: 1 };
    },
  };
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return require('../src/services/cultivationRoom.service');
}

function loadTrayService({
  roomExists = true,
  floorExists = true,
  floorRoomId = 1,
  deleteError = null,
} = {}) {
  const trayModelPath = require.resolve('../src/models/cultivationTray.model');
  const roomModelPath = require.resolve('../src/models/cultivationRoom.model');
  const servicePath = require.resolve('../src/services/cultivationTray.service');
  const trayModel = {
    findAll: async (filters) => filters,
    findById: async () => ({ tray_id: 1, room_id: 1, floor_id: null }),
    findFloorById: async () => (
      floorExists ? { floor_id: 3, room_id: floorRoomId } : null
    ),
    create: async (data) => ({ tray_id: 2, ...data }),
    updateById: async (id, data) => ({ tray_id: id, ...data }),
    removeById: async () => {
      if (deleteError) throw deleteError;
      return { tray_id: 1 };
    },
  };
  const roomModel = { findById: async () => (roomExists ? { room_id: 1 } : null) };
  delete require.cache[trayModelPath];
  delete require.cache[roomModelPath];
  delete require.cache[servicePath];
  require.cache[trayModelPath] = { exports: trayModel };
  require.cache[roomModelPath] = { exports: roomModel };
  return require('../src/services/cultivationTray.service');
}

test('creates a room with schema defaults and rejects invalid capacity', async () => {
  const service = loadRoomService();
  const room = await service.createCultivationRoom({ roomCode: ' R-01 ', roomName: ' Main room ' });
  assert.equal(room.roomCode, 'R-01');
  assert.equal(room.capacity, 0);
  assert.equal(room.status, 'ACTIVE');
  await assert.rejects(
    () => service.createCultivationRoom({ roomCode: 'R-02', roomName: 'Room 2', capacity: -1 }),
    { statusCode: 400 },
  );
});

test('creates a tray only for an existing room', async () => {
  const service = loadTrayService();
  const tray = await service.createCultivationTray({ roomId: 1, trayCode: ' T-01 ' });
  assert.equal(tray.trayCode, 'T-01');
  assert.equal(tray.status, 'AVAILABLE');

  const missingRoomService = loadTrayService({ roomExists: false });
  await assert.rejects(
    () => missingRoomService.createCultivationTray({ roomId: 5, trayCode: 'T-05' }),
    { statusCode: 404, message: 'Cultivation room not found' },
  );
});

test('assigns a tray to a floor in the same room', async () => {
  const service = loadTrayService();
  const tray = await service.createCultivationTray({
    roomId: 1,
    floorId: 3,
    trayCode: 'T-FLOOR-01',
  });
  assert.equal(tray.floorId, 3);

  const mismatchedFloorService = loadTrayService({ floorRoomId: 2 });
  await assert.rejects(
    () => mismatchedFloorService.createCultivationTray({
      roomId: 1,
      floorId: 3,
      trayCode: 'T-FLOOR-02',
    }),
    { statusCode: 400, message: 'Cultivation floor must belong to the selected room' },
  );

  const missingFloorService = loadTrayService({ floorExists: false });
  await assert.rejects(
    () => missingFloorService.createCultivationTray({
      roomId: 1,
      floorId: 99,
      trayCode: 'T-FLOOR-03',
    }),
    { statusCode: 404, message: 'Cultivation floor not found' },
  );
});

test('lists only trays belonging to an existing room', async () => {
  const service = loadTrayService();
  assert.deepEqual(
    await service.getCultivationTraysByRoomId('1', { status: 'available' }),
    { roomId: 1, status: 'AVAILABLE' },
  );

  const missingRoomService = loadTrayService({ roomExists: false });
  await assert.rejects(
    () => missingRoomService.getCultivationTraysByRoomId('5'),
    { statusCode: 404, message: 'Cultivation room not found' },
  );
});

test('blocks deletion when database references prevent it', async () => {
  const roomService = loadRoomService({ deleteError: { code: '23503' } });
  await assert.rejects(() => roomService.deleteCultivationRoom(1), { statusCode: 409 });

  const trayService = loadTrayService({ deleteError: { code: '23503' } });
  await assert.rejects(() => trayService.deleteCultivationTray(1), { statusCode: 409 });
});