const QRCode = require('qrcode');
const {
  WEBSITE_PAYMENT_MODELS,
  WEBSITE_PAYMENT_METHODS,
  WEBSITE_PAYMENT_FEE_BEARERS,
  WEBSITE_GATEWAY_FEE_PERCENT
} = require('../constants/websitePayments');

const cleanString = (value) => String(value || '').trim();
const cleanArray = (value) => Array.isArray(value) ? value.map((item) => cleanString(item)).filter(Boolean) : [];
const cleanNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const cleanBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};
const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

class WebsitePaymentService {
  normalizeFlowConfig(rawConfig = {}, defaults = {}) {
    const bookingModel = WEBSITE_PAYMENT_MODELS.includes(cleanString(rawConfig.paymentModel))
      ? cleanString(rawConfig.paymentModel)
      : (defaults.paymentModel || 'without-online-payment');
    const methods = cleanArray(rawConfig.paymentMethods).filter((item) => WEBSITE_PAYMENT_METHODS.includes(item));
    const feeBearer = WEBSITE_PAYMENT_FEE_BEARERS.includes(cleanString(rawConfig.gatewayFeeBearer))
      ? cleanString(rawConfig.gatewayFeeBearer)
      : (defaults.gatewayFeeBearer || 'customer');

    return {
      enabled: cleanBoolean(rawConfig.enabled, defaults.enabled !== false),
      paymentModel: bookingModel,
      paymentMethods: methods.length > 0 ? methods : cleanArray(defaults.paymentMethods),
      manualPaymentEnabled: methods.includes('manual-upi'),
      gatewayPaymentEnabled: methods.includes('gateway'),
      gatewayFeeBearer: feeBearer,
      gatewayFeePercent: WEBSITE_GATEWAY_FEE_PERCENT,
      paymentInstructions: cleanString(rawConfig.paymentInstructions || defaults.paymentInstructions),
      paymentLabel: cleanString(rawConfig.paymentLabel || defaults.paymentLabel),
      chargeAmount: Math.max(0, cleanNumber(rawConfig.chargeAmount, defaults.chargeAmount || 0))
    };
  }

  normalizeWebsitePaymentSettings(payload = {}, website = {}) {
    return {
      bookingFlow: this.normalizeFlowConfig(payload.bookingFlow, website.bookingFlow || {
        enabled: true,
        paymentModel: 'without-online-payment',
        paymentMethods: ['manual-upi'],
        gatewayFeeBearer: 'customer',
        chargeAmount: cleanNumber(payload.bookingFeeAmount, website.bookingFeeAmount || 0)
      }),
      productFlow: this.normalizeFlowConfig(payload.productFlow, website.productFlow || {
        enabled: cleanBoolean(payload.productsEnabled, website.productsEnabled),
        paymentModel: 'without-online-payment',
        paymentMethods: ['manual-upi'],
        gatewayFeeBearer: 'customer',
        chargeAmount: 0
      })
    };
  }

  isGatewayConfigured() {
    return Boolean(cleanString(process.env.WEBSITE_GATEWAY_PROVIDER) && cleanString(process.env.WEBSITE_GATEWAY_PUBLIC_KEY));
  }

  buildGatewayMeta() {
    return {
      configured: this.isGatewayConfigured(),
      provider: cleanString(process.env.WEBSITE_GATEWAY_PROVIDER || ''),
      publicKey: cleanString(process.env.WEBSITE_GATEWAY_PUBLIC_KEY || '')
    };
  }

  getAllowedCustomerChoices(flowConfig = {}) {
    const paymentModel = cleanString(flowConfig.paymentModel);
    if (paymentModel === 'without-online-payment') {
      return ['pay-later'];
    }

    const methods = cleanArray(flowConfig.paymentMethods);
    const choices = [];
    if (methods.includes('gateway')) {
      choices.push('gateway');
    }
    if (methods.includes('manual-upi')) {
      choices.push('manual-upi');
    }
    if (paymentModel === 'both') {
      choices.unshift('pay-later');
    }
    return Array.from(new Set(choices));
  }

  resolveCustomerPaymentChoice(flowConfig = {}, requestedChoice = '') {
    const normalizedRequested = cleanString(requestedChoice);
    const allowedChoices = this.getAllowedCustomerChoices(flowConfig);
    if (!allowedChoices.includes(normalizedRequested)) {
      return allowedChoices[0] || 'pay-later';
    }
    return normalizedRequested;
  }

  calculateGatewayAmounts(baseAmount, feeBearer = 'customer') {
    const safeBaseAmount = Math.max(0, cleanNumber(baseAmount, 0));
    const gatewayFeeAmount = roundCurrency((safeBaseAmount * WEBSITE_GATEWAY_FEE_PERCENT) / 100);
    if (feeBearer === 'provider') {
      return {
        baseAmount: safeBaseAmount,
        gatewayFeeAmount,
        totalAmount: safeBaseAmount,
        providerNetAmount: roundCurrency(Math.max(safeBaseAmount - gatewayFeeAmount, 0))
      };
    }
    return {
      baseAmount: safeBaseAmount,
      gatewayFeeAmount,
      totalAmount: roundCurrency(safeBaseAmount + gatewayFeeAmount),
      providerNetAmount: safeBaseAmount
    };
  }

  calculateManualAmounts(baseAmount) {
    const safeBaseAmount = Math.max(0, cleanNumber(baseAmount, 0));
    return {
      baseAmount: safeBaseAmount,
      gatewayFeeAmount: 0,
      totalAmount: safeBaseAmount,
      providerNetAmount: safeBaseAmount
    };
  }

  buildUpiUri({ upiId = '', payeeName = '', amount = 0, note = '' }) {
    const safeUpiId = cleanString(upiId);
    if (!safeUpiId) {
      return '';
    }
    const params = new URLSearchParams({
      pa: safeUpiId,
      pn: cleanString(payeeName),
      cu: 'INR',
      tn: cleanString(note)
    });
    const safeAmount = roundCurrency(amount);
    if (safeAmount > 0) {
      params.set('am', String(safeAmount));
    }
    return `upi://pay?${params.toString()}`;
  }

  async buildManualPaymentArtifacts({ upiId = '', payeeName = '', amount = 0, note = '', paymentInstructions = '' }) {
    const upiUri = this.buildUpiUri({ upiId, payeeName, amount, note });
    return {
      upiId: cleanString(upiId),
      upiUri,
      qrCodeDataUrl: upiUri ? await QRCode.toDataURL(upiUri, { margin: 1, width: 220 }) : '',
      instructions: cleanString(paymentInstructions)
    };
  }

  buildReceiptNumber(prefix = 'RCPT') {
    return `${prefix}-${Date.now()}`;
  }
}

module.exports = new WebsitePaymentService();
