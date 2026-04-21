const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['inquiry', 'callback', 'booking', 'system'], default: 'system' },
  title: { type: String, required: true, trim: true },
  body: { type: String, default: '', trim: true },
  linkPath: { type: String, default: '', trim: true },
  isRead: { type: Boolean, default: false, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
