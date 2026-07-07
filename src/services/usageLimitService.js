const crypto = require('crypto');
const UsageCounter = require('../models/UsageCounter');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

class UsageLimitError extends Error {
  constructor(message, retryAfterSeconds = 0) {
    super(message);
    this.name = 'UsageLimitError';
    this.statusCode = 429;
    this.retryAfterSeconds = Math.max(0, Number(retryAfterSeconds) || 0);
  }
}

const clean = (value = '') => String(value || '').trim().toLowerCase();

class UsageLimitService {
  hash(value = '') {
    return crypto
      .createHash('sha256')
      .update(String(value || ''))
      .digest('hex')
      .slice(0, 40);
  }

  buildKey(scope, subject) {
    return `${clean(scope)}:${this.hash(clean(subject))}`;
  }

  getRetryAfterSeconds(expiresAt, now = new Date()) {
    return Math.max(1, Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000));
  }

  async getActiveCounter(scope, subject) {
    const now = new Date();
    const counter = await UsageCounter.findOne({ key: this.buildKey(scope, subject) });
    if (!counter || counter.expiresAt <= now) {
      return null;
    }
    return counter;
  }

  async consume(options = {}) {
    const scope = clean(options.scope);
    const subject = clean(options.subject);
    const limit = Math.max(1, Number(options.limit) || 1);
    const windowMs = Math.max(SECOND, Number(options.windowMs) || HOUR);
    const amount = Math.max(1, Number(options.amount) || 1);
    const message = String(options.message || 'Too many requests. Please try again later.');
    const metadata = options.metadata || null;

    if (!scope || !subject) {
      throw new Error('Usage limit scope and subject are required');
    }

    const now = new Date();
    const key = this.buildKey(scope, subject);
    const expiresAt = new Date(now.getTime() + windowMs);

    const incremented = await UsageCounter.findOneAndUpdate(
      {
        key,
        expiresAt: { $gt: now },
        count: { $lte: limit - amount }
      },
      {
        $inc: { count: amount },
        $set: { scope, limit, metadata }
      },
      { new: true }
    );

    if (incremented) {
      return {
        limit,
        used: incremented.count,
        remaining: Math.max(0, limit - incremented.count),
        retryAfterSeconds: this.getRetryAfterSeconds(incremented.expiresAt, now)
      };
    }

    const counter = await UsageCounter.findOne({ key });
    if (counter && counter.expiresAt > now) {
      throw new UsageLimitError(message, this.getRetryAfterSeconds(counter.expiresAt, now));
    }

    if (counter) {
      const reset = await UsageCounter.findOneAndUpdate(
        { key, expiresAt: { $lte: now } },
        {
          $set: {
            scope,
            count: amount,
            limit,
            windowStartedAt: now,
            expiresAt,
            metadata
          }
        },
        { new: true }
      );

      if (reset) {
        return {
          limit,
          used: reset.count,
          remaining: Math.max(0, limit - reset.count),
          retryAfterSeconds: this.getRetryAfterSeconds(reset.expiresAt, now)
        };
      }

      return this.consume(options);
    }

    try {
      const created = await UsageCounter.create({
        key,
        scope,
        count: amount,
        limit,
        windowStartedAt: now,
        expiresAt,
        metadata
      });

      return {
        limit,
        used: created.count,
        remaining: Math.max(0, limit - created.count),
        retryAfterSeconds: this.getRetryAfterSeconds(created.expiresAt, now)
      };
    } catch (error) {
      if (error?.code === 11000) {
        return this.consume(options);
      }
      throw error;
    }
  }

  async assertAiSearchAllowed(req = {}) {
    const userId = req.user?._id?.toString?.() || '';
    const ip = this.getClientIp(req);

    if (userId) {
      return this.consume({
        scope: 'ai_search_user_12h',
        subject: userId,
        limit: 25,
        windowMs: 12 * HOUR,
        message: 'AI search limit reached. Please try again later.',
        metadata: { userId }
      });
    }

    return this.consume({
      scope: 'ai_search_anonymous_day',
      subject: ip,
      limit: 10,
      windowMs: DAY,
      message: 'Anonymous AI search limit reached. Please sign in or try again tomorrow.',
      metadata: { ipHash: this.hash(ip) }
    });
  }

  async assertMobileOtpSendAllowed({ identifier = '', userId = '', ip = '' } = {}) {
    const mobile = clean(identifier);
    if (!mobile) {
      throw new Error('Mobile number is required');
    }

    await this.consume({
      scope: 'mobile_otp_send_cooldown',
      subject: mobile,
      limit: 1,
      windowMs: 75 * SECOND,
      message: 'Please wait before requesting another mobile OTP.'
    });

    await this.consume({
      scope: 'mobile_otp_send_identifier_hour',
      subject: mobile,
      limit: 3,
      windowMs: HOUR,
      message: 'Too many mobile OTP requests for this number. Please try again later.'
    });

    await this.consume({
      scope: 'mobile_otp_send_identifier_day',
      subject: mobile,
      limit: 5,
      windowMs: DAY,
      message: 'Daily mobile OTP limit reached for this number. Please try again tomorrow.'
    });

    if (userId) {
      await this.consume({
        scope: 'mobile_otp_send_user_hour',
        subject: userId,
        limit: 5,
        windowMs: HOUR,
        message: 'Too many mobile OTP requests from this account. Please try again later.'
      });
    }

    if (ip) {
      await this.consume({
        scope: 'mobile_otp_send_ip_hour',
        subject: ip,
        limit: 10,
        windowMs: HOUR,
        message: 'Too many mobile OTP requests from this network. Please try again later.'
      });
    }

    return true;
  }

  otpAttemptSubject({ userId = '', type = '', identifier = '' } = {}) {
    return [userId, clean(type), clean(identifier)].filter(Boolean).join(':');
  }

  async assertOtpVerifyAllowed(context = {}) {
    const subject = this.otpAttemptSubject(context);
    if (!subject) {
      return true;
    }

    const limit = 5;
    const counter = await this.getActiveCounter('otp_verify_failures', subject);
    if (counter && counter.count >= limit) {
      throw new UsageLimitError(
        'Too many incorrect OTP attempts. Please request a new OTP or try again later.',
        this.getRetryAfterSeconds(counter.expiresAt)
      );
    }

    return true;
  }

  async recordOtpVerifyFailure(context = {}) {
    const subject = this.otpAttemptSubject(context);
    if (!subject) {
      return null;
    }

    const result = await this.consume({
      scope: 'otp_verify_failures',
      subject,
      limit: 5,
      windowMs: 15 * MINUTE,
      message: 'Too many incorrect OTP attempts. Please request a new OTP or try again later.'
    });

    if (result.remaining <= 0) {
      throw new UsageLimitError(
        'Too many incorrect OTP attempts. Please request a new OTP or try again later.',
        result.retryAfterSeconds
      );
    }

    return result;
  }

  async clearOtpVerifyFailures(context = {}) {
    const subject = this.otpAttemptSubject(context);
    if (!subject) {
      return;
    }

    await UsageCounter.deleteOne({ key: this.buildKey('otp_verify_failures', subject) });
  }

  getClientIp(req = {}) {
    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return clean(forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown');
  }
}

module.exports = new UsageLimitService();
module.exports.UsageLimitError = UsageLimitError;
