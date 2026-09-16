/**
 * 네이버 로그인 & 세션(storageState) 관리
 *
 * 흐름:
 *  1) 대시보드에서 "네이버 로그인" 버튼 클릭 -> POST /api/auth/login
 *  2) 서버가 headed(화면 보이는) Playwright 브라우저를 새로 띄우고 네이버 로그인 페이지로 이동
 *  3) 사용자가 그 창에서 직접 아이디/비번(+ 2차 인증)을 입력해서 로그인
 *  4) 로그인 완료를 감지하면(네이버 메인/블로그로 리다이렉트) storageState를 파일로 저장하고 창을 닫음
 *  5) 이후 자동화(글 발행 등)는 저장된 storageState를 불러와 로그인 상태를 재사용
 *
 * 주의: 네이버는 자동화 브라우저(playwright의 기본 headless Chromium)를 로봇으로 감지해
 *       로그인 자체를 막을 수 있습니다. 아래 launchOptions에서 headless:false +
 *       실제 Chrome 채널을 사용하고, 필요하면 navigator.webdriver 은닉 등의
 *       스텔스 설정을 추가로 고려하세요.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const { SESSION_PATH } = require('../config');

let activeLoginBrowser = null;

function hasSession() {
  return fs.existsSync(SESSION_PATH);
}

function clearSession() {
  if (hasSession()) fs.unlinkSync(SESSION_PATH);
}

/**
 * 로그인용 브라우저 창을 띄우고, 로그인 완료를 폴링으로 감지해 세션을 저장한다.
 * 프론트는 이 함수를 await하지 않고 바로 응답을 주고, 완료 여부는 /api/auth/status로 폴링하는 걸 권장.
 */
async function startLoginFlow() {
  if (activeLoginBrowser) {
    throw new Error('이미 로그인 창이 열려 있습니다.');
  }

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome', // 설치된 실제 Chrome 사용 (없으면 이 줄 제거하고 chromium 기본값 사용)
  });
  activeLoginBrowser = browser;

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://nid.naver.com/nidlogin.login');

  // 로그인 완료 감지: 로그인 성공 시 보통 naver.com 메인이나 이전 페이지로 리다이렉트됨
  try {
    await page.waitForURL(
      (url) => /^https:\/\/(www\.)?naver\.com/.test(url.href) ||
               /^https:\/\/blog\.naver\.com/.test(url.href),
      { timeout: 5 * 60 * 1000 } // 5분 안에 로그인 안 하면 타임아웃
    );

    // 로그인 세션 저장
    await context.storageState({ path: SESSION_PATH });
  } finally {
    await browser.close();
    activeLoginBrowser = null;
  }

  return { success: true };
}

async function getLoggedInContext(browserInstance) {
  if (!hasSession()) {
    throw new Error('저장된 네이버 로그인 세션이 없습니다. 먼저 로그인해주세요.');
  }
  return browserInstance.newContext({ storageState: SESSION_PATH });
}

module.exports = {
  hasSession,
  clearSession,
  startLoginFlow,
  getLoggedInContext,
};
