const pool = require('../config/db');

async function list(filters, exports = false) {
  const values = [];
  const conditions = exports ? ["t.transaction_type = 'OUT'"] : [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (filters.mushroomTypeId) add('i.mushroom_type_id = ?', filters.mushroomTypeId);
  if (filters.search) add('m.name ILIKE ?', `%${filters.search}%`);
  if (exports && filters.sessionId) add('t.session_id = ?', filters.sessionId);
  if (exports && filters.fromDate) add('t.created_at >= ?::timestamptz', filters.fromDate);
  if (exports && filters.toDate) add('t.created_at <= ?::timestamptz', filters.toDate);
  const from = `${exports ? 'inventory_transactions t JOIN spawn_inventory i ON i.inventory_id = t.inventory_id' : 'spawn_inventory i'}
    JOIN mushroom_types m ON m.mushroom_type_id = i.mushroom_type_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`;
  const fields = exports
    ? 't.transaction_id, t.inventory_id, i.mushroom_type_id, m.name AS mushroom_name, t.transaction_type, t.quantity, t.quantity_before, t.quantity_after, t.session_id, t.notes, t.created_at'
    : 'i.inventory_id, i.mushroom_type_id, m.name AS mushroom_name, i.quantity, i.updated_at';
  const total = (await pool.query(`SELECT COUNT(*)::int AS total FROM ${from}`, values)).rows[0].total;
  const result = await pool.query(`SELECT ${fields} FROM ${from}
    ORDER BY ${exports ? 't.created_at DESC, t.transaction_id DESC' : 'i.inventory_id'}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
  [...values, filters.limit, (filters.page - 1) * filters.limit]);
  return { data: result.rows, pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.ceil(total / filters.limit) } };
}

module.exports = {
  list,
  mushroom: async (client, id) => (await client.query('SELECT mushroom_type_id, status FROM mushroom_types WHERE mushroom_type_id = $1 FOR SHARE', [id])).rows[0],
  lock: async (client, id) => (await client.query('SELECT inventory_id, mushroom_type_id, quantity, updated_at FROM spawn_inventory WHERE inventory_id = $1 FOR UPDATE', [id])).rows[0],
  create: async (client, id, quantity) => (await client.query('INSERT INTO spawn_inventory (mushroom_type_id, quantity) VALUES ($1, $2) RETURNING *', [id, quantity])).rows[0],
  update: async (client, id, quantity) => (await client.query('UPDATE spawn_inventory SET quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE inventory_id = $1 RETURNING *', [id, quantity])).rows[0],
  // Calculate the delta in PostgreSQL to preserve the numeric column precision.
  record: (client, id, type, before, after, notes) => client.query(`INSERT INTO inventory_transactions
    (inventory_id, transaction_type, quantity, quantity_before, quantity_after, notes)
    VALUES ($1, $2, ABS($4::numeric - $3::numeric), $3, $4, $5)`, [id, type, before, after, notes]),
  hasHistory: async (client, id) => (await client.query('SELECT 1 FROM inventory_transactions WHERE inventory_id = $1 LIMIT 1', [id])).rows.length > 0,
  remove: (client, id) => client.query('DELETE FROM spawn_inventory WHERE inventory_id = $1', [id]),
};
