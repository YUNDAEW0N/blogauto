/**
 * 섹션별 imageQuery로 이미지를 찾고, AI(judgeImageFit)로 적합성을 판단해
 * 최종 사용할 이미지를 골라 로컬에 다운로드한다.
 *
 * 이미지 소스:
 *  - stock : Unsplash / Pixabay 무료 스톡 이미지 (저작권 안전)
 *  - ai    : 이미지 생성 API 연동 지점 (기본 미구현 - 아래 generateAiImage 참고)
 *  - auto  : stock 우선 시도, 실패하면 ai로 폴백
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { UNSPLASH_ACCESS_KEY, PIXABAY_API_KEY, DATA_DIR } = require('../config');
const { judgeImageFit } = require('./aiWriter');

const IMAGE_DIR = path.join(DATA_DIR, 'images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

async function searchUnsplash(query) {
  if (!UNSPLASH_ACCESS_KEY) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&client_id=${UNSPLASH_ACCESS_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((r) => ({ url: r.urls.regular, credit: `Unsplash / ${r.user.name}` }));
}

async function searchPixabay(query) {
  if (!PIXABAY_API_KEY) return [];
  const url = `https://pixabay.com/api/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&image_type=photo&per_page=5`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.hits || []).map((r) => ({ url: r.largeImageURL, credit: 'Pixabay' }));
}

// AI 이미지 생성은 서비스마다 API가 달라 여기서는 연동 지점만 남겨둔다.
// 예: OpenAI Images API, Stability AI, 또는 다른 이미지 생성 서비스의 API 키를 발급받아 구현
async function generateAiImage(/* query */) {
  throw new Error(
    'AI 이미지 생성은 아직 연동되지 않았습니다. imageFinder.js의 generateAiImage()에 ' +
      '사용할 이미지 생성 API(OpenAI Images, Stability 등)를 연결해주세요.'
  );
}

async function downloadImage(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${url}`);
  const buffer = await res.buffer();
  const filepath = path.join(IMAGE_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

/**
 * @param {string} query - 이미지 검색어
 * @param {string} sectionContext - AI 적합성 판단에 쓰일 섹션 본문
 * @param {string} imageSource - 'stock' | 'ai' | 'auto'
 * @returns {Promise<{localPath:string, credit:string}|null>} 적합 판정된 이미지 (없으면 null)
 */
async function findAndVerifyImage(query, sectionContext, imageSource = 'auto') {
  let candidates = [];

  if (imageSource === 'stock' || imageSource === 'auto') {
    candidates = [...(await searchUnsplash(query)), ...(await searchPixabay(query))];
  }

  if (candidates.length === 0 && (imageSource === 'ai' || imageSource === 'auto')) {
    try {
      const aiImg = await generateAiImage(query);
      candidates = [aiImg];
    } catch (e) {
      console.warn('[imageFinder] AI 이미지 생성 폴백 실패:', e.message);
    }
  }

  for (const candidate of candidates) {
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    let localPath;
    try {
      localPath = await downloadImage(candidate.url, safeName);
    } catch (e) {
      continue;
    }

    const verdict = await judgeImageFit(localPath, sectionContext);
    if (verdict.fits) {
      return { localPath, credit: candidate.credit };
    }
    // 부적합하면 파일 삭제하고 다음 후보 시도
    fs.unlinkSync(localPath);
  }

  return null; // 적합한 이미지를 찾지 못함
}

module.exports = { findAndVerifyImage, downloadImage };
