const analyticsModel = require('../models/analytics.model');

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

module.exports = { getDashboard };
