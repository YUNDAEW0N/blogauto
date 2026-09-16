const $ = (sel) => document.querySelector(sel);

const authStatus = $('#authStatus');
const authBtn = $('#authBtn');
const blogIdInput = $('#blogIdInput');
const referenceBlogIdsInput = $('#referenceBlogIdsInput');
const recommendBlogBtns = $('#recommendBlogBtns');
const imageSourceInput = $('#imageSourceInput');
const autoPublishInput = $('#autoPublishInput');

const categorySelect = $('#categorySelect');
const keywordField = $('#keywordField');
const keywordInput = $('#keywordInput');
const suggestBtn = $('#suggestBtn');
const generateBtn = $('#generateBtn');
const trendField = $('#trendField');
const trendList = $('#trendList');
const trendRefreshBtn = $('#trendRefreshBtn');
const generateTrendBtn = $('#generateTrendBtn');
const trendManualToggle = $('#trendManualToggle');
const trendManualField = $('#trendManualField');
const trendManualInput = $('#trendManualInput');
const generateTrendManualBtn = $('#generateTrendManualBtn');
const statusLine = $('#statusLine');

const TREND_CATEGORY = '이슈/트렌드';
let selectedTrendKeyword = null;
let selectedTrendImages = [];

const sourcesPanel = $('#sourcesPanel');
const newsList = $('#newsList');
const blogSourcesPanel = $('#blogSourcesPanel');
const blogList = $('#blogList');
const draftPanel = $('#draftPanel');
const draftTitle = $('#draftTitle');
const draftSections = $('#draftSections');
const thumbnailBlock = $('#thumbnailBlock');
const thumbnailImg = $('#thumbnailImg');
const hashtagBlock = $('#hashtagBlock');
const hashtagList = $('#hashtagList');
const publishBtn = $('#publishBtn');
const publishStatus = $('#publishStatus');
const scheduleToggle = $('#scheduleToggle');
const scheduleDateTime = $('#scheduleDateTime');

let currentDraft = null;
let currentAutoPublish = false;
let currentThumbnail = null;
let currentCategory = null;

async function loadCategories() {
  try {
    const res = await fetch('/api/topic/naver-categories');
    const data = await res.json();
    categorySelect.innerHTML = '';
    (data.categories || []).forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    });
  } catch (e) {
    statusLine.textContent = `카테고리 목록을 불러오지 못했습니다: ${e.message}`;
    statusLine.className = 'status-line error';
  }
  onCategoryChange();
}

