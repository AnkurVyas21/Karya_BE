const crypto = require('crypto');
const QRCode = require('qrcode');
const ProviderGrowth = require('../models/ProviderGrowth');
const ProviderWebsite = require('../models/ProviderWebsite');
const ProviderServiceModel = require('../models/ProviderService');
const ProviderProduct = require('../models/ProviderProduct');
const ProviderProductOrder = require('../models/ProviderProductOrder');
const ProviderArticle = require('../models/ProviderArticle');
const ProviderOffer = require('../models/ProviderOffer');
const ProviderLead = require('../models/ProviderLead');
const ProviderBooking = require('../models/ProviderBooking');
const WebsiteTransaction = require('../models/WebsiteTransaction');
const notificationService = require('./notificationService');
const ProviderThemeConfig = require('../models/ProviderThemeConfig');
const ProviderSEOConfig = require('../models/ProviderSEOConfig');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const Review = require('../models/Review');
const User = require('../models/User');
const logger = require('../utils/logger');
const providerGrowthService = require('./providerGrowthService');
const websitePaymentService = require('./websitePaymentService');
const receiptEmailService = require('./receiptEmailService');
const receiptPdfService = require('./receiptPdfService');
const websiteTemplateMediaService = require('./websiteTemplateMediaService');

const DEFAULT_BUSINESS_HOURS = [
  { day: 'Monday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Tuesday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Wednesday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Thursday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Friday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Saturday', isOpen: true, openTime: '09:00', closeTime: '21:00' },
  { day: 'Sunday', isOpen: true, openTime: '09:00', closeTime: '21:00' }
];

const DEFAULT_BOOKING_SLOTS = [
  { label: 'Morning', startTime: '09:00', endTime: '12:00', isActive: true },
  { label: 'Afternoon', startTime: '12:00', endTime: '16:00', isActive: true },
  { label: 'Evening', startTime: '16:00', endTime: '19:00', isActive: true }
];

const INDIA_TIME_ZONE = 'Asia/Kolkata';
const cleanString = (value) => String(value || '').trim();
const cleanArray = (value) => Array.isArray(value)
  ? value.map((item) => cleanString(item)).filter(Boolean)
  : cleanString(value)
    ? cleanString(value).split(',').map((item) => cleanString(item)).filter(Boolean)
    : [];
const cleanBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};
const cleanNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const generateBookingOtp = () => String(crypto.randomInt(100000, 1000000));
const hashBookingOtp = (value = '') => crypto.createHash('sha256').update(cleanString(value)).digest('hex');
const normalizeOfferCode = (value = '') => cleanString(value)
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')
  .slice(0, 18);
const normalizeIndianPhone = (value = '') => String(value || '').replace(/[^\d]/g, '').slice(-10);
const slugify = (value = '') => cleanString(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 60);
const escapeRegex = (value = '') => cleanString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isValidIndianPhone = (value = '') => /^[6-9]\d{9}$/.test(String(value || '').replace(/[^\d]/g, '').slice(-10));
const isValidUpi = (value = '') => !cleanString(value) || /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(cleanString(value));
const isValidObjectIdString = (value = '') => /^[a-f\d]{24}$/i.test(cleanString(value));
const normalizeGallery = (value) => cleanArray(value).slice(0, 20);
const normalizeVideos = (value) => cleanArray(value).slice(0, 8);
const toObjectIdString = (value) => (value && typeof value.toString === 'function' ? value.toString() : String(value || ''));
const normalizeDayLabel = (value = '') => cleanString(value).toLowerCase();
const clampNumber = (value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = cleanNumber(value, fallback);
  return Math.min(Math.max(parsed, min), max);
};
const parseTimeToMinutes = (value = '') => {
  const normalized = cleanString(value)
    .toUpperCase()
    .replace(/(\d)\.(\d)/g, '$1:$2')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b([AP])\s+M\b/g, '$1M');
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/.exec(normalized);
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
    return null;
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = meridiem === 'AM'
      ? hours === 12 ? 0 : hours
      : hours === 12 ? 12 : hours + 12;
  } else if (hours < 0 || hours > 23) {
    return null;
  }
  return (hours * 60) + minutes;
};
const minutesToTime = (value = 0) => {
  const normalized = Math.max(0, Math.min(1440, Number(value) || 0));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};
