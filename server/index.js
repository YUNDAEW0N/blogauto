const express = require('express');
const path = require('path');
const { PORT, DATA_DIR } = require('./config');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// 다운로드된 후보 이미지(스톡 이미지 + 자동 생성 섬네일)를 프론트에서 미리보기로 볼 수 있도록 정적 제공
app.use('/images', express.static(path.join(DATA_DIR, 'images')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/topic', require('./routes/topic'));
app.use('/api/generate', require('./routes/generate'));
app.use('/api/publish', require('./routes/publish'));

app.listen(PORT, () => {
  console.log(`네이버 블로그 자동화 대시보드: http://localhost:${PORT}`);
});
