// src/api/routes/slots.js
// Slot checking endpoints
const express = require('express');
const router = express.Router();
const slotBooker = require('../../modules/slotBooker');
const Application = require('../models/application');
const mongoose = require('mongoose');

// Get all active monitors
router.get('/monitors', async (req, res) => {
  const all = slotBooker.getMonitorStatus();
  const ids = Object.keys(all);
  if (ids.length === 0) {
    return res.json({ success: true, data: {}, count: 0 });
  }

  const agentId = req.agent?._id;
  const apps = await Application.find({ _id: { $in: ids }, agentId }).select('_id').lean();
  const allowed = new Set(apps.map((a) => String(a._id)));

  const data = {};
  for (const id of ids) {
    if (allowed.has(id)) data[id] = all[id];
  }

  res.json({
    success: true,
    data,
    count: Object.keys(data).length,
  });
});

// Stop a specific monitor
router.delete('/monitors/:applicationId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.applicationId)) {
    return res.status(400).json({ success: false, error: 'Invalid id' });
  }
  const app = await Application.findOne({ _id: req.params.applicationId, agentId: req.agent?._id })
    .select('_id')
    .lean();
  if (!app) return res.status(404).json({ success: false, error: 'Not found' });

  const stopped = slotBooker.stopMonitor(String(app._id));
  res.json({ success: true, stopped });
});

module.exports = router;
