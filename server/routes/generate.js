const express = require('express');
const router = express.Router();

const path = require('path');
const { collectSources } = require('../services/collector');
const { draftPost } = require('../services/blogWriter');
const { findAndVerifyImage } = require('../services/imageFinder');
const { generateThumbnail } = require('../services/thumbnailGenerator');
const { recordKeywordUsed } = require('../services/topicPlanner');
const { loadSettings } = require('../config');

/**
 * POST /api/generate
 * body: { keyword: string, category: string }
 *
 * category는 네이버 블로그 카테고리명(예: "건강정보", "재테크", "IT정보", "시사이슈", "이슈/트렌드")이다.
 * blogWriter.js가 이 값으로 페르소나/카테고리별 규칙을 결정하고, /api/publish에서
 * naverPublisher.js가 같은 값으로 실제 네이버 카테고리 선택을 시도한다.
 *
 * 1) 키워드로 뉴스 수집 (collector.js - 구글 뉴스 RSS) + 설정에 등록된 네이버 블로그의
 *    공식 RSS에서 정보 다양성 참고용 글 수집
 * 2) Claude(-p)로 카테고리별 초안 작성 (섹션별 imageQuery + 태그 + keyPhrase 포함)
 * 3) 섹션별 이미지 검색 + AI 적합성 판단 -> 로컬 다운로드 (imageFinder.js - 스톡 이미지 토큰 그대로 재사용)
 * 4) 섬네일 이미지 자동 생성 (thumbnailGenerator.js)
 * 5) 완성된 초안(JSON)을 프론트로 반환 (발행은 /api/publish에서 별도 처리)
 */
router.post('/', async (req, res) => {
  const { keyword, category } = req.body || {};
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ error: 'keyword를 입력해주세요.' });
  }
  if (!category || !category.trim()) {
    return res.status(400).json({ error: 'category를 선택해주세요.' });
  }

  try {
    const settings = loadSettings();

    console.log(`[generate] 시작 - 카테고리: "${category}" / 키워드: "${keyword.trim()}"`);
    console.log('[generate] 1/4 뉴스 수집 중…');
    const sources = await collectSources(keyword.trim(), { naverBlogIds: settings.naverReferenceBlogIds });
    console.log(
      `[generate] 1/4 뉴스 수집 완료 - 뉴스 ${sources.news.length}건, 참고 블로그 글 ${sources.blogs.length}건`
    );
    if (sources.news.length === 0) {
      const detail = sources.errors.length
        ? sources.errors.join(' / ')
        : '해당 키워드로는 검색 결과가 없었습니다. 다른 키워드로 시도해보세요.';
      return res.status(422).json({ error: `글감을 수집하지 못했습니다: ${detail}` });
    }

    console.log('[generate] 2/4 Claude로 초안 작성 중… (claude -p 호출, 몇 분 걸릴 수 있음)');
    const draft = await draftPost(sources, category.trim());
    console.log(`[generate] 2/4 초안 작성 완료 - 섹션 ${draft.sections.length}개`);

    // 섹션별 이미지 매칭 (병렬 처리하면 API 레이트리밋 걸릴 수 있어 순차 처리)
    console.log('[generate] 3/4 섹션별 이미지 검색 중…');
    for (const [i, section] of draft.sections.entries()) {
      if (!section.imageQuery) continue;
      const image = await findAndVerifyImage(section.imageQuery, section.body, settings.imageSource);
      section.imageLocalPath = image ? image.localPath : null; // 발행(publish) 단계에서 실제 업로드에 사용
      section.imageUrl = image ? `/images/${path.basename(image.localPath)}` : null; // 대시보드 미리보기용
      section.imageCredit = image ? image.credit : null;
      console.log(`[generate] 3/4 섹션 ${i + 1}/${draft.sections.length} 이미지 ${image ? '찾음' : '못찾음'}`);
    }

    // 섬네일 자동 생성 (검은 배경 + 핵심 문구 노란 강조 스타일)
    console.log('[generate] 4/4 섬네일 생성 중…');
    let thumbnail = null;
    try {
      thumbnail = await generateThumbnail(draft.title, draft.keyPhrase);
      console.log('[generate] 4/4 섬네일 생성 완료');
    } catch (e) {
      console.warn('[generate] 섬네일 생성 실패(발행에는 지장 없음):', e.message);
    }

    recordKeywordUsed(keyword.trim());
    console.log('[generate] 전체 완료, 응답 전송');

    res.json({
      sources: { news: sources.news, blogs: sources.blogs },
      draft,
      thumbnail,
      autoPublish: settings.autoPublish,
      category: category.trim(),
    });
  } catch (e) {
    console.error('[generate] 오류:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
