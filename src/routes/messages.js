const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { getUploadDestination } = require('../utils/uploadPaths');
const persistUploadedFiles = require('../middlewares/persistUploadedFiles');
const authMiddleware = require('../middlewares/authMiddleware');
const {
  getConversations,
  createConversation,
  getConversation,
  deleteConversation,
  sendMessage,
  updateMessage,
  deleteMessage,
  reactToMessage,
  streamMessages
} = require('../controllers/messageController');

const router = express.Router();

const storage = multer.diskStorage({
  destination: getUploadDestination(),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({ storage });

const uploadMessageAttachments = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }

  upload.array('attachments', 10)(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }

    persistUploadedFiles(req, res, next);
  });
};

router.get('/stream', streamMessages);

router.use(authMiddleware);

router.get('/conversations', getConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:id', getConversation);
router.delete('/conversations/:id', deleteConversation);
router.post('/conversations/:id/messages', uploadMessageAttachments, sendMessage);
router.patch('/conversations/:id/messages/:messageId', updateMessage);
router.delete('/conversations/:id/messages/:messageId', deleteMessage);
router.post('/conversations/:id/messages/:messageId/reactions', reactToMessage);

module.exports = router;
