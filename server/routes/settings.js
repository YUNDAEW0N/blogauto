const express = require('express');
const router = express.Router();
const { loadSettings, saveSettings } = require('../config');

router.get('/', (req, res) => {
  res.json(loadSettings());
});

function normalizeBlogIds(value) {
  if (Array.isArray(value)) return value.map((id) => String(id).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

router.post('/', (req, res) => {
  const { autoPublish, imageSource, naverBlogId, naverReferenceBlogIds } = req.body || {};
  const updated = saveSettings({
    ...(autoPublish !== undefined && { autoPublish }),
    ...(imageSource !== undefined && { imageSource }),
    ...(naverBlogId !== undefined && { naverBlogId }),
    ...(naverReferenceBlogIds !== undefined && { naverReferenceBlogIds: normalizeBlogIds(naverReferenceBlogIds) }),
  });
  res.json(updated);
});

module.exports = router;
