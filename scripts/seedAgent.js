#!/usr/bin/env node
/**
 * Create an Agent and print its API key once.
 *
 * Usage:
 *   node scripts/seedAgent.js "Agent Name"
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('../src/config/config');
const Agent = require('../src/api/models/agent');

async function main() {
  const name = process.argv.slice(2).join(' ').trim() || 'Default Agent';
  const apiKey = crypto.randomBytes(24).toString('hex'); // 48 chars
  const apiKeyHash = await bcrypt.hash(apiKey, 12);

  await mongoose.connect(config.db.mongoUri, config.db.mongoOptions);
  const agent = await Agent.create({ name, apiKeyHash, active: true });
  // Print the key once; do not store in DB.
  console.log(`Agent created: ${agent._id} (${agent.name})`);
  console.log(`API key (store securely): ${apiKey}`);
  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

