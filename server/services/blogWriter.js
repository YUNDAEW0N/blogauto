/**
 * 여러 니치(건강정보/재테크/IT정보/시사이슈)를 다루는 범용 블로그 초안 작성.
 *
 * aiWriterHealth.js(건강 단일 니치 전용)를 대체한다. 문체/가독성 규칙(짧은
 * 문단, 친근한 톤, 소제목 3~5개, keyPhrase/해시태그 등)은 모든 카테고리에
 * 공통으로 적용하고, YMYL 성격(건강/재테크)과 시사이슈에만 카테고리별로
 * 추가 규칙을 얹는다 (buildCategoryRules).
 */

const { runClaude, judgeImageFit } = require('./aiWriter');
const { SENSITIVE_CATEGORIES } = require('./topicPlanner');

/**
 * 뉴스와 네이버 블로그 글을 같은 비중의 참고 자료로 합친다. 뉴스만으로는
 * 관점이 한쪽(언론 보도)으로 쏠리기 쉬워서, 설정에 등록된 블로그의 실제
 * 경험담/정보도 함께 참고 자료에 넣어 정보의 다양성을 높인다. 원문을
 * 그대로 베끼지 말라는 규칙은 뉴스/블로그 모두에 동일하게 적용된다.
 */
function buildSourcesBlock(sources) {
  const newsBlock = sources.news
    .map((n, i) => `[뉴스 ${i + 1}] ${n.title}\n출처: ${n.source || '알수없음'}\n요약: ${n.summary}\n`)
    .join('\n');

  const blogBlock = (sources.blogs || [])
    .map((b, i) => `[네이버 블로그 ${i + 1}] ${b.title}\n블로그: ${b.source}\n요약: ${b.summary}\n`)
    .join('\n');

  return [newsBlock, blogBlock].filter(Boolean).join('\n');
}

/** 카테고리 성격에 따라 추가되는 규칙. 건강정보/재테크(YMYL)와 시사이슈만 특수 규칙을 가진다. */
function buildCategoryRules(category) {
  const rules = [];
  if (SENSITIVE_CATEGORIES.has(category)) {
    rules.push(
      `- "${category}"는 검색 알고리즘과 애드포스트 승인 심사 모두에서 과장·단정적 주장에 민감하다. ` +
        '"무조건 된다", "100% 효과/수익" 같은 단정적 표현 대신 "~로 알려져 있다", "~하는 경향이 있다" 같은 ' +
        '절제된 표현을 쓰고, 가능하면 구체적 수치나 근거를 함께 제시할 것'
    );
  }
  if (category === '시사이슈') {
    rules.push(
      '- 시사이슈 글은 사실관계 정확성이 특히 중요하다. 참고 자료(뉴스)에 없는 내용을 추측·단정하지 말고, ' +
        '출처(언론사명)를 본문 안에서 자연스럽게 언급할 것. 특정 정당·정치인·진영을 옹호하거나 비난하는 ' +
        '논조를 피하고 사실을 전달하는 중립적인 어조를 유지할 것. 확인되지 않은 소문이나 의혹은 다루지 말 것'
    );
  }
  if (category === '이슈/트렌드') {
    rules.push(
      '- 이 주제는 지금 실시간으로 검색량이 튀고 있는 화제(연예/방송/스포츠 등)다. ' +
        '참고 자료(뉴스)를 보고 사람들이 이 화제 때문에 실제로 무엇이 궁금해서 검색하는지(예: 투표방법, ' +
        '구매처/파는곳, 방송시간/편성표, 실시간 중계, 인물 프로필·나이·학력, 레시피 등)를 먼저 파악하고, ' +
        '그 실용적인 검색 의도를 제목과 본문 앞부분에 명확히 반영할 것 (예: "OOO 투표방법 총정리", ' +
        '"OOO 파는곳 정리"). 막연히 화제 자체를 소개하는 글이 아니라, 검색한 사람이 바로 필요한 정보를 ' +
        '얻어가는 글로 쓸 것. 참고 자료에 없는 내용(투표 방법/구매처 등)은 추측해서 단정하지 말고, ' +
        '자료에 실제로 나온 정보만 근거로 쓸 것'
    );
  }
  return rules.length ? rules.join('\n') + '\n' : '';
}

