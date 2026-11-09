const pool = require('../src/config/db');
const environmentHistoryModel = require('../src/models/cultivationEnvironmentHistory.model');

const PERIOD_MS = 10 * 60 * 1000;
const PERIODS_PER_BATCH = 100;
const LOCK_KEY = 62005;
const ORIGIN = '2000-01-01 00:00:00+00';

function createJob(repository = pool, logger = console, now = () => new Date()) {
  let timer;
  let pending;
  let stopping = false;

  async function run() {
    if (pending) return pending;
    pending = runExclusive()
      .catch((error) => {
        logger.error('Không thể lưu lịch sử môi trường trồng nấm:', error);
        return 0;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  async function runExclusive() {
    const startedAt = Date.now();
    const client = await repository.connect();
    let ownsLock = false;
    let destroyClient = false;
    let savedCount = 0;
    let batchCount = 0;
    try {
      const lock = await client.query(
        'SELECT pg_try_advisory_lock($1, 1) AS acquired',
        [LOCK_KEY],
      );
      ownsLock = lock.rows[0].acquired;
      if (!ownsLock) {
        logger.info?.('Bỏ qua job lịch sử môi trường vì instance khác đang xử lý');
        return 0;
      }

      while (!stopping) {
        await client.query('BEGIN');
        try {
          const periods = await client.query(
            `WITH bounds AS (
               SELECT date_bin(
                 INTERVAL '10 minutes',
                 $1::timestamptz - INTERVAL '10 minutes',
                 $2::timestamptz
               ) AS latest_period_start
             ),
             active_session_floors AS (
               SELECT s.session_id, f.floor_id, MIN(st.assigned_at) AS assigned_at, s.start_at
               FROM cultivation_sessions s
               INNER JOIN cultivation_session_trays st
                 ON st.session_id = s.session_id AND st.status = 'ACTIVE'
               INNER JOIN cultivation_trays t
                 ON t.tray_id = st.tray_id AND t.status = 'OCCUPIED'
               INNER JOIN cultivation_floors f
                 ON f.floor_id = t.floor_id AND f.status = 'ACTIVE'
               WHERE s.status = 'CULTIVATING'
                 AND s.start_at::timestamptz < (SELECT latest_period_start FROM bounds)
               GROUP BY s.session_id, f.floor_id, s.start_at
             )
             SELECT DISTINCT buckets.period_start
             FROM active_session_floors sf
             CROSS JOIN bounds
             CROSS JOIN LATERAL generate_series(
               date_bin(
                 INTERVAL '10 minutes',
                 GREATEST(sf.start_at::timestamptz, sf.assigned_at::timestamptz),
                 $2::timestamptz
               ),
               bounds.latest_period_start - INTERVAL '10 minutes',
               INTERVAL '10 minutes'
             ) AS buckets(period_start)
             WHERE NOT EXISTS (
               SELECT 1
               FROM cultivation_environment_history h
               WHERE h.session_id = sf.session_id
                 AND h.floor_id = sf.floor_id
                 AND h.period_start = buckets.period_start
             )
             ORDER BY buckets.period_start
             LIMIT $3`,
            [now(), ORIGIN, PERIODS_PER_BATCH],
          );
          if (periods.rows.length === 0) {
            await client.query('COMMIT');
            break;
          }

          for (const { period_start: periodStart } of periods.rows) {
            const periodEnd = new Date(new Date(periodStart).getTime() + PERIOD_MS);
            const result = await client.query(
              environmentHistoryModel.aggregatePeriodSql,
              [periodStart, periodEnd],
            );
            savedCount += result.rowCount;
          }
          batchCount += 1;
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }

      logger.info?.('Đã xử lý lịch sử môi trường trồng nấm', {
        savedCount,
        batchCount,
        durationMs: Date.now() - startedAt,
      });
      return savedCount;
    } finally {
      if (ownsLock) {
        try {
          await client.query('SELECT pg_advisory_unlock($1, 1)', [LOCK_KEY]);
        } catch (error) {
          destroyClient = true;
          logger.error('Không thể nhả khóa job lịch sử môi trường:', error);
        }
      }
      client.release(destroyClient);
    }
  }

  function scheduleNext() {
    if (stopping) return;
    const delay = PERIOD_MS - (Date.now() % PERIOD_MS);
    timer = setTimeout(async () => {
      await run();
      scheduleNext();
    }, delay);
    timer.unref();
  }

  return {
    run,
    start() {
      if (timer || stopping) return;
      stopping = false;
      void run();
      scheduleNext();
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      timer = null;
      if (pending) await pending;
    },
  };
}

module.exports = { ...createJob(), createJob };
