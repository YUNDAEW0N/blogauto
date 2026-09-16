/**
 * Playwright로 네이버 블로그 SmartEditor ONE에 글을 작성하고 발행한다.
 *
 * ⚠️ 매우 중요:
 * 네이버 블로그 에디터는 SmartEditor ONE이라는 iframe 기반 리치 에디터이고,
 * 내부 DOM 클래스명은 네이버가 수시로 변경합니다. 아래 각 조작마다 셀렉터
 * "후보 목록"을 두고 먼저 매칭되는 걸 쓰는 방식으로 짜뒀지만, 그래도
 * 한 번은 실제 계정으로 다음 명령을 돌려 직접 확인/보정하는 걸 권장합니다:
 *
 *   npx playwright codegen "https://blog.naver.com/{자신의블로그ID}?Redirect=Write"
 *
 * 콘솔에 [publisher] 로 시작하는 로그가 어떤 셀렉터가 실제로 매칭됐는지
 * 보여주니, 실행해보고 로그를 보면서 후보 목록을 좁혀나가면 됩니다.
 */

const { chromium } = require('playwright');
const { getLoggedInContext } = require('./naverAuth');
const { loadSettings } = require('../config');

/**
 * 후보 셀렉터들을 순서대로 시도해서 먼저 보이는(visible) 것을 반환한다.
 * 전부 실패하면 에러를 던지며, 시도했던 후보 목록을 에러 메시지에 남겨서
 * 디버깅할 때 어떤 걸 codegen으로 다시 뽑아야 하는지 바로 알 수 있게 한다.
 */
async function locateFirst(roots, label, selectors, { timeout = 3000 } = {}) {
  // 네이버 SmartEditor ONE은 툴바/본문은 iframe#mainFrame 안에 있지만,
  // 발행 설정 레이어처럼 일부 팝업은 postMessage로 부모(top-level) 문서에
  // 렌더링되는 경우가 있다. 호출부에서 roots에 [page, editorFrame]처럼
  // 여러 후보를 넘기면 순서대로 모두 시도한다. 단일 root를 넘겨도 동작한다.
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const root of rootList) {
    for (const selector of selectors) {
      // ":visible"만 붙이면 되지만, 후보 셀렉터 중 같은 텍스트를 가진 숨겨진
      // 중복 요소(모바일용/팝업 템플릿 등)가 DOM 순서상 먼저 나오는 경우가 있어
      // first()가 그 숨겨진 요소를 집어버리면 waitFor(visible)이 영원히 실패한다.
      // ">> visible=true" 로 먼저 보이는 요소만 걸러낸 뒤 first()를 적용한다.
      const locator = root.locator(`${selector} >> visible=true`).first();
      try {
        await locator.waitFor({ state: 'visible', timeout });
        console.log(`[publisher] "${label}" 매칭됨 -> ${selector}`);
        return locator;
      } catch {
        // 다음 후보로 계속
      }
    }
  }
  throw new Error(
    `[publisher] "${label}" 요소를 찾지 못했습니다. 아래 후보 셀렉터가 모두 실패했습니다:\n` +
      selectors.map((s) => `  - ${s}`).join('\n') +
      `\n-> npx playwright codegen 으로 실제 셀렉터를 다시 뽑아 SELECTORS.${label}에 추가해주세요.`
  );
}

