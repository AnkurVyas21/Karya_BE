const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');
const WebsiteTemplateMedia = require('../models/WebsiteTemplateMedia');
const mediaStorageService = require('./mediaStorageService');
const { getUploadDestination } = require('../utils/uploadPaths');

const cleanString = (value) => String(value || '').trim();
const cleanBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const TEMPLATE_CATEGORIES = ['logo', 'cover', 'header', 'about', 'gallery'];
const IMAGE_MIME_PREFIX = 'image/';

const escapeXml = (value = '') => cleanString(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const toObjectIdString = (value) => (value && typeof value.toString === 'function' ? value.toString() : String(value || ''));
const mediaIdentity = (value = '') => cleanString(value)
  .replace(/^https?:\/\/[^/]+/i, '')
  .replace(/^\/+/, '')
  .replace(/^uploads\//, 'uploads/');
const uniqueMediaList = (items = [], limit = 20) => {
  const seen = new Set();
  const next = [];
  items.filter(Boolean).forEach((item) => {
    const key = mediaIdentity(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    next.push(item);
  });
  return next.slice(0, limit);
};

class WebsiteTemplateMediaService {
  normalizeCategory(value = '') {
    const category = cleanString(value);
    return TEMPLATE_CATEGORIES.includes(category) ? category : '';
  }

  inferKind(file = {}) {
    const mimetype = cleanString(file.mimetype).toLowerCase();
    if (mimetype.startsWith(IMAGE_MIME_PREFIX)) {
      return 'image';
    }
    return '';
  }

  serialize(item) {
    if (!item) {
      return null;
    }
    return {
      id: toObjectIdString(item._id || item.id),
      category: cleanString(item.category),
      title: cleanString(item.title),
      fileUrl: cleanString(item.fileUrl),
      kind: cleanString(item.kind) || 'image',
      isActive: item.isActive !== false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  groupByCategory(items = []) {
    return items.reduce((groups, item) => {
      const category = cleanString(item.category);
      groups[category] = groups[category] || [];
      groups[category].push(this.serialize(item));
      return groups;
    }, {});
  }

  async list({ activeOnly = false } = {}) {
    const query = activeOnly ? { isActive: true } : {};
    query.category = { $in: TEMPLATE_CATEGORIES };
    const items = await WebsiteTemplateMedia.find(query).sort({ category: 1, createdAt: -1 }).lean();
    return {
      items: items.map((item) => this.serialize(item)),
      byCategory: this.groupByCategory(items)
    };
  }

  async listForProvider() {
    return this.list({ activeOnly: true });
  }

  async create(payload = {}, file = null, adminId = null) {
    const category = this.normalizeCategory(payload.category);
    if (!category) {
      throw new Error('Choose a valid template category');
    }
    if (!file?.path) {
      throw new Error('Upload a template media file');
    }

    const kind = this.inferKind(file);
    if (kind !== 'image') {
      throw new Error('Upload an image file for this template category');
    }

    const item = await WebsiteTemplateMedia.create({
      category,
      title: cleanString(payload.title) || this.defaultTitle(category),
      fileUrl: file.path,
      kind,
      isActive: cleanBoolean(payload.isActive, true),
      uploadedBy: adminId || null
    });

    return this.serialize(item);
  }

  async update(id, payload = {}) {
    const item = await WebsiteTemplateMedia.findById(id);
    if (!item) {
      throw new Error('Template media not found');
    }

    if (payload.category !== undefined) {
      const category = this.normalizeCategory(payload.category);
      if (!category) {
        throw new Error('Choose a valid template category');
      }
      item.category = category;
      item.kind = 'image';
    }
    if (payload.title !== undefined) {
      item.title = cleanString(payload.title);
    }
    if (payload.isActive !== undefined) {
      item.isActive = cleanBoolean(payload.isActive, item.isActive !== false);
    }

    await item.save();
    return this.serialize(item);
  }

  async remove(id) {
    const item = await WebsiteTemplateMedia.findByIdAndDelete(id).lean();
    if (!item) {
      throw new Error('Template media not found');
    }
    return this.serialize(item);
  }

  defaultTitle(category = '') {
    const labels = {
      logo: 'Logo template',
      cover: 'Cover image template',
      header: 'Header photo template',
      about: 'About business image template',
      gallery: 'Gallery photo template'
    };
    return labels[category] || 'Website template';
  }

  async findActiveById(id, allowedCategories = []) {
    const cleanId = cleanString(id);
    if (!/^[a-f\d]{24}$/i.test(cleanId)) {
      return null;
    }
    const query = { _id: cleanId, isActive: true };
    if (allowedCategories.length) {
      query.category = { $in: allowedCategories };
    }
    return WebsiteTemplateMedia.findOne(query).lean();
  }

  async randomActive(categories = [], kind = 'image') {
    const allowedCategories = categories.map((category) => this.normalizeCategory(category)).filter(Boolean);
    if (!allowedCategories.length) {
      return null;
    }
    const matches = await WebsiteTemplateMedia.aggregate([
      { $match: { isActive: true, category: { $in: allowedCategories }, kind } },
      { $sample: { size: 1 } }
    ]);
    return matches[0] || null;
  }

  async resolveSelectedOrRandom(selectedId = '', categories = [], kind = 'image') {
    const selected = await this.findActiveById(selectedId, categories);
    if (selected && selected.kind === kind) {
      return selected;
    }
    return this.randomActive(categories, kind);
  }

  async applyTemplates(website = {}, payload = {}, current = {}) {
    const selected = payload.selectedTemplateMedia || {};
    const next = {
      logo: current.logo || '',
      heroImage: current.heroImage || '',
      aboutImage: current.aboutImage || '',
      gallery: Array.isArray(current.gallery) ? current.gallery.slice() : [],
      videos: Array.isArray(current.videos) ? current.videos.slice() : []
    };
    const businessName = cleanString(payload.businessName || website.businessName || 'My Business');

    const logoTemplate = await this.resolveSelectedOrRandom(selected.logo, ['logo'], 'image');
    if (logoTemplate && (!next.logo || cleanString(selected.logo))) {
      next.logo = await this.generateLogoFromTemplate(logoTemplate, businessName);
    }

    const heroTemplate = await this.resolveSelectedOrRandom(selected.heroImage || selected.cover || selected.header, ['cover', 'header'], 'image');
    if (heroTemplate && (!next.heroImage || cleanString(selected.heroImage || selected.cover || selected.header))) {
      next.heroImage = cleanString(heroTemplate.fileUrl);
    }

    const aboutTemplate = await this.resolveSelectedOrRandom(selected.aboutImage || selected.about, ['about'], 'image');
    if (aboutTemplate && (!next.aboutImage || cleanString(selected.aboutImage || selected.about))) {
      next.aboutImage = cleanString(aboutTemplate.fileUrl);
    }

    const gallerySelections = Array.isArray(selected.gallery) ? selected.gallery : cleanString(selected.gallery) ? [selected.gallery] : [];
    const selectedGallery = await this.resolveTemplateList(gallerySelections, ['gallery'], 'image');
    if (selectedGallery.length) {
      next.gallery = [...next.gallery, ...selectedGallery.map((item) => cleanString(item.fileUrl))];
    } else if (!next.gallery.length) {
      const galleryTemplate = await this.randomActive(['gallery'], 'image');
      if (galleryTemplate) {
        next.gallery = [cleanString(galleryTemplate.fileUrl)];
      }
    }

    next.gallery = uniqueMediaList(next.gallery, 20);
    next.videos = uniqueMediaList(next.videos, 8);
    return next;
  }

  async resolveTemplateList(ids = [], categories = [], kind = 'image') {
    const cleanIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => cleanString(id)).filter(Boolean)));
    if (!cleanIds.length) {
      return [];
    }
    const items = await WebsiteTemplateMedia.find({
      _id: { $in: cleanIds },
      category: { $in: categories },
      kind,
      isActive: true
    }).lean();
    const byId = new Map(items.map((item) => [toObjectIdString(item._id), item]));
    return cleanIds.map((id) => byId.get(id)).filter(Boolean);
  }

  async generateLogoFromTemplate(template = {}, businessName = '') {
    const buffer = await this.readTemplateBuffer(template.fileUrl);
    if (!buffer?.length) {
      return cleanString(template.fileUrl);
    }

    const label = cleanString(businessName || 'My Business').slice(0, 52);
    const fontSize = label.length > 28 ? 44 : label.length > 16 ? 54 : 64;
    const svg = `
      <svg width="720" height="720" viewBox="0 0 720 720" xmlns="http://www.w3.org/2000/svg">
        <rect x="44" y="488" width="632" height="154" rx="32" fill="rgba(10,18,35,0.74)"/>
        <text x="360" y="572" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff">${escapeXml(label)}</text>
      </svg>
    `;
    const outputPath = path.join(getUploadDestination(), `logo-template-${Date.now()}-${crypto.randomUUID()}.png`);
    await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(720, 720, { fit: 'cover' })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png()
      .toFile(outputPath);

    const persisted = await mediaStorageService.persistUploadedFile({
      fieldname: 'logoImage',
      originalname: 'template-logo.png',
      filename: path.basename(outputPath),
      path: outputPath,
      mimetype: 'image/png'
    });

    return persisted.path;
  }

  async readTemplateBuffer(fileUrl = '') {
    const source = cleanString(fileUrl);
    if (!source) {
      return null;
    }

    const storedObject = await mediaStorageService.getStoredObject(source).catch(() => null);
    if (storedObject?.body) {
      return storedObject.body;
    }

    if (/^https?:\/\//i.test(source) && typeof fetch === 'function') {
      const response = await fetch(source).catch(() => null);
      if (response?.ok) {
        return Buffer.from(await response.arrayBuffer());
      }
    }

    return null;
  }
}

module.exports = new WebsiteTemplateMediaService();
