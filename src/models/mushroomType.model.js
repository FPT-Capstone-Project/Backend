const pool = require('../config/db');

const mushroomTypeColumns = `
  mushroom_type_id,
  name,
  description,
  growing_days,
  price,
  image_url,
  status,
  created_at
`;

async function findAll({ status } = {}) {
  let query = `SELECT ${mushroomTypeColumns} FROM mushroom_types`;
  const params = [];

  if (status) {
    query += ` WHERE status = $1`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;
  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(mushroomTypeId) {
  const result = await pool.query(
    `SELECT ${mushroomTypeColumns} FROM mushroom_types WHERE mushroom_type_id = $1 LIMIT 1`,
    [mushroomTypeId],
  );
  return result.rows[0] || null;
}

async function findByName(name, excludeId = null) {
  let query = `SELECT ${mushroomTypeColumns} FROM mushroom_types WHERE LOWER(name) = LOWER($1)`;
  const params = [name];

  if (excludeId !== null && excludeId !== undefined) {
    query += ` AND mushroom_type_id != $2`;
    params.push(excludeId);
  }

  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

async function create({ name, description, growingDays, price, imageUrl, status }) {
  const result = await pool.query(
    `INSERT INTO mushroom_types (name, description, growing_days, price, image_url, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${mushroomTypeColumns}`,
    [name, description || null, growingDays, price, imageUrl || null, status],
  );

  return result.rows[0];
}

async function updateById(mushroomTypeId, data = {}) {
  const fields = [];
  const values = [];
  let index = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index += 1;
    }
  });

  if (fields.length === 0) {
    return findById(mushroomTypeId);
  }

  values.push(mushroomTypeId);
  const query = `
    UPDATE mushroom_types
    SET ${fields.join(', ')}
    WHERE mushroom_type_id = $${index}
    RETURNING ${mushroomTypeColumns}
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function removeById(mushroomTypeId) {
  const result = await pool.query(
    `DELETE FROM mushroom_types
     WHERE mushroom_type_id = $1
     RETURNING ${mushroomTypeColumns}`,
    [mushroomTypeId],
  );

  return result.rows[0] || null;
}

module.exports = { findAll, findById, findByName, create, updateById, removeById };
