/**
 * 여러 니치(건강정보/재테크/IT정보/시사이슈/이슈·트렌드)를 다루는 "다음 주제 추천".
 *
 * healthTopicPlanner.js(건강 단일 니치 전용)를 대체한다. 예전엔 하나의
 * 주제(건강/피트니스/영양)에 집중해서 토픽 권위(Topic Authority)를 쌓는
 * 방식이었지만, 유입/애드포스트 수익 극대화를 위해 여러 카테고리를 함께
 * 다루는 범용 블로그로 방향을 바꿨다.
 *
 * 카테고리 구조는 2단계다:
 *  - naverCategory: 실제 네이버 블로그에 만들어야 하는 카테고리명
 *    ("건강정보"는 기존에 이미 있음, "재테크"/"IT정보"/"시사이슈"/"이슈/트렌드"는
 *    신규 생성 필요 - 네이버 블로그 관리 > 메뉴·글·동영상 관리 > 카테고리 관리)
 *  - 세부 키워드 그룹(GROUPS): naverCategory 하나에 여러 세부 그룹이 속하고,
 *    각 그룹 안에 고정 키워드 목록을 둔다 (건강 니치 때와 동일한 로테이션
 *    방식 - 히스토리를 참고해 가장 오래 안 쓴 키워드부터 추천).
 *
 * "시사이슈"/"이슈·트렌드"는 다이어트/재테크처럼 고정 키워드 목록을 미리
 * 정해둘 수 없는 성격이라(매일 바뀜) 로테이션 대상에서 빼고, 실시간 데이터에서
 * 그때그때 골라 추천한다:
 *  - "시사이슈": 구글 뉴스 BUSINESS 섹션(생활/경제 트렌드 위주, 정치/사법
 *    이슈는 덜 섞임) 헤드라인 (suggestIssueKeyword)
 *  - "이슈/트렌드": 구글 트렌드 한국 실시간 인기 검색어 중 관련 뉴스가 붙어
 *    있는 것(연예/방송/스포츠 등 "미스터트롯 투표방법"류 실용 정보 수요가
 *    생기는 화제) (suggestTrendKeyword) - 실제 "투표방법/구매방법" 같은
 *    문구는 글 작성 단계(blogWriter.js)에서 AI가 뉴스 맥락을 보고 짓는다.
 * 정치인 수사/의혹, 여야 공방, 소송 관련 실명 기사처럼 명예훼손/편향 리스크가
 * 큰 헤드라인·트렌드는 키워드 필터(ISSUE_BLOCKLIST)로 걸러낸다.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const { collectTopHeadlines, collectTrendingSearches } = require('./collector');

const HISTORY_PATH = path.join(DATA_DIR, 'topicHistory.json');

// 네이버 블로그에 실제로 있어야 하는(또는 만들어야 하는) 카테고리 목록.
// naverPublisher.js가 발행 시 이 이름으로 네이버 카테고리 선택을 시도한다.
const NAVER_CATEGORIES = ['건강정보', '재테크', 'IT정보', '시사이슈', '이슈/트렌드'];

// naverCategory별 YMYL(건강/금전) 민감도 - 포함되면 blogWriter.js가 "과장·단정적
// 표현 금지, 구체적 근거 제시" 규칙을 프롬프트에 추가한다.
const SENSITIVE_CATEGORIES = new Set(['건강정보', '재테크']);

const GROUPS = [
  {
    id: 'body-composition',
    label: '바디컴포지션/인바디',
    naverCategory: '건강정보',
    keywords: [
      '인바디 체지방률 낮추는 법',
      '골격근량 유지하면서 체지방 빼는 법',
      '인바디 내장지방 수치 낮추는 방법',
      '다이어트 중 근손실 없이 감량하는 법',
      '인바디 위상각 높이는 법',
    ],
  },
  {
    id: 'supplements',
    label: '보충제',
    naverCategory: '건강정보',
    keywords: [
      '마그네슘 종류별 차이',
      '오메가3 고르는 법',
      '종합비타민 성분표 보는 법',
      '코엔자임Q10 효과와 복용 시기',
      '고용량 비타민C 효과 논란',
    ],
  },
  {
    id: 'diet',
    label: '간헐적 단식/식단',
    naverCategory: '건강정보',
    keywords: [
      '간헐적 단식 공복 시간별 효과 차이',
      '단백질 섭취 타이밍 운동 전후 비교',
      '포화지방 몸에 미치는 영향',
      '다이어트 중 단백질 150g 채우는 식단',
      '칼로리 적자 폭 근손실 관계',
    ],
  },
  {
    id: 'training',
    label: '축구/스피드 훈련',
    naverCategory: '건강정보',
    keywords: [
      '축구 순발력 기르는 훈련법',
      '이영표 줄넘기 훈련 따라하기',
      '라테랄 점프 줄넘기 효과',
      '콘 드리블 훈련 루틴',
      '존2 러닝 훈련 효과',
    ],
  },
  {
    id: 'money-saving',
    label: '생활비 절약',
    naverCategory: '재테크',
    keywords: [
      '가스비 아끼는 보일러 온도 설정',
      '전기요금 누진세 피하는 법',
      '핸드폰 요금제 알뜰폰 전환 비교',
      '실비보험 갱신 전 확인할 것',
      '청년 지원금 정리',
    ],
  },
  {
    id: 'finance-basics',
    label: '재테크 기초',
    naverCategory: '재테크',
    keywords: [
      '파킹통장 금리 비교하는 법',
      'ISA 계좌 활용법',
      '연말정산 놓치기 쉬운 공제 항목',
      '신용점수 올리는 방법',
      '적금 풍차돌리기 방법',
    ],
  },
  {
    id: 'it-life-tips',
    label: '생활 IT 꿀팁',
    naverCategory: 'IT정보',
    keywords: [
      '스마트폰 저장공간 늘리는 법',
      '와이파이 속도 느려질 때 확인할 것',
      '노트북 발열 줄이는 법',
      '클라우드 저장소 무료로 늘리는 법',
      '중고폰 시세 확인하는 법',
    ],
  },
  {
    id: 'appliance-guide',
    label: '가전/전자제품 고르는 법',
    naverCategory: 'IT정보',
    keywords: [
      '로봇청소기 고르는 기준',
      '공기청정기 필터 교체 주기',
      '제습기 vs 에어컨 제습 비교',
      '무선이어폰 고르는 기준',
      '에어프라이어 활용 레시피',
    ],
  },
];

// 헤드라인/트렌드명에 이 단어가 포함되면 "시사이슈"·"이슈/트렌드" 추천에서
// 제외한다 (정치인 수사/의혹, 여야 공방, 소송 등 명예훼손·편향 리스크가 큰
// 실명 기사 걸러내기 위한 최소한의 안전장치 - 완벽한 필터는 아니라 최종적으로는
// 사람이 검토해야 한다).
const ISSUE_BLOCKLIST = [
  '검찰', '기소', '구속', '수사', '의혹', '재판', '판결', '소송', '탄핵',
  '여야', '국회의원', '대통령', '대선', '총선', '정당', '여당', '야당',
  '검사', '경찰청', '고발', '피의자', '압수수색',
];

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(list) {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(list, null, 2));
}

/** 고정 키워드 그룹들을 펼쳐서, 안 쓴 키워드 -> 오래된 키워드 순으로 정렬한다. */
function rankKeywords(naverCategory) {
  const history = loadHistory();
  const lastUsed = new Map();
  history.forEach((h) => lastUsed.set(h.keyword, h.usedAt));

  const groups = naverCategory ? GROUPS.filter((g) => g.naverCategory === naverCategory) : GROUPS;

  const all = [];
  for (const group of groups) {
    for (const keyword of group.keywords) {
      all.push({
        categoryId: group.id,
        categoryLabel: group.label,
        naverCategory: group.naverCategory,
        keyword,
        lastUsed: lastUsed.get(keyword) || null,
      });
    }
  }
  all.sort((a, b) => {
    if (!a.lastUsed && !b.lastUsed) return 0;
    if (!a.lastUsed) return -1;
    if (!b.lastUsed) return 1;
    return new Date(a.lastUsed) - new Date(b.lastUsed);
  });
  return all;
}

