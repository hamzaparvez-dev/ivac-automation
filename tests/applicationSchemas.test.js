const { test } = require('node:test');
const assert = require('node:assert');

const { existingAccountBody, fullPipelineBody } = require('../src/api/validation/applicationSchemas');
const config = require('../src/config/config');

test('existingAccountBody rejects paymentMode=auto', () => {
  const body = {
    ivacPhone: '01712345678',
    ivacPassword: 'pass1234',
    ivacEmail: 'a@b.com',
    ivacLocation: Object.values(config.ivac.locations)[0],
    visaType: config.ivac.visaTypes[0],
    paymentMode: 'auto',
  };
  const { error } = existingAccountBody.validate(body);
  assert.ok(error);
});

test('fullPipelineBody accepts paymentMode=self', () => {
  const body = {
    ivacPassword: 'pass1234',
    ivacLocation: Object.values(config.ivac.locations)[0],
    visaType: config.ivac.visaTypes[0],
    paymentMode: 'self',
  };
  const { error } = fullPipelineBody.validate(body);
  assert.strictEqual(error, undefined);
});

