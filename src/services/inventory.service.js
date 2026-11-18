const pool = require('../config/db');
const model = require('../models/inventory.model');
const AppError = require('../utils/app-error');

function id(value, name) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
    throw new AppError(`${name} must be a positive integer`, 400);
  }
  return Number(value);
}
function body(payload, create) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => !(create ? ['mushroomTypeId', 'quantity', 'notes'] : ['quantity', 'notes']).includes(key))) {
    throw new AppError('Invalid inventory fields', 400);
  }
  if (typeof payload.quantity !== 'number' || !Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    throw new AppError('quantity must be a positive number', 400);
  }
  if (payload.notes !== undefined && typeof payload.notes !== 'string') {
    throw new AppError('notes must contain an adjustment reason', 400);
  }
  return { ...payload, notes: payload.notes?.trim() || null };
}
function filters(query = {}) {
  const result = { page: query.page === undefined ? 1 : id(query.page, 'page'), limit: query.limit === undefined ? 20 : id(query.limit, 'limit') };
  if (result.limit > 100) throw new AppError('limit must not exceed 100', 400);
  for (const key of ['mushroomTypeId', 'sessionId']) if (query[key] !== undefined) result[key] = id(query[key], key);
  if (query.search !== undefined) {
    if (typeof query.search !== 'string') throw new AppError('search must be a string', 400);
    result.search = query.search.trim();
  }
  for (const key of ['fromDate', 'toDate']) if (query[key] !== undefined) {
    const value = query[key];
    const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match || !Number.isFinite(Date.parse(value)) || new Date(match[1]).toISOString().slice(0, 10) !== match[1]) throw new AppError(`${key} must be an ISO date or timestamp`, 400);
    result[key] = new Date(value).toISOString();
  }
  if (result.fromDate && result.toDate && result.fromDate > result.toDate) throw new AppError('fromDate must not exceed toDate', 400);
  return result;
}
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505' && error.constraint === 'spawn_inventory_mushroom_type_id_key') throw new AppError('Inventory already exists for this mushroom type', 409);
    if (error.code === '23503') throw new AppError('Inventory is referenced by another record', 409);
    throw error;
  } finally { client.release(); }
}
async function existing(client, inventoryId) {
  const row = await model.lock(client, inventoryId);
  if (!row) throw new AppError('Inventory not found', 404);
  return row;
}
module.exports = {
  list: async query => model.list(filters(query)),
  exports: async query => model.list(filters(query), true),
  async create(payload) {
    const data = body(payload, true);
    const mushroomId = id(data.mushroomTypeId, 'mushroomTypeId');
    return transaction(async client => {
      const mushroom = await model.mushroom(client, mushroomId);
      if (!mushroom) throw new AppError('Mushroom type not found', 404);
      if (mushroom.status !== 'ACTIVE') throw new AppError('Mushroom type must be ACTIVE', 409);
      const row = await model.create(client, mushroomId, data.quantity);
      await model.record(client, row.inventory_id, 'IN', 0, row.quantity, data.notes);
      return row;
    });
  },
  async update(inventoryId, payload) {
    const inventory = id(inventoryId, 'inventoryId');
    const data = body(payload, false);
    return transaction(async client => {
      const row = await existing(client, inventory);
      const updated = await model.update(client, inventory, data.quantity);
      await model.record(client, inventory, 'IN', row.quantity, updated.quantity, data.notes);
      return updated;
    });
  },
  async remove(inventoryId) {
    const inventory = id(inventoryId, 'inventoryId');
    return transaction(async client => {
      const row = await existing(client, inventory);
      if (await model.hasHistory(client, inventory)) throw new AppError('Cannot delete inventory because it has transaction history.', 409);
      if (Number(row.quantity) !== 0) throw new AppError('Cannot delete inventory because its quantity is greater than zero.', 409);
      await model.remove(client, inventory);
      return row;
    });
  },
};
