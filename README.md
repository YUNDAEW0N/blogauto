건강/피트니스/영양 니치 전용 네이버 블로그 자동화 도구입니다. 키워드를 넣으면
뉴스 수집 → AI 초안 작성(건강 니치 전용 프롬프트, 과장 표현 자제) → 섹션별
스톡 이미지 매칭 → 섬네일(검은 배경+노란 강조) 자동 생성 → 검토 후 발행까지
이어집니다.

사용법


1. 필수 프로그램 설치
- Git — https://git-scm.com (VSCode는 Git 연동만 하고 Git 자체는 별도 설치 필요)
- Node.js 18 이상 — https://nodejs.org (LTS 버전 권장)
- 설치 후 VSCode 터미널에서 확인:
git --version
node -v

2. 저장소 클론
git clone <레포 URL>
cd naver-blog-automation
code .
(VSCode에서 Ctrl+Shift+P → "Git: Clone"으로 GUI로 해도 됨)

3. 패키지 설치
VSCode 통합 터미널(Ctrl+`)에서:
npm install
postinstall 스크립트가 자동으로 playwright install chromium까지 실행합니다 (다운로드 용량 있으니 시간 좀 걸림).

4. 환경변수 파일 생성
copy .env.example .env
(PowerShell/Windows 기준. Bash면 cp) 그다음 .env를 열어 값 채우기:
- NAVER_BLOG_ID — 본인 블로그 ID
- NAVER_REFERENCE_BLOG_IDS — 정보 다양성 참고용으로 구독할 네이버 블로그 ID들 (쉼표 구분, 선택. 대시보드 설정에서도 수정 가능)
- UNSPLASH_ACCESS_KEY / PIXABAY_API_KEY — 스톡이미지 쓸 거면 (선택)
- CLAUDE_BIN — 보통 기본값 claude 그대로 두면 됨

5. Claude Code CLI 설치 및 로그인
초안 작성(claude -p)에 필요합니다.
npm install -g @anthropic-ai/claude-code
claude login

6. 서버 실행
npm start
브라우저에서 http://localhost:3000 접속.

7. 네이버 로그인 (매 환경마다 새로 필요)
로그인 세션은 로컬 파일(server/data/naver-session.json)로만 저장되고 Git에는 안 올라가므로, 새 환경에서는 대시보드의 "네이버 로그인" 버튼을 눌러 다시 로그인해야 합니다(2단계 인증 포함, 헤드풀 브라우저 창이 뜸).