/**
 * @param {{keyword:string, news:Array, blogs:Array}} sources - collector.js의 결과
 * @param {string} category - 네이버 블로그 카테고리명 (예: "건강정보", "재테크", "IT정보", "시사이슈")
 * @returns {Promise<{
 *   title:string,
 *   keyPhrase:string,
 *   sections:Array<{heading:string, body:string, imageQuery:string}>,
 *   hashtags:Array<string>
 * }>}
 */
async function draftPost(sources, category) {
  const sourcesBlock = buildSourcesBlock(sources);
  const categoryRules = buildCategoryRules(category);

  const prompt = `당신은 "${category}" 분야를 다루는 네이버 블로그 전문 작가입니다. 아래 자료(관련 뉴스 및
네이버 블로그 글 요약)를 참고해서 "${sources.keyword}" 주제로 완전히 새로운 블로그 글을 작성하세요.
뉴스는 최신 사실/수치 확인용, 블로그 글은 실제 경험담·다양한 관점 참고용이니 두 자료를
같이 활용해서 한쪽으로 치우치지 않게 풍부한 내용으로 구성할 것.

규칙:
- 원문을 그대로 베끼지 말고, 사실관계만 참고해서 당신의 문체로 자연스럽게 새로 쓸 것
- 친근하고 자연스러운 한국어 블로그 말투, 1인칭 경험담처럼 쓸 것 (지나친 홍보성/광고성 문구 금지)
- 딱딱하지 않게, 말끝에 물결표(~)나 느낌표(!!), 물음표(?)를 자연스럽게 섞어 쓰고 ㅎㅎ, ^^,
  😊 같은 가벼운 이모티콘도 적절히 활용해서 편안하고 친근한 톤으로 쓸 것 (단, 문장 전체를
  물결표/느낌표로 도배하지 말고 포인트 있게)
${categoryRules}- 한 문장을 너무 길게 쓰지 말고(한 문장에 여러 내용을 쉼표로 계속 이어붙이지 말고)
  짧게 짧게 끊어 쓸 것. 한 문단이 4~5줄을 넘지 않도록 2~3문장마다 끊어서 문단을
  나눌 것. 문단과 문단 사이는 빈 줄로 구분할 것 (body 안에서 "\n\n" 사용)
- 제목은 핵심 키워드를 앞쪽에 배치할 것 (모바일에서 뒤가 잘려도 의미가 전달되도록)
- 소제목(##)으로 3~5개 섹션으로 구성해 가독성을 높일 것. 전체 본문 합계 1000자 이상
- 각 섹션 본문에 어울리는 이미지를 찾기 위한 검색어(imageQuery)를 함께 제시할 것 (영어 키워드 권장 - 스톡 이미지 검색용)
- keyPhrase: 제목 안에서 섬네일에 노란색으로 강조할 짧은 핵심 문구 (2~6글자, 제목에 실제로 포함된 단어여야 함)
- hashtags: 네이버 블로그 태그로 쓸 키워드 12~18개 (핵심 키워드 위주, 본문에 실제 등장한 단어 위주)
- 마지막 섹션은 짧은 마무리 문단으로 구성
- 결과는 반드시 아래 JSON 형식으로만 출력 (설명, 코드블록 마크다운 없이 순수 JSON만)

{
  "title": "블로그 글 제목",
  "keyPhrase": "섬네일에 강조할 짧은 문구",
  "sections": [
    {"heading": "소제목", "body": "본문 내용", "imageQuery": "이미지 검색어"}
  ],
  "hashtags": ["태그1", "태그2"]
}

--- 참고 자료 ---
${sourcesBlock}
`;

  const raw = await runClaude(prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`AI 응답을 JSON으로 파싱하지 못했습니다: ${e.message}\n원본 응답: ${raw.slice(0, 500)}`);
  }
}

module.exports = { draftPost, judgeImageFit };