function formatDetectedAt(detectedAt) {
  if (!detectedAt) return '';
  const diffMs = Date.now() - new Date(detectedAt).getTime();
  if (Number.isNaN(diffMs)) return '';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '방금 감지';
  if (minutes < 60) return `${minutes}분 전 감지`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 전 감지`;
}

function renderTrendCandidates(candidates) {
  trendList.innerHTML = '';
  selectedTrendKeyword = null;
  selectedTrendImages = [];
  generateTrendBtn.disabled = true;
  generateTrendBtn.textContent = '골라야 초안 작성 가능';

  if (!candidates.length) {
    trendList.innerHTML = '<li class="trend-empty">지금은 쓸만한 실시간 이슈를 찾지 못했습니다. 잠시 후 새로고침 해보세요.</li>';
    return;
  }

  candidates.forEach((c) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'trend-item';

    const title = document.createElement('span');
    title.className = 'trend-keyword';
    title.textContent = c.keyword;
    btn.appendChild(title);

    if (c.approxTraffic) {
      const traffic = document.createElement('span');
      traffic.className = 'trend-traffic';
      traffic.textContent = `검색량 ${c.approxTraffic}`;
      btn.appendChild(traffic);
    }

    const detected = formatDetectedAt(c.detectedAt);
    if (detected) {
      const detectedEl = document.createElement('span');
      detectedEl.className = 'trend-traffic';
      detectedEl.textContent = detected;
      btn.appendChild(detectedEl);
    }

    if (c.sampleNews && c.sampleNews.length) {
      const news = document.createElement('div');
      news.className = 'trend-news';
      news.textContent = c.sampleNews[0];
      btn.appendChild(news);
    }

    btn.addEventListener('click', () => {
      selectedTrendKeyword = c.keyword;
      selectedTrendImages = Array.isArray(c.images) ? c.images : [];
      trendList.querySelectorAll('.trend-item').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
      generateTrendBtn.disabled = false;
      generateTrendBtn.textContent = `"${c.keyword}"로 초안 작성`;
    });

    li.appendChild(btn);
    trendList.appendChild(li);
  });
}

async function loadTrendCandidates() {
  trendList.innerHTML = '<li class="trend-empty">실시간 인기 검색어 불러오는 중…</li>';
  try {
    const res = await fetch('/api/topic/trend-candidates');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조회 실패');
    renderTrendCandidates(data.candidates || []);
  } catch (e) {
    trendList.innerHTML = `<li class="trend-empty">불러오기 실패: ${e.message}</li>`;
  }
}

function onCategoryChange() {
  const isTrend = categorySelect.value === TREND_CATEGORY;
  keywordField.classList.toggle('hidden', isTrend);
  trendField.classList.toggle('hidden', !isTrend);
  if (isTrend) {
    loadTrendCandidates();
    trendManualField.classList.add('hidden');
    trendManualInput.value = '';
    trendManualToggle.textContent = '마음에 드는 게 없나요? 직접 입력하기';
  }
}

categorySelect.addEventListener('change', onCategoryChange);
trendRefreshBtn.addEventListener('click', loadTrendCandidates);

trendManualToggle.addEventListener('click', () => {
  const nowHidden = trendManualField.classList.toggle('hidden');
  trendManualToggle.textContent = nowHidden
    ? '마음에 드는 게 없나요? 직접 입력하기'
    : '추천 목록에서 다시 고르기';
});

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateTimeLocalValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function updatePublishBtnLabel() {
  if (scheduleToggle.checked) {
    publishBtn.textContent = '예약 발행 등록하기';
  } else {
    publishBtn.textContent = currentAutoPublish ? '이 글 발행하기 (자동발행 켜짐)' : '이 글 발행하기';
  }
}

scheduleDateTime.min = toDateTimeLocalValue(new Date(Date.now() + 10 * 60 * 1000));

scheduleToggle.addEventListener('change', () => {
  scheduleDateTime.classList.toggle('hidden', !scheduleToggle.checked);
  if (scheduleToggle.checked && !scheduleDateTime.value) {
    // 기본값: 1시간 뒤, 10분 단위로 반올림 (네이버 예약 UI가 10분 단위 선택만 지원)
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.round(d.getMinutes() / 10) * 10, 0, 0);
    scheduleDateTime.value = toDateTimeLocalValue(d);
  }
  updatePublishBtnLabel();
});

function setStep(n) {
  document.querySelectorAll('.steps li').forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle('active', step === n);
    li.classList.toggle('done', step < n);
  });
}

async function refreshAuthStatus() {
  const res = await fetch('/api/auth/status');
  const data = await res.json();
  authStatus.textContent = data.loggedIn ? '로그인됨' : '로그인 필요';
  authStatus.classList.toggle('on', data.loggedIn);
  authBtn.textContent = data.loggedIn ? '다시 로그인' : '네이버 로그인';
}

async function loadSettings() {
  const res = await fetch('/api/settings');
  const s = await res.json();
  blogIdInput.value = s.naverBlogId || '';
  referenceBlogIdsInput.value = (s.naverReferenceBlogIds || []).join(', ');
  imageSourceInput.value = s.imageSource || 'auto';
  autoPublishInput.checked = !!s.autoPublish;
}

function currentReferenceIds() {
  return referenceBlogIdsInput.value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function loadRecommendedBlogButtons() {
  try {
    const res = await fetch('/api/settings/recommended-blogs');
    const data = await res.json();
    const groups = data.recommendedBlogs || {};

    recommendBlogBtns.innerHTML = '';
    Object.entries(groups).forEach(([category, blogs]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-quiet';
      btn.textContent = category;
      btn.title = blogs.map((b) => `${b.name} (${b.id})`).join('\n');

      btn.addEventListener('click', () => {
        const existing = new Set(currentReferenceIds());
        blogs.forEach((b) => existing.add(b.id));
        referenceBlogIdsInput.value = Array.from(existing).join(', ');
        saveSettings();
        btn.classList.add('added');
      });

      recommendBlogBtns.appendChild(btn);
    });
  } catch (e) {
    recommendBlogBtns.innerHTML = `<span class="hint">추천 목록을 불러오지 못했습니다: ${e.message}</span>`;
  }
}

async function saveSettings() {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      naverBlogId: blogIdInput.value.trim(),
      naverReferenceBlogIds: referenceBlogIdsInput.value.trim(),
      imageSource: imageSourceInput.value,
      autoPublish: autoPublishInput.checked,
    }),
  });
}

[blogIdInput, referenceBlogIdsInput, imageSourceInput, autoPublishInput].forEach((el) => {
  el.addEventListener('change', saveSettings);
});

suggestBtn.addEventListener('click', async () => {
  suggestBtn.disabled = true;
  try {
    const category = categorySelect.value;
    const res = await fetch(`/api/topic/suggest?category=${encodeURIComponent(category)}`);
    const suggestion = await res.json();
    if (!res.ok) throw new Error(suggestion.error || '추천 실패');
    keywordInput.value = suggestion.keyword;
    statusLine.textContent = `추천 주제(${category}): ${suggestion.categoryLabel}`;
    statusLine.className = 'status-line';
  } catch (e) {
    statusLine.textContent = `추천 실패: ${e.message}`;
    statusLine.className = 'status-line error';
  } finally {
    suggestBtn.disabled = false;
  }
});

authBtn.addEventListener('click', async () => {
  authBtn.disabled = true;
  authStatus.textContent = '브라우저 창에서 로그인해주세요…';
  try {
    const res = await fetch('/api/auth/login', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '로그인 실패');
  } catch (e) {
    authStatus.textContent = `로그인 실패: ${e.message}`;
  } finally {
    authBtn.disabled = false;
    refreshAuthStatus();
  }
});

function renderList(el, items) {
  el.innerHTML = '';
  if (!items.length) {
    el.innerHTML = '<li>수집된 항목 없음</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.title;
    li.appendChild(a);
    el.appendChild(li);
  });
}

function renderThumbnail(thumbnail) {
  if (thumbnail && thumbnail.url) {
    thumbnailImg.src = thumbnail.url;
    thumbnailBlock.classList.remove('hidden');
  } else {
    thumbnailBlock.classList.add('hidden');
  }
}

function renderHashtags(hashtags) {
  hashtagList.innerHTML = '';
  if (Array.isArray(hashtags) && hashtags.length) {
    hashtags.forEach((tag) => {
      const span = document.createElement('span');
      span.textContent = `#${tag}`;
      hashtagList.appendChild(span);
    });
    hashtagBlock.classList.remove('hidden');
  } else {
    hashtagBlock.classList.add('hidden');
  }
}

