const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { publishPost } = require('../services/naverPublisher');
const { loadSettings, DATA_DIR } = require('../config');

/**
 * generate 단계에서 만든 섬네일은 `/images/{filename}` URL로 프론트에 내려가는데,
 * 그 파일은 실제로 DATA_DIR/images/{filename}에 로컬 저장되어 있다(thumbnailGenerator.js).
 * 발행 시 Playwright가 파일 업로드에 쓸 수 있도록 URL을 다시 로컬 경로로 되돌린다.
 * path.basename으로 디렉터리 이동 요소를 제거해 다른 경로를 가리키지 못하게 한다.
 */
function resolveThumbnailLocalPath(thumbnailUrl) {
  if (!thumbnailUrl) return null;
  const filename = path.basename(thumbnailUrl);
  const localPath = path.join(DATA_DIR, 'images', filename);
  return fs.existsSync(localPath) ? localPath : null;
}

/**
 * POST /api/publish
 * body: { title, sections, forcePublish?, thumbnailUrl?, scheduledAt?, category? }
 *
 * autoPublish 설정이 꺼져 있으면(승인 모드) 프론트에서 사용자가
 * "발행하기" 버튼을 눌렀을 때만 이 라우트가 호출되며, 이 경우 forcePublish=true로 보낸다.
 *
 * scheduledAt이 오면(예: "2026-10-20T15:30", datetime-local input 값) 예약 발행으로
 * 처리한다 - naverPublisher.js가 발행 설정 레이어에서 "예약"을 선택하고 날짜/시간을
 * 지정한 뒤 등록한다. 예약이 지정되면 autoPublish 여부와 무관하게 발행 레이어를 연다.
 *
 * category가 오면(/api/generate 응답에서 받은 네이버 블로그 카테고리명) naverPublisher.js가
 * 발행 설정 레이어에서 같은 이름의 카테고리 선택을 시도한다. 해당 이름의 카테고리가
 * 네이버 블로그에 아직 없으면(예: 새로 만들어야 하는 카테고리) 경고만 남기고 카테고리
 * 선택 없이(기존 선택값 그대로) 발행을 계속한다.
 */
router.post('/', async (req, res) => {
  const { title, sections, forcePublish, placeQuery, thumbnailUrl, scheduledAt, category } = req.body || {};
  if (!title || !Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'title과 sections가 필요합니다.' });
  }
  if (scheduledAt && Number.isNaN(new Date(scheduledAt).getTime())) {
    return res.status(400).json({ error: `scheduledAt 형식이 올바르지 않습니다: ${scheduledAt}` });
  }

  try {
    const settings = loadSettings();
    const autoPublish = forcePublish === true ? true : settings.autoPublish;
    const thumbnailLocalPath = resolveThumbnailLocalPath(thumbnailUrl);

    const result = await publishPost({
      title,
      sections,
      autoPublish,
      placeQuery,
      thumbnailLocalPath,
      scheduledAt: scheduledAt || null,
      category: category || null,
    });
    res.json(result);
  } catch (e) {
    console.error('[publish] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
