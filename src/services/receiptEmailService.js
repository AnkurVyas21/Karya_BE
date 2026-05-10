const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class ReceiptEmailService {
  constructor() {
    this.transporter = null;
  }

  getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const host = String(process.env.SMTP_HOST || '').trim();
    const user = String(process.env.SMTP_USER || '').trim();
    const pass = String(process.env.SMTP_PASS || '').trim();
    const port = Number(process.env.SMTP_PORT || 587);

    if (!host || !user || !pass) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    return this.transporter;
  }

  normalizeAttachments(attachments = [], { base64 = false } = {}) {
    if (!Array.isArray(attachments)) {
      return [];
    }

    return attachments
      .map((item) => {
        const filename = String(item?.filename || '').trim();
        const content = item?.content;
        if (!filename || content === null || content === undefined) {
          return null;
        }
        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
        return {
          filename,
          content: base64 ? buffer.toString('base64') : buffer,
          contentType: item?.contentType || 'application/octet-stream'
        };
      })
      .filter(Boolean);
  }

  async sendWithResend({ to = [], subject = '', html = '', replyTo = '', attachments = [] }) {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.RESEND_FROM || '').trim();
    const recipients = (Array.isArray(to) ? to : [to]).map((item) => String(item || '').trim()).filter(Boolean);

    if (!apiKey || !from || recipients.length === 0) {
      return false;
    }

    try {
      const body = {
        from,
        to: recipients,
        subject,
        html
      };
      const normalizedAttachments = this.normalizeAttachments(attachments, { base64: true });
      if (normalizedAttachments.length > 0) {
        body.attachments = normalizedAttachments;
      }
      if (String(replyTo || '').trim()) {
        body.reply_to = String(replyTo || '').trim();
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        logger.warn(`Receipt email via Resend failed: ${payload.message || payload.error || response.status}`);
        return false;
      }

      return true;
    } catch (error) {
      logger.warn(`Receipt email via Resend failed: ${error.message}`);
      return false;
    }
  }

  async sendReceipt({ to = [], subject = '', html = '', replyTo = '', attachments = [] }) {
    const recipients = (Array.isArray(to) ? to : [to]).map((item) => String(item || '').trim()).filter(Boolean);
    if (recipients.length === 0) {
      return false;
    }

    const transporter = this.getTransporter();
    if (!transporter) {
      const sentWithResend = await this.sendWithResend({ to: recipients, subject, html, replyTo, attachments });
      if (!sentWithResend) {
        logger.warn('Receipt email skipped because neither SMTP nor Resend is configured');
      }
      return sentWithResend;
    }

    try {
      const mailOptions = {
        from: String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
        to: recipients.join(', '),
        subject,
        html,
        attachments: this.normalizeAttachments(attachments)
      };
      if (String(replyTo || '').trim()) {
        mailOptions.replyTo = String(replyTo || '').trim();
      }
      await transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      logger.warn(`Receipt email failed: ${error.message}`);
      const sentWithResend = await this.sendWithResend({ to: recipients, subject, html, replyTo, attachments });
      if (!sentWithResend) {
        logger.warn('Receipt email could not be sent by SMTP or Resend');
      }
      return sentWithResend;
    }
  }
}

module.exports = new ReceiptEmailService();
