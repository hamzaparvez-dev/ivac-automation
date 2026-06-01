// src/api/validation/querySchemas.js
const Joi = require('joi');

function makeListApplicationsQuerySchema(statusValues) {
  return Joi.object({
    status: Joi.string().valid(...statusValues).optional(),
    date: Joi.date().iso().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }).unknown(false);
}

module.exports = {
  makeListApplicationsQuerySchema,
};

