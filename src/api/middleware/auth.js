// src/api/middleware/auth.js
// API-key authentication for multi-agent B2B deployments.
const bcrypt = require('bcryptjs');
const Agent = require('../models/agent');

function extractApiKey(req) {
  const x = req.header('x-api-key');
  if (x) return String(x).trim();

  const auth = req.header('authorization');
  if (!auth) return null;
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : null;
}

async function authenticateApiKey(apiKey) {
  if (!apiKey) return null;
  const key = String(apiKey).trim();
  if (!key) return null;

  // Brute-force safe enough for small N; can be optimized later by key id prefix.
  const agents = await Agent.find({ active: true }).select('name apiKeyHash active').lean();
  for (const a of agents) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await bcrypt.compare(key, a.apiKeyHash);
    if (ok) return { _id: String(a._id), name: a.name };
  }
  return null;
}

async function requireAgentAuth(req, res, next) {
  try {
    const apiKey = extractApiKey(req);
    if (!apiKey) return res.status(401).json({ success: false, error: 'Missing API key' });

    const agent = await authenticateApiKey(apiKey);
    if (!agent) return res.status(401).json({ success: false, error: 'Invalid API key' });

    req.agent = agent;
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = requireAgentAuth;
module.exports.extractApiKey = extractApiKey;
module.exports.authenticateApiKey = authenticateApiKey;

