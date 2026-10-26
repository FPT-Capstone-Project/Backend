const pool = require('../config/db');

const mushroomConditionColumns = `
  condition_id,
  mushroom_type_id,
  temperature_min,
  temperature_max,
  humidity_min,
  humidity_max,
  created_at,
  updated_at
`;

async function findAll({ mushroomTypeId } = {}) {
  let query = `SELECT ${mushroomConditionColumns} FROM mushroom_conditions`;
  const params = [];

  if (mushroomTypeId !== undefined && mushroomTypeId !== null && String(mushroomTypeId).trim() !== '') {
    query += ` WHERE mushroom_type_id = $1`;
    params.push(Number(mushroomTypeId));
  }

  query += ` ORDER BY created_at DESC`;
  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(conditionId) {
  const result = await pool.query(
    `SELECT ${mushroomConditionColumns} FROM mushroom_conditions WHERE condition_id = $1 LIMIT 1`,
    [conditionId],
  );
  return result.rows[0] || null;
}

async function findByMushroomTypeId(mushroomTypeId) {
  const result = await pool.query(
    `SELECT ${mushroomConditionColumns} FROM mushroom_conditions WHERE mushroom_type_id = $1 ORDER BY created_at DESC`,
    [mushroomTypeId],
  );
  return result.rows;
}

async function create({
  mushroomTypeId,
  temperatureMin,
  temperatureMax,
  humidityMin,
  humidityMax,
}) {
  const result = await pool.query(
    `INSERT INTO mushroom_conditions (
      mushroom_type_id,
      temperature_min,
      temperature_max,
      humidity_min,
      humidity_max
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING ${mushroomConditionColumns}`,
    [
      mushroomTypeId,
      temperatureMin,
      temperatureMax,
      humidityMin,
      humidityMax,
    ],
  );

  return result.rows[0];
}

async function updateById(conditionId, data = {}) {
  const fields = [];
  const values = [];
  let index = 1;

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${index}`);
      values.push(value);
      index += 1;
    }
  });

  if (fields.length === 0) {
    return findById(conditionId);
  }

  values.push(conditionId);
  const query = `
    UPDATE mushroom_conditions
    SET ${fields.join(', ')}
    WHERE condition_id = $${index}
    RETURNING ${mushroomConditionColumns}
  `;

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function removeById(conditionId) {
  const result = await pool.query(
    `DELETE FROM mushroom_conditions
     WHERE condition_id = $1
     RETURNING ${mushroomConditionColumns}`,
    [conditionId],
  );

  return result.rows[0] || null;
}

module.exports = {
  findAll,
  findById,
  findByMushroomTypeId,
  create,
  updateById,
  removeById,
};