// 화면/버전에 따라 바뀔 수 있는 셀렉터들을 한곳에 모아 관리
const SELECTORS = {
  continueWritingCancel: ['button:has-text("취소")', '.se-popup-button-cancel'],
  // storageState만 있고 localStorage 방문 기록이 비어있는 새 컨텍스트로 처음
  // 진입하면 "도움말" 패널이 자동으로 열려 화면 오른쪽을 덮는다. 이 상태로
  // 두면 발행/저장 버튼 클릭이 이 패널에 막혀 타임아웃난다.
  helpPanelClose: ['.se-help-panel-close-button'],
  title: ['.se-title-text .se-text-paragraph', '.se-documentTitle .se-text-paragraph', '.se-title-text'],
  bodyLast: [
    '.se-component[data-a11y-title="본문"] .se-text-paragraph',
    '.se-section-text .se-text-paragraph',
    '.se-component.se-text .se-text-paragraph',
    '.se-main-container .se-text-paragraph',
    '.se-main-container .se-component-content',
  ],
  imageButton: [
    '.se-image-toolbar-button',
    '[data-name="image"]',
    'button[data-log="TXT.image"]',
    '.se-toolbar-item-image button',
  ],
  // 2026-09-09 실제 계정(daewonyun_)으로 codegen 검증 완료.
  // data-click-area / data-testid는 네이버 내부 로깅용 속성이라 CSS 모듈
  // 해시 클래스(예: save_btn__bzc5B)보다 리뉴얼에 덜 취약해서 1순위로 둔다.
  // 텍스트 기반 후보는 최후 폴백으로만 남겨둔다("발행" 텍스트는 "예약 발행"
  // 버튼에도 포함돼 있어 단독으로 쓰면 잘못된 버튼을 클릭할 수 있음).
  saveDraft: ['button[data-click-area="tpb.save"]', 'button:has-text("저장")', '.se-save-button'],
  // 상단 "발행" 버튼(레이어를 여는 버튼). "예약 발행 0건" 버튼도 텍스트에 "발행"이
  // 포함돼 있고 DOM상 이 버튼보다 먼저 나와서, 텍스트 후보만 쓰면 그쪽이 잘못
  // 매칭될 수 있다. data-click-area 후보를 반드시 먼저 시도해야 한다.
  publishOpen: ['button[data-click-area="tpb.publish"]', 'button:has-text("발행")'],
  // 발행 설정 레이어(카테고리/공개설정/태그 등)와 최종 확정 버튼은
  // iframe#mainFrame *내부*에 렌더링된다(최상위 문서 아님). 호출부에서
  // [editorFrame, page] 순서로 넘긴다.
  publishConfirm: [
    'button[data-testid="seOnePublishBtn"]',
    '[data-click-area="tpb*i.publish"]',
    '[class*="confirm_btn"]:has-text("발행")',
    '[class*="layer_btn_area"] button:has-text("발행")',
  ],
  // 2026-09-09 실제 계정으로 codegen 검증: data-name은 "strike"가 아니라
  // "strikethrough"였다. 이게 안 맞아서 버튼을 아예 못 찾았고, 새 세션에서
  // 기본으로 켜져 있는 취소선 상태를 꺼주지 못해 본문 전체에 취소선이
  // 적용되는 버그로 이어졌다.
  strikethroughToggle: [
    'button[data-name="strikethrough"]',
    'button[data-log="prt.strike"]',
    '.se-strikethrough-toolbar-button',
  ],
  // 2026-09-09 실제 계정으로 codegen 검증 완료 (장소/인용구/정렬/볼드).
  placeButton: ['button[data-name="map"]'],
  placeSearchInput: ['input.react-autosuggest__input'],
  placeResultLink: ['a.se-place-map-search-result-link'],
  placeAddButton: ['button.se-place-add-button'],
  placeConfirmButton: ['button.se-popup-button-confirm'],
  quotationInsert: ['button.se-insert-quotation-default-toolbar-button', 'button[data-name="quotation"][data-value="default"]'],
  alignDropdown: ['button[data-name="align-drop-down-with-justify"]'],
  alignCenterOption: ['.se-toolbar-option-align button[data-value="center"]'],
  alignLeftOption: ['.se-toolbar-option-align button[data-value="left"]'],
  fontColorButton: ['button[data-name="font-color"]'],
  // 2026-09-09 실제 yesain145 글 HTML 분석 결과 본문의 절대다수(356/392)가
  // 13px였다(네이버 기본값 15px보다 작음). 명시적으로 재지정한다.
  fontSizeButton: ['button[data-name="font-size"]'],
  // 2026-09-15 실제 계정으로 DOM 구조 확인 완료 (예약 발행). 발행 설정
  // 레이어의 "발행 시간" 섹션은 라디오 두 개(현재/예약)이고, "예약"을
  // 선택하면 날짜(readonly, 클릭 시 jQuery UI 스타일 달력 팝업) + 시(select,
  // 00~23) + 분(select, 10분 단위: 00/10/20/30/40/50) 입력이 나타난다.
  // 확정 버튼은 예약 모드에서도 텍스트가 "발행"으로 그대로 유지된다(별도
  // "예약" 버튼으로 안 바뀜) - publishConfirm 셀렉터를 그대로 재사용한다.
  scheduleRadio: ['label[for="radio_time2"]', 'input#radio_time2'],
  scheduleDateInput: ['input.input_date__UwKAB'],
  scheduleCalendarNextMonth: ['.ui-datepicker-next'],
  scheduleCalendarTitle: ['.ui-datepicker-title'],
  scheduleHourSelect: ['select.hour_option__Vk2eR'],
  scheduleMinuteSelect: ['select.minute_option__ETsdF'],
  // 2026-09-15 실제 계정으로 DOM 구조 확인 완료 (카테고리 선택). 발행 설정
  // 레이어 상단의 카테고리 버튼을 누르면 role="menu" 팝업에 라디오 목록이
  // 뜬다 (지금은 "건강정보" 하나뿐이라 다중 항목은 구조상으로만 확인).
  categoryButton: ['button[data-click-area="tpb*i.category"]'],
  categoryMenu: ['[role="menu"]'],
  categoryOptionText: ['[role="menu"] span[data-testid^="categoryItemText_"]'],
};

const BODY_FONT_SIZE = 'fs13';
// 소제목 역할(섹션 heading)은 본문과 구분되도록 19px로 키운다.
const HEADING_FONT_SIZE = 'fs19';
// 한 문단이 너무 길면(4~5줄 이상) 가독성이 떨어지므로 문장 단위로 끊어서
// 이 글자수를 넘기면 새 문단(빈 줄)으로 분리한다. 모바일 네이버 블로그 폭
// 기준 13px 본문이 대략 한 줄에 20~25자 정도 들어가는 걸 감안해 여유 있게
// 잡은 값 (기존 110은 실제로는 5~6줄까지 늘어나는 경우가 있어 낮췄다).
const MAX_CHARS_PER_PARAGRAPH = 90;

