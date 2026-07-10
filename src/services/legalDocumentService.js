const LegalDocument = require('../models/LegalDocument');
const User = require('../models/User');
const receiptEmailService = require('./receiptEmailService');
const notificationService = require('./notificationService');
const logger = require('../utils/logger');
const { DEFAULT_LEGAL_DOCUMENTS, LEGAL_DOCUMENT_TYPES } = require('../constants/legalDocuments');
const { isPlaceholderEmail } = require('../utils/accountPresenter');

const VALID_TYPES = new Set(LEGAL_DOCUMENT_TYPES);
const MAX_SECTIONS = 30;
const EMAIL_BATCH_SIZE = 8;

const cleanString = (value = '', maxLength = 10000) => String(value || '').trim().slice(0, maxLength);
const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanString(value).toLowerCase());

const escapeHtml = (value = '') => cleanString(value, 20000)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
};

const publicPathForType = (type) => type === 'privacy' ? '/privacy' : '/terms';

const frontendBaseUrl = () => {
  const raw = cleanString(process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://nasdiya.com', 300);
  return raw.replace(/\/+$/, '');
};

class LegalDocumentService {
  validateType(type) {
    const cleanType = cleanString(type, 40).toLowerCase();
    if (!VALID_TYPES.has(cleanType)) {
      throw new Error('Unknown legal document type.');
    }
    return cleanType;
  }

  defaultPayload(type) {
    const cleanType = this.validateType(type);
    const base = DEFAULT_LEGAL_DOCUMENTS[cleanType];
    return {
      ...base,
      sections: base.sections.map((section) => ({ ...section })),
      isPublished: true,
      publishedAt: new Date()
    };
  }

  serialize(document) {
    if (!document) {
      return null;
    }

    const plain = document.toObject ? document.toObject() : document;
    return {
      id: plain._id?.toString?.() || String(plain.id || ''),
      type: cleanString(plain.type),
      eyebrow: cleanString(plain.eyebrow),
      title: cleanString(plain.title),
      intro: cleanString(plain.intro),
      version: cleanString(plain.version),
      effectiveDate: plain.effectiveDate,
      sections: (plain.sections || []).map((section) => ({
        title: cleanString(section.title),
        body: cleanString(section.body, 12000)
      })),
      isPublished: plain.isPublished !== false,
      publishedAt: plain.publishedAt,
      updatedAt: plain.updatedAt,
      createdAt: plain.createdAt,
      notificationHistory: (plain.notificationHistory || []).map((item) => ({
        notifiedAt: item.notifiedAt,
        version: cleanString(item.version),
        subject: cleanString(item.subject),
        recipientsTotal: Number(item.recipientsTotal) || 0,
        sentCount: Number(item.sentCount) || 0,
        failedCount: Number(item.failedCount) || 0
      }))
    };
  }

  async ensureDocument(type) {
    const cleanType = this.validateType(type);
    const existing = await LegalDocument.findOne({ type: cleanType });
    if (existing) {
      return existing;
    }

    return LegalDocument.create(this.defaultPayload(cleanType));
  }

  async getPublicDocument(type) {
    const document = await this.ensureDocument(type);
    return this.serialize(document);
  }

  async listForAdmin() {
    const documents = await Promise.all(LEGAL_DOCUMENT_TYPES.map((type) => this.ensureDocument(type)));
    return {
      items: documents.map((document) => this.serialize(document))
    };
  }

  normalizeSections(sections) {
    if (!Array.isArray(sections)) {
      throw new Error('Sections must be an array.');
    }

    const normalized = sections
      .slice(0, MAX_SECTIONS)
      .map((section) => ({
        title: cleanString(section?.title, 180),
        body: cleanString(section?.body || section?.copy, 12000)
      }))
      .filter((section) => section.title && section.body);

    if (!normalized.length) {
      throw new Error('Add at least one section with a title and body.');
    }

    return normalized;
  }

  normalizeEffectiveDate(value) {
    if (!value) {
      return new Date();
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Enter a valid effective date.');
    }
    return date;
  }

  async updateDocument(type, payload = {}, adminId = null) {
    const cleanType = this.validateType(type);
    const document = await this.ensureDocument(cleanType);

    document.eyebrow = cleanString(payload.eyebrow || document.eyebrow, 120);
    document.title = cleanString(payload.title || document.title, 180);
    document.intro = cleanString(payload.intro || document.intro, 1500);
    document.version = cleanString(payload.version || document.version, 40) || document.version;
    document.effectiveDate = this.normalizeEffectiveDate(payload.effectiveDate || document.effectiveDate);
    document.sections = this.normalizeSections(payload.sections || document.sections);
    document.isPublished = true;
    document.publishedAt = new Date();
    document.updatedBy = adminId || null;

    await document.save();
    return this.serialize(document);
  }

  buildPolicyEmail({ document, user }) {
    const title = cleanString(document.title);
    const version = cleanString(document.version);
    const effectiveDate = formatDate(document.effectiveDate);
    const path = publicPathForType(document.type);
    const url = `${frontendBaseUrl()}${path}`;
    const name = cleanString(user.fullName || user.email, 120) || 'Nasdiya user';
    const subject = `Updated Nasdiya ${title}`;

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
        <p>Hello ${escapeHtml(name)},</p>
        <p>Nasdiya has updated its <strong>${escapeHtml(title)}</strong>${version ? ` to version ${escapeHtml(version)}` : ''}${effectiveDate ? `, effective ${escapeHtml(effectiveDate)}` : ''}.</p>
        <p>Please review the latest document here: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
        <p>This update explains platform terms, privacy practices, user responsibilities, provider responsibilities, and related legal information for using Nasdiya.</p>
        <p>If you have questions or want to raise a privacy or support request, email <a href="mailto:support@nasdiya.com">support@nasdiya.com</a>.</p>
        <p style="margin-top:22px;color:#667085;font-size:13px">You are receiving this because you have a Nasdiya account.</p>
      </div>
    `;

    return { subject, html, linkPath: path };
  }

  async notifyUsers(type, adminId = null) {
    const cleanType = this.validateType(type);
    const document = await this.ensureDocument(cleanType);
    const users = await User.find({
      role: { $in: ['user', 'professional'] },
      isBanned: { $ne: true },
      email: { $type: 'string', $ne: '' }
    }).select('_id fullName email role').lean();

    const recipients = users
      .map((user) => ({ ...user, email: cleanString(user.email).toLowerCase() }))
      .filter((user) => isValidEmail(user.email) && !isPlaceholderEmail(user.email));

    let sentCount = 0;
    let failedCount = 0;
    const { subject, linkPath } = this.buildPolicyEmail({ document, user: recipients[0] || {} });

    for (let index = 0; index < recipients.length; index += EMAIL_BATCH_SIZE) {
      const batch = recipients.slice(index, index + EMAIL_BATCH_SIZE);
      const results = await Promise.all(batch.map(async (user) => {
        const email = this.buildPolicyEmail({ document, user });
        const [sent] = await Promise.all([
          receiptEmailService.sendReceipt({
            to: [user.email],
            subject: email.subject,
            html: email.html
          }),
          notificationService.createNotification({
            userId: user._id,
            type: 'system',
            title: `Updated ${document.title}`,
            body: 'Please review the latest Nasdiya legal document.',
            linkPath,
            metadata: {
              legalDocumentType: document.type,
              version: document.version
            }
          }).catch((error) => {
            logger.warn(`Policy notification record failed: ${error.message}`);
            return null;
          })
        ]);
        return Boolean(sent);
      }));

      sentCount += results.filter(Boolean).length;
      failedCount += results.filter((sent) => !sent).length;
    }

    document.notificationHistory = Array.isArray(document.notificationHistory)
      ? document.notificationHistory
      : [];
    document.notificationHistory.push({
      notifiedAt: new Date(),
      version: document.version,
      subject,
      recipientsTotal: recipients.length,
      sentCount,
      failedCount,
      triggeredBy: adminId || null
    });
    if (document.notificationHistory.length > 20) {
      document.notificationHistory = document.notificationHistory.slice(-20);
    }
    await document.save();

    return {
      document: this.serialize(document),
      recipientsTotal: recipients.length,
      sentCount,
      failedCount
    };
  }
}

module.exports = new LegalDocumentService();
