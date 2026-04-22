const fs = require('fs');
const path = require('path');

const primaryUploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
const legacyUploadsDir = path.resolve(process.cwd(), 'uploads');

const ensureUploadsDir = () => {
  if (!fs.existsSync(primaryUploadsDir)) {
    fs.mkdirSync(primaryUploadsDir, { recursive: true });
  }
  return primaryUploadsDir;
};

const getUploadDestination = () => ensureUploadsDir();

const getUploadSearchPaths = (filename = '') => {
  const safeFilename = path.basename(filename || '');
  if (!safeFilename) {
    return [];
  }

  const roots = [ensureUploadsDir()];
  if (legacyUploadsDir !== primaryUploadsDir) {
    roots.push(legacyUploadsDir);
  }

  return roots.map((root) => path.join(root, safeFilename));
};

const resolveUploadFile = (filename = '') => {
  const matches = getUploadSearchPaths(filename);
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
  resolveUploadFile
};