const normalizeTimeForStorage = (value = '') => {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return '';
  }
  const minutes = parseTimeToMinutes(cleaned);
  return minutes === null ? cleaned : minutesToTime(minutes);
};
const getIndiaNowContext = () => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const pick = (type) => parts.find((item) => item.type === type)?.value || '';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    weekday: pick('weekday'),
    minutes: (Number(pick('hour')) * 60) + Number(pick('minute'))
  };
};
const getWeekdayForDate = (dateString = '') => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanString(dateString))) {
    return '';
  }
  const noonUtc = new Date(`${dateString}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone: INDIA_TIME_ZONE, weekday: 'long' }).format(noonUtc);
};
const resolvePriceForService = (service = {}, fallbackAmount = 0) => {
  const price = cleanNumber(service?.price, 0);
  return price > 0 ? price : cleanNumber(fallbackAmount, 0);
};
const normalizeBookingPaymentOptionValue = (value = '') => {
  const option = cleanString(value);
  if (option === 'no_online_payment') {
    return 'pay_later';
  }
  if (option === 'payment_screenshot_required') {
    return 'upi_payment';
  }
  if (option === 'gateway_plus_upi') {
    return 'upi_payment';
  }
  if (option === 'gateway_payment') {
    return 'pay_later';
  }
  return ['pay_later', 'upi_payment'].includes(option) ? option : '';
};
const normalizeBookingPaymentOptions = (value = '') => {
  const source = Array.isArray(value)
    ? value
    : Array.isArray(value?.bookingPaymentOptions)
      ? value.bookingPaymentOptions
      : value?.bookingPaymentOption !== undefined
        ? value.bookingPaymentOption
        : value;
  const rawOptions = Array.isArray(source) ? source : cleanArray(source);
  const options = rawOptions
    .map((item) => normalizeBookingPaymentOptionValue(item))
    .filter(Boolean);
  return Array.from(new Set(options.length ? options : ['pay_later']));
};
const hasOnlineBookingPaymentOption = (website = {}) => {
  const options = normalizeBookingPaymentOptions(website);
  return options.some((option) => option === 'upi_payment');
};
const hasAdvanceBookingFee = (website = {}) => cleanBoolean(website.advanceBookingFeeEnabled, false)
  && cleanNumber(website.bookingFeeAmount, 0) > 0
  && hasOnlineBookingPaymentOption(website);
const resolveLeadNoticeMinutes = (website = {}) => {
  if (website.bookingMinimumAdvanceMinutes !== undefined && website.bookingMinimumAdvanceMinutes !== null && website.bookingMinimumAdvanceMinutes !== '') {
    return clampNumber(website.bookingMinimumAdvanceMinutes, 60, 0, 43200);
  }
  const value = Math.max(0, cleanNumber(website.bookingLeadNoticeHours, 0));
  return value > 24 ? value : value * 60;
};
const resolveBookingSlotDuration = (website = {}, service = null) => {
  const serviceDuration = cleanNumber(service?.bookingDurationMinutes, 0);
  return clampNumber(serviceDuration > 0 ? serviceDuration : website.bookingSlotDurationMinutes, 30, 5, 480);
};
const resolveBookingGapMinutes = (website = {}, service = null) => {
  const serviceGap = cleanNumber(service?.bookingGapMinutes, -1);
  return clampNumber(serviceGap >= 0 ? serviceGap : website.bookingGapAfterMinutes, 0, 0, 240);
};
const resolveBookingLimitType = (website = {}) => {
  const value = cleanString(website.bookingLimitType || 'per_slot');
  return ['per_slot', 'per_day', 'per_service', 'manual_no_limit'].includes(value) ? value : 'per_slot';
};
const resolveCapacityPerSlot = (website = {}, service = null) => {
  const limitType = resolveBookingLimitType(website);
  if (limitType === 'manual_no_limit' || limitType === 'per_day') {
    return 0;
  }
  const serviceCapacity = cleanNumber(service?.bookingCapacity, 0);
  return clampNumber(limitType === 'per_service' && serviceCapacity > 0 ? serviceCapacity : website.bookingCapacityPerSlot, 1, 1, 100);
};
const resolveDailyBookingLimit = (website = {}) => clampNumber(website.bookingDailyLimit, 0, 0, 1000);
const resolveMaximumAdvanceDays = (website = {}) => clampNumber(website.bookingMaximumAdvanceDays, 30, 0, 365);
const resolveBookingConfirmationType = (website = {}, service = null) => {
  const serviceType = cleanString(service?.bookingConfirmationType);
  const value = serviceType || cleanString(website.bookingConfirmationType || 'provider_approval');
  return ['auto_confirm', 'provider_approval'].includes(value) ? value : 'provider_approval';
};
const resolveBookingPaymentOption = (value = '') => {
  const options = normalizeBookingPaymentOptions(value);
  if (options.includes('pay_later')) {
    return 'pay_later';
  }
  return options.includes('upi_payment') ? 'upi_payment' : 'pay_later';
};
const resolvePaymentMethodsForBookingOptions = (paymentOptions = '') => {
  const options = normalizeBookingPaymentOptions(paymentOptions);
  return options.includes('upi_payment') ? ['manual-upi'] : [];
};
const resolvePaymentModelForBookingOptions = (paymentOptions = '') => {
  const options = normalizeBookingPaymentOptions(paymentOptions);
  const hasPayLater = options.includes('pay_later');
  const hasOnline = options.includes('upi_payment');
  if (hasPayLater && hasOnline) return 'both';
  if (hasOnline) return 'payment-only';
  return 'without-online-payment';
};
const resolveBookingStatus = (website = {}, service = null, paymentChoice = 'pay-later') => {
  const confirmationType = resolveBookingConfirmationType(website, service);
  if (confirmationType === 'provider_approval') {
    return 'pending_approval';
  }
  if (paymentChoice === 'pay-later') {
    return 'confirmed';
  }
  return 'payment_pending';
};
const parseBookingTimeRange = (booking = {}) => {
  const [startLabel = '', endLabel = ''] = cleanString(booking.bookingTime).split(' - ').map((item) => cleanString(item));
  const startTime = cleanString(booking.bookingStartTime) || startLabel;
  const start = parseTimeToMinutes(startTime);
  const storedEnd = parseTimeToMinutes(booking.bookingEndTime);
  const rangeEnd = parseTimeToMinutes(endLabel);
  const durationEnd = start !== null ? start + clampNumber(booking.bookingDurationMinutes, 30, 5, 480) : null;
  const end = storedEnd !== null ? storedEnd : rangeEnd !== null ? rangeEnd : durationEnd;
  return start !== null && end !== null && end > start ? { start, end } : null;
};
const rangesOverlap = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && leftEnd > rightStart;
const dateToUtcTime = (dateString = '') => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanString(dateString))) {
    return null;
  }
  return new Date(`${dateString}T00:00:00Z`).getTime();
};
const dateDiffDays = (left = '', right = '') => {
  const leftTime = dateToUtcTime(left);
  const rightTime = dateToUtcTime(right);
  if (leftTime === null || rightTime === null) {
    return 0;
  }
  return Math.round((leftTime - rightTime) / 86400000);
};
const minutesUntilBooking = (bookingDate = '', bookingStartMinutes = 0, nowContext = getIndiaNowContext()) => {
  return (dateDiffDays(bookingDate, nowContext.date) * 1440) + bookingStartMinutes - nowContext.minutes;
};
const addDaysToDateString = (dateString = '', days = 0) => {
  const time = dateToUtcTime(dateString);
  if (time === null) {
    return '';
  }
  return new Date(time + (days * 86400000)).toISOString().slice(0, 10);
};
const normalizeClosedDateEntries = (website = {}) => {
  const detailEntries = Array.isArray(website.bookingClosedDateDetails)
    ? website.bookingClosedDateDetails
      .map((item) => ({
        date: cleanString(item?.date),
        reason: cleanString(item?.reason)
      }))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
    : [];
  const legacyEntries = Array.isArray(website.bookingClosedDates)
    ? website.bookingClosedDates
      .map((date) => ({ date: cleanString(date), reason: '' }))
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date))
    : [];
  const merged = new Map();
  [...legacyEntries, ...detailEntries].forEach((item) => {
    const existing = merged.get(item.date) || {};
    merged.set(item.date, { date: item.date, reason: item.reason || existing.reason || '' });
  });
  return Array.from(merged.values()).sort((left, right) => left.date.localeCompare(right.date));
};
const resolveBookingPaymentDue = (website = {}, service = {}, bookingFlow = {}) => {
  const advanceAmount = cleanNumber(website.bookingFeeAmount, 0);
  if (hasAdvanceBookingFee(website)) {
    const servicePrice = resolvePriceForService(service, 0);
    return servicePrice > 0 ? Math.min(advanceAmount, servicePrice) : advanceAmount;
  }
  return resolvePriceForService(service, bookingFlow.chargeAmount || 0);
};
const isTimeInWindow = (timeMinutes, startMinutes, endMinutes) => {
  if (timeMinutes === null || startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    return false;
  }
  return startMinutes < endMinutes
    ? timeMinutes >= startMinutes && timeMinutes < endMinutes
    : timeMinutes >= startMinutes || timeMinutes < endMinutes;
};
const resolveBookingTimeCharges = (website = {}, bookingStartMinutes = null, baseAmount = 0, bookingDate = '') => {
  const rules = website.extraChargeRules || website.extraCharges || {};
  const night = rules.night || {};
  const emergency = rules.emergency || {};
  let nightAmount = 0;
  let emergencyAmount = 0;

  if (cleanBoolean(night.enabled, false) && isTimeInWindow(bookingStartMinutes, parseTimeToMinutes(night.startTime), parseTimeToMinutes(night.endTime))) {
    const amount = cleanNumber(night.amount, 0);
    const waiveAbove = cleanNumber(night.waiveOrderAbove ?? night.waiveAboveAmount, 0);
    nightAmount = waiveAbove > 0 && baseAmount >= waiveAbove ? 0 : Math.max(0, amount);
  }
  if (cleanBoolean(emergency.enabled, false) && isEmergencyBookingTime(website, bookingStartMinutes, bookingDate)) {
    const amount = cleanNumber(emergency.amount, 0);
    const waiveAbove = cleanNumber(emergency.waiveOrderAbove ?? emergency.waiveAboveAmount, 0);
    emergencyAmount = waiveAbove > 0 && baseAmount >= waiveAbove ? 0 : Math.max(0, amount);
  }

  return {
    nightAmount,
    emergencyAmount,
    total: Number((nightAmount + emergencyAmount).toFixed(2))
  };
};
const isEmergencyBookingTime = (website = {}, bookingStartMinutes = null, bookingDate = '') => {
  const indiaNow = getIndiaNowContext();
  const emergency = (website.extraChargeRules || website.extraCharges || {}).emergency || {};
  const emergencyWindowMinutes = Math.max(0, cleanNumber(emergency.windowMinutes ?? website.bookingBufferMinutes, 0));
  return emergencyWindowMinutes > 0
    && bookingStartMinutes !== null
    && minutesUntilBooking(cleanString(bookingDate), bookingStartMinutes, indiaNow) > 0
    && minutesUntilBooking(cleanString(bookingDate), bookingStartMinutes, indiaNow) <= emergencyWindowMinutes;
};
const toReceiptPayload = (transaction, providerName = '') => ({
  receiptNumber: transaction?.receipt?.receiptNumber || '',
  contextLabel: cleanString(transaction?.contextLabel),
  contextType: cleanString(transaction?.contextType),
  contextId: toObjectIdString(transaction?.contextId),
  paymentChannel: cleanString(transaction?.paymentChannel),
  paymentStatus: cleanString(transaction?.paymentStatus),
  paymentId: cleanString(transaction?.manualPayment?.payerTransactionId),
  upiId: cleanString(transaction?.manualPayment?.upiId),
  totalAmount: cleanNumber(transaction?.amountBreakdown?.totalAmount, 0),
  issuedAt: transaction?.receipt?.issuedAt,
  providerName: cleanString(providerName),
  customerName: cleanString(transaction?.customerName),
  customerPhone: cleanString(transaction?.customerPhone),
  customerEmail: cleanString(transaction?.customerEmail),
  refundStatus: cleanString(transaction?.refundStatus),
  refundAmount: cleanNumber(transaction?.refund?.amount, 0),
  refundReference: cleanString(transaction?.refund?.reference)
});
const escapeHtml = (value = '') => cleanString(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const frontendBaseUrl = () => cleanString(process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://nasdiya.com').replace(/\/+$/, '');
const buildBusinessUrl = (website = {}) => {
  const baseUrl = frontendBaseUrl();
  return website?.slug ? `${baseUrl}/business/${website.slug}` : baseUrl;
};
const bookingPublicReference = (booking = {}) => {
  const id = toObjectIdString(booking?._id || booking?.id);
  return id ? `BK-${id.slice(-8).toUpperCase()}` : '';
};
const formatInr = (value = 0) => `Rs ${cleanNumber(value, 0)}`;
const formatIndiaDateTime = (value) => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? cleanString(value) : date.toLocaleString('en-IN', { timeZone: INDIA_TIME_ZONE });
};
const paymentMethodLabel = (value = '') => {
  const labels = {
    'manual-upi': 'Manual UPI',
    gateway: 'Online gateway',
    none: 'Pay later'
  };
  return labels[cleanString(value)] || cleanString(value) || 'Payment';
};
const bookingUnitsLabel = (booking = {}) => {
  const units = Math.max(1, cleanNumber(booking?.bookingQuantity, 1));
  return `${units} unit${units === 1 ? '' : 's'}`;
};
const bookingOfferEmailHtml = (offerInfo = null, booking = {}) => {
  const code = cleanString(booking?.offerCode || offerInfo?.offerCode);
  if (!code) {
    return '<p style="margin:4px 0">Offer: <strong>No offer applied</strong></p>';
  }
  const title = cleanString(offerInfo?.title);
  const description = cleanString(offerInfo?.description);
  const discountAmount = cleanNumber(booking?.offerDiscountAmount, 0);
  return `
    <div style="margin:10px 0;padding:10px 12px;border:1px solid #dbeafe;background:#eff6ff;border-radius:8px">
      <p style="margin:0 0 4px">Offer applied: <strong>${escapeHtml(code)}</strong>${title ? ` - ${escapeHtml(title)}` : ''}</p>
      ${description ? `<p style="margin:0 0 4px;color:#475467">${escapeHtml(description)}</p>` : ''}
      ${discountAmount ? `<p style="margin:0;color:#155dfc"><strong>You received a benefit of Rs ${discountAmount} from this offer.</strong></p>` : ''}
    </div>
  `;
};
const bookingOfferPdfLine = (offerInfo = null, booking = {}) => {
  const code = cleanString(booking?.offerCode || offerInfo?.offerCode);
  if (!code) {
    return 'No offer applied';
  }
  const parts = [code];
  if (cleanString(offerInfo?.title)) {
    parts.push(cleanString(offerInfo.title));
  }
  if (cleanNumber(booking?.offerDiscountAmount, 0) > 0) {
    parts.push(`Discount ${formatInr(booking.offerDiscountAmount)}`);
  }
  return parts.join(' - ');
};
const buildBookingReceiptPdfAttachment = ({
  receipt = {},
  booking = {},
  provider = {},
  website = {},
  statusLabel = '',
  providerMessage = '',
  offerInfo = null
}) => {
  const providerName = receipt.providerName || provider?.fullName || website?.businessName || 'Provider';
  const providerPhone = normalizeIndianPhone(website?.phone || provider?.mobile || provider?.phone);
  const bookingId = bookingPublicReference(booking) || (receipt.contextId ? `BK-${receipt.contextId.slice(-8).toUpperCase()}` : '');
  const bookingWhen = [booking?.bookingDate, booking?.bookingTime].filter(Boolean).join(', ');
  const rows = [
    { label: 'Receipt No.', value: receipt.receiptNumber },
    { label: 'Booking status', value: statusLabel || 'updated' },
    { label: 'Booking ID', value: bookingId },
    { label: 'Item / Service', value: booking?.serviceTitle || receipt.contextLabel || 'Website booking' },
    { label: 'Date & time', value: bookingWhen || '-' },
    { label: 'Units', value: bookingUnitsLabel(booking) },
    { label: 'Customer', value: [booking?.customerName || receipt.customerName || '-', booking?.customerPhone || receipt.customerPhone, receipt.customerEmail].filter(Boolean).join(' | ') },
    { label: 'Offer', value: bookingOfferPdfLine(offerInfo, booking) },
    { label: 'Total paid', value: formatInr(receipt.totalAmount) },
    { label: 'Payment method', value: paymentMethodLabel(receipt.paymentChannel) },
    { label: 'Payment ID', value: receipt.paymentId || '-' },
    { label: 'Provider UPI ID', value: receipt.upiId || '-' },
    { label: 'Issued at', value: formatIndiaDateTime(receipt.issuedAt) || '-' },
    { label: 'Provider', value: [website?.businessName || providerName, providerPhone ? `Mobile: ${providerPhone}` : ''].filter(Boolean).join(' | ') },
    { label: 'Book again', value: buildBusinessUrl(website) },
    { label: 'Nasdiya', value: frontendBaseUrl() }
  ];
  if (receipt.refundStatus && receipt.refundStatus !== 'none') {
    rows.push({ label: 'Refund status', value: `${receipt.refundStatus}${receipt.refundAmount ? ` (${formatInr(receipt.refundAmount)})` : ''}${receipt.refundReference ? ` - ${receipt.refundReference}` : ''}` });
  }
  if (providerMessage) {
    rows.push({ label: 'Message from provider', value: providerMessage });
  }

  return receiptPdfService.buildAttachment({
    filename: `booking-receipt-${receipt.receiptNumber || bookingId}`,
    title: 'Nasdiya payment receipt',
    subtitle: `Booking ${statusLabel || 'updated'} - ${website?.businessName || providerName}`,
    rows
  });
};
const buildBookingReceiptEmailHtml = ({
  receipt = {},
  booking = {},
  provider = {},
  website = {},
  statusLabel = '',
  providerMessage = '',
  offerInfo = null
}) => {
  const providerName = receipt.providerName || provider?.fullName || website?.businessName || 'Provider';
  const providerPhone = normalizeIndianPhone(website?.phone || provider?.mobile || provider?.phone);
  const businessUrl = buildBusinessUrl(website);
  const providerSignupUrl = `${frontendBaseUrl()}/provider/register`;
  const bookingId = bookingPublicReference(booking) || (receipt.contextId ? `BK-${receipt.contextId.slice(-8).toUpperCase()}` : '');
  const bookingWhen = [booking?.bookingDate, booking?.bookingTime].filter(Boolean).join(', ');
  const refundLine = receipt.refundStatus && receipt.refundStatus !== 'none'
    ? `<tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Refund status</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.refundStatus)}</strong>${receipt.refundAmount ? ` (${formatInr(receipt.refundAmount)})` : ''}${receipt.refundReference ? `<br><span>Reference: ${escapeHtml(receipt.refundReference)}</span>` : ''}</td></tr>`
    : '';
  const completionBlock = cleanString(statusLabel) === 'completed'
    ? `<p style="margin:0 0 16px;padding:14px 16px;border-left:4px solid #16a34a;background:#f0fdf4;color:#14532d;line-height:1.6">Thank you for contacting us. I hope you liked our services. Please rate and review, and visit again.<br><a href="${escapeHtml(`${businessUrl}#reviews`)}" style="color:#155dfc;text-decoration:none;font-weight:700">Rate and review ${escapeHtml(website?.businessName || providerName)}</a><br><a href="${escapeHtml(providerSignupUrl)}" style="color:#155dfc;text-decoration:none;font-weight:700">Become a provider on Nasdiya</a></p>`
    : '';

  return `
    <div style="margin:0;background:#f3f6fb;padding:24px;font-family:Arial,sans-serif;color:#111827">
      <style>
        @media print {
          body { background: #fff !important; }
          .receipt-page { box-shadow: none !important; border: 1px solid #d0d5dd !important; }
          .no-print { display: none !important; }
        }
      </style>
      <div class="receipt-page" style="max-width:760px;margin:0 auto;background:#fff;border:1px solid #d9e2ee;border-radius:14px;box-shadow:0 18px 45px rgba(15,23,42,.08);overflow:hidden">
        <div style="padding:24px 28px;border-bottom:1px solid #e4ebf5;display:flex;justify-content:space-between;gap:18px;align-items:flex-start">
          <div>
            <p style="margin:0 0 6px;color:#155dfc;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:12px">Nasdiya payment receipt</p>
            <h1 style="margin:0;color:#101828;font-size:26px;line-height:1.2">Booking ${escapeHtml(statusLabel || 'updated')}</h1>
            <p style="margin:8px 0 0;color:#667085;font-size:14px">Keep this email as a printable receipt for your booking and payment.</p>
          </div>
          <div style="text-align:right;color:#101828">
            <p style="margin:0;color:#667085;font-size:12px">Receipt No.</p>
            <strong style="font-size:15px">${escapeHtml(receipt.receiptNumber)}</strong>
          </div>
        </div>

        <div style="padding:22px 28px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hello ${escapeHtml(booking?.customerName || receipt.customerName || 'there')}, your booking with <strong>${escapeHtml(website?.businessName || providerName)}</strong> is <strong>${escapeHtml(statusLabel || 'updated')}</strong>.</p>

          <table style="width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e4ebf5;border-radius:10px;overflow:hidden">
            <tbody>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085;width:38%">Booking ID</td><td style="padding:12px 14px"><strong>${escapeHtml(bookingId)}</strong></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Item / Service</td><td style="padding:12px 14px"><strong>${escapeHtml(booking?.serviceTitle || receipt.contextLabel || 'Website booking')}</strong></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Date & time</td><td style="padding:12px 14px"><strong>${escapeHtml(bookingWhen || '-')}</strong></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Units</td><td style="padding:12px 14px"><strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Customer</td><td style="padding:12px 14px"><strong>${escapeHtml(booking?.customerName || receipt.customerName || '-')}</strong><br><span>${escapeHtml(booking?.customerPhone || receipt.customerPhone || '')}</span></td></tr>
            </tbody>
          </table>
          ${bookingOfferEmailHtml(offerInfo, booking)}

          <table style="width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e4ebf5;border-radius:10px;overflow:hidden">
            <tbody>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085;width:38%">Total paid</td><td style="padding:12px 14px"><strong style="font-size:18px">${formatInr(receipt.totalAmount)}</strong></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Payment method</td><td style="padding:12px 14px"><strong>${escapeHtml(paymentMethodLabel(receipt.paymentChannel))}</strong></td></tr>
              ${receipt.paymentId ? `<tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Payment ID</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.paymentId)}</strong></td></tr>` : ''}
              ${receipt.upiId ? `<tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Provider UPI ID</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.upiId)}</strong></td></tr>` : ''}
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Issued at</td><td style="padding:12px 14px"><strong>${escapeHtml(formatIndiaDateTime(receipt.issuedAt))}</strong></td></tr>
              ${refundLine}
            </tbody>
          </table>

          <table style="width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e4ebf5;border-radius:10px;overflow:hidden">
            <tbody>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085;width:38%">Provider</td><td style="padding:12px 14px"><strong>${escapeHtml(website?.businessName || providerName)}</strong>${providerPhone ? `<br><span>Mobile: ${escapeHtml(providerPhone)}</span>` : ''}</td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Book again</td><td style="padding:12px 14px"><a href="${escapeHtml(businessUrl)}" style="color:#155dfc;text-decoration:none;font-weight:700">${escapeHtml(businessUrl)}</a></td></tr>
              <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Nasdiya</td><td style="padding:12px 14px">Find trusted providers or create your own provider website at <a href="${escapeHtml(frontendBaseUrl())}" style="color:#155dfc;text-decoration:none;font-weight:700">Nasdiya</a>.</td></tr>
            </tbody>
          </table>

          ${providerMessage ? `<p style="margin:0 0 16px;padding:12px 14px;border-left:4px solid #155dfc;background:#f5f9ff;color:#344054"><strong>Message from provider:</strong><br>${escapeHtml(providerMessage)}</p>` : ''}
          ${completionBlock}
          <p class="no-print" style="margin:0;color:#667085;font-size:12px;line-height:1.5">To print this receipt, open this email and use your browser or mail app print option.</p>
        </div>
      </div>
    </div>
  `;
};
const normalizeBookingFlowForWebsite = (website = {}) => {
  const paymentOptions = normalizeBookingPaymentOptions(website);
  const paymentModel = resolvePaymentModelForBookingOptions(paymentOptions);
  const optionMethods = resolvePaymentMethodsForBookingOptions(paymentOptions);
  const flow = websitePaymentService.normalizeFlowConfig(website.bookingFlow || {}, {
    enabled: true,
    paymentModel,
    paymentMethods: optionMethods,
    gatewayFeeBearer: 'customer',
    chargeAmount: website.bookingFeeAmount || 0,
    paymentInstructions: website.paymentInstructions || ''
  });
  if (hasAdvanceBookingFee(website)) {
    return {
      ...flow,
      paymentModel,
      paymentMethods: optionMethods,
      manualPaymentEnabled: optionMethods.includes('manual-upi'),
      gatewayPaymentEnabled: false,
      chargeAmount: cleanNumber(website.bookingFeeAmount, 0)
    };
  }
  return {
    ...flow,
    paymentModel,
    paymentMethods: optionMethods,
    manualPaymentEnabled: optionMethods.includes('manual-upi'),
    gatewayPaymentEnabled: false
  };
};

class ProviderWebsiteService {
  async getManager(userId) {
    const website = await this.getOrCreateWebsite(userId);
    return this.buildManagerResponse(userId, website);
  }

  async saveManager(userId, rawPayload = {}, files = {}) {
    const payload = this.parsePayload(rawPayload);
    const [state, website] = await Promise.all([
      providerGrowthService.getOrCreateState(userId),
      this.getOrCreateWebsite(userId)
    ]);
    const requestedSlug = slugify(payload.slug);
    const currentSlug = cleanString(website.slug || state.websiteSlug);
    let finalSlug = currentSlug;
    if (requestedSlug && requestedSlug !== currentSlug) {
      await this.ensureSlugAvailable(requestedSlug, userId, website._id);
      finalSlug = requestedSlug;
    } else {
      finalSlug = await this.getOrCreateSlug(
        userId,
        website,
        state,
        payload.slug || website.slug || payload.businessName || website.businessName
      );
    }

    if (payload.phone && !isValidIndianPhone(payload.phone)) {
      throw new Error('Enter a valid 10-digit business phone number');
    }
    if (payload.whatsappNumber && !isValidIndianPhone(payload.whatsappNumber)) {
      throw new Error('Enter a valid 10-digit WhatsApp number');
    }
    if (payload.upiId && !isValidUpi(payload.upiId)) {
      throw new Error('Enter a valid UPI ID');
    }

    const purchased = providerGrowthService.hasActiveWebsite(state);

    const hasUploadedHeroImage = Array.isArray(files.heroImage) && files.heroImage[0]?.path;
    const hasUploadedAboutImage = Array.isArray(files.aboutImage) && files.aboutImage[0]?.path;
    const hasUploadedLogo = Array.isArray(files.logoImage) && files.logoImage[0]?.path;
    const heroImage = hasUploadedHeroImage ? files.heroImage[0].path : cleanString(payload.heroImage) || website.heroImage;
    const aboutImage = hasUploadedAboutImage
      ? files.aboutImage[0].path
      : cleanString(payload.aboutImage) || website.aboutImage;
    const logo = hasUploadedLogo ? files.logoImage[0].path : website.logo;
    const uploadedUpiQrCodeImage = Array.isArray(files.upiQrCodeImage) && files.upiQrCodeImage[0]?.path ? files.upiQrCodeImage[0].path : '';
    const uploadedGallery = Array.isArray(files.galleryImages) ? files.galleryImages.map((item) => item.path).filter(Boolean) : [];
    const uploadedVideos = Array.isArray(files.galleryVideos) ? files.galleryVideos.map((item) => item.path).filter(Boolean) : [];
    const selectedTemplateMedia = { ...(payload.selectedTemplateMedia || {}) };
    if (hasUploadedHeroImage) {
      delete selectedTemplateMedia.heroImage;
      delete selectedTemplateMedia.cover;
      delete selectedTemplateMedia.header;
    }
    if (hasUploadedAboutImage) {
      delete selectedTemplateMedia.aboutImage;
      delete selectedTemplateMedia.about;
    }
    if (hasUploadedLogo) {
      delete selectedTemplateMedia.logo;
    }

    const businessHours = this.normalizeBusinessHours(payload.businessHours || website.businessHours);
    const bookingSlots = this.normalizeBookingSlots(payload.bookingSlots || website.bookingSlots);
    const faqs = this.normalizeFaqs(payload.faqs || website.faqs);
    const testimonials = this.normalizeTestimonials(payload.testimonials || website.testimonials);

    const requestedStatus = ['draft', 'published', 'unpublished'].includes(payload.status) ? payload.status : website.status;
    if (requestedStatus === 'published' && !purchased) {
      throw new Error('Purchase the website feature before publishing your business page');
    }

    website.isPurchased = purchased;
    website.status = requestedStatus;
    website.slug = finalSlug || website.slug;
    website.businessName = cleanString(payload.businessName) || website.businessName;
    website.tagline = cleanString(payload.tagline);
    website.category = cleanString(payload.category);
    website.subcategories = cleanArray(payload.subcategories);
    website.tags = cleanArray(payload.tags);
    website.about = cleanString(payload.about);
    website.yearsOfExperience = cleanNumber(payload.yearsOfExperience, website.yearsOfExperience);
    website.languages = cleanArray(payload.languages);
    website.phone = normalizeIndianPhone(payload.phone);
    website.whatsappNumber = normalizeIndianPhone(payload.whatsappNumber);
    website.email = cleanString(payload.email);
    website.address = cleanString(payload.address);
    website.city = cleanString(payload.city);
    website.state = cleanString(payload.state);
    website.pincode = cleanString(payload.pincode);
    website.serviceAreas = cleanArray(payload.serviceAreas);
    website.geo = {
      lat: payload.geo?.lat ?? website.geo?.lat ?? null,
      lng: payload.geo?.lng ?? website.geo?.lng ?? null
    };
    website.businessHours = businessHours;
    const mediaWithTemplates = await websiteTemplateMediaService.applyTemplates(
      website,
      { ...payload, selectedTemplateMedia },
      {
        heroImage,
        aboutImage,
        logo,
        gallery: [...normalizeGallery(payload.gallery), ...uploadedGallery].slice(0, 20),
        videos: [...normalizeVideos(payload.videos), ...uploadedVideos].slice(0, 8)
      }
    );
    website.heroImage = mediaWithTemplates.heroImage || '';
    website.aboutImage = mediaWithTemplates.aboutImage || '';
    website.logo = mediaWithTemplates.logo || '';
    website.gallery = mediaWithTemplates.gallery;
    website.videos = mediaWithTemplates.videos;
    website.servicesEnabled = cleanBoolean(payload.servicesEnabled, true);
    website.productsEnabled = cleanBoolean(payload.productsEnabled, false);
    website.bookingEnabled = cleanBoolean(payload.bookingEnabled, false);
    website.paymentsEnabled = cleanBoolean(payload.paymentsEnabled, false);
    website.offersEnabled = cleanBoolean(payload.offersEnabled, false);
    website.articlesEnabled = cleanBoolean(payload.articlesEnabled, false);
    website.reviewsEnabled = cleanBoolean(payload.reviewsEnabled, true);
    website.inquiryFormEnabled = cleanBoolean(payload.inquiryFormEnabled, true);
    website.callbackEnabled = cleanBoolean(payload.callbackEnabled, true);
    website.callEnabled = cleanBoolean(payload.callEnabled, true);
    website.whatsappEnabled = cleanBoolean(payload.whatsappEnabled, true);
    website.showPricing = cleanBoolean(payload.showPricing, true);
    website.showMap = cleanBoolean(payload.showMap, true);
    website.showVerification = cleanBoolean(payload.showVerification, true);
    website.emergencyAvailability = cleanBoolean(payload.emergencyAvailability, false);
    website.requestCallbackMessage = cleanString(payload.requestCallbackMessage);
    website.bookingIntro = cleanString(payload.bookingIntro);
    website.bookingConfirmationType = payload.bookingConfirmationType !== undefined
      ? resolveBookingConfirmationType(payload, null)
      : resolveBookingConfirmationType(website, null);
    const bookingPaymentOptions = normalizeBookingPaymentOptions(
      payload.bookingPaymentOptions !== undefined
        ? payload.bookingPaymentOptions
        : payload.bookingPaymentOption !== undefined
          ? payload.bookingPaymentOption
          : website
    );
    if (
      cleanBoolean(payload.bookingEnabled, false)
      && bookingPaymentOptions.includes('upi_payment')
      && !cleanString(payload.upiId)
    ) {
      throw new Error('Enter your UPI ID when bookings can collect advance UPI payment.');
    }
    website.bookingPaymentOptions = bookingPaymentOptions;
    website.bookingPaymentOption = resolveBookingPaymentOption(bookingPaymentOptions);
    website.bookingWorkingDays = cleanArray(payload.bookingWorkingDays);
    website.bookingSlots = bookingSlots;
    website.bookingSlotDurationMinutes = clampNumber(payload.bookingSlotDurationMinutes, website.bookingSlotDurationMinutes || 30, 5, 480);
    website.bookingGapAfterMinutes = clampNumber(payload.bookingGapAfterMinutes, website.bookingGapAfterMinutes || 0, 0, 240);
    website.bookingMinimumAdvanceMinutes = clampNumber(payload.bookingMinimumAdvanceMinutes ?? payload.bookingLeadNoticeMinutes, resolveLeadNoticeMinutes(website), 0, 43200);
    website.bookingMaximumAdvanceDays = clampNumber(payload.bookingMaximumAdvanceDays, website.bookingMaximumAdvanceDays ?? 30, 0, 365);
    website.bookingLimitType = resolveBookingLimitType(payload);
    website.bookingCapacityPerSlot = clampNumber(payload.bookingCapacityPerSlot, website.bookingCapacityPerSlot || 1, 1, 100);
    website.bookingMultipleUnitsEnabled = cleanBoolean(payload.bookingMultipleUnitsEnabled, false);
    website.bookingMaxUnitsPerCustomer = website.bookingMultipleUnitsEnabled
      ? clampNumber(payload.bookingMaxUnitsPerCustomer, website.bookingCapacityPerSlot, 1, website.bookingCapacityPerSlot)
      : 1;
    website.bookingDailyLimit = clampNumber(payload.bookingDailyLimit, website.bookingDailyLimit || 0, 0, 1000);
    website.bookingBufferMinutes = cleanNumber(payload.bookingBufferMinutes, 0);
    website.bookingLeadNoticeHours = cleanNumber(payload.bookingLeadNoticeHours, 0);
    website.bookingClosedDates = this.normalizeBookingClosedDates(payload.bookingClosedDates || website.bookingClosedDates);
    website.bookingClosedDateDetails = this.normalizeBookingClosedDateDetails(payload.bookingClosedDateDetails || website.bookingClosedDateDetails || website.bookingClosedDates);
    website.upiId = cleanString(payload.upiId);
    website.bookingFeeAmount = cleanNumber(payload.bookingFeeAmount, 0);
    website.advanceBookingFeeEnabled = cleanBoolean(payload.advanceBookingFeeEnabled, false);
    website.paymentInstructions = cleanString(payload.paymentInstructions);
    website.extraChargeRules = this.normalizeExtraChargeRules(payload.extraChargeRules || website.extraChargeRules || {});
    const paymentSettings = websitePaymentService.normalizeWebsitePaymentSettings(payload, website);
    const bookingPaymentMethods = resolvePaymentMethodsForBookingOptions(bookingPaymentOptions);
    const bookingPaymentModel = resolvePaymentModelForBookingOptions(bookingPaymentOptions);
    website.bookingFlow = {
      ...paymentSettings.bookingFlow,
      paymentModel: bookingPaymentModel,
      paymentMethods: bookingPaymentMethods,
      manualPaymentEnabled: bookingPaymentMethods.includes('manual-upi'),
      gatewayPaymentEnabled: false,
      chargeAmount: paymentSettings.bookingFlow.chargeAmount || website.bookingFeeAmount || 0,
      paymentInstructions: paymentSettings.bookingFlow.paymentInstructions || website.paymentInstructions || ''
    };
    if (hasAdvanceBookingFee(website)) {
      website.bookingFlow = {
        ...website.bookingFlow,
        paymentModel: bookingPaymentModel,
        paymentMethods: bookingPaymentMethods,
        manualPaymentEnabled: bookingPaymentMethods.includes('manual-upi'),
        gatewayPaymentEnabled: false,
        chargeAmount: website.bookingFeeAmount
      };
    } else if (bookingPaymentModel === 'without-online-payment') {
      website.bookingFlow = {
        ...website.bookingFlow,
        paymentModel: 'without-online-payment',
        paymentMethods: [],
        manualPaymentEnabled: false,
        gatewayPaymentEnabled: false
      };
    }
    website.productFlow = {
      ...paymentSettings.productFlow,
      enabled: cleanBoolean(paymentSettings.productFlow.enabled, website.productsEnabled),
      paymentInstructions: paymentSettings.productFlow.paymentInstructions || website.paymentInstructions || ''
    };
    if (!website.upiId) {
      website.upiQrCodeImage = '';
      website.upiQrCodeSource = 'auto';
    } else if (uploadedUpiQrCodeImage) {
      website.upiQrCodeImage = uploadedUpiQrCodeImage;
      website.upiQrCodeSource = 'custom';
    } else if (website.upiQrCodeSource !== 'custom') {
      website.upiQrCodeImage = await this.buildWebsiteUpiQrCode(website);
      website.upiQrCodeSource = website.upiQrCodeImage ? 'auto' : 'auto';
    }
    website.faqs = faqs;
    website.testimonials = testimonials;
    website.featuredServiceTitle = cleanString(payload.featuredServiceTitle);
    website.shareMessage = cleanString(payload.shareMessage);
    website.completionScore = 0;

    const services = this.normalizeServices(payload.services);
    const products = this.normalizeProducts(payload.products);
    const offers = this.normalizeOffers(payload.offers);
    const articles = this.normalizeArticles(payload.articles);

    const reviewSummary = await this.getReviewSummary(userId);
    const completion = this.computeCompletion({ website, services });
    website.completionScore = completion.score;
    if (website.status === 'published') {
      website.publishedAt = website.publishedAt || new Date();
    }

    state.websiteSlug = website.slug;
    await Promise.all([website.save(), state.save()]);
    await this.upsertThemeConfig(userId, website._id, payload.themeConfig || {});
    await this.upsertSeoConfig(userId, website._id, payload.seoConfig || {}, website.slug);
    await this.replaceCollection(ProviderServiceModel, website, userId, services);
    await this.replaceCollection(ProviderProduct, website, userId, products);
    await this.replaceCollection(ProviderOffer, website, userId, offers);
    await this.replaceArticles(website, userId, articles);

    logger.info(`Business website manager saved for provider ${userId}`);
    return this.buildManagerResponse(userId, website, { completion, reviewSummary });
  }

  async updatePublishStatus(userId, payload = {}) {
    const [state, website] = await Promise.all([
      providerGrowthService.getOrCreateState(userId),
      this.getOrCreateWebsite(userId)
    ]);
    const nextStatus = cleanBoolean(payload.published, false) ? 'published' : 'unpublished';

    if (nextStatus === 'published' && !providerGrowthService.hasActiveWebsite(state)) {
      throw new Error('Purchase the website feature before publishing your business page');
    }

    await this.getOrCreateSlug(userId, website, state, website.slug || website.businessName);

    if (nextStatus === 'published') {
      const services = await ProviderServiceModel.find({ providerId: userId }).lean();
      this.ensurePublishReady(website, services);
    }

    website.isPurchased = providerGrowthService.hasActiveWebsite(state);
    website.status = nextStatus;
    website.publishedAt = nextStatus === 'published' ? new Date() : website.publishedAt;
    await website.save();
    return this.buildManagerResponse(userId, website);
  }

  async getPublicWebsiteBySlug(slug, viewerId = null) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) {
      return null;
    }

    const [website, state] = await Promise.all([
      ProviderWebsite.findOne({ slug: cleanSlug }).lean(),
      ProviderGrowth.findOne({ websiteSlug: cleanSlug })
    ]);

    if (!website || !state) {
      return null;
    }

    const normalizedState = await providerGrowthService.normalizeState(state);
    if (website.status !== 'published' || !providerGrowthService.hasActiveWebsite(normalizedState)) {
      return null;
    }

    const data = await this.buildPublicResponse(website.providerId.toString(), website);
    if (!data) {
      return null;
    }

    await ProfessionalProfile.findOneAndUpdate({ user: website.providerId }, { $inc: { viewCount: 1 } });
    return data;
  }

  async getPreviewWebsiteBySlug(slug, userId) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) {
      return null;
    }

    const website = await ProviderWebsite.findOne({ slug: cleanSlug }).lean();
    if (!website || toObjectIdString(website.providerId) !== toObjectIdString(userId)) {
      return null;
    }

    return this.buildPreviewResponse(userId, website);
  }

  async createInquiry(slug, payload = {}, actorUserId = null) {
    const publicWebsite = await this.getPublicWebsiteBySlug(slug);
    if (!publicWebsite) {
      throw new Error('Business page not found');
    }

    const source = ['website', 'callback', 'inquiry', 'whatsapp-click', 'call-click', 'share'].includes(cleanString(payload.source))
      ? cleanString(payload.source)
      : 'website';

    if (!['whatsapp-click', 'call-click', 'share'].includes(source)) {
      if (!cleanString(payload.name)) {
        throw new Error('Name is required');
      }
      if (!isValidIndianPhone(payload.phone)) {
        throw new Error('Enter a valid 10-digit mobile number');
      }
    }

    const normalizedPhone = normalizeIndianPhone(payload.phone);
    const website = await ProviderWebsite.findOne({ slug: slugify(slug) });
    const lead = await ProviderLead.create({
      providerId: website.providerId,
      websiteId: website._id,
      customerUserId: actorUserId || null,
      source,
      name: cleanString(payload.name),
      phone: normalizedPhone,
      email: cleanString(payload.email),
      message: cleanString(payload.message),
      interestedService: cleanString(payload.interestedService),
      status: 'new',
      notes: ''
    });

    const notificationBySource = {
      callback: {
        type: 'callback',
        title: 'New callback request',
        body: `${cleanString(payload.name) || 'A visitor'} requested a callback for ${publicWebsite.website?.businessName || 'your business page'}.`
      },
      inquiry: {
        type: 'inquiry',
        title: 'New inquiry received',
        body: `${cleanString(payload.name) || 'A visitor'} sent an inquiry for ${publicWebsite.website?.businessName || 'your business page'}.`
      },
      website: {
        type: 'inquiry',
        title: 'New website inquiry',
        body: `${cleanString(payload.name) || 'A visitor'} contacted you from ${publicWebsite.website?.businessName || 'your business page'}.`
      },
      'call-click': {
        type: 'system',
        title: 'Someone tapped call',
        body: `A visitor tapped the call button on ${publicWebsite.website?.businessName || 'your business page'}.`
      },
      'whatsapp-click': {
        type: 'system',
        title: 'Someone tapped WhatsApp',
        body: `A visitor tapped the WhatsApp button on ${publicWebsite.website?.businessName || 'your business page'}.`
      },
      share: {
        type: 'system',
        title: 'Your page was shared',
        body: `A visitor shared ${publicWebsite.website?.businessName || 'your business page'}.`
      }
    };
    const notificationCopy = notificationBySource[source] || notificationBySource.website;
    await notificationService.createNotification({
      userId: website.providerId,
      type: notificationCopy.type,
      title: notificationCopy.title,
      body: notificationCopy.body,
      linkPath: source === 'callback'
        ? '/provider/customer-requests?tab=callbacks'
        : '/provider/customer-requests?tab=inquiries',
      metadata: {
        leadId: lead._id.toString(),
        slug: website.slug,
        source
      }
    });

    if (actorUserId && ['website', 'inquiry', 'callback'].includes(source)) {
      const sourceLabel = source === 'callback' ? 'callback request' : source === 'inquiry' ? 'inquiry' : 'website inquiry';
      await notificationService.createNotification({
        userId: actorUserId,
        type: source === 'callback' ? 'callback' : 'inquiry',
        title: source === 'callback' ? 'Callback request sent' : 'Inquiry sent',
        body: `Your ${sourceLabel} was sent to ${publicWebsite.website?.businessName || 'this provider'}.`,
        linkPath: source === 'callback' ? '/my-requests?tab=callbacks' : '/my-requests?tab=inquiries',
        metadata: {
          leadId: lead._id.toString(),
          providerId: website.providerId.toString(),
          slug: website.slug,
          source
        }
      });
    }

    return {
      id: lead._id.toString(),
      source: lead.source,
      status: lead.status,
      createdAt: lead.createdAt
    };
  }

  async getBookingSlots(slug, dateString = '', options = {}) {
    const cleanSlug = slugify(slug);
    if (!cleanSlug) {
      throw new Error('Booking is not available for this business page');
    }

    const [website, state] = await Promise.all([
      ProviderWebsite.findOne({ slug: cleanSlug }).lean(),
      ProviderGrowth.findOne({ websiteSlug: cleanSlug })
    ]);
    const normalizedState = state ? await providerGrowthService.normalizeState(state) : null;
    if (!website || website.status !== 'published' || !providerGrowthService.hasActiveWebsite(normalizedState) || !website.bookingEnabled) {
      throw new Error('Booking is not available for this business page');
    }

    const bookingDate = cleanString(dateString);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      throw new Error('Choose a valid booking date');
    }

    const selectedService = cleanString(options.serviceId)
      ? await ProviderServiceModel.findOne({ _id: options.serviceId, providerId: website.providerId, isActive: true }).lean()
      : null;
    if (cleanString(options.serviceId) && !selectedService) {
      throw new Error('Selected service is not available for booking');
    }
    if (selectedService && selectedService.availableForBooking === false) {
      throw new Error('Selected service is not available for booking');
    }

    const indiaNow = getIndiaNowContext();
    const bookingWeekday = getWeekdayForDate(bookingDate);
    const workingDays = Array.isArray(website.bookingWorkingDays) ? website.bookingWorkingDays : [];
    const closedEntries = normalizeClosedDateEntries(website);
    const closedDate = closedEntries.find((item) => item.date === bookingDate);
    const businessHour = Array.isArray(website.businessHours)
      ? website.businessHours.find((item) => normalizeDayLabel(item?.day) === normalizeDayLabel(bookingWeekday))
      : null;
    const openMinutes = parseTimeToMinutes(businessHour?.openTime);
    const closeMinutes = parseTimeToMinutes(businessHour?.closeTime);
    const breakStart = parseTimeToMinutes(businessHour?.breakStartTime);
    const breakEnd = parseTimeToMinutes(businessHour?.breakEndTime);
    const leadNoticeMinutes = resolveLeadNoticeMinutes(website);
    const slotDurationMinutes = resolveBookingSlotDuration(website, selectedService);
    const gapAfterBookingMinutes = resolveBookingGapMinutes(website, selectedService);
    const maxAdvanceDays = resolveMaximumAdvanceDays(website);
    const maxBookableDate = addDaysToDateString(indiaNow.date, maxAdvanceDays);
    const capacityPerSlot = resolveCapacityPerSlot(website, selectedService);
    const dailyBookingLimit = resolveDailyBookingLimit(website);
    const minBookableMinutes = bookingDate === indiaNow.date ? indiaNow.minutes + leadNoticeMinutes : -1;
    const isWorkingDay = workingDays.length === 0 || workingDays.some((day) => normalizeDayLabel(day) === normalizeDayLabel(bookingWeekday));
    const dayClosedReason = bookingDate < indiaNow.date
      ? 'past date'
      : maxBookableDate && bookingDate > maxBookableDate
        ? 'outside advance booking period'
        : closedDate
        ? closedDate.reason || 'closed date'
        : !isWorkingDay
          ? 'booking off-day'
          : !businessHour || businessHour.isOpen === false
            ? 'business closed'
            : openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes
              ? 'working hours unavailable'
              : '';

    const existingBookings = await ProviderBooking.find({
      websiteId: website._id,
      bookingDate,
      status: { $nin: ['cancelled', 'rejected'] }
    }).select('bookingTime bookingStartTime bookingEndTime bookingDurationMinutes bookingGapMinutes bookingQuantity serviceId status').lean();
    const dailyLimitReached = dailyBookingLimit > 0 && existingBookings.length >= dailyBookingLimit;
    const rules = website.extraChargeRules || website.extraCharges || {};
    const night = rules.night || {};
    const nightStart = parseTimeToMinutes(night.startTime);
    const nightEnd = parseTimeToMinutes(night.endTime);
    const slots = [];

    for (let start = 0; start < 1440; start += slotDurationMinutes) {
      const end = start + slotDurationMinutes;
      const value = `${minutesToTime(start)} - ${minutesToTime(end)}`;
      const overlapsBreak = breakStart !== null && breakEnd !== null && breakEnd > breakStart && start < breakEnd && end > breakStart;
      const outsideWorkingHours = !dayClosedReason && (start < openMinutes || end > closeMinutes);
      const alreadyPassed = !dayClosedReason && bookingDate === indiaNow.date && start <= indiaNow.minutes;
      const underLeadNotice = !dayClosedReason && minutesUntilBooking(bookingDate, start, indiaNow) <= leadNoticeMinutes;
      const overlappingBookings = existingBookings.filter((booking) => {
        const range = parseBookingTimeRange(booking);
        if (!range) {
          return false;
        }
        const existingGap = clampNumber(booking.bookingGapMinutes, gapAfterBookingMinutes, 0, 240);
        return rangesOverlap(start, end + gapAfterBookingMinutes, range.start, range.end + existingGap);
      });
      const serviceOverlappingBookings = selectedService
        ? overlappingBookings.filter((booking) => toObjectIdString(booking.serviceId) === toObjectIdString(selectedService._id))
        : [];
      const serviceCapacity = selectedService && cleanNumber(selectedService.bookingCapacity, 0) > 0
        ? clampNumber(selectedService.bookingCapacity, 1, 1, 100)
        : 0;
      const usedSlotUnits = overlappingBookings.reduce((total, booking) => total + Math.max(1, cleanNumber(booking.bookingQuantity, 1)), 0);
      const usedServiceUnits = serviceOverlappingBookings.reduce((total, booking) => total + Math.max(1, cleanNumber(booking.bookingQuantity, 1)), 0);
      const slotFull = capacityPerSlot > 0 && usedSlotUnits >= capacityPerSlot;
      const serviceFull = serviceCapacity > 0 && usedServiceUnits >= serviceCapacity;
      const reason = dayClosedReason
        || (outsideWorkingHours ? 'outside working hours' : '')
        || (overlapsBreak ? 'break time' : '')
        || (alreadyPassed ? 'time passed' : '')
        || (underLeadNotice ? 'too soon' : '')
        || (dailyLimitReached ? 'daily booking limit reached' : '')
        || (serviceFull ? 'service full' : '')
        || (slotFull ? 'full' : '');
      const totalCapacity = serviceCapacity || capacityPerSlot;
      const usedCapacity = serviceCapacity ? usedServiceUnits : usedSlotUnits;
      const spotsLeft = totalCapacity > 0 ? Math.max(0, totalCapacity - usedCapacity) : null;
      slots.push({
        label: minutesToTime(start),
        startTime: minutesToTime(start),
        endTime: minutesToTime(end),
        value,
        durationMinutes: slotDurationMinutes,
        gapAfterBookingMinutes,
        spotsLeft,
        disabled: !!reason,
        reason,
        isEmergency: !reason && isEmergencyBookingTime(website, start, bookingDate),
        isNight: !reason && cleanBoolean(night.enabled, false) && isTimeInWindow(start, nightStart, nightEnd)
      });
    }

    return {
      date: bookingDate,
      weekday: bookingWeekday,
      workingHours: businessHour ? {
        openTime: businessHour.openTime || '',
        closeTime: businessHour.closeTime || '',
        breakStartTime: businessHour.breakStartTime || '',
        breakEndTime: businessHour.breakEndTime || ''
      } : null,
      minBookableTime: minBookableMinutes >= 0 ? minutesToTime(Math.min(1440, minBookableMinutes)) : '',
      maxBookableDate,
      slotDurationMinutes,
      gapAfterBookingMinutes,
      minimumAdvanceBookingMinutes: leadNoticeMinutes,
      maximumAdvanceBookingDays: maxAdvanceDays,
      capacityPerSlot,
      dailyBookingLimit,
      existingBookingsCount: existingBookings.length,
      service: selectedService ? {
        id: selectedService._id.toString(),
        title: selectedService.title,
        price: selectedService.price,
        durationMinutes: slotDurationMinutes,
        capacity: cleanNumber(selectedService.bookingCapacity, 0) || capacityPerSlot
      } : null,
      emergencyWindowMinutes: Math.max(0, cleanNumber((rules.emergency || {}).windowMinutes ?? website.bookingBufferMinutes, 0)),
      slots
    };
  }

  async createBooking(slug, payload = {}, actorUserId = null) {
    const publicWebsite = await this.getPublicWebsiteBySlug(slug);
    if (!publicWebsite) {
      throw new Error('Business page not found');
    }
    if (!publicWebsite.website?.bookingEnabled) {
      throw new Error('Booking is disabled for this business page');
    }
    if (!cleanString(payload.customerName)) {
      throw new Error('Customer name is required');
    }
    if (!isValidIndianPhone(payload.customerPhone)) {
      throw new Error('Enter a valid 10-digit mobile number');
    }

    const bookingDate = cleanString(payload.bookingDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      throw new Error('Choose a valid booking date');
    }

    const bookingTime = cleanString(payload.bookingTime);
    if (!bookingTime) {
      throw new Error('Choose a booking time slot');
    }

    const slotData = await this.getBookingSlots(slug, bookingDate, { serviceId: payload.serviceId });
    const selectedSlot = (slotData.slots || []).find((slot) => slot.value === bookingTime);
    if (!selectedSlot || selectedSlot.disabled) {
      throw new Error(selectedSlot?.reason ? `Selected slot is unavailable: ${selectedSlot.reason}` : 'Choose an available booking time slot');
    }

    const website = await ProviderWebsite.findOne({ slug: slugify(slug) });
    const selectedService = payload.serviceId
      ? await ProviderServiceModel.findOne({ _id: payload.serviceId, providerId: website.providerId, isActive: true }).lean()
      : null;
    if (payload.serviceId && (!selectedService || selectedService.availableForBooking === false)) {
      throw new Error('Selected service is not available for booking');
    }
    const maxUnitsPerCustomer = cleanBoolean(website.bookingMultipleUnitsEnabled, false)
      ? clampNumber(website.bookingMaxUnitsPerCustomer, website.bookingCapacityPerSlot || 1, 1, resolveCapacityPerSlot(website, selectedService))
      : 1;
    const bookingQuantity = cleanBoolean(website.bookingMultipleUnitsEnabled, false)
      ? clampNumber(payload.bookingQuantity, 1, 1, maxUnitsPerCustomer)
      : 1;
    if (selectedSlot.spotsLeft !== null && selectedSlot.spotsLeft !== undefined && bookingQuantity > cleanNumber(selectedSlot.spotsLeft, 0)) {
      throw new Error(`Only ${selectedSlot.spotsLeft} booking unit${Number(selectedSlot.spotsLeft) === 1 ? '' : 's'} are available for this time slot.`);
    }

    const bookingWeekday = getWeekdayForDate(bookingDate);
    if (!bookingWeekday) {
      throw new Error('Choose a valid booking date');
    }

    const workingDays = Array.isArray(website.bookingWorkingDays) ? website.bookingWorkingDays : [];
    const isWorkingDay = workingDays.length === 0 || workingDays.some((day) => normalizeDayLabel(day) === normalizeDayLabel(bookingWeekday));
    if (!isWorkingDay) {
      throw new Error(`${bookingWeekday} is not available for bookings`);
    }
    const closedDates = Array.isArray(website.bookingClosedDates) ? website.bookingClosedDates : [];
    if (closedDates.includes(bookingDate)) {
      throw new Error(`The business is closed for bookings on ${bookingDate}`);
    }

    const businessHour = Array.isArray(website.businessHours)
      ? website.businessHours.find((item) => normalizeDayLabel(item?.day) === normalizeDayLabel(bookingWeekday))
      : null;
    if (businessHour && businessHour.isOpen === false) {
      throw new Error(`${bookingWeekday} is marked closed for this business`);
    }

    const [requestedStart = '', requestedEnd = ''] = bookingTime.split(' - ').map((item) => cleanString(item));
    const slotStartMinutes = parseTimeToMinutes(requestedStart);
    const slotEndMinutes = parseTimeToMinutes(requestedEnd);
    const slotDurationMinutes = cleanNumber(selectedSlot.durationMinutes, resolveBookingSlotDuration(website, selectedService));
    const gapAfterBookingMinutes = cleanNumber(selectedSlot.gapAfterBookingMinutes, resolveBookingGapMinutes(website, selectedService));
    const openMinutes = parseTimeToMinutes(businessHour?.openTime);
    const closeMinutes = parseTimeToMinutes(businessHour?.closeTime);
    if (slotStartMinutes === null || slotEndMinutes === null || openMinutes === null || closeMinutes === null || slotEndMinutes <= slotStartMinutes) {
      throw new Error('Choose an available booking time slot');
    }
    if (slotStartMinutes < openMinutes || slotEndMinutes > closeMinutes) {
      throw new Error('Choose a booking time within business working hours');
    }
    const breakStart = parseTimeToMinutes(businessHour?.breakStartTime);
    const breakEnd = parseTimeToMinutes(businessHour?.breakEndTime);
    if (breakStart !== null && breakEnd !== null && breakEnd > breakStart && slotStartMinutes < breakEnd && slotEndMinutes > breakStart) {
      throw new Error('The selected booking time overlaps with business break time');
    }

    const indiaNow = getIndiaNowContext();
    if (bookingDate < indiaNow.date) {
      throw new Error('Past booking dates are not allowed');
    }

    const leadNoticeMinutes = resolveLeadNoticeMinutes(website);
    if (minutesUntilBooking(bookingDate, slotStartMinutes, indiaNow) <= leadNoticeMinutes) {
      throw new Error('This time slot does not meet the minimum advance booking time');
    }

    const actorUser = actorUserId ? await User.findById(actorUserId).select('email').lean() : null;
    const customerEmail = cleanString(payload.customerEmail) || cleanString(actorUser?.email);
    const bookingFlow = normalizeBookingFlowForWebsite(website);
    const unitBaseAmount = resolveBookingPaymentDue(website, selectedService, bookingFlow);
    const baseAmount = Number((unitBaseAmount * bookingQuantity).toFixed(2));
    const timeCharges = resolveBookingTimeCharges(website, slotStartMinutes, baseAmount, bookingDate);
    const paymentChoice = websitePaymentService.resolveCustomerPaymentChoice(bookingFlow, payload.paymentChoice);
    const offerQuantity = bookingQuantity;
    const requestedOfferCode = normalizeOfferCode(payload.offerCode);
    let offerDiscountAmount = 0;
    let appliedOfferCode = '';
    let payableAmount = Number((baseAmount + timeCharges.total).toFixed(2));
    if (requestedOfferCode && paymentChoice !== 'pay-later' && payableAmount > 0) {
      const offer = await ProviderOffer.findOne({
        providerId: website.providerId,
        websiteId: website._id,
        kind: 'offer',
        offerCode: requestedOfferCode,
        isActive: true
      }).lean();
      if (!offer) {
        throw new Error('Enter a valid offer code.');
      }
      const serviceIds = Array.isArray(offer.applicableServiceIds) ? offer.applicableServiceIds.map((item) => toObjectIdString(item)) : [];
      const selectedServiceId = toObjectIdString(selectedService?._id || payload.serviceId);
      const appliesToService = serviceIds.length === 0 || serviceIds.includes('all') || serviceIds.includes(selectedServiceId);
      if (!appliesToService) {
        throw new Error('This offer code is not applicable to the selected service.');
      }
      if (offerQuantity < Math.max(1, cleanNumber(offer.minQuantity, 1))) {
        throw new Error(`This offer is available for quantity ${Math.max(1, cleanNumber(offer.minQuantity, 1))} or above.`);
      }
      offerDiscountAmount = cleanString(offer.discountType) === 'amount'
        ? Math.min(payableAmount, cleanNumber(offer.discountValue, 0))
        : Math.min(payableAmount, Number((payableAmount * cleanNumber(offer.discountValue, 0) / 100).toFixed(2)));
      payableAmount = Math.max(0, Number((payableAmount - offerDiscountAmount).toFixed(2)));
      appliedOfferCode = requestedOfferCode;
    }
    const confirmationType = resolveBookingConfirmationType(website, selectedService);
    if (paymentChoice === 'gateway' && !websitePaymentService.isGatewayConfigured()) {
      throw new Error('Online gateway payment is not connected yet. Choose manual UPI payment or pay later.');
    }
    if (paymentChoice === 'manual-upi' && !cleanString(payload.payerTransactionId)) {
      throw new Error('Enter the UPI transaction ID after payment');
    }

    const paymentChannel = paymentChoice === 'pay-later' ? 'none' : paymentChoice;
    const amountBreakdown = paymentChoice === 'gateway'
      ? websitePaymentService.calculateGatewayAmounts(payableAmount, bookingFlow.gatewayFeeBearer)
      : websitePaymentService.calculateManualAmounts(payableAmount);
    const paymentStatus = paymentChoice === 'pay-later'
      ? 'not-required'
      : paymentChoice === 'manual-upi'
        ? 'verification-pending'
        : 'pending';
    const serviceProofOtp = paymentChoice !== 'pay-later' && amountBreakdown.totalAmount > 0 ? generateBookingOtp() : '';

    const booking = await ProviderBooking.create({
      providerId: website.providerId,
      websiteId: website._id,
      customerUserId: actorUserId || null,
      customerName: cleanString(payload.customerName),
      customerPhone: normalizeIndianPhone(payload.customerPhone),
      customerWhatsappOptIn: cleanBoolean(payload.isWhatsappNumber, false),
      customerEmail,
      customerAddress: cleanString(payload.customerAddress),
      serviceId: payload.serviceId || null,
      serviceTitle: cleanString(selectedService?.title),
      bookingDate,
      bookingTime,
      bookingStartTime: minutesToTime(slotStartMinutes),
      bookingEndTime: minutesToTime(slotEndMinutes),
      bookingDurationMinutes: slotDurationMinutes,
      bookingGapMinutes: gapAfterBookingMinutes,
      bookingQuantity,
      message: cleanString(payload.message),
      advanceFeeRequired: paymentChoice !== 'pay-later' && amountBreakdown.totalAmount > 0,
      advanceFeeAmount: Number(amountBreakdown.totalAmount || 0),
      paymentChoice,
      paymentChannel,
      paymentStatus,
      offerCode: appliedOfferCode,
      offerDiscountAmount,
      offerQuantity,
      serviceProofOtpHash: serviceProofOtp ? hashBookingOtp(serviceProofOtp) : '',
      serviceProofOtpCode: serviceProofOtp,
      serviceProofOtpGeneratedAt: serviceProofOtp ? new Date() : null,
      status: resolveBookingStatus(website, selectedService, paymentChoice)
    });

    let transaction = null;
    if (paymentChoice !== 'pay-later' && amountBreakdown.totalAmount > 0) {
      const manualPayment = paymentChoice === 'manual-upi'
        ? await websitePaymentService.buildManualPaymentArtifacts({
          upiId: website.upiId,
          payeeName: website.businessName || publicWebsite.fullName || 'Provider',
          amount: amountBreakdown.totalAmount,
          note: `${website.businessName || 'Booking'} ${booking._id.toString().slice(-6)}`,
          paymentInstructions: bookingFlow.paymentInstructions || website.paymentInstructions || ''
        })
        : {};
      if (paymentChoice === 'manual-upi') {
        manualPayment.payerTransactionId = cleanString(payload.payerTransactionId);
        manualPayment.submittedAt = new Date();
      }

      transaction = await WebsiteTransaction.create({
        providerId: website.providerId,
        websiteId: website._id,
        customerUserId: actorUserId || null,
        customerName: cleanString(payload.customerName),
        customerPhone: normalizeIndianPhone(payload.customerPhone),
        customerEmail,
        contextType: 'booking',
        contextId: booking._id,
        contextLabel: cleanString(selectedService?.title) || 'Website booking',
        paymentChannel,
        paymentStatus,
        amountBreakdown: {
          ...amountBreakdown,
          bookingBaseAmount: baseAmount,
          nightChargeAmount: timeCharges.nightAmount,
          emergencyChargeAmount: timeCharges.emergencyAmount,
          feeBearer: bookingFlow.gatewayFeeBearer
        },
        gateway: paymentChoice === 'gateway' ? {
          provider: websitePaymentService.buildGatewayMeta().provider,
          status: 'pending',
          feePercent: bookingFlow.gatewayFeePercent || 3
        } : undefined,
        manualPayment
      });

      booking.transactionId = transaction._id;
      await booking.save();
    }

    await notificationService.createNotification({
      userId: website.providerId,
      type: 'booking',
      title: 'New booking request',
      body: `${cleanString(payload.customerName) || 'A customer'} requested a booking for ${publicWebsite.website?.businessName || 'your business page'}.`,
      linkPath: '/provider/customer-requests?tab=bookings',
      metadata: {
        bookingId: booking._id.toString(),
        slug: website.slug,
        transactionId: transaction?._id?.toString?.() || ''
      }
    });

    if (actorUserId) {
      await notificationService.createNotification({
        userId: actorUserId,
        type: 'booking',
        title: 'Booking request sent',
        body: `Your booking request was sent to ${publicWebsite.website?.businessName || 'this provider'}.`,
        linkPath: '/my-requests?tab=bookings',
        metadata: {
          bookingId: booking._id.toString(),
          providerId: website.providerId.toString(),
          slug: website.slug
        }
      });
    }

    await this.sendBookingCreatedEmails(website.providerId, booking, transaction, website, serviceProofOtp);
    if (booking.status === 'confirmed') {
      await this.sendBookingStatusUpdate(website.providerId, booking, transaction, 'confirmed', 'Your booking is confirmed.');
    }

    return {
      id: booking._id.toString(),
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentChoice: booking.paymentChoice,
      customerEmail: booking.customerEmail,
      bookingDate: booking.bookingDate,
      bookingTime: booking.bookingTime,
      serviceTitle: booking.serviceTitle,
      advanceFeeAmount: booking.advanceFeeAmount,
      createdAt: booking.createdAt,
      transaction: transaction ? this.serializeTransaction(transaction) : null
    };
  }

  async createProductOrder(slug, payload = {}, actorUserId = null) {
    const publicWebsite = await this.getPublicWebsiteBySlug(slug);
    if (!publicWebsite) {
      throw new Error('Business page not found');
    }
    if (!publicWebsite.website?.productsEnabled || publicWebsite.website?.productFlow?.enabled === false) {
      throw new Error('Product orders are not enabled for this business page');
    }
    if (!cleanString(payload.customerName)) {
      throw new Error('Customer name is required');
    }
    if (!isValidIndianPhone(payload.customerPhone)) {
      throw new Error('Enter a valid 10-digit mobile number');
    }

    const website = await ProviderWebsite.findOne({ slug: slugify(slug) });
    const product = await ProviderProduct.findOne({ _id: payload.productId, providerId: website.providerId, isActive: true }).lean();
    if (!product) {
      throw new Error('Product not found');
    }

    const productFlow = websitePaymentService.normalizeFlowConfig(website.productFlow || {}, {
      enabled: website.productsEnabled,
      paymentModel: 'without-online-payment',
      paymentMethods: website.upiId ? ['manual-upi'] : [],
      gatewayFeeBearer: 'customer',
      chargeAmount: 0,
      paymentInstructions: website.paymentInstructions || ''
    });
    const quantity = Math.max(1, Math.min(cleanNumber(payload.quantity, 1), 20));
    const unitAmount = cleanNumber(product.discountedPrice || product.price, 0);
    const baseAmount = unitAmount * quantity;
    const paymentChoice = websitePaymentService.resolveCustomerPaymentChoice(productFlow, payload.paymentChoice);
    if (paymentChoice === 'gateway' && !websitePaymentService.isGatewayConfigured()) {
      throw new Error('Online gateway payment is not connected yet. Choose manual UPI payment or pay later.');
    }
    if (paymentChoice === 'manual-upi' && !cleanString(payload.payerTransactionId)) {
      throw new Error('Enter the UPI transaction ID after payment');
    }

    const paymentChannel = paymentChoice === 'pay-later' ? 'none' : paymentChoice;
    const amountBreakdown = paymentChoice === 'gateway'
      ? websitePaymentService.calculateGatewayAmounts(baseAmount, productFlow.gatewayFeeBearer)
      : websitePaymentService.calculateManualAmounts(baseAmount);
    const paymentStatus = paymentChoice === 'pay-later'
      ? 'not-required'
      : paymentChoice === 'manual-upi'
        ? 'verification-pending'
        : 'pending';

    const order = await ProviderProductOrder.create({
      providerId: website.providerId,
      websiteId: website._id,
      productId: product._id,
      customerUserId: actorUserId || null,
      customerName: cleanString(payload.customerName),
      customerPhone: normalizeIndianPhone(payload.customerPhone),
      customerEmail: cleanString(payload.customerEmail),
      productTitle: cleanString(product.title),
      quantity,
      unitAmount,
      message: cleanString(payload.message),
      status: 'new',
      paymentStatus,
      paymentChannel,
      totalAmount: amountBreakdown.totalAmount
    });

    let transaction = null;
    if (paymentChoice !== 'pay-later' && amountBreakdown.totalAmount > 0) {
      const manualPayment = paymentChoice === 'manual-upi'
        ? await websitePaymentService.buildManualPaymentArtifacts({
          upiId: website.upiId,
          payeeName: website.businessName || publicWebsite.fullName || 'Provider',
          amount: amountBreakdown.totalAmount,
          note: `${product.title} ${order._id.toString().slice(-6)}`,
          paymentInstructions: productFlow.paymentInstructions || website.paymentInstructions || ''
        })
        : {};
      if (paymentChoice === 'manual-upi') {
        manualPayment.payerTransactionId = cleanString(payload.payerTransactionId);
        manualPayment.submittedAt = new Date();
      }

      transaction = await WebsiteTransaction.create({
        providerId: website.providerId,
        websiteId: website._id,
        customerUserId: actorUserId || null,
        customerName: cleanString(payload.customerName),
        customerPhone: normalizeIndianPhone(payload.customerPhone),
        customerEmail: cleanString(payload.customerEmail),
        contextType: 'product-order',
        contextId: order._id,
        contextLabel: cleanString(product.title),
        paymentChannel,
        paymentStatus,
        amountBreakdown: {
          ...amountBreakdown,
          feeBearer: productFlow.gatewayFeeBearer
        },
        gateway: paymentChoice === 'gateway' ? {
          provider: websitePaymentService.buildGatewayMeta().provider,
          status: 'pending',
          feePercent: productFlow.gatewayFeePercent || 3
        } : undefined,
        manualPayment
      });
    }

    await notificationService.createNotification({
      userId: website.providerId,
      type: 'order',
      title: 'New product order',
      body: `${cleanString(payload.customerName) || 'A customer'} placed an order for ${product.title}.`,
      linkPath: '/provider/website',
      metadata: {
        orderId: order._id.toString(),
        slug: website.slug,
        transactionId: transaction?._id?.toString?.() || ''
      }
    });

    if (actorUserId) {
      await notificationService.createNotification({
        userId: actorUserId,
        type: 'order',
        title: 'Product order sent',
        body: `Your order for ${product.title} was sent to ${publicWebsite.website?.businessName || 'this provider'}.`,
        linkPath: '/my-requests?tab=orders',
        metadata: {
          orderId: order._id.toString(),
          providerId: website.providerId.toString(),
          slug: website.slug,
          transactionId: transaction?._id?.toString?.() || ''
        }
      });
    }

    return {
      id: order._id.toString(),
      status: order.status,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
      transaction: transaction ? this.serializeTransaction(transaction) : null
    };
  }

  async getMyRequests(userId) {
    const user = await User.findById(userId).select('fullName mobile email').lean();
    if (!user) {
      throw new Error('User not found');
    }

    const userIdString = toObjectIdString(userId);
    const customerMobile = normalizeIndianPhone(user.mobile);
    const customerEmail = cleanString(user.email).toLowerCase();
    const emailRegex = customerEmail ? new RegExp(`^${escapeRegex(customerEmail)}$`, 'i') : null;
    const lookupFilters = (phoneField, emailField) => {
      const filters = [{ customerUserId: userId }];
      if (customerMobile) {
        filters.push({ [phoneField]: customerMobile });
      }
      if (emailRegex) {
        filters.push({ [emailField]: emailRegex });
      }
      return filters;
    };

    const [bookings, leads, orders] = await Promise.all([
      ProviderBooking.find({ $or: lookupFilters('customerPhone', 'customerEmail') }).sort({ createdAt: -1 }).limit(100).lean(),
      ProviderLead.find({
        source: { $in: ['website', 'inquiry', 'callback'] },
        $or: lookupFilters('phone', 'email')
      }).sort({ createdAt: -1 }).limit(100).lean(),
      ProviderProductOrder.find({ $or: lookupFilters('customerPhone', 'customerEmail') }).sort({ createdAt: -1 }).limit(100).lean()
    ]);

    const bookingIds = bookings.map((item) => item._id).filter(Boolean);
    const orderIds = orders.map((item) => item._id).filter(Boolean);
    const transactionFilters = [
      bookingIds.length ? { contextType: 'booking', contextId: { $in: bookingIds } } : null,
      orderIds.length ? { contextType: 'product-order', contextId: { $in: orderIds } } : null
    ].filter(Boolean);
    const transactions = transactionFilters.length
      ? await WebsiteTransaction.find({ $or: transactionFilters }).sort({ createdAt: -1 }).lean()
      : [];

    const providerIds = [...new Set([
      ...bookings.map((item) => toObjectIdString(item.providerId)),
      ...leads.map((item) => toObjectIdString(item.providerId)),
      ...orders.map((item) => toObjectIdString(item.providerId))
    ].filter(Boolean))];
    const websiteIds = [...new Set([
      ...bookings.map((item) => toObjectIdString(item.websiteId)),
      ...leads.map((item) => toObjectIdString(item.websiteId)),
      ...orders.map((item) => toObjectIdString(item.websiteId))
    ].filter(Boolean))];

    const [providers, profiles, websites] = await Promise.all([
      providerIds.length
        ? User.find({ _id: { $in: providerIds } }).select('fullName mobile email').lean()
        : Promise.resolve([]),
      providerIds.length
        ? ProfessionalProfile.find({ user: { $in: providerIds } }).select('user profession profilePicture city state area').lean()
        : Promise.resolve([]),
      websiteIds.length
        ? ProviderWebsite.find({ _id: { $in: websiteIds } }).select('providerId slug businessName category phone email city state address logoImage').lean()
        : Promise.resolve([])
    ]);

    const providerMap = new Map(providers.map((item) => [toObjectIdString(item._id), item]));
    const profileMap = new Map(profiles.map((item) => [toObjectIdString(item.user), item]));
    const websiteMap = new Map(websites.map((item) => [toObjectIdString(item._id), item]));
    const transactionMap = new Map(transactions.map((item) => [`${cleanString(item.contextType)}:${toObjectIdString(item.contextId)}`, item]));

    const providerMeta = (providerId, websiteId) => {
      const providerKey = toObjectIdString(providerId);
      const website = websiteMap.get(toObjectIdString(websiteId)) || {};
      const provider = providerMap.get(providerKey) || {};
      const profile = profileMap.get(providerKey) || {};
      const city = cleanString(website.city || profile.city || profile.area);
      const state = cleanString(website.state || profile.state);
      const businessName = cleanString(website.businessName) || cleanString(provider.fullName) || 'Provider';

      return {
        id: providerKey,
        websiteId: toObjectIdString(websiteId),
        fullName: cleanString(provider.fullName),
        businessName,
        category: cleanString(website.category || profile.profession),
        phone: cleanString(website.phone || provider.mobile),
        email: cleanString(website.email || provider.email),
        location: [city, state].filter(Boolean).join(', '),
        address: cleanString(website.address),
        slug: cleanString(website.slug),
        publicPath: website.slug ? `/business/${website.slug}` : '',
        profilePicture: cleanString(profile.profilePicture),
        logoImage: cleanString(website.logoImage)
      };
    };

    const serializeCustomerTransaction = (transaction = null) => transaction ? {
      id: transaction._id?.toString?.() || String(transaction.id || ''),
      contextType: cleanString(transaction.contextType),
      contextId: toObjectIdString(transaction.contextId),
      contextLabel: cleanString(transaction.contextLabel),
      paymentChannel: cleanString(transaction.paymentChannel),
      paymentStatus: cleanString(transaction.paymentStatus),
      amountBreakdown: transaction.amountBreakdown || {},
      gateway: {
        provider: cleanString(transaction.gateway?.provider),
        status: cleanString(transaction.gateway?.status),
        providerReference: cleanString(transaction.gateway?.providerReference),
        orderReference: cleanString(transaction.gateway?.orderReference)
      },
      manualPayment: {
        upiId: cleanString(transaction.manualPayment?.upiId),
        payerTransactionId: cleanString(transaction.manualPayment?.payerTransactionId),
        instructions: cleanString(transaction.manualPayment?.instructions),
        submittedAt: transaction.manualPayment?.submittedAt || null,
        verifiedAt: transaction.manualPayment?.verifiedAt || null,
        verificationNote: cleanString(transaction.manualPayment?.verificationNote)
      },
      receipt: transaction.receipt || {},
      refundStatus: cleanString(transaction.refundStatus),
      refund: transaction.refund || {},
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt
    } : null;

    const serializePayment = (source, transaction = null) => ({
      choice: cleanString(source.paymentChoice),
      channel: cleanString(transaction?.paymentChannel || source.paymentChannel),
      status: cleanString(transaction?.paymentStatus || source.paymentStatus),
      amount: cleanNumber(transaction?.amountBreakdown?.totalAmount ?? source.advanceFeeAmount ?? source.totalAmount, 0),
      advanceFeeRequired: Boolean(source.advanceFeeRequired),
      offerCode: cleanString(source.offerCode),
      offerDiscountAmount: cleanNumber(source.offerDiscountAmount, 0),
      refundStatus: cleanString(transaction?.refundStatus || source.refundStatus),
      refundAmount: cleanNumber(transaction?.refund?.amount ?? source.refundAmount, 0),
      refundReference: cleanString(transaction?.refund?.reference || source.refundReference),
      refundNote: cleanString(transaction?.refund?.note || source.refundNote),
      transaction: serializeCustomerTransaction(transaction)
    });

    const requestItems = [
      ...bookings.map((booking) => {
        const id = toObjectIdString(booking._id);
        const transaction = transactionMap.get(`booking:${id}`) || null;
        return {
          id,
          type: 'booking',
          reference: bookingPublicReference(booking),
          title: cleanString(booking.serviceTitle || transaction?.contextLabel) || 'Website booking',
          provider: providerMeta(booking.providerId, booking.websiteId),
          status: cleanString(booking.status),
          customer: {
            name: cleanString(booking.customerName),
            phone: cleanString(booking.customerPhone),
            email: cleanString(booking.customerEmail),
            address: cleanString(booking.customerAddress)
          },
          bookingDate: cleanString(booking.bookingDate),
          bookingTime: cleanString(booking.bookingTime),
          bookingStartTime: cleanString(booking.bookingStartTime),
          bookingEndTime: cleanString(booking.bookingEndTime),
          bookingDurationMinutes: cleanNumber(booking.bookingDurationMinutes, 0),
          bookingQuantity: Math.max(1, cleanNumber(booking.bookingQuantity, 1)),
          message: cleanString(booking.message),
          providerMessage: cleanString(booking.providerMessage),
          cancellationReason: cleanString(booking.cancellationReason),
          cancelledAt: booking.cancelledAt || null,
          rescheduleMessage: cleanString(booking.rescheduleMessage),
          rescheduledAt: booking.rescheduledAt || null,
          serviceOtp: cleanString(booking.serviceProofOtpCode),
          serviceOtpGeneratedAt: booking.serviceProofOtpGeneratedAt || null,
          serviceOtpVerifiedAt: booking.serviceProofOtpVerifiedAt || null,
          payment: serializePayment(booking, transaction),
          statusUpdatedAt: booking.statusUpdatedAt || null,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt
        };
      }),
      ...leads.map((lead) => {
        const source = cleanString(lead.source);
        const isCallback = source === 'callback';
        return {
          id: toObjectIdString(lead._id),
          type: isCallback ? 'callback' : 'inquiry',
          reference: `RQ-${toObjectIdString(lead._id).slice(-8).toUpperCase()}`,
          title: isCallback ? 'Callback request' : (cleanString(lead.interestedService) || 'Inquiry'),
          provider: providerMeta(lead.providerId, lead.websiteId),
          status: cleanString(lead.status),
          customer: {
            name: cleanString(lead.name),
            phone: cleanString(lead.phone),
            email: cleanString(lead.email)
          },
          source,
          interestedService: cleanString(lead.interestedService),
          message: cleanString(lead.message),
          createdAt: lead.createdAt,
          updatedAt: lead.updatedAt
        };
      }),
      ...orders.map((order) => {
        const id = toObjectIdString(order._id);
        const transaction = transactionMap.get(`product-order:${id}`) || null;
        return {
          id,
          type: 'order',
          reference: `OR-${id.slice(-8).toUpperCase()}`,
          title: cleanString(order.productTitle) || 'Product order',
          provider: providerMeta(order.providerId, order.websiteId),
          status: cleanString(order.status),
          customer: {
            name: cleanString(order.customerName),
            phone: cleanString(order.customerPhone),
            email: cleanString(order.customerEmail)
          },
          productTitle: cleanString(order.productTitle),
          quantity: Math.max(1, cleanNumber(order.quantity, 1)),
          unitAmount: cleanNumber(order.unitAmount, 0),
          totalAmount: cleanNumber(order.totalAmount, 0),
          message: cleanString(order.message),
          payment: serializePayment(order, transaction),
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        };
      })
    ].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    const pendingStatuses = new Set(['new', 'pending_approval', 'payment_pending', 'verification-pending', 'pending']);
    const completedStatuses = new Set(['completed', 'closed', 'paid']);
    return {
      currentUser: {
        id: userIdString,
        fullName: cleanString(user.fullName),
        mobile: cleanString(user.mobile),
        email: cleanString(user.email)
      },
      requests: requestItems,
      stats: {
        total: requestItems.length,
        bookings: requestItems.filter((item) => item.type === 'booking').length,
        inquiries: requestItems.filter((item) => item.type === 'inquiry').length,
        callbacks: requestItems.filter((item) => item.type === 'callback').length,
        orders: requestItems.filter((item) => item.type === 'order').length,
        pending: requestItems.filter((item) => pendingStatuses.has(item.status) || pendingStatuses.has(item.payment?.status)).length,
        completed: requestItems.filter((item) => completedStatuses.has(item.status)).length,
        otpAvailable: requestItems.filter((item) => cleanString(item.serviceOtp)).length
      }
    };
  }

  async updateLeadStatus(userId, leadId, payload = {}) {
    const nextStatus = cleanString(payload.status);
    const allowedStatuses = ['new', 'contacted', 'qualified', 'closed'];
    if (!allowedStatuses.includes(nextStatus)) {
      throw new Error('Invalid lead status');
    }

    const lead = await ProviderLead.findOne({ _id: leadId, providerId: userId });
    if (!lead) {
      throw new Error('Lead not found');
    }

    lead.status = nextStatus;
    if ('notes' in payload) {
      lead.notes = cleanString(payload.notes);
    }
    await lead.save();

    return this.getManager(userId);
  }

  async updateBookingStatus(userId, bookingId, payload = {}) {
    const nextStatus = cleanString(payload.status);
    const allowedStatuses = ['new', 'pending_approval', 'confirmed', 'payment_pending', 'rejected', 'completed', 'cancelled', 'rescheduled'];
    if (!allowedStatuses.includes(nextStatus)) {
      throw new Error('Invalid booking status');
    }

    const booking = await ProviderBooking.findOne({ _id: bookingId, providerId: userId });
    if (!booking) {
      throw new Error('Booking not found');
    }

    const transaction = booking.transactionId ? await WebsiteTransaction.findById(booking.transactionId) : null;
    const providerMessage = cleanString(payload.message || payload.providerMessage || payload.note);
    const nextBookingDate = cleanString(payload.bookingDate);
    const nextBookingTime = cleanString(payload.bookingTime);
    const paymentChannel = cleanString(transaction?.paymentChannel || booking.paymentChannel);
    const paymentStatus = cleanString(transaction?.paymentStatus || booking.paymentStatus);
    const actionStatuses = ['confirmed', 'rescheduled', 'cancelled', 'completed'];
    if (paymentChannel === 'manual-upi' && paymentStatus === 'verification-pending' && actionStatuses.includes(nextStatus)) {
      throw new Error('Verify the UPI payment or mark it not received before updating this booking.');
    }
    if (paymentChannel === 'manual-upi' && paymentStatus === 'failed' && ['confirmed', 'rescheduled', 'completed'].includes(nextStatus)) {
      throw new Error('Payment was marked not received. Resolve the payment before continuing this booking.');
    }
    if (this.requiresBookingProofOtp(booking, transaction) && ['rescheduled', 'cancelled', 'completed'].includes(nextStatus)) {
      this.verifyBookingProofOtp(booking, payload.otp || payload.serviceOtp);
    }

    if (nextBookingDate || nextBookingTime) {
      const bookingDate = nextBookingDate || booking.bookingDate;
      const bookingTime = nextBookingTime || booking.bookingTime;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
        throw new Error('Choose a valid reschedule date');
      }
      const [requestedStart = '', requestedEnd = ''] = bookingTime.split(' - ').map((item) => cleanString(item));
      const slotStartMinutes = parseTimeToMinutes(requestedStart);
      const slotEndMinutes = parseTimeToMinutes(requestedEnd);
      if (slotStartMinutes === null || slotEndMinutes === null || slotEndMinutes <= slotStartMinutes) {
        throw new Error('Choose a valid reschedule time range');
      }
      booking.bookingDate = bookingDate;
      booking.bookingStartTime = minutesToTime(slotStartMinutes);
      booking.bookingEndTime = minutesToTime(slotEndMinutes);
      booking.bookingTime = `${booking.bookingStartTime} - ${booking.bookingEndTime}`;
      booking.bookingDurationMinutes = Math.max(5, slotEndMinutes - slotStartMinutes);
      booking.rescheduledAt = new Date();
      booking.rescheduleMessage = providerMessage || cleanString(payload.rescheduleMessage);
    }

    booking.status = nextStatus;
    booking.statusUpdatedAt = new Date();
    if (providerMessage) {
      booking.providerMessage = providerMessage;
    }
    if (nextStatus === 'cancelled' || nextStatus === 'rejected') {
      booking.cancelledAt = new Date();
      booking.cancellationReason = cleanString(payload.cancellationReason || providerMessage);
      if (['paid', 'verification-pending'].includes(booking.paymentStatus)) {
        booking.refundStatus = booking.refundStatus === 'processed' ? 'processed' : 'pending';
        booking.refundAmount = cleanNumber(payload.refundAmount, transaction?.amountBreakdown?.totalAmount || booking.advanceFeeAmount || 0);
        booking.refundNote = cleanString(payload.refundNote || 'Refund pending from provider.');
        if (transaction && transaction.refundStatus !== 'processed') {
          transaction.refundStatus = 'pending';
          transaction.refund.requestedAt = transaction.refund.requestedAt || new Date();
          transaction.refund.amount = booking.refundAmount;
          transaction.refund.note = booking.refundNote;
        }
      }
    } else if (['new', 'pending_approval', 'confirmed', 'payment_pending', 'rescheduled', 'completed'].includes(nextStatus)) {
      booking.cancelledAt = null;
      booking.cancellationReason = '';
      if (booking.refundStatus === 'pending') {
        booking.refundStatus = 'none';
        booking.refundAmount = 0;
        booking.refundNote = '';
        if (transaction && transaction.refundStatus === 'pending') {
          transaction.refundStatus = 'none';
          transaction.refund.amount = 0;
          transaction.refund.note = '';
          transaction.refund.requestedAt = null;
        }
      }
    }

    await Promise.all([
      booking.save(),
      transaction && transaction.isModified ? transaction.save() : Promise.resolve()
    ]);
    await this.sendBookingStatusUpdate(userId, booking, transaction, nextStatus, providerMessage);

    return this.getManager(userId);
  }

  async updateBookingPayment(userId, bookingId, payload = {}) {
    const booking = await ProviderBooking.findOne({ _id: bookingId, providerId: userId });
    if (!booking) {
      throw new Error('Booking not found');
    }
    const transaction = booking.transactionId ? await WebsiteTransaction.findById(booking.transactionId) : null;
    if (!transaction) {
      throw new Error('Payment record not found for this booking');
    }

    const action = cleanString(payload.action);
    if (!['verify', 'refund', 'fail', 'receipt'].includes(action)) {
      throw new Error('Invalid payment action');
    }

    if (action === 'verify') {
      transaction.paymentStatus = 'paid';
      transaction.manualPayment.payerTransactionId = cleanString(payload.payerTransactionId || transaction.manualPayment?.payerTransactionId);
      transaction.manualPayment.verificationNote = cleanString(payload.note);
      transaction.manualPayment.verifiedAt = new Date();
      transaction.manualPayment.verifiedBy = userId;
      transaction.receipt.receiptNumber = transaction.receipt.receiptNumber || websitePaymentService.buildReceiptNumber('BK');
      transaction.receipt.issuedAt = new Date();
      booking.paymentStatus = 'paid';
      booking.status = ['new', 'payment_pending'].includes(booking.status) ? 'pending_approval' : booking.status;
      await Promise.all([transaction.save(), booking.save()]);
    } else if (action === 'refund') {
      const refundUpiId = cleanString(payload.upiId || transaction.manualPayment?.upiId);
      this.verifyBookingProofOtp(booking, payload.otp || payload.serviceOtp);
      if (!cleanString(payload.reference) && !cleanBoolean(payload.refundPaidCash, false)) {
        throw new Error('Enter the refund transaction ID or mark the refund as paid by cash.');
      }
      transaction.paymentStatus = 'refunded';
      transaction.refundStatus = 'processed';
      transaction.refund.processedAt = new Date();
      transaction.refund.amount = cleanNumber(payload.amount, transaction.amountBreakdown?.totalAmount || 0);
      transaction.refund.reference = cleanBoolean(payload.refundPaidCash, false) ? 'Paid by cash' : cleanString(payload.reference);
      transaction.refund.note = cleanString(payload.note);
      booking.paymentStatus = 'refunded';
      booking.refundStatus = 'processed';
      booking.refundAmount = transaction.refund.amount;
      booking.refundReference = transaction.refund.reference;
      booking.refundNote = transaction.refund.note;
      await Promise.all([transaction.save(), booking.save()]);
      try {
        await this.sendBookingRefundEmail(userId, booking, transaction, refundUpiId);
      } catch (error) {
        logger.warn(`Booking refund email failed: ${error.message}`);
      }
    } else if (action === 'fail') {
      transaction.paymentStatus = 'failed';
      transaction.manualPayment.verificationNote = cleanString(payload.note);
      booking.paymentStatus = 'failed';
      await Promise.all([transaction.save(), booking.save()]);
    } else if (action === 'receipt') {
      if (!['paid', 'refunded'].includes(cleanString(transaction.paymentStatus))) {
        throw new Error('Verify the payment before sending a receipt.');
      }
      transaction.receipt.receiptNumber = transaction.receipt.receiptNumber || websitePaymentService.buildReceiptNumber('BK');
      transaction.receipt.issuedAt = transaction.receipt.issuedAt || new Date();
      await transaction.save();
      const mailed = await this.sendBookingReceiptCopy(userId, booking, transaction);
      if (!mailed) {
        throw new Error('Receipt could not be emailed. Check email configuration or customer email.');
      }
    }

    return this.getManager(userId);
  }

  async updateOrderStatus(userId, orderId, payload = {}) {
    const nextStatus = cleanString(payload.status);
    const allowedStatuses = ['new', 'confirmed', 'completed', 'cancelled'];
    if (!allowedStatuses.includes(nextStatus)) {
      throw new Error('Invalid order status');
    }

    const order = await ProviderProductOrder.findOne({ _id: orderId, providerId: userId });
    if (!order) {
      throw new Error('Order not found');
    }

    order.status = nextStatus;
    await order.save();

    return this.getManager(userId);
  }

  async updateOrderPayment(userId, orderId, payload = {}) {
    const order = await ProviderProductOrder.findOne({ _id: orderId, providerId: userId });
    if (!order) {
      throw new Error('Order not found');
    }
    const transaction = await WebsiteTransaction.findOne({ providerId: userId, contextType: 'product-order', contextId: order._id });
    if (!transaction) {
      throw new Error('Payment record not found for this order');
    }

    const action = cleanString(payload.action);
    if (!['verify', 'refund', 'fail'].includes(action)) {
      throw new Error('Invalid payment action');
    }

    if (action === 'verify') {
      transaction.paymentStatus = 'paid';
      transaction.manualPayment.payerTransactionId = cleanString(payload.payerTransactionId || transaction.manualPayment?.payerTransactionId);
      transaction.manualPayment.verificationNote = cleanString(payload.note);
      transaction.manualPayment.verifiedAt = new Date();
      transaction.manualPayment.verifiedBy = userId;
      transaction.receipt.receiptNumber = transaction.receipt.receiptNumber || websitePaymentService.buildReceiptNumber('OR');
      transaction.receipt.issuedAt = new Date();
      order.paymentStatus = 'paid';
      order.status = order.status === 'new' ? 'confirmed' : order.status;
      await Promise.all([transaction.save(), order.save()]);
      await this.sendReceiptEmails(userId, transaction);
    } else if (action === 'refund') {
      transaction.paymentStatus = 'refunded';
      transaction.refundStatus = 'processed';
      transaction.refund.processedAt = new Date();
      transaction.refund.amount = cleanNumber(payload.amount, transaction.amountBreakdown?.totalAmount || 0);
      transaction.refund.reference = cleanString(payload.reference);
      transaction.refund.note = cleanString(payload.note);
      order.paymentStatus = 'refunded';
      await Promise.all([transaction.save(), order.save()]);
    } else {
      transaction.paymentStatus = 'failed';
      transaction.manualPayment.verificationNote = cleanString(payload.note);
      order.paymentStatus = 'failed';
      await Promise.all([transaction.save(), order.save()]);
    }

    return this.getManager(userId);
  }

  async getOrCreateWebsite(userId) {
    const [user, profile, state] = await Promise.all([
      User.findById(userId).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      providerGrowthService.getOrCreateState(userId)
    ]);

    let website = await ProviderWebsite.findOne({ providerId: userId });
    if (!website) {
      const defaultName = user?.fullName || profile?.profession || 'My Business';
      website = await ProviderWebsite.create({
        providerId: userId,
        isPurchased: providerGrowthService.hasActiveWebsite(state),
        status: 'draft',
        slug: cleanString(state.websiteSlug),
        businessName: defaultName,
        tagline: profile?.profession || '',
        category: profile?.profession || '',
        tags: Array.isArray(profile?.tags) ? profile.tags : [],
        about: cleanString(profile?.description),
        yearsOfExperience: cleanNumber(profile?.experience, 0),
        phone: normalizeIndianPhone(user?.mobile),
        whatsappNumber: normalizeIndianPhone(user?.mobile),
        email: cleanString(user?.email),
        address: cleanString(profile?.addressLine),
        city: cleanString(profile?.city),
        state: cleanString(profile?.state),
        pincode: cleanString(profile?.pincode),
        serviceAreas: Array.isArray(profile?.serviceAreas) ? profile.serviceAreas : [],
        businessHours: DEFAULT_BUSINESS_HOURS,
        aboutImage: '',
        gallery: [],
        videos: [],
        servicesEnabled: true,
        productsEnabled: false,
        bookingEnabled: true,
        paymentsEnabled: false,
        bookingConfirmationType: 'provider_approval',
        bookingPaymentOption: 'pay_later',
        bookingPaymentOptions: ['pay_later'],
        bookingSlotDurationMinutes: 30,
        bookingGapAfterMinutes: 0,
        bookingMinimumAdvanceMinutes: 60,
        bookingMaximumAdvanceDays: 30,
        bookingLimitType: 'per_slot',
        bookingCapacityPerSlot: 1,
        bookingMultipleUnitsEnabled: false,
        bookingMaxUnitsPerCustomer: 1,
        bookingDailyLimit: 0,
        paymentInstructions: 'Complete the QR code payment and enter the transaction ID which you see on your UPI payment app after payment.',
        bookingFlow: {
          enabled: true,
          paymentModel: 'without-online-payment',
          paymentMethods: [],
          gatewayFeeBearer: 'customer',
          gatewayFeePercent: 3,
          chargeAmount: 0
        },
        productFlow: {
          enabled: false,
          paymentModel: 'without-online-payment',
          paymentMethods: [],
          gatewayFeeBearer: 'customer',
          gatewayFeePercent: 3,
          chargeAmount: 0
        },
        offersEnabled: false,
        articlesEnabled: false,
        reviewsEnabled: true,
        inquiryFormEnabled: true,
        callbackEnabled: true,
        callEnabled: true,
        whatsappEnabled: true,
        showPricing: true,
        showMap: true,
        showVerification: true,
        bookingWorkingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        bookingSlots: DEFAULT_BOOKING_SLOTS
      });
    }

    website.isPurchased = providerGrowthService.hasActiveWebsite(state);
    await this.getOrCreateSlug(userId, website, state, website.slug || state.websiteSlug || website.businessName);

    await ProviderThemeConfig.findOneAndUpdate(
      { providerId: userId },
      { $setOnInsert: { providerId: userId, websiteId: website._id } },
      { upsert: true, new: true }
    );
    await ProviderSEOConfig.findOneAndUpdate(
      { providerId: userId },
      { $setOnInsert: { providerId: userId, websiteId: website._id } },
      { upsert: true, new: true }
    );

    return website;
  }

  parsePayload(rawPayload = {}) {
    if (typeof rawPayload?.payload === 'string') {
      try {
        return JSON.parse(rawPayload.payload);
      } catch (error) {
        throw new Error('Invalid website manager payload');
      }
    }
    return rawPayload || {};
  }

  normalizeBusinessHours(hours = []) {
    const source = Array.isArray(hours) && hours.length > 0 ? hours : DEFAULT_BUSINESS_HOURS;
    return source.map((item, index) => ({
      day: cleanString(item.day) || DEFAULT_BUSINESS_HOURS[index]?.day || '',
      isOpen: cleanBoolean(item.isOpen, true),
      openTime: normalizeTimeForStorage(item.openTime),
      closeTime: normalizeTimeForStorage(item.closeTime),
      breakStartTime: normalizeTimeForStorage(item.breakStartTime),
      breakEndTime: normalizeTimeForStorage(item.breakEndTime)
    })).slice(0, 7);
  }

  normalizeBookingSlots(slots = []) {
    const source = Array.isArray(slots) && slots.length > 0 ? slots : DEFAULT_BOOKING_SLOTS;
    return source
      .map((item) => ({
        label: cleanString(item.label),
        startTime: cleanString(item.startTime),
        endTime: cleanString(item.endTime),
        isActive: cleanBoolean(item.isActive, true)
      }))
      .filter((item) => item.label || item.startTime || item.endTime)
      .slice(0, 12);
  }

  normalizeExtraChargeRules(rules = {}) {
    const convenience = rules.convenience || rules.distance || {};
    const night = rules.night || {};
    const emergency = rules.emergency || {};
    return {
      convenience: {
        enabled: cleanBoolean(convenience.enabled, false),
        freeKm: cleanNumber(convenience.freeKm ?? convenience.startsAfterKm, 0),
        perKm: cleanNumber(convenience.perKm ?? convenience.amountPerKm, 0),
        waiveOrderAbove: cleanNumber(convenience.waiveOrderAbove ?? convenience.waiveAboveAmount, 0),
        waiveDistanceKm: cleanNumber(convenience.waiveDistanceKm, 0)
      },
      night: {
        enabled: cleanBoolean(night.enabled, false),
        startTime: cleanString(night.startTime),
        endTime: cleanString(night.endTime),
        amount: cleanNumber(night.amount, 0),
        waiveOrderAbove: cleanNumber(night.waiveOrderAbove ?? night.waiveAboveAmount, 0)
      },
      emergency: {
        enabled: cleanBoolean(emergency.enabled, false),
        windowMinutes: clampNumber(emergency.windowMinutes ?? emergency.applyWithinMinutes, 120, 0, 43200),
        amount: cleanNumber(emergency.amount, 0),
        waiveOrderAbove: cleanNumber(emergency.waiveOrderAbove ?? emergency.waiveAboveAmount, 0)
      },
      note: cleanString(rules.note)
    };
  }

  normalizeBookingClosedDates(dates = []) {
    return cleanArray(dates)
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
      .slice(0, 60);
  }

  normalizeBookingClosedDateDetails(items = []) {
    const source = Array.isArray(items) ? items : cleanArray(items).map((date) => ({ date }));
    const seen = new Map();
    source.forEach((item) => {
      const date = cleanString(typeof item === 'string' ? item : item?.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return;
      }
      seen.set(date, {
        date,
        reason: cleanString(typeof item === 'string' ? '' : item?.reason)
      });
    });
    return Array.from(seen.values())
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, 60);
  }

  normalizeFaqs(faqs = []) {
    return (Array.isArray(faqs) ? faqs : [])
      .map((item, index) => ({
        question: cleanString(item.question),
        answer: cleanString(item.answer),
        sortOrder: cleanNumber(item.sortOrder, index)
      }))
      .filter((item) => item.question && item.answer)
      .slice(0, 20);
  }

  normalizeTestimonials(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        authorName: cleanString(item.authorName),
        authorRole: cleanString(item.authorRole),
        rating: Math.min(Math.max(cleanNumber(item.rating, 5), 1), 5),
        quote: cleanString(item.quote),
        isPinned: cleanBoolean(item.isPinned, false)
      }))
      .filter((item) => item.authorName && item.quote)
      .slice(0, 12);
  }

  normalizeServices(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const serviceId = cleanString(item.id || item._id);
        return {
          ...(isValidObjectIdString(serviceId) ? { _id: serviceId } : {}),
          title: cleanString(item.title),
          shortDescription: cleanString(item.shortDescription),
          fullDescription: cleanString(item.fullDescription),
          category: cleanString(item.category),
          priceType: ['fixed', 'starting', 'custom', 'on-request'].includes(cleanString(item.priceType)) ? cleanString(item.priceType) : 'on-request',
          price: cleanNumber(item.price, 0),
          unit: cleanString(item.unit),
          image: cleanString(item.image),
          isFeatured: cleanBoolean(item.isFeatured, false),
          isActive: cleanBoolean(item.isActive, true),
          availableForBooking: cleanBoolean(item.availableForBooking, true),
          bookingDurationMinutes: clampNumber(item.bookingDurationMinutes, 0, 0, 480),
          bookingGapMinutes: clampNumber(item.bookingGapMinutes, 0, 0, 240),
          bookingCapacity: clampNumber(item.bookingCapacity, 0, 0, 100),
          bookingConfirmationType: ['', 'auto_confirm', 'provider_approval'].includes(cleanString(item.bookingConfirmationType))
            ? cleanString(item.bookingConfirmationType)
            : '',
          sortOrder: cleanNumber(item.sortOrder, index)
        };
      })
      .filter((item) => item.title);
  }

  normalizeProducts(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item) => ({
        title: cleanString(item.title),
        description: cleanString(item.description),
        price: cleanNumber(item.price, 0),
        discountedPrice: cleanNumber(item.discountedPrice, 0),
        image: cleanString(item.image),
        gallery: normalizeGallery(item.gallery),
        stockStatus: ['in-stock', 'low-stock', 'out-of-stock', 'made-to-order'].includes(cleanString(item.stockStatus)) ? cleanString(item.stockStatus) : 'in-stock',
        isActive: cleanBoolean(item.isActive, true),
        category: cleanString(item.category)
      }))
      .filter((item) => item.title);
  }

  normalizeOffers(items = []) {
    return (Array.isArray(items) ? items : [])
      .map((item, index) => {
        const kind = cleanString(item.kind) === 'offer' ? 'offer' : 'banner';
        const title = cleanString(item.title);
        const fallbackCode = `${slugify(title || `OFFER${index + 1}`).replace(/-/g, '').toUpperCase().slice(0, 10)}${String(index + 1).padStart(2, '0')}`;
        const offerCode = normalizeOfferCode(item.offerCode) || (kind === 'offer' ? fallbackCode : '');
        return {
          kind,
          title,
          description: cleanString(item.description),
          bannerImage: cleanString(item.bannerImage),
          badgeText: cleanString(item.badgeText),
          discountText: cleanString(item.discountText),
          offerCode,
          linkedOfferCode: normalizeOfferCode(item.linkedOfferCode),
          applicableServiceIds: cleanArray(item.applicableServiceIds),
          minQuantity: Math.max(1, cleanNumber(item.minQuantity, 1)),
          discountType: cleanString(item.discountType) === 'amount' ? 'amount' : 'percent',
          discountValue: Math.max(0, cleanNumber(item.discountValue, 0)),
          paymentOnly: cleanBoolean(item.paymentOnly, true),
          startDate: item.startDate || null,
          endDate: item.endDate || null,
          isActive: cleanBoolean(item.isActive, true),
          placement: ['hero', 'offers', 'both'].includes(cleanString(item.placement)) ? cleanString(item.placement) : 'hero',
          preset: cleanString(item.preset)
        };
      })
      .filter((item) => item.title);
  }

  normalizeArticles(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const baseSlug = slugify(item.slug || item.title);
        let candidate = baseSlug || `article-${seen.size + 1}`;
        let suffix = 2;
        while (seen.has(candidate)) {
          candidate = `${baseSlug}-${suffix}`;
          suffix += 1;
        }
        seen.add(candidate);
        return {
          title: cleanString(item.title),
          slug: candidate,
          summary: cleanString(item.summary),
          content: cleanString(item.content),
          coverImage: cleanString(item.coverImage),
          status: cleanString(item.status) === 'published' ? 'published' : 'draft',
          publishedAt: cleanString(item.status) === 'published' ? new Date() : null
        };
      })
      .filter((item) => item.title);
  }

  computeCompletion({ website, services = [] }) {
    let score = 0;
    const checklist = [];

    const hasBusinessInfo = Boolean(website.businessName && website.category);
    checklist.push({ id: 'business-info', label: 'Business name and category added', completed: hasBusinessInfo });
    if (hasBusinessInfo) score += 25;

    const hasContactInfo = Boolean(isValidIndianPhone(website.phone) && website.email);
    checklist.push({ id: 'contact-info', label: 'Contact details completed', completed: hasContactInfo });
    if (hasContactInfo) score += 20;

    const hasAddressInfo = Boolean(website.address && website.city && website.state && website.pincode);
    checklist.push({ id: 'address-info', label: 'Address, city, state, and pincode added', completed: hasAddressInfo });
    if (hasAddressInfo) score += 10;

    const hasServiceAreas = Array.isArray(website.serviceAreas) && website.serviceAreas.length > 0;
    checklist.push({ id: 'service-areas', label: 'Service areas selected', completed: hasServiceAreas });
    if (hasServiceAreas) score += 10;

    const hasEnoughServices = services.filter((item) => item.isActive !== false).length >= 1;
    checklist.push({ id: 'services', label: 'Added at least 1 service', completed: hasEnoughServices });
    if (hasEnoughServices) score += 20;

    const hasGallery = (website.gallery || []).length > 0;
    checklist.push({ id: 'gallery', label: 'Gallery photos added (optional)', completed: hasGallery, required: false });
    if (hasGallery) score += 10;

    const hasHours = (website.businessHours || []).some((item) => item.isOpen && item.openTime && item.closeTime);
    checklist.push({ id: 'hours', label: 'Business hours configured', completed: hasHours });
    if (hasHours) score += 10;

    const hasCtas = website.callEnabled || website.whatsappEnabled || website.inquiryFormEnabled;
    checklist.push({ id: 'cta', label: 'Lead CTA enabled', completed: hasCtas });
    if (hasCtas) score += 10;

    const hasSlug = Boolean(website.slug);
    checklist.push({ id: 'slug', label: 'Public page slug set', completed: hasSlug });
    if (hasSlug) score += 10;

    const hasHeroImage = Boolean(website.heroImage);
    checklist.push({ id: 'hero-image', label: 'Hero image uploaded (optional)', completed: hasHeroImage, required: false });
    if (hasHeroImage) score += 5;

    return {
      score: Math.min(score, 100),
      checklist,
      suggestions: checklist.filter((item) => !item.completed).map((item) => this.toSuggestion(item.id))
    };
  }

  toSuggestion(id) {
    const suggestions = {
      'business-info': 'Add your business name and category to help customers understand your work.',
      'contact-info': 'Complete your business phone and email so customers can reach you.',
      'address-info': 'Add address, city, state, and pincode so customers know your location.',
      'service-areas': 'Select service areas or All over India so customers know where you work.',
      services: 'Add at least 1 service so customers know what you offer.',
      gallery: 'Add gallery photos when you have them to improve trust and conversion.',
      hours: 'Set your business hours to reduce missed leads.',
      cta: 'Enable call, WhatsApp, or inquiry form to capture leads.',
      slug: 'Set your slug so your business page is easy to share.',
      'hero-image': 'Upload a hero image when you want the page to look more complete.'
    };
    return suggestions[id] || 'Complete more setup details to improve your business page.';
  }

  ensurePublishReady(website, services = []) {
    const completion = this.computeCompletion({ website, services });
    const missing = completion.checklist.filter((item) => item.required !== false && !item.completed);
    if (missing.length === 0) {
      return;
    }

    const requiredLabels = missing.slice(0, 4).map((item) => item.label.toLowerCase());
    throw new Error(`Finish these before publishing: ${requiredLabels.join(', ')}`);
  }

  async buildWebsiteUpiQrCode(website = {}) {
    const upiId = cleanString(website.upiId);
    if (!upiId) {
      return '';
    }

    const amount = resolveBookingPaymentDue(website, {}, website.bookingFlow || {});
    const upiUri = websitePaymentService.buildUpiUri({
      upiId,
      payeeName: website.businessName || 'Provider',
      amount,
      note: `${website.businessName || 'Website'} booking payment`
    });
    return upiUri ? QRCode.toDataURL(upiUri, { margin: 1, width: 240 }) : '';
  }

  async replaceCollection(Model, website, userId, items) {
    await Model.deleteMany({ websiteId: website._id });
    if (!items.length) {
      return;
    }
    await Model.insertMany(items.map((item) => ({
      ...item,
      providerId: userId,
      websiteId: website._id
    })));
  }

  async replaceArticles(website, userId, items) {
    await ProviderArticle.deleteMany({ websiteId: website._id });
    if (!items.length) {
      return;
    }
    await ProviderArticle.insertMany(items.map((item) => ({
      ...item,
      providerId: userId,
      websiteId: website._id
    })));
  }

  async upsertThemeConfig(userId, websiteId, payload = {}) {
    await ProviderThemeConfig.findOneAndUpdate(
      { providerId: userId },
      {
        $set: {
          providerId: userId,
          websiteId,
          themeName: cleanString(payload.themeName) || 'trust-blue',
          primaryColor: cleanString(payload.primaryColor) || '#1d4ed8',
          accentColor: cleanString(payload.accentColor) || '#f59e0b',
          layoutStyle: ['classic', 'spotlight', 'compact'].includes(cleanString(payload.layoutStyle)) ? cleanString(payload.layoutStyle) : 'classic',
          showStickyMobileCTA: cleanBoolean(payload.showStickyMobileCTA, true),
          cardStyle: ['rounded', 'soft', 'minimal'].includes(cleanString(payload.cardStyle)) ? cleanString(payload.cardStyle) : 'rounded',
          bannerStyle: ['solid', 'gradient', 'split'].includes(cleanString(payload.bannerStyle)) ? cleanString(payload.bannerStyle) : 'gradient'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async upsertSeoConfig(userId, websiteId, payload = {}, slug = '') {
    await ProviderSEOConfig.findOneAndUpdate(
      { providerId: userId },
      {
        $set: {
          providerId: userId,
          websiteId,
          metaTitle: cleanString(payload.metaTitle),
          metaDescription: cleanString(payload.metaDescription),
          keywords: cleanArray(payload.keywords),
          canonicalUrl: cleanString(payload.canonicalUrl) || (slug ? `/business/${slug}` : ''),
          schemaType: cleanString(payload.schemaType) || 'LocalBusiness'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async ensureSlugAvailable(slug, userId, websiteId) {
    const [growthConflict, websiteConflict] = await Promise.all([
      ProviderGrowth.exists({ websiteSlug: slug, user: { $ne: userId } }),
      ProviderWebsite.exists({ slug, _id: { $ne: websiteId } })
    ]);

    if (growthConflict || websiteConflict) {
      throw new Error('That public business URL is already taken');
    }
  }

  async checkSlugAvailability(userId, rawSlug = '') {
    const slug = slugify(rawSlug);
    if (!slug) {
      return {
        slug: '',
        available: false,
        message: 'Enter a public business URL slug'
      };
    }

    const website = await this.getOrCreateWebsite(userId);
    const ownSlug = cleanString(website.slug);
    if (slug === ownSlug) {
      return {
        slug,
        available: true,
        current: true,
        message: 'This is your current public URL'
      };
    }

    const [growthConflict, websiteConflict] = await Promise.all([
      ProviderGrowth.exists({ websiteSlug: slug, user: { $ne: userId } }),
      ProviderWebsite.exists({ slug, _id: { $ne: website._id } })
    ]);

    const available = !(growthConflict || websiteConflict);
    return {
      slug,
      available,
      current: false,
      message: available ? 'This public URL is available' : 'That public business URL is already taken'
    };
  }

  async syncWebsiteSlug(userId, website, state, slug) {
    website.slug = slug;
    state.websiteSlug = slug;
    await Promise.all([website.save(), state.save()]);
  }

  async getOrCreateSlug(userId, website, state, seedValue = '') {
    const existing = cleanString(website.slug || state.websiteSlug);
    if (existing) {
      if (website.slug !== existing || state.websiteSlug !== existing) {
        await this.syncWebsiteSlug(userId, website, state, existing);
      }
      return existing;
    }

    const user = await User.findById(userId).lean();
    const base = slugify(seedValue)
      || slugify(user?.fullName || '')
      || `business-${String(userId).slice(-6)}`;
    let candidate = base;
    let suffix = 2;

    while (
      await ProviderWebsite.exists({ slug: candidate, _id: { $ne: website._id } })
      || await ProviderGrowth.exists({ websiteSlug: candidate, user: { $ne: userId } })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    await this.syncWebsiteSlug(userId, website, state, candidate);
    return candidate;
  }

  async getReviewSummary(userId) {
    const profile = await ProfessionalProfile.findOne({ user: userId }).select('_id');
    if (!profile) {
      return { averageRating: 0, totalReviews: 0, reviews: [] };
    }

    const reviews = await Review.find({ professional: profile._id }).populate('user').sort({ createdAt: -1 }).limit(10);
    const stats = await Review.aggregate([
      { $match: { professional: profile._id } },
      { $group: { _id: '$professional', averageRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } }
    ]);
    const summary = stats[0] || { averageRating: 0, totalReviews: 0 };
    return {
      averageRating: Number(Number(summary.averageRating || 0).toFixed(1)),
      totalReviews: Number(summary.totalReviews || 0),
      reviews: reviews.map((item) => ({
        id: item._id.toString(),
        rating: item.rating,
        comment: item.comment,
        customerName: item.user?.fullName || 'Customer',
        createdAt: item.createdAt
      }))
    };
  }

  async buildManagerResponse(userId, websiteDoc, options = {}) {
    const website = websiteDoc.toObject ? websiteDoc.toObject() : websiteDoc;
    const [themeConfig, seoConfig, services, products, offers, articles, leads, bookings, orders, transactions, profile, user, reviewSummary, leadCount, bookingCount, inquiryCount, callbackCount, templateMedia] = await Promise.all([
      ProviderThemeConfig.findOne({ providerId: userId }).lean(),
      ProviderSEOConfig.findOne({ providerId: userId }).lean(),
      ProviderServiceModel.find({ providerId: userId }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
      ProviderProduct.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderOffer.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderArticle.find({ providerId: userId }).sort({ createdAt: -1 }).lean(),
      ProviderLead.find({ providerId: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      ProviderBooking.find({ providerId: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      ProviderProductOrder.find({ providerId: userId }).sort({ createdAt: -1 }).limit(30).lean(),
      WebsiteTransaction.find({ providerId: userId }).sort({ createdAt: -1 }).limit(60).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      User.findById(userId).lean(),
      options.reviewSummary ? Promise.resolve(options.reviewSummary) : this.getReviewSummary(userId),
      ProviderLead.countDocuments({ providerId: userId }),
      ProviderBooking.countDocuments({ providerId: userId }),
      ProviderLead.countDocuments({ providerId: userId, source: { $in: ['website', 'inquiry'] } }),
      ProviderLead.countDocuments({ providerId: userId, source: 'callback' }),
      websiteTemplateMediaService.listForProvider()
    ]);

    const completion = options.completion || this.computeCompletion({ website, services });
    const publicPath = website.slug ? `/business/${website.slug}` : '';
    const draftPreviewPath = website.slug ? `/business/preview/${website.slug}` : '';
    const canOpenLivePage = website.status === 'published' && Boolean(website.isPurchased);
    const livePublicPath = canOpenLivePage ? publicPath : '';
    const qrCodeDataUrl = publicPath
      ? await QRCode.toDataURL(`https://karya.local${publicPath}`, { margin: 1, width: 180 })
      : '';
    const upiQrCodeImage = website.upiQrCodeSource === 'custom' && website.upiQrCodeImage
      ? website.upiQrCodeImage
      : await this.buildWebsiteUpiQrCode(website);

    return {
      providerId: userId,
      managerName: 'Business Website Manager',
      isPurchased: Boolean(website.isPurchased),
      canPublish: Boolean(website.isPurchased),
      status: website.status || 'draft',
      publicPath,
      draftPreviewPath,
      livePublicPath,
      canOpenLivePage,
      legacyPublicPath: website.slug ? `/provider/site/${website.slug}` : '',
      publicUrl: publicPath ? `https://karya.local${publicPath}` : '',
      qrCodeDataUrl,
      completionScore: completion.score,
      checklist: completion.checklist,
      suggestions: completion.suggestions,
      stats: {
        inquiriesCount: inquiryCount,
        callbacksCount: callbackCount,
        leadsCount: leadCount,
        bookingsCount: bookingCount,
        viewsCount: Number(profile?.viewCount || 0),
        serviceCount: services.length,
        productCount: products.length,
        articleCount: articles.length
      },
      verification: {
        status: cleanString((await ProviderGrowth.findOne({ user: userId }).lean())?.verification?.status || 'not_started'),
        badgeActive: providerGrowthService.hasVerificationBadge(await providerGrowthService.getOrCreateState(userId))
      },
      website: {
        ...website,
        upiQrCodeImage,
        bookingFlow: normalizeBookingFlowForWebsite(website),
        productFlow: websitePaymentService.normalizeFlowConfig(website.productFlow || {}, {
          enabled: website.productsEnabled,
          paymentModel: 'without-online-payment',
          paymentMethods: website.upiId ? ['manual-upi'] : [],
          gatewayFeeBearer: 'customer',
          chargeAmount: 0,
          paymentInstructions: website.paymentInstructions || ''
        }),
        gatewayMeta: websitePaymentService.buildGatewayMeta(),
        phone: website.phone || cleanString(user?.mobile),
        email: website.email || cleanString(user?.email),
        category: website.category || cleanString(profile?.profession)
      },
      services: services.map((item) => ({ ...item, id: item._id.toString() })),
      products: products.map((item) => ({ ...item, id: item._id.toString() })),
      offers: offers.map((item) => ({ ...item, id: item._id.toString() })),
      articles: articles.map((item) => ({ ...item, id: item._id.toString() })),
      leads: leads.map((item) => ({ ...item, id: item._id.toString() })),
      bookings: bookings.map((item) => this.serializeBooking(item)),
      orders: orders.map((item) => ({ ...item, id: item._id.toString() })),
      transactions: transactions.map((item) => this.serializeTransaction(item)),
      themeConfig: themeConfig || {},
      seoConfig: seoConfig || {},
      templateMedia,
      reviewSummary,
      voiceReady: {
        descriptionPromptSeed: [website.businessName, website.category, website.city].filter(Boolean).join(' | '),
        aiHooks: ['descriptionDraft', 'serviceTagSuggestion', 'voiceProfileImport']
      }
    };
  }

  async buildPublicResponse(userId, websiteSeed = null) {
    const website = websiteSeed || await ProviderWebsite.findOne({ providerId: userId }).lean();
    if (!website) {
      return null;
    }

    const [themeConfig, seoConfig, services, products, offers, articles, profile, user, reviewSummary, state] = await Promise.all([
      ProviderThemeConfig.findOne({ providerId: userId }).lean(),
      ProviderSEOConfig.findOne({ providerId: userId }).lean(),
      ProviderServiceModel.find({ providerId: userId, isActive: true }).sort({ isFeatured: -1, sortOrder: 1, createdAt: 1 }).lean(),
      ProviderProduct.find({ providerId: userId, isActive: true }).sort({ createdAt: -1 }).lean(),
      ProviderOffer.find({ providerId: userId, isActive: true }).sort({ createdAt: -1 }).lean(),
      ProviderArticle.find({ providerId: userId, status: 'published' }).sort({ publishedAt: -1, createdAt: -1 }).lean(),
      ProfessionalProfile.findOne({ user: userId }).lean(),
      User.findById(userId).lean(),
      this.getReviewSummary(userId),
      providerGrowthService.getOrCreateState(userId)
    ]);

    const activeOffers = offers;

    const responseTime = reviewSummary.totalReviews > 4 ? 'Usually replies within 30 minutes' : 'Usually replies within a few hours';
    const bookingSuccess = `${Math.min(90 + Math.floor((reviewSummary.totalReviews || 0) / 2), 99)}% booking response`;
    const upiQrCodeImage = website.upiQrCodeSource === 'custom' && website.upiQrCodeImage
      ? website.upiQrCodeImage
      : await this.buildWebsiteUpiQrCode(website);

    return {
      id: website._id.toString(),
      providerId: userId,
      fullName: user?.fullName || '',
      mobile: cleanString(user?.mobile),
      email: cleanString(user?.email),
      profilePicture: cleanString(profile?.profilePicture),
      profession: cleanString(profile?.profession),
      description: cleanString(profile?.description),
      averageRating: reviewSummary.averageRating,
      reviewCount: reviewSummary.totalReviews,
      viewCount: Number(profile?.viewCount || 0),
      isVerifiedProvider: providerGrowthService.hasVerificationBadge(state),
      websiteActive: true,
      websiteSlug: website.slug,
      tags: website.tags || [],
      serviceAreas: website.serviceAreas || [],
      location: [website.city, website.state].filter(Boolean).join(', '),
      city: website.city || cleanString(profile?.city),
      state: website.state || cleanString(profile?.state),
      country: cleanString(profile?.country || 'India'),
      area: cleanString(profile?.area),
      addressLine: website.address || cleanString(profile?.addressLine),
      pincode: website.pincode || cleanString(profile?.pincode),
      website: {
        ...website,
        upiQrCodeImage,
        publicPath: website.slug ? `/business/${website.slug}` : '',
        legacyPublicPath: website.slug ? `/provider/site/${website.slug}` : '',
        inquiryEndpoint: `/api/professional/website/${website.slug}/inquiries`,
        bookingEndpoint: `/api/professional/website/${website.slug}/bookings`,
        orderEndpoint: `/api/professional/website/${website.slug}/orders`,
        services,
        products,
        offers: activeOffers,
        articles,
        reviews: reviewSummary.reviews,
        reviewSummary: {
          averageRating: reviewSummary.averageRating,
          totalReviews: reviewSummary.totalReviews
        },
        themeConfig: themeConfig || {},
        seoConfig: seoConfig || {},
        trustIndicators: [
          { label: 'Experience', value: `${website.yearsOfExperience || profile?.experience || 0}+ years` },
          { label: 'Response time', value: responseTime },
          { label: 'Booking success', value: bookingSuccess }
        ],
        advanceFeeRequired: hasAdvanceBookingFee(website),
        advanceFeeAmount: Number(website.bookingFeeAmount || 0),
        paymentInstructions: website.paymentInstructions || '',
        bookingFlow: normalizeBookingFlowForWebsite(website),
        productFlow: websitePaymentService.normalizeFlowConfig(website.productFlow || {}, {
          enabled: website.productsEnabled,
          paymentModel: 'without-online-payment',
          paymentMethods: website.upiId ? ['manual-upi'] : [],
          gatewayFeeBearer: 'customer',
          chargeAmount: 0,
          paymentInstructions: website.paymentInstructions || ''
        }),
        gatewayMeta: websitePaymentService.buildGatewayMeta(),
        qrCodeDataUrl: website.slug
          ? await QRCode.toDataURL(`https://karya.local/business/${website.slug}`, { margin: 1, width: 180 })
          : ''
      }
    };
  }

  serializeTransaction(item) {
    if (!item) {
      return null;
    }
    return {
      ...item,
      id: item._id?.toString?.() || String(item.id || ''),
      contextId: item.contextId?.toString?.() || String(item.contextId || ''),
      providerId: item.providerId?.toString?.() || String(item.providerId || ''),
      websiteId: item.websiteId?.toString?.() || String(item.websiteId || ''),
      customerUserId: item.customerUserId?.toString?.() || String(item.customerUserId || '')
    };
  }

  serializeBooking(item) {
    const { serviceProofOtpHash, serviceProofOtpCode, ...booking } = item || {};
    return {
      ...booking,
      id: item?._id?.toString?.() || String(item?.id || '')
    };
  }

  requiresBookingProofOtp(booking, transaction = null) {
    const amount = cleanNumber(transaction?.amountBreakdown?.totalAmount || booking?.advanceFeeAmount, 0);
    const status = cleanString(transaction?.paymentStatus || booking?.paymentStatus);
    return amount > 0 && ['paid', 'refunded'].includes(status || 'paid') && cleanString(booking?.serviceProofOtpHash);
  }

  verifyBookingProofOtp(booking, otpValue) {
    if (!cleanString(booking?.serviceProofOtpHash)) {
      throw new Error('Booking completion OTP is not available. Ask the customer to contact support.');
    }
    const otp = cleanString(otpValue);
    if (!/^\d{6}$/.test(otp) || hashBookingOtp(otp) !== cleanString(booking.serviceProofOtpHash)) {
      throw new Error('Enter the valid 6-digit OTP shared by the customer.');
    }
    booking.serviceProofOtpVerifiedAt = new Date();
  }

  async resendBookingProofOtp(providerUserId, bookingId) {
    const booking = await ProviderBooking.findOne({ _id: bookingId, providerId: providerUserId });
    if (!booking) {
      throw new Error('Booking not found');
    }

    const transaction = booking.transactionId ? await WebsiteTransaction.findById(booking.transactionId) : null;
    const amount = cleanNumber(transaction?.amountBreakdown?.totalAmount || booking.advanceFeeAmount, 0);
    const paymentStatus = cleanString(transaction?.paymentStatus || booking.paymentStatus);
    if (amount <= 0 || !['paid', 'refunded'].includes(paymentStatus)) {
      throw new Error('OTP is available only for paid bookings that need customer approval.');
    }

    const otp = generateBookingOtp();
    booking.serviceProofOtpHash = hashBookingOtp(otp);
    booking.serviceProofOtpCode = otp;
    booking.serviceProofOtpGeneratedAt = new Date();
    booking.serviceProofOtpVerifiedAt = null;
    await booking.save();

    const mailed = await this.sendBookingProofOtpEmail(providerUserId, booking, transaction, otp);
    if (!mailed) {
      throw new Error('OTP could not be emailed. Check the customer email address or email configuration.');
    }

    return this.getManager(providerUserId);
  }

  async sendBookingProofOtpEmail(providerUserId, booking, transaction = null, serviceProofOtp = '') {
    const [provider, website, customerUser] = await Promise.all([
      User.findById(providerUserId).lean(),
      booking?.websiteId ? ProviderWebsite.findById(booking.websiteId).lean() : Promise.resolve(null),
      booking?.customerUserId ? User.findById(booking.customerUserId).select('email').lean() : Promise.resolve(null)
    ]);
    const customerEmail = cleanString(booking.customerEmail) || cleanString(customerUser?.email);
    if (!customerEmail || !cleanString(serviceProofOtp)) {
      return false;
    }

    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const businessName = website?.businessName || providerName;
    const bookingWhen = [booking.bookingDate, booking.bookingTime].filter(Boolean).join(', ');
    const offerInfo = await this.getBookingOfferInfo(booking);
    await receiptEmailService.sendReceipt({
      to: [customerEmail],
      subject: `Your booking OTP - ${businessName}`,
      replyTo: cleanString(provider?.email),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
          <h2 style="margin:0 0 12px">Booking OTP</h2>
          <p>Hello ${escapeHtml(booking.customerName || 'there')},</p>
          <p>Your OTP for <strong>${escapeHtml(businessName)}</strong> has been resent.</p>
          <div style="margin:14px 0;padding:12px;border:1px solid #f5c542;background:#fff8e1;border-radius:8px">
            <p style="margin:0 0 6px"><strong>Service proof OTP: ${escapeHtml(serviceProofOtp)}</strong></p>
            <p style="margin:0;color:#7a4b00">Share this OTP with the provider only after the service is completed, or when you approve a paid booking reschedule, cancellation, or refund.</p>
          </div>
          <p style="margin:4px 0">Booking ID: <strong>${escapeHtml(bookingPublicReference(booking))}</strong></p>
          <p style="margin:4px 0">Service: <strong>${escapeHtml(booking.serviceTitle || transaction?.contextLabel || 'Website booking')}</strong></p>
          <p style="margin:4px 0">Date & time: <strong>${escapeHtml(bookingWhen || '-')}</strong></p>
          <p style="margin:4px 0">Units: <strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></p>
          ${bookingOfferEmailHtml(offerInfo, booking)}
        </div>
      `
    });
    return true;
  }

  async getBookingOfferInfo(booking) {
    const code = normalizeOfferCode(booking?.offerCode);
    if (!code) {
      return null;
    }
    return ProviderOffer.findOne({
      providerId: booking.providerId,
      websiteId: booking.websiteId,
      kind: 'offer',
      offerCode: code
    }).lean();
  }

  async sendBookingCreatedEmails(providerUserId, booking, transaction = null, websiteSeed = null, serviceProofOtp = '') {
    const [provider, website, customerUser] = await Promise.all([
      User.findById(providerUserId).lean(),
      websiteSeed ? Promise.resolve(websiteSeed) : booking?.websiteId ? ProviderWebsite.findById(booking.websiteId).lean() : Promise.resolve(null),
      booking?.customerUserId ? User.findById(booking.customerUserId).select('email').lean() : Promise.resolve(null)
    ]);
    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const businessName = website?.businessName || providerName;
    const bookingId = bookingPublicReference(booking);
    const bookingWhen = [booking.bookingDate, booking.bookingTime].filter(Boolean).join(', ');
    const paymentLine = transaction
      ? `${paymentMethodLabel(transaction.paymentChannel)} - ${cleanString(transaction.paymentStatus) || 'pending'}`
      : 'Pay later';
    const paymentIdLine = transaction?.manualPayment?.payerTransactionId
      ? `<p style="margin:4px 0">Payment ID: <strong>${escapeHtml(transaction.manualPayment.payerTransactionId)}</strong></p>`
      : '';
    const otpLine = cleanString(serviceProofOtp)
      ? `<div style="margin:14px 0;padding:12px;border:1px solid #f5c542;background:#fff8e1;border-radius:8px"><p style="margin:0 0 6px"><strong>Service proof OTP: ${escapeHtml(serviceProofOtp)}</strong></p><p style="margin:0;color:#7a4b00">Share this OTP with the provider only after the service is completed, or when you approve a paid booking reschedule, cancellation, or refund.</p></div>`
      : '';
    const businessUrl = buildBusinessUrl(website);
    const offerInfo = await this.getBookingOfferInfo(booking);

    const customerEmail = cleanString(booking.customerEmail) || cleanString(customerUser?.email);

    if (customerEmail) {
      await receiptEmailService.sendReceipt({
        to: [customerEmail],
        subject: `Booking request received - ${businessName}`,
        replyTo: cleanString(provider?.email),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
            <h2 style="margin:0 0 12px">Booking request received</h2>
            <p>Hello ${escapeHtml(booking.customerName || 'there')},</p>
            <p>Your booking request has been sent to <strong>${escapeHtml(businessName)}</strong>. The provider will review it and update you soon.</p>
            <p style="margin:4px 0">Booking ID: <strong>${escapeHtml(bookingId)}</strong></p>
            <p style="margin:4px 0">Service: <strong>${escapeHtml(booking.serviceTitle || 'Website booking')}</strong></p>
            <p style="margin:4px 0">Date & time: <strong>${escapeHtml(bookingWhen || '-')}</strong></p>
            <p style="margin:4px 0">Units: <strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></p>
            <p style="margin:4px 0">Payment mode/status: <strong>${escapeHtml(paymentLine)}</strong></p>
            ${bookingOfferEmailHtml(offerInfo, booking)}
            ${paymentIdLine}
            ${otpLine}
            <p style="margin:14px 0 0">Book more with this provider: <a href="${escapeHtml(businessUrl)}" style="color:#155dfc;text-decoration:none;font-weight:700">${escapeHtml(businessUrl)}</a></p>
          </div>
        `
      });
    }

    if (cleanString(provider?.email)) {
      await receiptEmailService.sendReceipt({
        to: [provider.email],
        subject: `New booking request - ${booking.customerName || 'Customer'}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.55;color:#1f2937">
            <h2 style="margin:0 0 12px">New booking request</h2>
            <p>Booking ID: <strong>${escapeHtml(bookingId)}</strong></p>
            <p>Customer: <strong>${escapeHtml(booking.customerName || '-')}</strong> ${booking.customerPhone ? `(${escapeHtml(booking.customerPhone)})` : ''}</p>
            <p>Service: <strong>${escapeHtml(booking.serviceTitle || 'Website booking')}</strong></p>
            <p>Date & time: <strong>${escapeHtml(bookingWhen || '-')}</strong></p>
            <p>Units: <strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></p>
            <p>Payment mode/status: <strong>${escapeHtml(paymentLine)}</strong></p>
            ${bookingOfferEmailHtml(offerInfo, booking)}
            ${paymentIdLine}
            <p>Open requests: <a href="${escapeHtml(`${frontendBaseUrl()}/provider/customer-requests?tab=bookings`)}" style="color:#155dfc;text-decoration:none;font-weight:700">Customer Requests</a></p>
          </div>
        `
      });
    }
  }

  async sendBookingReceiptCopy(providerUserId, booking, transaction, providerMessage = '') {
    if (!transaction?.receipt?.receiptNumber) {
      return false;
    }

    const [provider, website, customerUser] = await Promise.all([
      User.findById(providerUserId).lean(),
      booking?.websiteId ? ProviderWebsite.findById(booking.websiteId).lean() : Promise.resolve(null),
      booking?.customerUserId ? User.findById(booking.customerUserId).select('email').lean() : Promise.resolve(null)
    ]);
    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const receipt = toReceiptPayload(transaction, providerName);
    const offerInfo = await this.getBookingOfferInfo(booking);
    const customerEmail = cleanString(booking.customerEmail) || cleanString(customerUser?.email);
    const recipients = [
      customerEmail,
      cleanString(provider?.email)
    ].filter(Boolean);
    if (!customerEmail && !cleanString(provider?.email)) {
      return false;
    }

    const mailed = await receiptEmailService.sendReceipt({
      to: recipients,
      subject: `Receipt ${receipt.receiptNumber} - ${website?.businessName || providerName}`,
      replyTo: cleanString(provider?.email),
      attachments: [buildBookingReceiptPdfAttachment({
        receipt,
        booking,
        provider,
        website,
        statusLabel: cleanString(booking.status) || 'updated',
        providerMessage,
        offerInfo
      })],
      html: buildBookingReceiptEmailHtml({
        receipt,
        booking,
        provider,
        website,
        statusLabel: cleanString(booking.status) || 'updated',
        providerMessage,
        offerInfo
      })
    });

    if (mailed) {
      transaction.receipt.emailedAt = new Date();
      await transaction.save();
    }
    return mailed;
  }

  async sendBookingStatusUpdate(providerUserId, booking, transaction = null, status = '', providerMessage = '') {
    const statusLabels = {
      confirmed: 'confirmed',
      cancelled: 'cancelled',
      rejected: 'declined',
      rescheduled: 'rescheduled',
      completed: 'completed',
      payment_pending: 'waiting for payment',
      pending_approval: 'waiting for provider approval'
    };
    const statusLabel = statusLabels[cleanString(status)] || cleanString(status) || 'updated';
    const [provider, website, customerUser] = await Promise.all([
      User.findById(providerUserId).lean(),
      booking?.websiteId ? ProviderWebsite.findById(booking.websiteId).lean() : Promise.resolve(null),
      booking?.customerUserId ? User.findById(booking.customerUserId).select('email').lean() : Promise.resolve(null)
    ]);
    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const bookingWhen = [booking.bookingDate, booking.bookingTime].filter(Boolean).join(' ');
    const customerMessage = providerMessage || booking.providerMessage || booking.cancellationReason || booking.rescheduleMessage || '';
    const businessUrl = buildBusinessUrl(website);
    const providerSignupUrl = `${frontendBaseUrl()}/provider/register`;
    const hasPaidReceipt = transaction
      && cleanString(transaction.paymentStatus) === 'paid'
      && cleanString(transaction.paymentChannel) !== 'none';
    if (hasPaidReceipt) {
      transaction.receipt.receiptNumber = transaction.receipt.receiptNumber || websitePaymentService.buildReceiptNumber('BK');
      transaction.receipt.issuedAt = transaction.receipt.issuedAt || new Date();
      if (transaction.isModified && transaction.isModified()) {
        await transaction.save();
      }
    }
    const receipt = hasPaidReceipt ? toReceiptPayload(transaction, providerName) : null;
    const refundLine = booking.refundStatus && booking.refundStatus !== 'none'
      ? `<p>Refund status: <strong>${escapeHtml(booking.refundStatus)}</strong>${booking.refundAmount ? ` for Rs ${cleanNumber(booking.refundAmount, 0)}` : ''}</p>`
      : '';
    const completionBlock = cleanString(status) === 'completed'
      ? `
          <p style="margin:14px 0 0">Thank you for contacting us. I hope you liked our services. Please rate and review, and visit again.</p>
          <p style="margin:8px 0">Rate and review: <a href="${escapeHtml(`${businessUrl}#reviews`)}" style="color:#155dfc;text-decoration:none;font-weight:700">${escapeHtml(businessUrl)}</a></p>
          <p style="margin:8px 0">Want to become a provider? <a href="${escapeHtml(providerSignupUrl)}" style="color:#155dfc;text-decoration:none;font-weight:700">Sign up on Nasdiya</a></p>
        `
      : '';
    const offerInfo = await this.getBookingOfferInfo(booking);

    if (booking.customerUserId) {
      await notificationService.createNotification({
        userId: booking.customerUserId,
        type: 'booking',
        title: `Booking ${statusLabel}`,
        body: `Your booking with ${providerName} is ${statusLabel}.`,
        linkPath: website?.slug ? `/business/${website.slug}` : '',
        metadata: {
          bookingId: booking._id.toString(),
          providerId: providerUserId.toString(),
          status: cleanString(status)
        }
      });
    }

    const customerEmail = cleanString(booking.customerEmail) || cleanString(customerUser?.email);
    if (!customerEmail) {
      return;
    }

    const mailed = await receiptEmailService.sendReceipt({
      to: [customerEmail],
      subject: hasPaidReceipt
        ? `Receipt ${receipt.receiptNumber} - Booking ${statusLabel} - ${website?.businessName || providerName}`
        : `Booking ${statusLabel} - ${website?.businessName || providerName}`,
      replyTo: cleanString(provider?.email),
      attachments: hasPaidReceipt ? [buildBookingReceiptPdfAttachment({
        receipt,
        booking,
        provider,
        website,
        statusLabel,
        providerMessage: customerMessage,
        offerInfo
      })] : [],
      html: hasPaidReceipt ? buildBookingReceiptEmailHtml({
        receipt,
        booking,
        provider,
        website,
        statusLabel,
        providerMessage: customerMessage,
        offerInfo
      }) : `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
          <h2 style="margin-bottom:12px">Booking ${escapeHtml(statusLabel)}</h2>
          <p>Hello ${escapeHtml(booking.customerName || 'there')},</p>
          <p>Your booking with <strong>${escapeHtml(website?.businessName || providerName)}</strong> is <strong>${escapeHtml(statusLabel)}</strong>.</p>
          <p>Booking ID: <strong>${escapeHtml(bookingPublicReference(booking))}</strong></p>
          <p>Booking: <strong>${escapeHtml(booking.serviceTitle || 'Website booking')}</strong></p>
          <p>Date and time: <strong>${escapeHtml(bookingWhen)}</strong></p>
          <p>Units: <strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></p>
          <p>Payment: <strong>${escapeHtml(booking.paymentChoice === 'pay-later' ? 'Pay later' : booking.paymentStatus)}</strong></p>
          ${bookingOfferEmailHtml(offerInfo, booking)}
          ${transaction?.manualPayment?.payerTransactionId ? `<p>Payment ID: <strong>${escapeHtml(transaction.manualPayment.payerTransactionId)}</strong></p>` : ''}
          ${customerMessage ? `<p>Message from provider: ${escapeHtml(customerMessage)}</p>` : ''}
          ${refundLine}
          ${completionBlock}
        </div>
      `
    });
    if (mailed && hasPaidReceipt && !transaction.receipt.emailedAt) {
      transaction.receipt.emailedAt = new Date();
      await transaction.save();
    }
  }

  async sendBookingRefundEmail(providerUserId, booking, transaction, refundUpiId = '') {
    const [provider, website, customerUser] = await Promise.all([
      User.findById(providerUserId).lean(),
      booking?.websiteId ? ProviderWebsite.findById(booking.websiteId).lean() : Promise.resolve(null),
      booking?.customerUserId ? User.findById(booking.customerUserId).select('email').lean() : Promise.resolve(null)
    ]);
    const customerEmail = cleanString(booking.customerEmail) || cleanString(customerUser?.email);
    if (!customerEmail) {
      return false;
    }

    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const amount = cleanNumber(transaction?.refund?.amount || booking.refundAmount, 0);
    const reference = cleanString(transaction?.refund?.reference || booking.refundReference);
    const providerUpiId = cleanString(refundUpiId || transaction?.manualPayment?.upiId || website?.upiId);
    const bookingWhen = [booking.bookingDate, booking.bookingTime].filter(Boolean).join(' ');
    const offerInfo = await this.getBookingOfferInfo(booking);

    return receiptEmailService.sendReceipt({
      to: [customerEmail],
      subject: `Refund processed - ${website?.businessName || providerName}`,
      replyTo: cleanString(provider?.email),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
          <h2 style="margin-bottom:12px">Refund processed</h2>
          <p>Hello ${escapeHtml(booking.customerName || 'there')},</p>
          <p>Your refund for <strong>${escapeHtml(website?.businessName || providerName)}</strong> has been marked as processed.</p>
          <p>Booking ID: <strong>${escapeHtml(bookingPublicReference(booking))}</strong></p>
          <p>Booking: <strong>${escapeHtml(booking.serviceTitle || 'Website booking')}</strong></p>
          <p>Date and time: <strong>${escapeHtml(bookingWhen)}</strong></p>
          <p>Units: <strong>${escapeHtml(bookingUnitsLabel(booking))}</strong></p>
          ${bookingOfferEmailHtml(offerInfo, booking)}
          <p>Refund amount: <strong>Rs ${escapeHtml(String(amount))}</strong></p>
          ${reference ? `<p>Refund transaction ID: <strong>${escapeHtml(reference)}</strong></p>` : ''}
          ${providerUpiId ? `<p>Provider UPI ID: <strong>${escapeHtml(providerUpiId)}</strong></p>` : ''}
          ${transaction?.manualPayment?.payerTransactionId ? `<p>Original payment transaction ID: <strong>${escapeHtml(transaction.manualPayment.payerTransactionId)}</strong></p>` : ''}
          ${booking.refundNote ? `<p>Note: ${escapeHtml(booking.refundNote)}</p>` : ''}
        </div>
      `
    });
  }

  async sendReceiptEmails(providerUserId, transaction) {
    if (!transaction?.receipt?.receiptNumber) {
      return;
    }

    const [provider, website] = await Promise.all([
      User.findById(providerUserId).lean(),
      transaction.websiteId ? ProviderWebsite.findById(transaction.websiteId).lean() : Promise.resolve(null)
    ]);
    const recipients = [
      cleanString(transaction.customerEmail),
      cleanString(provider?.email)
    ].filter(Boolean);
    if (recipients.length === 0) {
      return;
    }

    const providerName = provider?.fullName || website?.businessName || 'Provider';
    const providerPhone = normalizeIndianPhone(website?.phone || provider?.mobile || provider?.phone);
    const receipt = toReceiptPayload(transaction, providerName);
    const mailed = await receiptEmailService.sendReceipt({
      to: recipients,
      subject: `Receipt ${receipt.receiptNumber} for ${receipt.contextLabel || 'Website payment'}`,
      html: `
        <div style="margin:0;background:#f3f6fb;padding:24px;font-family:Arial,sans-serif;color:#111827">
          <style>
            @media print {
              body { background: #fff !important; }
              .receipt-page { box-shadow: none !important; border: 1px solid #d0d5dd !important; }
            }
          </style>
          <div class="receipt-page" style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #d9e2ee;border-radius:14px;box-shadow:0 18px 45px rgba(15,23,42,.08);overflow:hidden">
            <div style="padding:24px 28px;border-bottom:1px solid #e4ebf5">
              <p style="margin:0 0 6px;color:#155dfc;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:12px">Nasdiya payment receipt</p>
              <h2 style="margin:0;color:#101828;font-size:24px">Payment receipt</h2>
              <p style="margin:8px 0 0;color:#667085;font-size:14px">Receipt number: <strong>${escapeHtml(receipt.receiptNumber)}</strong></p>
            </div>
            <div style="padding:22px 28px">
              <table style="width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #e4ebf5;border-radius:10px;overflow:hidden">
                <tbody>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085;width:38%">Reference ID</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.contextId)}</strong></td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Item</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.contextLabel || 'Website payment')}</strong></td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Customer</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.customerName || '-')}</strong>${receipt.customerPhone ? `<br><span>${escapeHtml(receipt.customerPhone)}</span>` : ''}</td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Payment method</td><td style="padding:12px 14px"><strong>${escapeHtml(paymentMethodLabel(receipt.paymentChannel))}</strong></td></tr>
                  ${receipt.paymentId ? `<tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Payment ID</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.paymentId)}</strong></td></tr>` : ''}
                  ${receipt.upiId ? `<tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Provider UPI ID</td><td style="padding:12px 14px"><strong>${escapeHtml(receipt.upiId)}</strong></td></tr>` : ''}
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Total paid</td><td style="padding:12px 14px"><strong style="font-size:18px">${formatInr(receipt.totalAmount)}</strong></td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Issued at</td><td style="padding:12px 14px"><strong>${escapeHtml(formatIndiaDateTime(receipt.issuedAt))}</strong></td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Provider</td><td style="padding:12px 14px"><strong>${escapeHtml(website?.businessName || receipt.providerName || 'Provider')}</strong>${providerPhone ? `<br><span>Mobile: ${escapeHtml(providerPhone)}</span>` : ''}</td></tr>
                  <tr><td style="padding:12px 14px;background:#f8fafc;color:#667085">Nasdiya</td><td style="padding:12px 14px">Book more services or create your own provider website at <a href="${escapeHtml(frontendBaseUrl())}" style="color:#155dfc;text-decoration:none;font-weight:700">Nasdiya</a>.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `
    });

    if (mailed) {
      transaction.receipt.emailedAt = new Date();
      await transaction.save();
    }
  }

  async buildPreviewResponse(userId, websiteSeed = null) {
    const response = await this.buildPublicResponse(userId, websiteSeed);
    if (!response) {
      return null;
    }

    return {
      ...response,
      isPreview: true,
      website: {
        ...response.website,
        isPreview: true,
        previewNote: 'This is your private draft preview. Customers cannot access it until you publish.'
      }
    };
  }
}

module.exports = new ProviderWebsiteService();
