const fs = require('fs');
const path = require('path');

const primaryUploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
const legacyUploadsDir = path.resolve(process.cwd(), 'uploads');

const normalizeUploadKey = (value = '') => {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  if (!normalized || normalized.includes('..')) {
    return '';
  }

  return normalized;
};

const ensureUploadsDir = () => {
  if (!fs.existsSync(primaryUploadsDir)) {
    fs.mkdirSync(primaryUploadsDir, { recursive: true });
  }
  return primaryUploadsDir;
};

const getUploadDestination = () => ensureUploadsDir();

const getUploadSearchPaths = (key = '') => {
  const normalizedKey = normalizeUploadKey(key);
  if (!normalizedKey) {
    return [];
  }

  const roots = [ensureUploadsDir()];
  if (legacyUploadsDir !== primaryUploadsDir) {
    roots.push(legacyUploadsDir);
  }

  return roots.map((root) => path.resolve(root, normalizedKey));
};

const resolveUploadFile = (key = '') => {
  const matches = getUploadSearchPaths(key);
  for (const filePath of matches) {
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return matches[0] || '';
};

module.exports = {
  getUploadDestination,
  getUploadSearchPaths,
  normalizeUploadKey,
  resolveUploadFile
};
