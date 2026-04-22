const mongoose = require('mongoose');
const {
  WEBSITE_TRANSACTION_CONTEXTS,
  WEBSITE_TRANSACTION_CHANNELS,
  WEBSITE_PAYMENT_STATUSES,
  WEBSITE_REFUND_STATUSES,
  WEBSITE_PAYMENT_FEE_BEARERS
} = require('../constants/websitePayments');

const websiteTransactionSchema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  websiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderWebsite', required: true, index: true },
  customerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  customerName: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  contextType: { type: String, enum: WEBSITE_TRANSACTION_CONTEXTS, required: true, index: true },
  contextId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  contextLabel: { type: String, default: '' },
  paymentChannel: { type: String, enum: WEBSITE_TRANSACTION_CHANNELS, default: 'none' },
  paymentStatus: { type: String, enum: WEBSITE_PAYMENT_STATUSES, default: 'pending', index: true },
  refundStatus: { type: String, enum: WEBSITE_REFUND_STATUSES, default: 'none' },
  amountBreakdown: {
    baseAmount: { type: Number, default: 0 },
    gatewayFeeAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    providerNetAmount: { type: Number, default: 0 },
    feeBearer: { type: String, enum: WEBSITE_PAYMENT_FEE_BEARERS, default: 'customer' }
  },
  gateway: {
    provider: { type: String, default: '' },
    providerReference: { type: String, default: '' },
    orderReference: { type: String, default: '' },
    status: { type: String, default: '' },
    feePercent: { type: Number, default: 0 }
  },
  manualPayment: {
    upiId: { type: String, default: '' },
    upiUri: { type: String, default: '' },
    qrCodeDataUrl: { type: String, default: '' },
    payerTransactionId: { type: String, default: '' },
    instructions: { type: String, default: '' },
    submittedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verificationNote: { type: String, default: '' }
  },
  receipt: {
    receiptNumber: { type: String, default: '', index: true },
    issuedAt: { type: Date, default: null },
    emailedAt: { type: Date, default: null }
  },
  refund: {
    requestedAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    amount: { type: Number, default: 0 },
    reference: { type: String, default: '' },
    note: { type: String, default: '' }
  }
}, { timestamps: true });

module.exports = mongoose.model('WebsiteTransaction', websiteTransactionSchema);
