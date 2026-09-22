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

async function findOtpUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email],
  );
  return result.rows[0] || null;
}

async function findOtpUserById(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  return result.rows[0] || null;
}

async function createUnverifiedUser({ roleId, email, passwordHash, fullName, phone, address }) {
  const result = await pool.query(
    `INSERT INTO users (
      role_id, email, password_hash, full_name, phone, address, status, is_email_verified
    )
     VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', FALSE)
     RETURNING *`,
    [roleId, email, passwordHash, fullName, phone || null, address || null],
  );
  return result.rows[0];
}

async function updateUnverifiedUser({ userId, passwordHash, fullName, phone, address }) {
  const result = await pool.query(
    `UPDATE users
     SET full_name = $2, password_hash = $3, phone = $4, address = $5, updated_at = NOW()
     WHERE user_id = $1 AND is_email_verified = FALSE
     RETURNING *`,
    [userId, fullName, passwordHash, phone || null, address || null],
  );
  return result.rows[0] || null;
}

async function saveOtp(userId, otpCode, otpType, expiresAt, cooldownSeconds) {
  const result = await pool.query(
    `UPDATE users
     SET otp_code = $2,
         otp_type = $3,
         otp_expires_at = $4,
         otp_attempts = 0,
         otp_last_sent_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND (otp_last_sent_at IS NULL OR otp_last_sent_at <= NOW() - ($5 * INTERVAL '1 second'))
     RETURNING *`,
    [userId, otpCode, otpType, expiresAt, cooldownSeconds],
  );
  return result.rows[0] || null;
}

async function incrementOtpAttempts(userId) {
  const result = await pool.query(
    `UPDATE users
     SET otp_attempts = otp_attempts + 1, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId],
  );
  return result.rows[0] || null;
}

async function clearOtp(userId) {
  const result = await pool.query(
    `UPDATE users
     SET otp_code = NULL,
         otp_type = NULL,
         otp_expires_at = NULL,
         otp_attempts = 0,
         otp_last_sent_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId],
  );
  return result.rows[0] || null;
}

async function markEmailVerified(userId, otpCode) {
  const result = await pool.query(
    `UPDATE users
     SET is_email_verified = TRUE,
         otp_code = NULL,
         otp_type = NULL,
         otp_expires_at = NULL,
         otp_attempts = 0,
         otp_last_sent_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND otp_code = $2
     RETURNING *`,
    [userId, otpCode],
  );
  return result.rows[0] || null;
}

async function updatePasswordAndClearOtp(userId, passwordHash, otpCode) {
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $2,
         otp_code = NULL,
         otp_type = NULL,
         otp_expires_at = NULL,
         otp_attempts = 0,
         otp_last_sent_at = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND otp_code = $3
     RETURNING *`,
    [userId, passwordHash, otpCode],
  );
  return result.rows[0] || null;
}

module.exports.findOtpUserByEmail = findOtpUserByEmail;
module.exports.findOtpUserById = findOtpUserById;
module.exports.createUnverifiedUser = createUnverifiedUser;
module.exports.updateUnverifiedUser = updateUnverifiedUser;
module.exports.saveOtp = saveOtp;
module.exports.incrementOtpAttempts = incrementOtpAttempts;
module.exports.clearOtp = clearOtp;
module.exports.markEmailVerified = markEmailVerified;
module.exports.updatePasswordAndClearOtp = updatePasswordAndClearOtp;
