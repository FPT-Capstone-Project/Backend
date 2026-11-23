const analyticsService = require('../services/analytics.service');

async function dashboard(req, res) {
  const data = await analyticsService.getDashboard();
  res.json({ data });
}

async function environmentHistory(req, res) {
  res.json({ data: await analyticsService.getEnvironmentHistory(req.query) });
}

async function latestEnvironment(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await analyticsService.getLatestEnvironment() });
}

module.exports = { dashboard, environmentHistory, latestEnvironment };
