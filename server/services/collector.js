/**
 * 관심분야 키워드로 뉴스 글감 후보를 수집한다.
 *
 * Google 뉴스 RSS(공식 공개 피드, 키 발급 불필요)를 사용한다.
 * https://news.google.com/rss/search?q={키워드}&hl=ko&gl=KR&ceid=KR:ko
 *
 * 왜 네이버 검색 API가 아닌가:
 * 네이버 검색 API는 2026-09-07 시행된 개정 약관에서 "검색 결과를 AI에
 * 입력하거나 학습/가공에 활용하는 행위"를 명시적으로 금지하고 있다.
 * 이 프로젝트처럼 수집한 글을 AI가 참고해 새 글을 쓰는 방식은 그 약관과
 * 정면으로 충돌하므로 사용하지 않는다.
 *
 * 왜 "네이버 인기글 검색"이 아니라 "특정 블로그 RSS 구독"인가:
 * 네이버 블로그 검색결과 페이지를 직접 긁는 건 검색 API와 같은 종류의
 * 문제(이용약관 위반, 접근 차단/계정 위험)를 가진 스크래핑이라 여전히
 * 하지 않는다. 대신 네이버 블로그가 블로그별로 공식 제공하는 공개 RSS
 * (https://rss.blog.naver.com/{블로그ID}.xml)는 블로그 운영자가 스스로
 * 배포하는 공개 피드라 약관 문제가 없다. 그래서 "검색"이 아니라 설정에서
 * 지정한 특정 블로그(들)를 구독하는 방식으로 톤/스타일 참고용 글을
 * 모은다 (collectNaverBlogPosts).
 */

const Parser = require('rss-parser');
const parser = new Parser({ timeout: 10000 });

// 구글 트렌드 피드는 ht: 네임스페이스의 커스텀 태그(트래픽량/관련 뉴스)를 쓰므로
// 전용 파서 인스턴스에 customFields를 지정해야 값을 읽을 수 있다.
const trendsParser = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ['ht:approx_traffic', 'approxTraffic'],
      ['ht:picture', 'picture'],
      ['ht:picture_source', 'pictureSource'],
      ['ht:news_item', 'newsItems', { keepArray: true }],
    ],
  },
});

