const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { getUploadDestination, normalizeUploadKey, resolveUploadFile } = require('../utils/uploadPaths');

const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || '').trim();
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || '').trim();
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET = String(process.env.R2_BUCKET || '').trim();
const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
const R2_KEY_PREFIX = String(process.env.R2_KEY_PREFIX || 'media').trim().replace(/^\/+|\/+$/g, '');

let r2Client = null;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']);
const IMAGE_PRESETS = {
  heroImage: { width: 1800, quality: 82 },
  websiteImages: { width: 1800, quality: 82 },
  galleryImages: { width: 1400, quality: 78 },
  image: { width: 1600, quality: 82 },
  profilePicture: { width: 720, quality: 74 },
  logoImage: { width: 720, quality: 78 },
  upiQrCodeImage: { width: 640, quality: 90 },
  default: { width: 1200, quality: 76 }
};

const streamToBuffer = async (body) => {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(body)) {
    return body;
  }

  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

class MediaStorageService {
  isR2Enabled() {
    return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
  }

  getR2Client() {
    if (!this.isR2Enabled()) {
      return null;
    }

    if (!r2Client) {
      r2Client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: R2_ACCESS_KEY_ID,
          secretAccessKey: R2_SECRET_ACCESS_KEY
        }
      });
    }

    return r2Client;
  }

  buildObjectKey(file = {}) {
    const ext = file.optimizedExtension || path.extname(file.originalname || file.filename || file.path || '').toLowerCase();
    const unique = `${Date.now()}-${crypto.randomUUID().replace(/-/g, '')}${ext}`;
    return normalizeUploadKey(R2_KEY_PREFIX ? `${R2_KEY_PREFIX}/${unique}` : unique);
  }

  buildPublicPath(key = '') {
    const normalizedKey = normalizeUploadKey(key);
    if (!normalizedKey) {
      return '';
    }

    if (R2_PUBLIC_BASE_URL) {
      return `${R2_PUBLIC_BASE_URL}/${normalizedKey}`;
    }

    return `/uploads/${normalizedKey}`;
  }

  isCompressibleImage(file = {}) {
    return IMAGE_MIME_TYPES.has(String(file.mimetype || '').toLowerCase());
  }

  imagePresetFor(file = {}) {
    return IMAGE_PRESETS[file.fieldname] || IMAGE_PRESETS.default;
  }

  async optimizeImageFile(file = {}) {
    if (!file?.path || !this.isCompressibleImage(file)) {
      return file;
    }

    const preset = this.imagePresetFor(file);
    const inputPath = path.resolve(file.path);
    const outputPath = `${inputPath}.webp`;

    await sharp(inputPath, { failOn: 'none' })
      .rotate()
      .resize({ width: preset.width, withoutEnlargement: true })
      .webp({ quality: preset.quality, effort: 5 })
      .toFile(outputPath);

    const optimizedStats = await fsp.stat(outputPath);
    const originalStats = await fsp.stat(inputPath).catch(() => ({ size: file.size || 0 }));

    if (originalStats.size && optimizedStats.size >= originalStats.size) {
      await fsp.unlink(outputPath).catch(() => undefined);
      return file;
    }

    await fsp.unlink(inputPath).catch(() => undefined);
    return {
      ...file,
      path: outputPath,
      filename: `${path.basename(file.filename || inputPath)}.webp`,
      mimetype: 'image/webp',
      size: optimizedStats.size,
      optimizedExtension: '.webp'
    };
  }

  async persistUploadedFile(file = {}) {
    if (!file?.path) {
      return file;
    }

    const preparedFile = await this.optimizeImageFile(file);
    const normalizedLocalPath = path.resolve(preparedFile.path);
    const fallbackKey = normalizeUploadKey(path.basename(preparedFile.filename || normalizedLocalPath));

    if (!this.isR2Enabled()) {
      return {
        ...preparedFile,
        path: this.buildPublicPath(fallbackKey),
        storageKey: fallbackKey
      };
    }

    const key = this.buildObjectKey(preparedFile);
    const client = this.getR2Client();
    const body = await fsp.readFile(normalizedLocalPath);

    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: preparedFile.mimetype || 'application/octet-stream'
    }));

    await fsp.unlink(normalizedLocalPath).catch(() => undefined);

    return {
      ...preparedFile,
      path: this.buildPublicPath(key),
      storageKey: key
    };
  }

  async persistRequestFiles(req) {
    if (!req) {
      return;
    }

    if (req.file) {
      req.file = await this.persistUploadedFile(req.file);
    }

    if (!req.files) {
      return;
    }

    if (Array.isArray(req.files)) {
      req.files = await Promise.all(req.files.map((file) => this.persistUploadedFile(file)));
      return;
    }

    const entries = Object.entries(req.files);
    for (const [key, files] of entries) {
      req.files[key] = await Promise.all((files || []).map((file) => this.persistUploadedFile(file)));
    }
  }

  normalizeRequestedKey(value = '') {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }

    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        return normalizeUploadKey(url.pathname.replace(/^\/+/, ''));
      } catch (_error) {
        return '';
      }
    }

    return normalizeUploadKey(raw.replace(/^\/?uploads\//, ''));
  }

  resolveLocalFile(key = '') {
    const normalizedKey = this.normalizeRequestedKey(key);
    if (!normalizedKey) {
      return '';
    }
    return resolveUploadFile(normalizedKey);
  }

  async getStoredObject(key = '') {
    const normalizedKey = this.normalizeRequestedKey(key);
    if (!normalizedKey) {
      return null;
    }

    const localFilePath = this.resolveLocalFile(normalizedKey);
    if (localFilePath && fs.existsSync(localFilePath)) {
      const body = await fsp.readFile(localFilePath);
      return {
        body,
        contentType: '',
        cacheControl: 'public, max-age=86400'
      };
    }

    if (!this.isR2Enabled()) {
      return null;
    }

    const client = this.getR2Client();

    try {
      const result = await client.send(new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: normalizedKey
      }));

      return {
        body: await streamToBuffer(result.Body instanceof Readable ? result.Body : result.Body),
        contentType: String(result.ContentType || '').trim(),
        cacheControl: String(result.CacheControl || 'public, max-age=86400').trim()
      };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey' || error?.Code === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async objectExists(key = '') {
    const normalizedKey = this.normalizeRequestedKey(key);
    if (!normalizedKey) {
      return false;
    }

    const localFilePath = this.resolveLocalFile(normalizedKey);
    if (localFilePath && fs.existsSync(localFilePath)) {
      return true;
    }

    if (!this.isR2Enabled()) {
      return false;
    }

    try {
      await this.getR2Client().send(new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: normalizedKey
      }));
      return true;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }
}

module.exports = new MediaStorageService();
