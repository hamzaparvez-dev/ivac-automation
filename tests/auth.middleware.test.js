const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const Agent = require('../src/api/models/agent');
const requireAgentAuth = require('../src/api/middleware/auth');
const { authenticateApiKey } = require('../src/api/middleware/auth');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
}

test('authenticateApiKey returns agent for valid key', async () => {
  const apiKey = 'test_key_123';
  const hash = await bcrypt.hash(apiKey, 4);
  Agent.find = () => ({
    select: () => ({
      lean: async () => [{ _id: 'agent1', name: 'A', apiKeyHash: hash, active: true }],
    }),
  });

  const agent = await authenticateApiKey(apiKey);
  assert.ok(agent);
  assert.strictEqual(agent._id, 'agent1');
});

test('authenticateApiKey returns null for invalid key', async () => {
  const hash = await bcrypt.hash('some_other_key', 4);
  Agent.find = () => ({
    select: () => ({
      lean: async () => [{ _id: 'agent1', name: 'A', apiKeyHash: hash, active: true }],
    }),
  });

  const agent = await authenticateApiKey('wrong');
  assert.strictEqual(agent, null);
});

test('requireAgentAuth returns 401 when missing key', async () => {
  const req = { header: () => null };
  const res = makeRes();
  let calledNext = false;
  await requireAgentAuth(req, res, () => { calledNext = true; });
  assert.strictEqual(calledNext, false);
  assert.strictEqual(res.statusCode, 401);
});