async function collectNews(keyword, limit = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
  const feed = await parser.parseURL(url);

  return (feed.items || []).slice(0, limit).map((item) => ({
    type: 'news',
    title: item.title || '',
    link: item.link || '',
    summary: (item.contentSnippet || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    source: item.creator || (item.title && item.title.split(' - ').pop()) || '',
  }));
}

/**
 * 구글 뉴스 KR의 "비즈니스" 섹션 피드를 가져온다. "시사이슈" 카테고리는
 * 다이어트/재테크처럼 고정 키워드 목록을 미리 정해둘 수 없는 성격이라
 * (매일 바뀜) 다음 주제 추천 시 이 피드에서 골라 쓴다.
 *
 * 메인 피드(https://news.google.com/rss)가 아니라 BUSINESS 섹션을 쓰는 이유:
 * 메인 피드는 정치인 수사/의혹, 여야 공방처럼 명예훼손·편향 리스크가 큰
 * 실명 기사가 상위를 차지하는 경우가 많다. BUSINESS 섹션은 금리/환율/부동산/
 * 생활물가처럼 "생활·경제 트렌드" 위주라 그런 리스크가 훨씬 적다(완전히
 * 없는 건 아니라서 topicPlanner.js의 ISSUE_BLOCKLIST로 한 번 더 거른다).
 */
async function collectTopHeadlines(limit = 10) {
  const url = 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko';
  const feed = await parser.parseURL(url);

  return (feed.items || []).slice(0, limit).map((item) => ({
    type: 'headline',
    title: item.title || '',
    link: item.link || '',
    source: item.creator || (item.title && item.title.split(' - ').pop()) || '',
  }));
}

/**
 * 구글 트렌드(https://trends.google.com/trending)의 한국 실시간 인기 검색어를
 * 가져온다. "이슈/트렌드" 카테고리(연예/방송/스포츠 등 실시간 화제)는
 * 시사이슈(구글뉴스 BUSINESS 헤드라인)와 달리 미리 정해둘 수 없는 데다,
 * "미스터트롯 투표방법"처럼 방송/이벤트를 계기로 갑자기 검색량이 튀는
 * 실용 정보성 주제를 잡아내는 게 목적이라 뉴스 헤드라인이 아닌 실시간
 * 인기 검색어 자체를 소스로 쓴다.
 *
 * 각 트렌드 항목에 딸려오는 ht:news_item(구글이 그 트렌드와 연결 지은 실제
 * 보도)도 함께 반환한다 - topicPlanner.js가 이 관련 뉴스 유무로 "쓸 거리가
 * 있는 트렌드인지" 1차 필터링을 하고, 글 작성 단계(blogWriter.js)에서는
 * AI가 이 맥락을 보고 "투표방법/구매방법/방송시간" 같은 실제 검색 의도에
 * 맞는 제목을 스스로 판단한다.
 */
async function collectTrendingSearches(limit = 20) {
  const url = 'https://trends.google.com/trending/rss?geo=KR';
  const feed = await trendsParser.parseURL(url);

  return (feed.items || []).slice(0, limit).map((item) => {
    const newsItems = (item.newsItems || []).map((n) => ({
      title: (n['ht:news_item_title'] || [])[0] || '',
      url: (n['ht:news_item_url'] || [])[0] || '',
      source: (n['ht:news_item_source'] || [])[0] || '',
      picture: (n['ht:news_item_picture'] || [])[0] || '',
    }));
    return {
      type: 'trend',
      title: item.title || '',
      approxTraffic: item.approxTraffic || '',
      picture: item.picture || '',
      pictureSource: item.pictureSource || '',
      pubDate: item.pubDate || item.isoDate || '',
      newsItems,
    };
  });
}

/**
 * 설정에서 지정한 네이버 블로그(들)의 공식 공개 RSS를 구독해서 최근 글을
 * 가져온다. 뉴스만 참고하면 언론 보도 관점으로 쏠리기 쉬워서, 실제 블로그의
 * 경험담/정보도 함께 참고 자료로 써서 내용의 다양성을 높이는 용도다.
 * 블로그당 소수(perBlogLimit)만 가져오고, 특정 블로그 하나가 다운되거나
 * RSS를 막아도 전체 수집이 실패하지 않도록 블로그별로 개별 처리한다.
 */
async function collectNaverBlogPosts(blogIds, perBlogLimit = 3) {
  const ids = (blogIds || []).map((id) => String(id).trim()).filter(Boolean);
  if (!ids.length) return [];

  const results = await Promise.all(
    ids.map(async (blogId) => {
      try {
        const url = `https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`;
        const feed = await parser.parseURL(url);
        return (feed.items || []).slice(0, perBlogLimit).map((item) => ({
          type: 'naverBlog',
          title: item.title || '',
          link: item.link || '',
          summary: (item.contentSnippet || item.content || '').replace(/\s+/g, ' ').trim().slice(0, 300),
          source: blogId,
        }));
      } catch (e) {
        console.warn(`[collector] 네이버 블로그 RSS 수집 실패 (${blogId}): ${e.message}`);
        return [];
      }
    })
  );

  return results.flat();
}

async function collectSources(keyword, { naverBlogIds = [] } = {}) {
  const errors = [];

  const news = await collectNews(keyword).catch((e) => {
    console.error('[collector] 뉴스 수집 실패:', e.message);
    errors.push(`뉴스 수집 실패: ${e.message}`);
    return [];
  });

  const blogs = await collectNaverBlogPosts(naverBlogIds).catch((e) => {
    console.error('[collector] 네이버 블로그 수집 실패:', e.message);
    errors.push(`네이버 블로그 수집 실패: ${e.message}`);
    return [];
  });

  return { keyword, news, blogs, errors, collectedAt: new Date().toISOString() };
}

module.exports = {
  collectSources,
  collectNews,
  collectNaverBlogPosts,
  collectTopHeadlines,
  collectTrendingSearches,
};
