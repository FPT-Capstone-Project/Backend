const pool = require('../config/db');

async function create({ userId, tokenHash, tokenFamily, deviceName, userAgent, ipAddress, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO public.refresh_tokens (
       user_id, token_hash, token_family, device_name, user_agent, ip_address, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING refresh_token_id`,
    [userId, tokenHash, tokenFamily, deviceName || null, userAgent || null, ipAddress || null, expiresAt],
  );
  return result.rows[0];
}

async function rotate({
  tokenHash, newTokenHash, deviceName, userAgent, ipAddress, expiresAt,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT rt.refresh_token_id, rt.user_id, rt.token_family, rt.device_name,
              rt.expires_at, rt.revoked_at,
              u.role_id, u.email, u.full_name, u.phone, u.address, u.status,
              u.created_at, u.updated_at
       FROM public.refresh_tokens rt
       JOIN public.users u ON u.user_id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [tokenHash],
    );
    const currentToken = result.rows[0];
    if (!currentToken) {
      await client.query('COMMIT');
      return null;
    }

    if (currentToken.revoked_at) {
      await client.query(
        `UPDATE public.refresh_tokens
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE token_family = $1 AND revoked_at IS NULL`,
        [currentToken.token_family],
      );
      await client.query('COMMIT');
      return { reuseDetected: true };
    }

    if (new Date(currentToken.expires_at).getTime() <= Date.now()) {
      await client.query(
        'UPDATE public.refresh_tokens SET revoked_at = NOW() WHERE refresh_token_id = $1',
        [currentToken.refresh_token_id],
      );
      await client.query('COMMIT');
      return { expired: true };
    }

    if (currentToken.status !== 'ACTIVE') {
      await client.query(
        `UPDATE public.refresh_tokens
         SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE token_family = $1 AND revoked_at IS NULL`,
        [currentToken.token_family],
      );
      await client.query('COMMIT');
      return { userInactive: true };
    }

    const inserted = await client.query(
      `INSERT INTO public.refresh_tokens (
         user_id, token_hash, token_family, device_name, user_agent, ip_address, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING refresh_token_id`,
      [
        currentToken.user_id,
        newTokenHash,
        currentToken.token_family,
        deviceName || currentToken.device_name,
        userAgent || null,
        ipAddress || null,
        expiresAt,
      ],
    );
    await client.query(
      `UPDATE public.refresh_tokens
       SET revoked_at = NOW(), replaced_by_token_id = $2, last_used_at = NOW()
       WHERE refresh_token_id = $1`,
      [currentToken.refresh_token_id, inserted.rows[0].refresh_token_id],
    );
    await client.query('COMMIT');
    return {
      user: {
        user_id: currentToken.user_id,
        role_id: currentToken.role_id,
        email: currentToken.email,
        full_name: currentToken.full_name,
        phone: currentToken.phone,
        address: currentToken.address,
        status: currentToken.status,
        created_at: currentToken.created_at,
        updated_at: currentToken.updated_at,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function revokeByHash(tokenHash) {
  const result = await pool.query(
    `UPDATE public.refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW()), last_used_at = NOW()
     WHERE token_family = (
       SELECT token_family FROM public.refresh_tokens WHERE token_hash = $1
     ) AND revoked_at IS NULL`,
    [tokenHash],
  );
  return result.rowCount > 0;
}

module.exports = { create, rotate, revokeByHash };
