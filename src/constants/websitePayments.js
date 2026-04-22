const WEBSITE_PAYMENT_MODELS = ['without-online-payment', 'payment-only', 'both'];
const WEBSITE_PAYMENT_METHODS = ['manual-upi', 'gateway'];
const WEBSITE_PAYMENT_FEE_BEARERS = ['provider', 'customer'];
const WEBSITE_TRANSACTION_CONTEXTS = ['booking', 'product-order'];
const WEBSITE_TRANSACTION_CHANNELS = ['none', 'manual-upi', 'gateway'];
const WEBSITE_PAYMENT_STATUSES = ['not-required', 'pending', 'verification-pending', 'paid', 'failed', 'refunded'];
const WEBSITE_REFUND_STATUSES = ['none', 'pending', 'processed', 'rejected'];
const WEBSITE_GATEWAY_FEE_PERCENT = 3;

module.exports = {
  WEBSITE_PAYMENT_MODELS,
  WEBSITE_PAYMENT_METHODS,
  WEBSITE_PAYMENT_FEE_BEARERS,
  WEBSITE_TRANSACTION_CONTEXTS,
  WEBSITE_TRANSACTION_CHANNELS,
  WEBSITE_PAYMENT_STATUSES,
  WEBSITE_REFUND_STATUSES,
  WEBSITE_GATEWAY_FEE_PERCENT
};
