#!/usr/bin/env node
// STANDALONE Slot Monitor — loads .env from repo root via config
// Usage: node scripts/slotMonitor.js --phone 01X --password "Pass@123" --location "Dhaka (Gulshan)" --visa Tourist
require('../src/config/config');
const slotBooker = require('../src/modules/slotBooker');
const logger = require('../src/services/logger');
const browserManager = require('../src/modules/browser');

let currentAppId = null;

async function shutdown(signal, appId) {
  try {
    if (appId) slotBooker.stopMonitor(appId);
  } catch {
    /* ignore */
  }
  try {
    await browserManager.closeAll();
  } catch {
    /* ignore */
  }
  logger.warn(`${signal}: exiting`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const phone = get('--phone');
  const password = get('--password');
  const location = get('--location');
  const visa = get('--visa') || 'Tourist';
  const maxAttempts = parseInt(get('--max-attempts') || '0') || Infinity;

  if (!phone || !password || !location) {
    console.error('Usage: node slotMonitor.js --phone 01X --password "Pass@123" --location "Dhaka (Gulshan)" --visa Tourist');
    process.exit(1);
  }

  logger.info(`
╔══════════════════════════════════════════╗
║     IVAC SLOT MONITOR - STANDALONE       ║
╠══════════════════════════════════════════╣
║  Phone    : ${phone.padEnd(28)}║
║  Location : ${location.padEnd(28)}║
║  Visa     : ${visa.padEnd(28)}║
║  Max Tries: ${String(maxAttempts).padEnd(28)}║
╚══════════════════════════════════════════╝
  `);

  currentAppId = `standalone_${Date.now()}`;
  const result = await slotBooker.monitorAndBook(
    { phone, password },
    {
      applicationId: currentAppId,
      ivacLocation: location,
      visaType: visa,
      preferredDates: [],
      attendees: [],
    },
    {
      startAt5PM: true,
      maxAttempts,
    }
  );

  if (result.success) {
    logger.info(`🎉 SUCCESS! Appointment booked:`);
    logger.info(JSON.stringify(result.appointment, null, 2));
  } else {
    logger.warn(`❌ Monitor ended: ${result.reason}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  logger.error(err.message);
  process.exit(1);
});

process.once('SIGINT', () => shutdown('SIGINT', currentAppId));
process.once('SIGTERM', () => shutdown('SIGTERM', currentAppId));
