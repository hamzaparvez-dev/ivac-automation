const { test } = require('node:test');
const assert = require('node:assert');

const Application = require('../src/api/models/application');
const { makeListApplicationsQuerySchema } = require('../src/api/validation/querySchemas');

test('list applications query rejects operator injection objects', () => {
  const statusValues = Application.schema.path('status').enumValues;
  const schema = makeListApplicationsQuerySchema(statusValues);
  const { error } = schema.validate({ status: { $ne: '' } });
  assert.ok(error);
});

test('list applications query accepts normal inputs', () => {
  const statusValues = Application.schema.path('status').enumValues;
  const schema = makeListApplicationsQuerySchema(statusValues);
  const { error, value } = schema.validate({ status: statusValues[0], page: 1, limit: 20 });
  assert.strictEqual(error, undefined);
  assert.strictEqual(value.page, 1);
});

