/**
 * Claude Code CLI를 "-p"(non-interactive) 모드로 호출해서
 * 수집된 뉴스/블로그 글을 바탕으로 새로운 블로그 글을 작성한다.
 *
 * 이 방식은 API 키 종량 과금이 아니라, 로컬에 로그인된 Claude 구독 계정
 * (claude login으로 인증된 세션)의 사용량 한도를 사용한다.
 *
 * 사전 준비:
 *   npm install -g @anthropic-ai/claude-code
 *   claude login   (Pro/Max 구독 계정으로 1회 로그인)
 */

const { spawn } = require('child_process');
const { CLAUDE_BIN } = require('../config');

function runClaude(prompt, { timeoutMs = 3 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    // -p : non-interactive print 모드 (프롬프트 처리 후 결과만 출력하고 종료)
    // Windows에서는 npm 전역 설치 시 claude.cmd 래퍼로 설치되는데, spawn은
    // shell:true 없이 .cmd 확장자를 못 찾아 ENOENT를 내는 경우가 있어
    // 플랫폼에 따라 shell 옵션을 켜준다.
    const child = spawn(CLAUDE_BIN, ['-p'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('claude -p 호출이 타임아웃되었습니다.'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`claude 실행 실패: ${err.message} (CLAUDE_BIN 경로/설치 확인 필요)`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude -p 종료코드 ${code}: ${stderr || '알 수 없는 오류'}`));
      }
      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildSourcesBlock(sources) {
  return sources.news
    .map((n, i) => `[뉴스 ${i + 1}] ${n.title}\n출처: ${n.source || '알수없음'}\n요약: ${n.summary}\n`)
    .join('\n');
}

/**
 * @param {{keyword:string, news:Array, blogs:Array}} sources - collector.js의 결과
 * @returns {Promise<{title:string, sections:Array<{heading:string, body:string}>, imageQueries:Array<string>}>}
 */
async function draftPost(sources) {
  const sourcesBlock = buildSourcesBlock(sources);

  const prompt = `당신은 네이버 블로그 전문 작가입니다. 아래 자료(관련 뉴스 요약)를 참고해서
"${sources.keyword}" 주제로 완전히 새로운 블로그 글을 작성하세요.

규칙:
- 원문을 그대로 베끼지 말고, 사실관계만 참고해서 당신의 문체로 자연스럽게 새로 쓸 것
- 친근하고 자연스러운 한국어 블로그 말투 (지나친 홍보성/광고성 문구 금지)
- 소제목(##)으로 3~5개 섹션으로 구성해 가독성을 높일 것
- 각 섹션 본문에 어울리는 이미지를 찾기 위한 검색어(imageQuery)를 함께 제시할 것
- 마지막에 짧은 마무리 문단 포함
- 결과는 반드시 아래 JSON 형식으로만 출력 (설명, 코드블록 마크다운 없이 순수 JSON만)

{
  "title": "블로그 글 제목",
  "sections": [
    {"heading": "소제목", "body": "본문 내용", "imageQuery": "이미지 검색어"}
  ]
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

/**
 * 이미지 후보가 본문/섹션과 실제로 어울리는지 Claude에게 시각 판단을 맡긴다.
 * Claude Code CLI가 로컬 이미지 경로를 인식하도록 프롬프트에 파일 경로를 포함시킨다.
 * (CLI 버전에 따라 이미지 첨부 문법이 다를 수 있어 실제 환경에서 검증 필요)
 */
async function judgeImageFit(imageLocalPath, sectionContext) {
  const prompt = `다음 이미지 파일이 아래 블로그 섹션 내용과 잘 어울리는지 판단해주세요.
이미지 경로: ${imageLocalPath}

섹션 내용:
${sectionContext}

반드시 아래 JSON 형식으로만 답하세요:
{"fits": true 또는 false, "reason": "간단한 이유"}
`;
  const raw = await runClaude(prompt);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 파싱 실패 시 보수적으로 사용 보류
    return { fits: false, reason: 'AI 응답 파싱 실패' };
  }
}

module.exports = { draftPost, judgeImageFit, runClaude };
