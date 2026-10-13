const pool = require('../config/db');

const rentalPackageColumns = `
  package_id,
  package_name,
  description,
  duration_days,
  price,
  status
`;

async function findAll({ status } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  let query = `SELECT ${rentalPackageColumns} FROM rental_packages`;
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY package_id DESC';

  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(packageId) {
  const result = await pool.query(
    `SELECT ${rentalPackageColumns} FROM rental_packages WHERE package_id = $1 LIMIT 1`,
    [packageId],
  );
  return result.rows[0] || null;
}

async function create({ packageName, description, durationDays, price, status }) {
  const result = await pool.query(
    `INSERT INTO rental_packages (package_name, description, duration_days, price, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${rentalPackageColumns}`,
    [packageName, description, durationDays, price, status],
  );
  return result.rows[0];
}

async function updateById(packageId, data = {}) {
  const fields = [];
  const values = [];

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      values.push(value);
      fields.push(`${key} = $${values.length}`);
    }
  });

  if (fields.length === 0) return findById(packageId);

  values.push(packageId);
  const result = await pool.query(
    `UPDATE rental_packages
     SET ${fields.join(', ')}
     WHERE package_id = $${values.length}
     RETURNING ${rentalPackageColumns}`,
    values,
  );
  return result.rows[0] || null;
}

async function removeById(packageId) {
  const result = await pool.query(
    `DELETE FROM rental_packages
     WHERE package_id = $1
     RETURNING ${rentalPackageColumns}`,
    [packageId],
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, create, updateById, removeById };