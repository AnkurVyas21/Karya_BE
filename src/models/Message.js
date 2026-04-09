const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['user', 'professional', 'admin'], required: true },
  body: { type: String, default: '', trim: true },
  attachments: [{
    url: { type: String, required: true },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 }
  }],
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [{
    emoji: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  deliveredAt: { type: Date, default: null },
  readAt: { type: Date, default: null },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  isRead: { type: Boolean, default: false }
}, {
  timestamps: true
});

messageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
