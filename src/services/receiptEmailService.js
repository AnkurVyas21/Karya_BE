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

  async sendWithResend({ to = [], subject = '', html = '', replyTo = '' }) {
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

  async sendReceipt({ to = [], subject = '', html = '', replyTo = '' }) {
    const recipients = (Array.isArray(to) ? to : [to]).map((item) => String(item || '').trim()).filter(Boolean);
    if (recipients.length === 0) {
      return false;
    }

    const transporter = this.getTransporter();
    if (!transporter) {
      const sentWithResend = await this.sendWithResend({ to: recipients, subject, html, replyTo });
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
        html
      };
      if (String(replyTo || '').trim()) {
        mailOptions.replyTo = String(replyTo || '').trim();
      }
      await transporter.sendMail(mailOptions);
      return true;
    } catch (error) {
      logger.warn(`Receipt email failed: ${error.message}`);
      return false;
    }
  }
}

module.exports = new ReceiptEmailService();
