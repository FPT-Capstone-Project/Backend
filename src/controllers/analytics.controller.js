const analyticsService = require('../services/analytics.service');

async function dashboard(req, res) {
  const data = await analyticsService.getDashboard();
  res.json({ data });
}

module.exports = { dashboard };
