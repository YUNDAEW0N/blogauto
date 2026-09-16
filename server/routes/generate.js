const express = require('express');
const router = express.Router();

const path = require('path');
const { collectSources } = require('../services/collector');
const { draftPost } = require('../services/blogWriter');
const { findAndVerifyImage, downloadImage } = require('../services/imageFinder');
const { generateThumbnail } = require('../services/thumbnailGenerator');
const { recordKeywordUsed, getTrendImageCandidates } = require('../services/topicPlanner');
const { loadSettings } = require('../config');

const TREND_CATEGORY = '이슈/트렌드';

/**
 * "이슈/트렌드" 글은 스톡 이미지 대신, 가능하면 그 트렌드에 실제로 딸린 뉴스
 * 사진(구글 트렌드 피드의 ht:picture/ht:news_item_picture)을 쓴다. 인물/현장이
 * 실제로 나오는 사진이라 몰입감은 높지만, 언론사가 저작권을 가진 뉴스 사진이라
 * 반드시 출처를 본문에 표기해야 한다(사용자 확인 후 적용된 정책).
 *
 * 다운로드 자체가 실패하면(링크 만료 등) null을 반환해서 호출부가 스톡 이미지로
 * 폴백하게 한다.
 */
async function downloadRealNewsImage(candidate) {
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  try {
    const localPath = await downloadImage(candidate.url, safeName);
    const attribution = candidate.source ? `사진 출처: ${candidate.source}` : '사진 출처: 뉴스';
    return { localPath, credit: attribution, sourceUrl: candidate.sourceUrl || null, sourceName: candidate.source || '뉴스' };
  } catch (e) {
    console.warn('[generate] 실제 뉴스 이미지 다운로드 실패, 스톡 이미지로 대체:', e.message);
    return null;
  }
}

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
 * 3) 섹션별 이미지 검색 + AI 적합성 판단 -> 로컬 다운로드 (imageFinder.js - 스톡 이미지 토큰 그대로 재사용).
 *    "이슈/트렌드"는 그 트렌드에 실제로 딸린 뉴스 사진(구글 트렌드 ht:picture 등)을
 *    먼저 시도하고, 쓰면 본문에 "(사진 출처: 언론사, 원문: 링크)"를 자동으로 남긴다.
 * 4) 섬네일 이미지 자동 생성 (thumbnailGenerator.js)
 * 5) 완성된 초안(JSON)을 프론트로 반환 (발행은 /api/publish에서 별도 처리)
 */
router.post('/', async (req, res) => {
  const { keyword, category, trendImages } = req.body || {};
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

    // "이슈/트렌드"는 가능하면 그 트렌드에 실제로 딸린 뉴스 사진을 먼저 써본다
    // (없거나 다운로드 실패 시 스톡 이미지로 자연스럽게 폴백). 트렌드 목록을
    // "고른 시점"에 프론트가 함께 보내준 trendImages를 우선 쓴다 - 지금 다시
    // 트렌드를 조회해서 keyword로 매칭하면, 몇 분 걸리는 초안 작성 사이에
    // 트렌드 목록이 바뀌어(5~10분 주기) 방금 고른 트렌드가 최신 스냅샷에
    // 없을 수 있다 (사진을 못 찾고 스톡으로 새는 원인이었음). trendImages가
    // 안 왔을 때만(예: 구버전 프론트, 직접입력 폴백) 다시 조회를 시도한다.
    let realImagePool = [];
    if (category.trim() === TREND_CATEGORY) {
      realImagePool = Array.isArray(trendImages) && trendImages.length
        ? trendImages
        : await getTrendImageCandidates(keyword.trim()).catch(() => []);
    }

    // 섹션별 이미지 매칭 (병렬 처리하면 API 레이트리밋 걸릴 수 있어 순차 처리)
    console.log('[generate] 3/4 섹션별 이미지 검색 중…');
    for (const [i, section] of draft.sections.entries()) {
      if (!section.imageQuery) continue;

      let image = null;
      let realPhoto = null;
      if (realImagePool.length) {
        realPhoto = await downloadRealNewsImage(realImagePool.shift());
        if (realPhoto) image = realPhoto;
      }
      if (!image) {
        image = await findAndVerifyImage(section.imageQuery, section.body, settings.imageSource);
      }

      section.imageLocalPath = image ? image.localPath : null; // 발행(publish) 단계에서 실제 업로드에 사용
      section.imageUrl = image ? `/images/${path.basename(image.localPath)}` : null; // 대시보드 미리보기용
      section.imageCredit = image ? image.credit : null;

      // 실제 뉴스 사진은 저작권자(언론사) 표기를 본문에도 눈에 보이게 남긴다.
      // 대시보드에서 발행 전에 자유롭게 수정/삭제할 수 있다.
      if (realPhoto) {
        const attribution = realPhoto.sourceUrl
          ? `(사진 출처: ${realPhoto.sourceName}, 원문: ${realPhoto.sourceUrl})`
          : `(사진 출처: ${realPhoto.sourceName})`;
        section.body = `${section.body}\n\n${attribution}`;
      }

      console.log(
        `[generate] 3/4 섹션 ${i + 1}/${draft.sections.length} 이미지 ${image ? (realPhoto ? '찾음(실제 뉴스 사진)' : '찾음(스톡)') : '못찾음'}`
      );
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