/**
 * 물결표(~)는 네이버 SmartEditor ONE이 마크다운 취소선(~~text~~)의 일부로
 * 오인해서, 문단 안에 물결표가 두 번 이상 나오면 그 사이 텍스트 전체에
 * 취소선이 자동 적용되는 문제가 있었다(실제 발행 결과에서 확인됨). AI
 * 프롬프트에서도 물결표를 쓰지 말라고 지시하지만, 참고 자료 원문 인용 등
 * 예상치 못한 경로로 섞여 들어올 수 있어 타이핑 직전에 한 번 더 걸러준다.
 * 전각 물결표(U+FF5E)로 치환하면 한국어 문장에서 시각적으로 거의 동일하게
 * 보이면서 에디터의 마크다운 자동변환 트리거는 피할 수 있다.
 */
function sanitizeTilde(text) {
  return text.replace(/~/g, '～');
}

/**
 * 긴 문단을 문장 단위로 끊어서 MAX_CHARS_PER_PARAGRAPH를 넘기면 새 문단으로
 * 나눈다. 인용구("> ") 줄은 건드리지 않고 그대로 보존한다.
 *
 * 1차로 문장 끝 표시(마침표/느낌표/물음표뿐 아니라 캐주얼 톤에서 자주 쓰는
 * 물결표·말줄임표도 포함) 뒤 공백에서 끊는다. 그래도 문장 하나가 그 자체로
 * maxChars를 넘기면(구두점 없이 길게 이어 쓴 경우) 공백 기준으로 한 번 더
 * 강제로 끊어서, 어떤 경우든 한 문단이 maxChars를 넘지 않도록 보장한다.
 */
function splitIntoReadableParagraphs(paragraphText, maxChars = MAX_CHARS_PER_PARAGRAPH) {
  const rawSentences = paragraphText.split(/(?<=[.!?~…])\s+/).filter(Boolean);

  const sentences = [];
  for (const s of rawSentences) {
    if (s.length <= maxChars) {
      sentences.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      sentences.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) sentences.push(rest);
  }

  const result = [];
  let buffer = '';
  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (buffer && candidate.length > maxChars) {
      result.push(buffer);
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }
  if (buffer) result.push(buffer);
  return result.length ? result : [paragraphText];
}

/**
 * section.body를 줄 단위로 훑어서, 인용구("> ") 줄이 아닌 일반 텍스트
 * 블록은 한데 합친 뒤 splitIntoReadableParagraphs로 다시 짧은 문단들로
 * 나누고 문단 사이에 빈 줄을 끼워 넣는다. AI가 이미 짧게 나눠 보내더라도
 * 안전망으로 한 번 더 정리한다.
 */
function normalizeSectionBody(bodyText, maxChars = MAX_CHARS_PER_PARAGRAPH) {
  const rawLines = bodyText.split('\n');
  const outputLines = [];
  let block = [];

  const flushBlock = () => {
    if (!block.length) return;
    const combined = block.join(' ').replace(/\s+/g, ' ').trim();
    block = [];
    if (!combined) return;
    const paragraphs = splitIntoReadableParagraphs(combined, maxChars);
    paragraphs.forEach((p, idx) => {
      if (idx > 0) outputLines.push('');
      outputLines.push(p);
    });
  };

  for (const line of rawLines) {
    if (line.trim().startsWith('> ')) {
      flushBlock();
      outputLines.push(line.trim());
    } else if (line.trim() === '') {
      flushBlock();
    } else {
      block.push(line.trim());
    }
  }
  flushBlock();

  return outputLines.join('\n');
}

// 글자색 마크업({{color:이름}})에서 쓸 수 있는 이름 -> 실제 네이버 에디터
// 색상 피커의 프리셋 스와치 hex. 프리셋에 없는 hex는 스와치가 없어 자동화로
// 클릭할 수 없기 때문에, 반드시 이 목록에 있는 색만 지원한다.
const COLOR_PALETTE = {
  빨강: '#ff0010',
  갈색: '#823f00',
  금색: '#ffd300',
  초록: '#54b800',
  청록: '#00bfb5',
  파랑: '#0078cb',
  보라: '#aa1f91',
  분홍: '#ff65a8',
  회색: '#777777',
  검정: '#000000',
};

/**
 * 새 컨텍스트(storageState만 있고 localStorage는 비어있는 상태)로 에디터를 처음 열면
 * 툴바의 "취소선" 토글 버튼이 활성 상태로 잘못 렌더링되는 경우가 있다.
 * 본문 입력 전에 상태를 확인해서 켜져 있으면 한 번 클릭해서 꺼준다.
 */
