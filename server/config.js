require('dotenv').config();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const SESSION_PATH = path.join(DATA_DIR, 'naver-session.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  autoPublish: process.env.DEFAULT_AUTO_PUBLISH === 'true',
  imageSource: process.env.DEFAULT_IMAGE_SOURCE || 'auto', // stock | ai | auto
  naverBlogId: process.env.NAVER_BLOG_ID || '',
  // 정보 다양성(뉴스 외 실제 블로그 경험담/관점)을 위해 구독할 네이버 블로그
  // ID 목록 (blog.naver.com/{이 부분}). 검색이 아니라 각 블로그의 공식 공개
  // RSS를 구독하는 방식이라 여기 넣은 블로그만 참고 대상이 된다.
  naverReferenceBlogIds: (process.env.NAVER_REFERENCE_BLOG_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(update) {
  const current = loadSettings();
  const next = { ...current, ...update };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR,
  SESSION_PATH,
  SETTINGS_PATH,
  CLAUDE_BIN: process.env.CLAUDE_BIN || 'claude',
  UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY || '',
  PIXABAY_API_KEY: process.env.PIXABAY_API_KEY || '',
  loadSettings,
  saveSettings,
};
