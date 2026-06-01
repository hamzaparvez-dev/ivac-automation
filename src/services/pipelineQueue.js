// src/services/pipelineQueue.js
// Limits concurrent full / existing-account pipelines (p-queue)
const PQueue = require('p-queue').default;
const config = require('../config/config');

const queue = new PQueue({ concurrency: config.queue.concurrency });

function waitingCount() {
  return queue.size + queue.pending;
}

/**
 * Run a pipeline job when a slot is available. Rejects if backlog exceeds maxWaiting.
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runPipeline(fn) {
  const max = config.queue.maxWaiting;
  if (waitingCount() >= max) {
    const err = new Error(`Pipeline queue saturated (max waiting: ${max})`);
    err.code = 'QUEUE_FULL';
    throw err;
  }
  return queue.add(fn);
}

module.exports = {
  runPipeline,
  waitingCount,
  async onIdle(timeoutMs = 10_000) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
    const done = queue.onIdle().then(() => true);
    return Promise.race([done, timeout]);
  },
  get concurrency() {
    return config.queue.concurrency;
  },
};
