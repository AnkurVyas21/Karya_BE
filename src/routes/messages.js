const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getConversations,
  createConversation,
  getConversation,
  sendMessage,
  streamMessages
} = require('../controllers/messageController');

const router = express.Router();

router.get('/stream', streamMessages);

router.use(authMiddleware);

router.get('/conversations', getConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:id', getConversation);
router.post('/conversations/:id/messages', sendMessage);

module.exports = router;
