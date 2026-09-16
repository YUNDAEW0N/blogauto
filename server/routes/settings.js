const express = require('express');
const router = express.Router();
const { loadSettings, saveSettings } = require('../config');
const { RECOMMENDED_BLOGS } = require('../services/recommendedBlogs');

router.get('/', (req, res) => {
  res.json(loadSettings());
});

/** GET /api/settings/recommended-blogs - 카테고리별 참고 블로그 기본 추천 목록 */
router.get('/recommended-blogs', (req, res) => {
  res.json({ recommendedBlogs: RECOMMENDED_BLOGS });
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
