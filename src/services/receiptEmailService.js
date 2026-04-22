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

  async sendReceipt({ to = [], subject = '', html = '' }) {
    const recipients = (Array.isArray(to) ? to : [to]).map((item) => String(item || '').trim()).filter(Boolean);
    if (recipients.length === 0) {
      return false;
    }

    const transporter = this.getTransporter();
    if (!transporter) {
      logger.warn('Receipt email skipped because SMTP is not configured');
      return false;
    }

    try {
      await transporter.sendMail({
        from: String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim(),
        to: recipients.join(', '),
        subject,
        html
      });
      return true;
    } catch (error) {
      logger.warn(`Receipt email failed: ${error.message}`);
      return false;
    }
  }
}

module.exports = new ReceiptEmailService();
