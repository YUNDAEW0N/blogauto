/**
 * 글 제목 기반으로 섬네일 이미지를 자동 생성한다.
 *
 * 별도 이미지 생성 API나 캔버스 라이브러리를 추가하지 않고, 이미 프로젝트에
 * 있는 Playwright(네이버 로그인용으로 이미 설치돼 있음)의 headless 브라우저로
 * 간단한 HTML을 렌더링해서 스크린샷을 찍는 방식이다. 별도 npm 의존성이
 * 늘어나지 않고, 한글 폰트도 시스템 폰트(맑은 고딕 등)를 그대로 쓴다.
 *
 * 스타일: 검은 배경 + 가운데 정렬 + 핵심 문구만 노란색 강조, 나머지는 흰색.
 * (대화에서 확정한 스타일을 그대로 템플릿화한 것)
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { DATA_DIR } = require('../config');

const IMAGE_DIR = path.join(DATA_DIR, 'images');
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

const WIDTH = 800;
const HEIGHT = 450;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 제목 안에서 keyPhrase를 찾아 그 부분만 노란색으로 감싼 HTML 조각을 만든다.
 * keyPhrase가 제목에 없으면(AI가 살짝 다르게 냈을 경우) 제목 전체를 흰색으로만 표시한다.
 */
function buildTitleHtml(title, keyPhrase) {
  if (keyPhrase && title.includes(keyPhrase)) {
    const idx = title.indexOf(keyPhrase);
    const before = title.slice(0, idx);
    const after = title.slice(idx + keyPhrase.length);
    return `${escapeHtml(before)}<span class="hl">${escapeHtml(keyPhrase)}</span>${escapeHtml(after)}`;
  }
  return escapeHtml(title);
}

function buildHtml(title, keyPhrase) {
  const titleHtml = buildTitleHtml(title, keyPhrase);
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<style>
  html, body { margin: 0; padding: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: #111111; }
  .wrap { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .title {
    max-width: 680px;
    text-align: center;
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 56px;
    line-height: 1.35;
    color: #ffffff;
    word-break: keep-all;
  }
  .hl { color: #ffd400; }
</style></head>
<body>
  <div class="wrap"><div class="title">${titleHtml}</div></div>
</body></html>`;
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch();
  return browserPromise;
}

/**
 * @param {string} title - 블로그 글 제목
 * @param {string} keyPhrase - 노란색으로 강조할 짧은 문구 (제목 안에 포함된 단어)
 * @returns {Promise<{localPath:string, url:string}>}
 */
async function generateThumbnail(title, keyPhrase) {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  try {
    await page.setContent(buildHtml(title, keyPhrase), { waitUntil: 'networkidle' });
    const filename = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const filepath = path.join(IMAGE_DIR, filename);
    await page.screenshot({ path: filepath });
    return { localPath: filepath, url: `/images/${filename}` };
  } finally {
    await page.close();
  }
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = { generateThumbnail, closeBrowser };
