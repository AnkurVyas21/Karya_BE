const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const mimeTypesByExtension = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.zip': 'application/zip'
};

const detectMimeType = (buffer, filename = '') => {
  if (!buffer || buffer.length < 4) {
    return 'application/octet-stream';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return 'image/gif';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp'
  ) {
    return 'image/avif';
  }

  const ext = path.extname(filename || '').toLowerCase();
  if (ext && mimeTypesByExtension[ext]) {
    return mimeTypesByExtension[ext];
  }

  return 'application/octet-stream';
};

app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => req.path === '/api/messages/stream' || req.path === '/api/auth/login'
}));
app.get('/uploads/:filename', (req, res, next) => {
  const filename = path.basename(req.params.filename || '');
  const filePath = path.join(uploadsDir, filename);

  if (!filePath.startsWith(uploadsDir)) {
    return res.status(400).json({ success: false, message: 'Invalid file path' });
  }

  fs.readFile(filePath, (error, fileBuffer) => {
    if (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      return next(error);
    }

    res.setHeader('Content-Type', detectMimeType(fileBuffer, filename));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(fileBuffer);
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/professional', require('./routes/professional'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/admin', require('./routes/admin'));

// Error handler
app.use(require('./middlewares/errorHandler'));

module.exports = app;
