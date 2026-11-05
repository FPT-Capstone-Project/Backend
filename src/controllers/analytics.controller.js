const analyticsService = require('../services/analytics.service');

async function dashboard(req, res) {
  const data = await analyticsService.getDashboard();
  res.json({ data });
}

async function environmentHistory(req, res) {
  res.json({ data: await analyticsService.getEnvironmentHistory(req.query) });
}

module.exports = { dashboard, environmentHistory };
