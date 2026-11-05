const analyticsModel = require('../models/analytics.model');
const AppError = require('../utils/app-error');

async function getDashboard() {
  const [revenue, trays, harvest] = await Promise.all([
    analyticsModel.getDashboardRevenue(),
    analyticsModel.getDashboardTraysUsed(),
    analyticsModel.getDashboardHarvestQuality(),
  ]);
  const totalWeight = Number(harvest?.total_weight ?? 0);
  const rate = (weight) => totalWeight > 0
    ? Number((Number(weight ?? 0) / totalWeight * 100).toFixed(2))
    : 0;
  return {
    revenue: { value: Number(revenue?.revenue ?? 0), currency: 'VND' },
    trays_used: Number(trays?.trays_used ?? 0),
    harvest_quality: {
      usable_rate: rate(harvest?.usable_weight),
      waste_rate: rate(harvest?.rejected_weight),
    },
  };
}

async function getEnvironmentHistory(query = {}) {
  const windowMs = 24 * 60 * 60 * 1000;
  const bucketMs = 15 * 60 * 1000;
  const refreshMs = 5 * 60 * 1000;
  const hasFrom = query.from !== undefined;
  const hasTo = query.to !== undefined;
  if (hasFrom !== hasTo) throw new AppError('from and to must be supplied together', 400);
  const parseTime = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
      throw new AppError('from and to must be ISO timestamps with a timezone', 400);
    }
    return Date.parse(value);
  };
  const to = hasTo ? parseTime(query.to) : Math.floor(Date.now() / refreshMs) * refreshMs;
  const from = hasFrom ? parseTime(query.from) : to - windowMs;
  if (from >= to || to - from > windowMs) {
    throw new AppError('Time range must be positive and at most 24 hours', 400);
  }
  return {
    from, to, bucketMs, refreshAfterMs: refreshMs,
    floors: await analyticsModel.getEnvironmentHistory({
      from: new Date(from).toISOString(), to: new Date(to).toISOString(), bucketMs,
    }),
  };
}

module.exports = { getDashboard, getEnvironmentHistory };
