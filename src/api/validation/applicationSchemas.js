// src/api/validation/applicationSchemas.js
const Joi = require('joi');
const config = require('../../config/config');

const locationValues = Object.values(config.ivac.locations || {});
const visaValues = config.ivac.visaTypes || [];

const existingAccountBody = Joi.object({
  ivacPhone: Joi.string().trim().min(10).max(20).required(),
  ivacPassword: Joi.string().min(4).max(200).required(),
  ivacEmail: Joi.string().email().allow('', null),
  ivacLocation: Joi.string()
    .valid(...locationValues)
    .required(),
  visaType: Joi.string()
    .valid(...visaValues)
    .required(),
  paymentMode: Joi.string().valid('self', 'manual').default('self'),
  preferredDates: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).default([]),
  agentId: Joi.string().allow('', null),
  attendees: Joi.array().default([]),
});

const fullPipelineBody = Joi.object({
  ivacPassword: Joi.string().min(4).max(200).required(),
  ivacLocation: Joi.string()
    .valid(...locationValues)
    .required(),
  visaType: Joi.string()
    .valid(...visaValues)
    .required(),
  paymentMode: Joi.string().valid('self', 'manual').default('self'),
  preferredDates: Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string()).default([]),
  agentId: Joi.string().allow('', null),
  attendee1Name: Joi.string().allow(''),
  attendee1Passport: Joi.string().allow(''),
  attendee2Name: Joi.string().allow(''),
  attendee2Passport: Joi.string().allow(''),
  attendee3Name: Joi.string().allow(''),
  attendee3Passport: Joi.string().allow(''),
}).unknown(true);

module.exports = {
  existingAccountBody,
  fullPipelineBody,
};
