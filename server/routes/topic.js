const express = require('express');
const router = express.Router();
const { GROUPS, NAVER_CATEGORIES, suggestNextKeyword, listTrendCandidates } = require('../services/topicPlanner');

/** GET /api/topic/naver-categories - 네이버 블로그 카테고리 선택 드롭다운용 목록 */
router.get('/naver-categories', (req, res) => {
  res.json({ categories: NAVER_CATEGORIES });
});

/** GET /api/topic/categories - 카테고리별 세부 키워드 그룹 전체 목록 (참고/수동 선택용) */
router.get('/categories', (req, res) => {
  res.json({ groups: GROUPS });
});

/**
 * GET /api/topic/suggest?category=건강정보
 * 로테이션상 다음으로 추천되는 키워드 (부작용 없음).
 * category(네이버 블로그 카테고리명)가 "시사이슈"면 실시간 헤드라인에서, "이슈/트렌드"면
 * 구글 트렌드 실시간 인기 검색어에서 고른다.
 */
router.get('/suggest', async (req, res) => {
  try {
    const suggestion = await suggestNextKeyword(req.query.category);
    if (!suggestion) {
      return res.status(404).json({ error: '추천할 키워드를 찾지 못했습니다.' });
    }
    res.json(suggestion);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/topic/trend-candidates
 * "이슈/트렌드" 카테고리용 - 대시보드에서 사람이 직접 골라 쓸 수 있게
 * 실시간 인기 검색어 상위 여러 개를 반환한다 (부작용 없음).
 */
router.get('/trend-candidates', async (req, res) => {
  try {
    const candidates = await listTrendCandidates(10);
    res.json({ candidates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
