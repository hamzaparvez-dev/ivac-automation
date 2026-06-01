// src/api/routes/uploads.js
// Auth-gated download access to uploaded files (BGD PDFs/photos/docs).
const express = require('express');
const path = require('path');

const router = express.Router();

const ALLOWED_TYPES = new Set(['bgd', 'photos', 'documents']);

router.get('/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ success: false, error: 'Invalid type' });
  }

  // Prevent path traversal
  const safeName = path.basename(String(filename));
  const repoRoot = path.join(__dirname, '../../..');
  const filePath = path.join(repoRoot, 'uploads', type, safeName);

  return res.sendFile(filePath, (err) => {
    if (err) {
      res.status(err.statusCode || 404).json({ success: false, error: 'Not found' });
    }
  });
});

module.exports = router;