function renderDraft(draft) {
  draftTitle.textContent = draft.title;
  draftSections.innerHTML = '';

  draft.sections.forEach((section) => {
    const block = document.createElement('div');
    block.className = 'section-block';

    const h3 = document.createElement('h3');
    h3.contentEditable = 'true';
    h3.textContent = section.heading;
    block.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'body-text';
    body.contentEditable = 'true';
    body.textContent = section.body;
    block.appendChild(body);

    if (section.imageUrl) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'section-images';
      const imgEl = document.createElement('img');
      imgEl.src = section.imageUrl;
      imgEl.alt = section.imageQuery || '';
      imgWrap.appendChild(imgEl);
      block.appendChild(imgWrap);
    } else {
      const note = document.createElement('div');
      note.className = 'no-image';
      note.textContent = '이 섹션에는 이미지가 없습니다.';
      block.appendChild(note);
    }

    draftSections.appendChild(block);
  });

  draftPanel.classList.remove('hidden');
}

function onDraftReady(data, statusEl) {
  renderList(newsList, data.sources.news || []);
  sourcesPanel.classList.toggle('hidden', !(data.sources.news && data.sources.news.length));
  renderList(blogList, data.sources.blogs || []);
  blogSourcesPanel.classList.toggle('hidden', !(data.sources.blogs && data.sources.blogs.length));
  setStep(2);

  currentDraft = data.draft;
  currentAutoPublish = data.autoPublish;
  currentThumbnail = data.thumbnail || null;
  currentCategory = data.category || null;
  renderDraft(data.draft);
  renderThumbnail(data.thumbnail);
  renderHashtags(data.draft.hashtags);
  setStep(4);

  statusEl.textContent = '초안 작성 완료. 아래에서 검토/수정 후 발행하세요.';
  statusEl.className = 'status-line ok';

  scheduleToggle.checked = false;
  scheduleDateTime.classList.add('hidden');
  updatePublishBtnLabel();
}

