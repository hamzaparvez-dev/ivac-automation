#!/usr/bin/env node
/**
 * Smoke test: load env from repo root, connect to MongoDB, exit 0/1.
 */
const mongoose = require('mongoose');
const config = require('../src/config/config');

async function main() {
  const uri = config.db.mongoUri;
  await mongoose.connect(uri, config.db.mongoOptions);
  await mongoose.connection.db.admin().ping();
  console.log('MongoDB OK');
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error('Connection failed:', err.message);
  process.exit(1);
});
