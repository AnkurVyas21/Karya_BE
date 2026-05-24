const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fsp = require('fs/promises');
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
  sendTyping,
  streamMessages
} = require('../controllers/messageController');

const router = express.Router();
const MAX_MESSAGE_ATTACHMENTS = 5;
const MAX_MESSAGE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGE_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const VIDEO_FILE_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.wmv']);

const isImageMimeType = (file) => String(file?.mimetype || '').toLowerCase().startsWith('image/');
const isVideoMimeType = (file) => String(file?.mimetype || '').toLowerCase().startsWith('video/');
const isVideoFile = (file) => isVideoMimeType(file) || VIDEO_FILE_EXTENSIONS.has(path.extname(file?.originalname || '').toLowerCase());

const validateMessageAttachments = (files = []) => {
  for (const file of files) {
    if (isVideoFile(file)) {
      throw new Error('Video uploads are not allowed in messages.');
    }

    if (!isImageMimeType(file) && Number(file.size || 0) > MAX_MESSAGE_FILE_SIZE_BYTES) {
      throw new Error('File attachments must be 2 MB or smaller.');
    }
  }
};

const cleanupUploadedFiles = async (files = []) => {
  await Promise.all((files || []).map((file) => (
    file?.path ? fsp.unlink(file.path).catch(() => undefined) : Promise.resolve()
  )));
};

const storage = multer.diskStorage({
  destination: getUploadDestination(),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MESSAGE_IMAGE_SIZE_BYTES, files: MAX_MESSAGE_ATTACHMENTS },
  fileFilter: (_req, file, cb) => {
    if (isVideoFile(file)) {
      cb(new Error('Video uploads are not allowed in messages.'));
      return;
    }

    cb(null, true);
  }
});

const uploadMessageAttachments = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }

  upload.array('attachments', MAX_MESSAGE_ATTACHMENTS)(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }

    try {
      validateMessageAttachments(req.files || []);
    } catch (validationError) {
      cleanupUploadedFiles(req.files || []).finally(() => next(validationError));
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
router.post('/conversations/:id/typing', sendTyping);
router.patch('/conversations/:id/messages/:messageId', updateMessage);
router.delete('/conversations/:id/messages/:messageId', deleteMessage);
router.post('/conversations/:id/messages/:messageId/reactions', reactToMessage);

module.exports = router;
