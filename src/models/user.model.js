const pool = require('../config/db');

const publicUserColumns = `
  user_id,
  role_id,
  email,
  full_name,
  phone,
  address,
  status,
  created_at,
  updated_at
`;

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT ${publicUserColumns}, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return result.rows[0] || null;
}

async function findById(userId) {
  const result = await pool.query(
    `SELECT ${publicUserColumns} FROM users WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function create({ roleId, email, passwordHash, fullName, phone, address }) {
  const result = await pool.query(
    `INSERT INTO users (role_id, email, password_hash, full_name, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${publicUserColumns}`,
    [roleId, email, passwordHash, fullName, phone || null, address || null],
  );
  return result.rows[0];
}

module.exports = { findByEmail, findById, create };