/** "시사이슈" 전용: 구글 뉴스 BUSINESS 섹션에서 블록리스트에 안 걸리고 최근에 안 쓴 헤드라인 하나를 고른다. */
async function suggestIssueKeyword() {
  const history = loadHistory();
  const usedTitles = new Set(history.map((h) => h.keyword));

  const headlines = await collectTopHeadlines(20).catch((e) => {
    console.warn('[topicPlanner] 시사이슈 헤드라인 수집 실패:', e.message);
    return [];
  });

  const safe = headlines.filter((h) => {
    if (usedTitles.has(h.title)) return false;
    return !ISSUE_BLOCKLIST.some((word) => h.title.includes(word));
  });

  const pick = safe[0] || headlines[0];
  if (!pick) return null;

  // 헤드라인 원문 그대로가 아니라 " - 언론사" 꼬리를 떼어 키워드처럼 다듬는다.
  const keyword = pick.title.replace(/\s*-\s*[^-]+$/, '').trim() || pick.title;
  return { categoryId: 'issue-headline', categoryLabel: '시사이슈(오늘의 헤드라인)', naverCategory: '시사이슈', keyword, lastUsed: null };
}

/** "1000+", "500+" 같은 approx_traffic 표기를 비교용 숫자로 바꾼다. */
function parseTraffic(approxTraffic) {
  const n = parseInt(String(approxTraffic).replace(/[^0-9]/g, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * "이슈/트렌드" 후보 목록을 만든다. 구글 트렌드 한국 실시간 인기 검색어 중,
 * 최근에 추천하지 않았고 블록리스트에 안 걸리면서 관련 뉴스가 붙어 있는
 * (=쓸 거리가 있는) 트렌드만 남겨서 트래픽이 큰 순서로 정렬한다.
 *
 * 트렌드명 자체를 keyword로 쓴다 ("미스터트롯4" 처럼) - "투표방법",
 * "구매방법" 같은 실제 검색 의도에 맞는 문구는 여기서 미리 만들지 않고,
 * blogWriter.js의 글 작성 단계에서 AI가 수집된 뉴스 맥락을 보고 제목/본문에
 * 자연스럽게 반영하도록 한다 (카테고리 규칙 참고).
 */
async function getTrendCandidates(limit = 10) {
  const history = loadHistory();
  const usedKeywords = new Set(history.map((h) => h.keyword));

  const trends = await collectTrendingSearches(20).catch((e) => {
    console.warn('[topicPlanner] 트렌드 수집 실패:', e.message);
    return [];
  });

  return trends
    .filter((t) => t.title && !usedKeywords.has(t.title))
    .filter((t) => !ISSUE_BLOCKLIST.some((word) => t.title.includes(word)))
    .filter((t) => t.newsItems && t.newsItems.length > 0)
    .sort((a, b) => parseTraffic(b.approxTraffic) - parseTraffic(a.approxTraffic))
    .slice(0, limit);
}

/**
 * 대시보드의 "이슈/트렌드" 후보 목록용 - 사람이 직접 고를 수 있게 여러 개를
 * 반환한다 (관련 뉴스 제목 1~2개를 곁들여서 어떤 화제인지 감을 잡을 수 있게).
 */
async function listTrendCandidates(limit = 10) {
  const candidates = await getTrendCandidates(limit);
  return candidates.map((t) => ({
    keyword: t.title,
    approxTraffic: t.approxTraffic,
    sampleNews: t.newsItems.slice(0, 2).map((n) => n.title),
  }));
}

/** 자동 추천(부작용 없음): 후보 중 트래픽이 가장 큰 것 하나를 고른다. */
async function suggestTrendKeyword() {
  const [pick] = await getTrendCandidates(1);
  if (!pick) return null;

  return {
    categoryId: 'trend-issue',
    categoryLabel: '이슈/트렌드(실시간 인기검색어)',
    naverCategory: '이슈/트렌드',
    keyword: pick.title,
    lastUsed: null,
  };
}

/**
 * 가장 오래 안 쓴 키워드 하나를 추천한다 (부작용 없음).
 * naverCategory가 "시사이슈"/"이슈/트렌드"면 고정 목록 대신 실시간 데이터에서 고른다.
 */
async function suggestNextKeyword(naverCategory) {
  if (naverCategory === '시사이슈') {
    return suggestIssueKeyword();
  }
  if (naverCategory === '이슈/트렌드') {
    return suggestTrendKeyword();
  }
  const [top] = rankKeywords(naverCategory);
  return top || null;
}

/** 실제로 이 키워드로 글을 생성했을 때 호출해 로테이션 히스토리에 기록한다. */
function recordKeywordUsed(keyword) {
  const history = loadHistory();
  history.push({ keyword, usedAt: new Date().toISOString() });
  saveHistory(history.slice(-500)); // 최근 500개만 유지
}

module.exports = {
  GROUPS,
  NAVER_CATEGORIES,
  SENSITIVE_CATEGORIES,
  suggestNextKeyword,
  suggestTrendKeyword,
  listTrendCandidates,
  recordKeywordUsed,
};