async function resetStrikethroughIfActive(editorFrame) {
  for (const selector of SELECTORS.strikethroughToggle) {
    const locator = editorFrame.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;

    const ariaPressed = await locator.getAttribute('aria-pressed').catch(() => null);
    const className = (await locator.getAttribute('class').catch(() => '')) || '';
    // 실제 버튼은 aria-pressed를 아예 안 쓰고(null), 대신 클래스에 "se-is-selected"
    // (하이픈으로 붙은 se- 접두사 토큰)가 붙는다. 예전 정규식은 공백으로 둘러싸인
    // "selected"/"is-selected"만 잡아서 "se-is-selected"를 못 잡았다 -> substring으로 검사.
    const looksActive = ariaPressed === 'true' || /se-is-(selected|active|on)/i.test(className);

    if (looksActive) {
      console.warn('[publisher] 취소선 토글이 기본 활성화되어 있어 클릭해서 꺼줍니다.');
      await locator.click();
    }
    return;
  }
  console.warn('[publisher] 취소선 토글 버튼을 찾지 못해 상태를 확인하지 못했습니다 (후보 셀렉터 보정 필요할 수 있음).');
}

async function insertImage(page, editorFrame, imageLocalPath) {
  const imageButton = await locateFirst(editorFrame, 'imageButton', SELECTORS.imageButton, { timeout: 3000 });
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
  await imageButton.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(imageLocalPath);
  // 업로드/렌더링 대기 (네트워크 상태에 따라 조정 필요)
  await page.waitForTimeout(1500);
}

/**
 * 네이버 "장소" 첨부 기능으로 실제 지도 위젯을 삽입한다 (주소를 텍스트로
 * 쓰는 대신). 흐름: 장소 버튼 -> 검색창에 입력 -> Enter -> 첫 검색결과 클릭
 * -> "추가" 버튼 클릭 -> "확인" 버튼 클릭. (2026-09-09 실제 계정으로 검증됨)
 */
async function insertPlace(page, editorFrame, query) {
  const placeBtn = await locateFirst(editorFrame, 'placeButton', SELECTORS.placeButton, { timeout: 3000 });
  await placeBtn.click();
  await page.waitForTimeout(600);

  const searchInput = await locateFirst(editorFrame, 'placeSearchInput', SELECTORS.placeSearchInput, {
    timeout: 3000,
  });
  await searchInput.click();
  await page.keyboard.type(query, { delay: 20 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const firstResult = editorFrame.locator(`${SELECTORS.placeResultLink[0]} >> visible=true`).first();
  await firstResult.waitFor({ state: 'visible', timeout: 5000 });
  await firstResult.click();
  await page.waitForTimeout(800);

  const addBtn = editorFrame.locator(`${SELECTORS.placeAddButton[0]} >> visible=true`).first();
  await addBtn.waitFor({ state: 'visible', timeout: 3000 });
  await addBtn.click();
  await page.waitForTimeout(600);

  const confirmBtn = await locateFirst(editorFrame, 'placeConfirmButton', SELECTORS.placeConfirmButton, {
    timeout: 3000,
  });
  await confirmBtn.click();
  await page.waitForTimeout(1200);
}

/**
 * "**볼드**" 마크업만 파싱해서 Ctrl+B로 토글해가며 입력한다.
 */
async function toggleAndType(page, key, text) {
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.down('Control');
  await page.keyboard.press(key);
  await page.keyboard.up('Control');
}

/** "**볼드**"와 "++밑줄++" 마크업을 Ctrl+B / Ctrl+U 토글로 변환해가며 입력한다. */
async function typeBoldParsed(page, text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\+\+[^+]+\+\+)/g).filter((p) => p.length > 0);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      await toggleAndType(page, 'B', part.slice(2, -2));
    } else if (part.startsWith('++') && part.endsWith('++') && part.length > 4) {
      await toggleAndType(page, 'U', part.slice(2, -2));
    } else {
      await page.keyboard.type(part, { delay: 5 });
    }
  }
}

/**
 * 방금 입력한 charCount개의 문자를 Shift+ArrowLeft로 선택한 뒤, 글자색 피커에서
 * 해당 hex 스와치를 클릭해 색을 적용한다. 색상은 "선택 후 적용" 방식만 확인됐기
 * 때문에(입력 전에 토글하는 볼드와 다름), 먼저 타이핑한 뒤 되돌아가 선택한다.
 */
