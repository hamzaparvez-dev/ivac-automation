// src/api/models/agent.js
const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  apiKeyHash: { type: String, required: true },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
}, { minimize: false });

module.exports = mongoose.model('Agent', agentSchema);

