const pool = require('../config/db');

async function getDashboardRevenue() {
  const result = await pool.query(
    'SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE payment_status = $1',
    ['PAID'],
  );
  return result.rows[0];
}

async function getDashboardTraysUsed() {
  const result = await pool.query(
    `SELECT COUNT(st.session_tray_id) AS trays_used
     FROM cultivation_session_trays st
     INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
     INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
     WHERE st.status = ANY($1::text[]) AND s.status = ANY($2::text[])`,
    [['ACTIVE', 'RELEASED'], ['CULTIVATING', 'HARVEST_READY', 'HARVESTING', 'COMPLETED']],
  );
  return result.rows[0];
}

async function getDashboardHarvestQuality() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(total_weight_kg), 0) AS total_weight,
            COALESCE(SUM(usable_weight_kg), 0) AS usable_weight,
            COALESCE(SUM(rejected_weight_kg), 0) AS rejected_weight
     FROM harvests
     WHERE status = $1
       AND total_weight_kg >= 0 AND usable_weight_kg >= 0 AND rejected_weight_kg >= 0`,
    ['COMPLETED'],
  );
  return result.rows[0];
}

module.exports = { getDashboardRevenue, getDashboardTraysUsed, getDashboardHarvestQuality };