async function applyColorToLastTyped(page, editorFrame, charCount, hex) {
  if (!charCount) return;
  await page.keyboard.down('Shift');
  for (let i = 0; i < charCount; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.waitForTimeout(150);

  const colorBtn = await locateFirst(editorFrame, 'fontColorButton', SELECTORS.fontColorButton, {
    timeout: 2000,
  }).catch(() => null);
  if (!colorBtn) {
    await page.keyboard.press('ArrowRight').catch(() => {});
    return;
  }
  await colorBtn.click();
  await page.waitForTimeout(300);

  const swatch = editorFrame.locator(`button.se-color-palette[data-color="${hex}"] >> visible=true`).first();
  const found = (await swatch.count().catch(() => 0)) > 0;
  if (found) {
    await swatch.click();
  } else {
    console.warn(`[publisher] 색상 스와치를 찾지 못함: ${hex}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(200);
  // 선택 해제하고 커서를 방금 입력한 텍스트 끝으로 복귀
  await page.keyboard.press('ArrowRight').catch(() => {});
}

/**
 * "**볼드**"와 "{{color:이름}}...{{/color}}" 마크업을 함께 파싱해서 입력한다.
 * 색상은 지원 팔레트(COLOR_PALETTE)에 있는 이름만 적용되고, 없는 이름은
 * 마크업만 제거하고 일반 텍스트로 입력한다.
 */
async function typeInlineFormatted(page, editorFrame, rawText) {
  const text = sanitizeTilde(rawText);
  const colorRegex = /\{\{color:([^}]+)\}\}([\s\S]*?)\{\{\/color\}\}/g;
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = colorRegex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ plain: text.slice(lastIndex, match.index) });
    segments.push({ colorName: match[1].trim(), inner: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ plain: text.slice(lastIndex) });
  if (segments.length === 0) segments.push({ plain: text });

  for (const seg of segments) {
    if (seg.colorName !== undefined) {
      const hex = COLOR_PALETTE[seg.colorName];
      const plainInner = seg.inner.replace(/\*\*/g, '').replace(/\+\+/g, '');
      await typeBoldParsed(page, seg.inner);
      if (hex) {
        await applyColorToLastTyped(page, editorFrame, Array.from(plainInner).length, hex);
      } else {
        console.warn(`[publisher] 지원하지 않는 색상 이름이라 색 적용 없이 넘어감: ${seg.colorName}`);
      }
    } else {
      await typeBoldParsed(page, seg.plain);
    }
  }
}

/**
 * 섹션 본문을 한 줄씩 처리하며 "**볼드**"와 "> 인용구" 마크업을 실제 네이버
 * 에디터 서식으로 변환해가며 입력한다.
 *
 * 인용구는 별도 컴포넌트라 Enter/ArrowDown으로는 빠져나올 수 없다(실제로
 * 확인함 - Enter는 인용구 블록 안에 새 줄만 만들고, ArrowDown은 인용구
 * 컴포넌트 전체를 "블록 선택" 상태로 만들어버려서 그 상태에서 타이핑한
 * 내용이 그냥 사라진다). 처음엔 "문서의 마지막 '본문' 문단을 찾아 클릭"하는
 * 방식을 썼는데, 인용구는 뒤에 빈 문단을 안 남기기 때문에(다음 형제 요소가
 * 없음을 실제로 확인) 그 방식은 인용구 "이전"의 문단을 찾아버렸다 - 그
 * 결과 이후 내용이 전부 인용구 앞에 끼어들어가면서, 인용구가 계속 뒤로
 * 밀려 글 끝부분에 몰리는 버그로 이어졌다. 지금은 인용구 컴포넌트의
 * bounding box 바로 아래 빈 공간을 마우스로 클릭해서 벗어나는데, 이 방법은
 * 실제로 새 문단에 정확히 커서가 놓이는 것까지 확인했다.
 */
async function typeFormattedBody(page, editorFrame, bodyText) {
  const lines = bodyText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('> ')) {
      const quoteText = line.slice(2).trim();
      const quoteBtn = await locateFirst(editorFrame, 'quotationInsert', SELECTORS.quotationInsert, {
        timeout: 2000,
      }).catch(() => null);

      if (quoteBtn) {
        await quoteBtn.click();
        await page.waitForTimeout(400);
        await typeInlineFormatted(page, editorFrame, quoteText);
        await page.waitForTimeout(200);
        // 인용구 블록을 빠져나와 다음 줄부터 일반 문단으로 이어가기 위해
        // 방금 삽입한 인용구 컴포넌트 바로 아래 빈 공간을 클릭한다.
        const quoteEl = editorFrame.locator('.se-component.se-quotation').last();
        const box = await quoteEl.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height + 15);
        } else {
          // 폴백: bounding box를 못 얻으면 예전 방식이라도 시도
          const lastPara = editorFrame.locator(`${SELECTORS.bodyLast[0]} >> visible=true`).last();
          await lastPara.click().catch(() => {});
          await page.keyboard.press('End').catch(() => {});
        }
      } else {
        console.warn('[publisher] 인용구 버튼을 찾지 못해 일반 텍스트로 대체합니다.');
        await typeInlineFormatted(page, editorFrame, quoteText);
      }
    } else {
      await typeInlineFormatted(page, editorFrame, line);
    }

    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

/** 현재 커서가 있는 문단을 가운데 정렬한다 (섹션 전체를 가운데 정렬하고 싶을 때). */
async function applyAlign(editorFrame, direction) {
  const alignBtn = await locateFirst(editorFrame, 'alignDropdown', SELECTORS.alignDropdown, { timeout: 2000 }).catch(
    () => null
  );
  if (!alignBtn) return;
  await alignBtn.click();
  const optionSelectors = direction === 'left' ? SELECTORS.alignLeftOption : SELECTORS.alignCenterOption;
  const option = await locateFirst(editorFrame, `align${direction === 'left' ? 'Left' : 'Center'}Option`, optionSelectors, {
    timeout: 2000,
  }).catch(() => null);
  if (option) await option.click();
}

/** 현재 커서 위치의 글자 크기를 지정한다 (sizeCode 예: "fs13", "fs19"). */
async function applyFontSize(editorFrame, sizeCode) {
  const sizeBtn = await locateFirst(editorFrame, 'fontSizeButton', SELECTORS.fontSizeButton, { timeout: 2000 }).catch(
    () => null
  );
  if (!sizeBtn) return;
  await sizeBtn.click();
  const option = editorFrame.locator(`.se-toolbar-option-font-size-code button[data-value="${sizeCode}"] >> visible=true`).first();
  const found = (await option.count().catch(() => 0)) > 0;
  if (found) await option.click();
}

/**
 * 발행 설정 레이어가 열려 있는 상태에서 카테고리 드롭다운을 열고, 이름이
 * 일치하는(정확히 일치 우선, 없으면 양방향 부분 일치) 항목을 선택한다.
 * 해당 이름의 카테고리가 네이버 블로그에 아직 없으면(예: 새 니치 카테고리를
 * 아직 안 만든 경우) 경고만 남기고 조용히 건너뛴다 - 카테고리를 못 찾았다고
 * 전체 발행을 실패시키지 않는다.
 */
async function applyCategory(page, editorFrame, categoryLabel) {
  const categoryBtn = await locateFirst(editorFrame, 'categoryButton', SELECTORS.categoryButton, {
    timeout: 3000,
  }).catch(() => null);
  if (!categoryBtn) {
    console.warn('[publisher] 카테고리 선택 버튼을 찾지 못했습니다.');
    return;
  }
  await categoryBtn.click();
  await page.waitForTimeout(400);

  const options = editorFrame.locator(`${SELECTORS.categoryOptionText[0]} >> visible=true`);
  const count = await options.count().catch(() => 0);

  let matchedIndex = -1;
  for (let i = 0; i < count; i++) {
    const text = ((await options.nth(i).textContent().catch(() => '')) || '').trim();
    if (text === categoryLabel) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex === -1) {
    for (let i = 0; i < count; i++) {
      const text = ((await options.nth(i).textContent().catch(() => '')) || '').trim();
      if (text && (text.includes(categoryLabel) || categoryLabel.includes(text))) {
        matchedIndex = i;
        break;
      }
    }
  }

  // 드롭다운을 닫을 때 Escape는 쓰지 않는다 - 이 팝업뿐 아니라 발행 설정
  // 레이어 전체를 닫아버릴 위험이 있다(둘 다 같은 키 리스너를 공유할 수
  // 있어 실제로 확인 전까지는 안전하지 않음). 대신 레이어 안의 다른 안전한
  // 영역("카테고리" 제목)을 클릭해서 바깥 클릭으로 드롭다운만 닫는다.
  const dismissDropdown = async () => {
    const title = editorFrame.locator('.option_category__mNwDi .set_title__JYe8V').first();
    if (await title.count().catch(() => 0)) {
      await title.click({ force: true }).catch(() => {});
    }
  };

  if (matchedIndex === -1) {
    console.warn(
      `[publisher] 네이버 블로그에 "${categoryLabel}" 카테고리가 없어 카테고리 선택을 건너뜁니다 ` +
        '(네이버 블로그 관리 > 메뉴·글·동영상 관리 > 카테고리 관리에서 먼저 만들어야 함).'
    );
    await dismissDropdown();
    return;
  }

  await options.nth(matchedIndex).click();
  await page.waitForTimeout(300);
  await dismissDropdown();
}

/** 10분 단위 select만 지원하는 분 선택 UI에 맞춰 가장 가까운 10분 단위로 반올림한다. */
function roundToNearestTenMinutes(date) {
  const ms = 10 * 60 * 1000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

/**
 * 발행 설정 레이어가 열려 있는 상태에서 "예약" 라디오를 선택하고 날짜(달력
 * 팝업 네비게이션)와 시/분을 지정한다. 호출 전에 publishOpenBtn을 이미
 * 클릭해서 레이어가 열려 있어야 한다.
 */
async function applySchedule(page, editorFrame, scheduledAt) {
  const target = roundToNearestTenMinutes(new Date(scheduledAt));
  if (Number.isNaN(target.getTime())) {
    throw new Error(`잘못된 예약 시간입니다: ${scheduledAt}`);
  }
  if (target.getTime() <= Date.now()) {
    throw new Error('예약 시간은 현재 시각 이후여야 합니다.');
  }

  const scheduleRadio = await locateFirst(editorFrame, 'scheduleRadio', SELECTORS.scheduleRadio, { timeout: 3000 });
  await scheduleRadio.click();
  await page.waitForTimeout(400);

  const dateInput = await locateFirst(editorFrame, 'scheduleDateInput', SELECTORS.scheduleDateInput, { timeout: 3000 });
  await dateInput.click();
  await page.waitForTimeout(400);

  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth() + 1;
  const targetDay = target.getDate();

  const titleLocator = editorFrame.locator(`${SELECTORS.scheduleCalendarTitle[0]} >> visible=true`).first();
  const nextBtn = editorFrame.locator(`${SELECTORS.scheduleCalendarNextMonth[0]} >> visible=true`).first();

  let matched = false;
  for (let i = 0; i < 24; i++) {
    const titleText = (await titleLocator.textContent().catch(() => '')) || '';
    const m = titleText.match(/(\d{4})\D+(\d{1,2})/);
    if (!m) break;
    const shownYear = Number(m[1]);
    const shownMonth = Number(m[2]);
    if (shownYear === targetYear && shownMonth === targetMonth) {
      matched = true;
      break;
    }
    if (shownYear > targetYear || (shownYear === targetYear && shownMonth > targetMonth)) break;
    await nextBtn.click();
    await page.waitForTimeout(250);
  }
  if (!matched) {
    throw new Error(`예약 날짜(${targetYear}-${targetMonth})로 달력을 이동하지 못했습니다 (네이버가 허용하는 예약 가능 기간을 벗어났을 수 있음).`);
  }

  const dayBtn = editorFrame.locator(`.ui-datepicker table button:text-is("${targetDay}")`).first();
  const dayFound = (await dayBtn.count().catch(() => 0)) > 0;
  if (!dayFound) {
    throw new Error(`예약 날짜(${targetDay}일)를 달력에서 찾지 못했습니다.`);
  }
  await dayBtn.click();
  await page.waitForTimeout(300);

  const hourSelect = await locateFirst(editorFrame, 'scheduleHourSelect', SELECTORS.scheduleHourSelect, { timeout: 2000 });
  await hourSelect.selectOption(String(target.getHours()).padStart(2, '0'));

  const minuteSelect = await locateFirst(editorFrame, 'scheduleMinuteSelect', SELECTORS.scheduleMinuteSelect, {
    timeout: 2000,
  });
  await minuteSelect.selectOption(String(target.getMinutes()).padStart(2, '0'));
}

async function publishPost({ title, sections, autoPublish, placeQuery, thumbnailLocalPath, scheduledAt, category }) {
  const settings = loadSettings();
  const blogId = settings.naverBlogId;
  if (!blogId) throw new Error('설정에서 naverBlogId(네이버 블로그 아이디)를 먼저 지정해주세요.');

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  let context;
  try {
    context = await getLoggedInContext(browser);
    const page = await context.newPage();

    await page.goto(`https://blog.naver.com/${blogId}?Redirect=Write&`, { waitUntil: 'networkidle' });

    const editorFrame = page.frameLocator('iframe#mainFrame');

    // 작성 중이던 글 이어쓰기 팝업 -> 취소(새 글 작성)
    const cancelBtn = await locateFirst(editorFrame, 'continueWritingCancel', SELECTORS.continueWritingCancel, {
      timeout: 2000,
    }).catch(() => null);
    if (cancelBtn) await cancelBtn.click();

    // 새 세션에서 자동으로 뜨는 "도움말" 패널 닫기 (열려 있으면 이후 버튼 클릭을 가로챔)
    const helpCloseBtn = await locateFirst(editorFrame, 'helpPanelClose', SELECTORS.helpPanelClose, {
      timeout: 1500,
    }).catch(() => null);
    if (helpCloseBtn) await helpCloseBtn.click();

    // 제목
    const titleArea = await locateFirst(editorFrame, 'title', SELECTORS.title);
    await titleArea.click();
    await page.keyboard.type(sanitizeTilde(title), { delay: 15 });

    // 본문 영역으로 이동
    const bodyArea = await locateFirst(editorFrame, 'bodyLast', SELECTORS.bodyLast);
    await bodyArea.click();
    await page.keyboard.press('Enter');
    // 커서가 막 옮겨간 직후에는 툴바 버튼 상태가 아직 갱신 전일 수 있어 살짝 대기 후 확인.
    await page.waitForTimeout(300);
    await resetStrikethroughIfActive(editorFrame);

    // generate 단계에서 만든 섬네일(검은 배경+노란 강조)을 본문 맨 앞에 삽입한다.
    // 네이버는 발행 설정에서 대표 이미지를 따로 고르지 않으면 본문에 등장하는
    // 첫 번째 이미지를 목록/검색 결과 썸네일로 자동 선택하기 때문에, 맨 앞에
    // 넣어야 실제 발행 결과에 이 섬네일이 반영된다.
    if (thumbnailLocalPath) {
      try {
        await insertImage(page, editorFrame, thumbnailLocalPath);
        await page.keyboard.press('Enter');
      } catch (e) {
        console.warn(`[publisher] 섬네일 이미지 삽입 실패: ${e.message}`);
      }
    }

    // 섹션 heading은 별도 컴포넌트가 아니라 본문 흐름 안의 굵은 글씨 한 줄로
    // 처리하되(2026-09-09 yesain145 분석 결과 반영), 소제목임을 시각적으로
    // 구분할 수 있도록 글자 크기만 19px로 키운다.
    const headingResults = [];
    for (const section of sections) {
      // 실제 yesain145 블로그 분석 결과 본문 문단의 절대다수(약 97%)가 가운데
      // 정렬이라, 기본값을 가운데로 바꾸고 section.align === 'left'일 때만 예외로 둔다.
      await applyAlign(editorFrame, section.align === 'left' ? 'left' : 'center').catch((e) => {
        console.warn(`[publisher] 정렬 적용 실패 (섹션: ${section.heading}): ${e.message}`);
      });

      if (section.heading) {
        await applyFontSize(editorFrame, HEADING_FONT_SIZE).catch((e) => {
          console.warn(`[publisher] 소제목 글자 크기 적용 실패 (섹션: ${section.heading}): ${e.message}`);
        });
        // 정렬/글자크기 툴바 조작 이후 취소선 토글이 다시 켜지는 경우가 있어
        // 소제목을 타이핑하기 직전에도 한 번 확인한다 (본문 앞에서만 확인하면
        // 이미지 삽입/정렬/글자크기 조작 사이에 다시 켜진 걸 못 잡는다).
        await resetStrikethroughIfActive(editorFrame);
        await typeInlineFormatted(page, editorFrame, `**${section.heading}**`);
        await page.keyboard.press('Enter');
      }

      // 실제 yesain145 글의 지배적인 본문 크기(13px)로 맞춘다.
      await applyFontSize(editorFrame, BODY_FONT_SIZE).catch((e) => {
        console.warn(`[publisher] 글자 크기 적용 실패 (섹션: ${section.heading}): ${e.message}`);
      });
      // 취소선이 이전 서식 조작 중 다시 켜졌을 수 있어 문단 입력 직전에 한 번 더 확인.
      await resetStrikethroughIfActive(editorFrame);

      const normalizedBody = normalizeSectionBody(section.body || '');
      await typeFormattedBody(page, editorFrame, normalizedBody);
      headingResults.push({ heading: section.heading, mode: 'inline-bold-fs19' });
      await page.keyboard.press('Enter');

      // 섹션 하나에 사진이 여러 장 들어갈 수 있다(예: 전/디자인/후 여러 장을 한
      // 단계에서 같이 보여주는 경우). section.images(배열)를 우선 쓰고, 예전
      // 방식(스톡/AI 이미지 검색)의 section.imageLocalPath(단일 문자열)도 계속 지원한다.
      const imagePaths = Array.isArray(section.images)
        ? section.images.map((img) => img.localPath).filter(Boolean)
        : section.imageLocalPath
          ? [section.imageLocalPath]
          : [];

      for (const imagePath of imagePaths) {
        try {
          await insertImage(page, editorFrame, imagePath);
        } catch (e) {
          console.warn(`[publisher] 이미지 삽입 실패 (섹션: ${section.heading}): ${e.message}`);
        }
      }
    }

    // 실제 매장 위치를 네이버 지도(장소) 위젯으로 첨부 (있을 때만 - yesain145
    // 자동 발행 흐름에서만 전달됨). 텍스트로 주소를 쓰는 대신 이걸 씀.
    if (placeQuery) {
      try {
        await insertPlace(page, editorFrame, placeQuery);
      } catch (e) {
        console.warn(`[publisher] 장소 삽입 실패: ${e.message}`);
      }
    }

    if (!autoPublish && !scheduledAt) {
      const saveDraftBtn = await locateFirst(editorFrame, 'saveDraft', SELECTORS.saveDraft, { timeout: 2000 }).catch(
        () => null
      );
      if (saveDraftBtn) await saveDraftBtn.click();
      return {
        published: false,
        message: '초안이 임시저장되었습니다. 대시보드에서 검토 후 발행하세요.',
        headingResults,
      };
    }

    const publishOpenBtn = await locateFirst(editorFrame, 'publishOpen', SELECTORS.publishOpen);
    await publishOpenBtn.click();
    await page.waitForTimeout(800);

    if (category) {
      await applyCategory(page, editorFrame, category).catch((e) => {
        console.warn(`[publisher] 카테고리 선택 중 오류(발행은 계속 진행): ${e.message}`);
      });
    }

    if (scheduledAt) {
      await applySchedule(page, editorFrame, scheduledAt);
    }

    // 발행 설정 레이어/확정 버튼은 iframe 안에 뜬다. 혹시 네이버가 나중에
    // 최상위 문서로 옮기더라도 대응할 수 있게 page를 폴백으로만 둔다.
    // 예약 모드에서도 이 버튼 텍스트는 그대로 "발행"이라 셀렉터 재사용 가능
    // (2026-09-15 실제 계정으로 확인).
    const publishConfirmBtn = await locateFirst([editorFrame, page], 'publishConfirm', SELECTORS.publishConfirm, {
      timeout: 5000,
    });
    await publishConfirmBtn.click();
    await page.waitForTimeout(2000);

    return scheduledAt
      ? { published: false, scheduled: true, scheduledAt, message: `예약 발행이 등록되었습니다 (${scheduledAt}).`, headingResults }
      : { published: true, scheduled: false, message: '발행이 완료되었습니다.', headingResults };
  } finally {
    await browser.close();
  }
}

module.exports = { publishPost };