async function runGenerate(keyword, category, triggerBtn, trendImages) {
  if (!keyword) {
    statusLine.textContent = '키워드를 입력(또는 선택)해주세요.';
    statusLine.className = 'status-line error';
    return;
  }

  triggerBtn.disabled = true;
  statusLine.className = 'status-line';
  statusLine.textContent = '뉴스 수집 중…';
  draftPanel.classList.add('hidden');
  sourcesPanel.classList.add('hidden');
  setStep(1);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, category, trendImages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '생성 실패');
    onDraftReady(data, statusLine);
  } catch (e) {
    statusLine.textContent = `오류: ${e.message}`;
    statusLine.className = 'status-line error';
  } finally {
    triggerBtn.disabled = false;
  }
}

generateBtn.addEventListener('click', () => {
  runGenerate(keywordInput.value.trim(), categorySelect.value, generateBtn);
});

generateTrendBtn.addEventListener('click', () => {
  runGenerate(selectedTrendKeyword, TREND_CATEGORY, generateTrendBtn, selectedTrendImages);
});

generateTrendManualBtn.addEventListener('click', () => {
  runGenerate(trendManualInput.value.trim(), TREND_CATEGORY, generateTrendManualBtn);
});

publishBtn.addEventListener('click', async () => {
  if (!currentDraft) return;

  const isScheduled = scheduleToggle.checked;
  if (isScheduled && !scheduleDateTime.value) {
    publishStatus.textContent = '예약 발행 시간을 선택해주세요.';
    publishStatus.className = 'status-line error';
    return;
  }
  if (isScheduled && new Date(scheduleDateTime.value).getTime() <= Date.now()) {
    publishStatus.textContent = '예약 시간은 현재 시각 이후로 선택해주세요.';
    publishStatus.className = 'status-line error';
    return;
  }

  // 사용자가 직접 수정한 내용을 반영해서 전송
  const editedTitle = draftTitle.textContent.trim();
  const sectionEls = draftSections.querySelectorAll('.section-block');
  const editedSections = currentDraft.sections.map((section, idx) => {
    const el = sectionEls[idx];
    return {
      ...section,
      heading: el.querySelector('h3').textContent.trim(),
      body: el.querySelector('.body-text').textContent.trim(),
    };
  });

  publishBtn.disabled = true;
  publishStatus.textContent = isScheduled ? '네이버 블로그에 예약 등록 중…' : '네이버 블로그에 작성 중…';
  publishStatus.className = 'status-line';

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editedTitle,
        sections: editedSections,
        forcePublish: true,
        thumbnailUrl: currentThumbnail ? currentThumbnail.url : null,
        scheduledAt: isScheduled ? scheduleDateTime.value : null,
        category: currentCategory,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '발행 실패');

    publishStatus.textContent = data.message;
    publishStatus.className = 'status-line ok';
  } catch (e) {
    publishStatus.textContent = `오류: ${e.message}`;
    publishStatus.className = 'status-line error';
  } finally {
    publishBtn.disabled = false;
  }
});

refreshAuthStatus();
loadSettings();
loadCategories();
loadRecommendedBlogButtons();
