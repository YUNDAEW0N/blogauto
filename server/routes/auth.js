const express = require('express');
const router = express.Router();
const naverAuth = require('../services/naverAuth');

// 로그인 상태 확인
router.get('/status', (req, res) => {
  res.json({ loggedIn: naverAuth.hasSession() });
});

// 로그인 창 띄우기 (완료될 때까지 응답을 지연시킴 - 프론트는 로딩 상태 표시)
router.post('/login', async (req, res) => {
  try {
    await naverAuth.startLoginFlow();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/logout', (req, res) => {
  naverAuth.clearSession();
  res.json({ success: true });
});

module.exports = router;
