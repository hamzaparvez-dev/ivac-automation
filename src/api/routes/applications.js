// src/api/routes/applications.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Application = require('../models/application');
const pipeline = require('../../services/pipeline');
const pipelineQueue = require('../../services/pipelineQueue');
const slotBooker = require('../../modules/slotBooker');
const logger = require('../../services/logger');
const config = require('../../config/config');
const mongoose = require('mongoose');
const { makeListApplicationsQuerySchema } = require('../validation/querySchemas');
const {
  existingAccountBody,
  fullPipelineBody,
} = require('../validation/applicationSchemas');

function parseJsonSafe(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

module.exports = function (upload, io) {
  const router = express.Router();
  const statusValues = Application.schema.path('status')?.enumValues || [];
  const listQuerySchema = makeListApplicationsQuerySchema(statusValues);

  router.get('/', async (req, res) => {
    try {
      const { error: qErr, value: q } = listQuerySchema.validate(req.query, { stripUnknown: true });
      if (qErr) {
        return res.status(400).json({ success: false, error: qErr.details.map((d) => d.message).join('; ') });
      }

      const { status, date, page, limit } = q;
      const filter = {};
      if (status) filter.status = status;
      // Multi-tenant scoping: ignore client-supplied agentId
      filter.agentId = req.agent?._id;
      if (date) {
        const d = new Date(date);
        const next = new Date(d);
        next.setDate(d.getDate() + 1);
        filter.createdAt = { $gte: d, $lt: next };
      }

      const lim = limit;
      const pg = page;

      const [apps, total] = await Promise.all([
        Application.find(filter)
          .sort({ createdAt: -1 })
          .skip((pg - 1) * lim)
          .limit(lim)
          .lean(),
        Application.countDocuments(filter),
      ]);

      res.json({ success: true, data: apps, total, page: pg, limit: lim });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/stats/summary', async (req, res) => {
    try {
      const agentId = req.agent?._id;
      const [total, booked, failed, monitoring] = await Promise.all([
        Application.countDocuments({ agentId }),
        Application.countDocuments({ agentId, status: { $in: ['SLOT_BOOKED', 'COMPLETED'] } }),
        Application.countDocuments({ agentId, status: 'FAILED' }),
        Application.countDocuments({ agentId, status: 'MONITORING_SLOTS' }),
      ]);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTotal = await Application.countDocuments({ agentId, createdAt: { $gte: today } });

      res.json({
        success: true,
        data: {
          total,
          booked,
          failed,
          monitoring,
          todayTotal,
          successRate: total > 0 ? ((booked / total) * 100).toFixed(1) : '0',
          activeMonitors: slotBooker.monitorCount,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:id/logs', async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
      }
      const app = await Application.findOne({ _id: req.params.id, agentId: req.agent?._id })
        .select('logs applicantName status');
      if (!app) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, data: app.logs, status: app.status });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
      }
      const app = await Application.findOne({ _id: req.params.id, agentId: req.agent?._id }).lean();
      if (!app) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, data: app });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post(
    '/full-pipeline',
    upload.fields([
      { name: 'bgdPdf', maxCount: 1 },
      { name: 'photo', maxCount: 1 },
      { name: 'attendee1Pdf', maxCount: 1 },
      { name: 'attendee2Pdf', maxCount: 1 },
      { name: 'attendee3Pdf', maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        if (pipelineQueue.waitingCount() >= config.queue.maxWaiting) {
          return res.status(503).json({
            success: false,
            error: 'Pipeline queue full — try again shortly',
            retryAfter: 60,
          });
        }

        const bgdPdf = req.files?.bgdPdf?.[0];
        if (!bgdPdf) {
          return res.status(400).json({ error: 'BGD PDF file is required' });
        }

        const { error: joiErr, value: body } = fullPipelineBody.validate(req.body, {
          stripUnknown: true,
        });
        if (joiErr) {
          return res.status(400).json({
            error: joiErr.details.map((d) => d.message).join('; '),
          });
        }

        const {
          ivacPassword,
          ivacLocation,
          visaType,
          paymentMode,
        } = body;
        const agentId = req.agent?._id;

        const preferredDates = parseJsonSafe(body.preferredDates, []);

        const attendees = [];
        ['1', '2', '3'].forEach((n) => {
          const pdf = req.files?.[`attendee${n}Pdf`]?.[0];
          if (pdf) {
            attendees.push({
              bgdPdfPath: pdf.path,
              name: body[`attendee${n}Name`],
              passport: body[`attendee${n}Passport`],
            });
          }
        });

        const pipelineId = uuidv4();
        const application = await Application.create({
          pipelineId,
          agentId,
          status: 'PENDING',
          ivacLocation,
          visaType,
          paymentMode: paymentMode || 'self',
          preferredDates,
          attendees,
          logs: [{ status: 'QUEUED', timestamp: new Date() }],
        });

        const appId = application._id.toString();
        const params = {
          applicationId: appId,
          bgdPdfPath: bgdPdf.path,
          photoPath: req.files?.photo?.[0]?.path,
          ivacPassword,
          ivacLocation,
          visaType,
          paymentMode: paymentMode || 'self',
          preferredDates,
          agentId,
          attendees,
        };

        const emitUpdate = (result) => {
          const payload = {
            ...result,
            applicationId: result.application?._id?.toString() || appId,
          };
          io.to(`app:${appId}`).emit('pipelineUpdate', payload);
        };

        res.status(202).json({
          success: true,
          message: 'Pipeline started',
          applicationId: appId,
          pipelineId: application.pipelineId,
        });

        pipelineQueue
          .runPipeline(() => pipeline.runFullPipeline(params))
          .then(emitUpdate)
          .catch((err) => {
            logger.error(`Pipeline error: ${err.message}`);
            emitUpdate({
              success: false,
              error: err.message,
              application: application.toObject(),
            });
          });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.post('/existing-account', async (req, res) => {
    try {
      if (pipelineQueue.waitingCount() >= config.queue.maxWaiting) {
        return res.status(503).json({
          success: false,
          error: 'Pipeline queue full — try again shortly',
          retryAfter: 60,
        });
      }

      const { error: joiErr, value: body } = existingAccountBody.validate(req.body, {
        stripUnknown: true,
      });
      if (joiErr) {
        return res.status(400).json({
          error: joiErr.details.map((d) => d.message).join('; '),
        });
      }

      const {
        ivacPhone,
        ivacPassword,
        ivacEmail,
        ivacLocation,
        visaType,
        paymentMode,
        preferredDates: prefRaw,
        attendees,
      } = body;
      const agentId = req.agent?._id;

      const preferredDates = Array.isArray(prefRaw) ? prefRaw : parseJsonSafe(prefRaw, []);

      const pipelineId = uuidv4();
      const application = await Application.create({
        pipelineId,
        agentId,
        status: 'PENDING',
        phone: ivacPhone,
        email: ivacEmail,
        ivacLocation,
        visaType,
        paymentMode: paymentMode || 'self',
        preferredDates,
        attendees: Array.isArray(attendees) ? attendees : [],
        ivacRegistered: true,
        logs: [{ status: 'QUEUED', timestamp: new Date() }],
      });

      const appId = application._id.toString();

      const emitUpdate = (result) => {
        const payload = {
          ...result,
          applicationId: result.application?._id?.toString() || appId,
        };
        io.to(`app:${appId}`).emit('pipelineUpdate', payload);
      };

      res.status(202).json({
        success: true,
        message: 'Existing account pipeline started',
        applicationId: appId,
        pipelineId: application.pipelineId,
      });

      pipelineQueue
        .runPipeline(() =>
          pipeline.runExistingAccountPipeline({
            applicationId: appId,
            ivacPhone,
            ivacPassword,
            ivacEmail,
            ivacLocation,
            visaType,
            paymentMode: paymentMode || 'self',
            preferredDates: application.preferredDates,
            attendees: application.attendees,
            agentId,
          })
        )
        .then(emitUpdate)
        .catch((err) => {
          logger.error(err.message);
          emitUpdate({
            success: false,
            error: err.message,
            application: application.toObject(),
          });
        });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/:id/stop', async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
      }
      const app = await Application.findOne({ _id: req.params.id, agentId: req.agent?._id });
      if (!app) return res.status(404).json({ error: 'Not found' });

      const stopped = slotBooker.stopMonitor(req.params.id);
      app.status = 'STOPPED';
      app.logs.push({
        status: 'STOPPED',
        timestamp: new Date(),
        message: 'Manually stopped',
      });
      await app.save();
      res.json({ success: true, stopped });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
