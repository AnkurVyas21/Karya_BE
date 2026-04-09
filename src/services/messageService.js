const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ProfessionalProfile = require('../models/ProfessionalProfile');
const messageRealtimeService = require('./messageRealtimeService');
const { buildProfessionalSummary } = require('../utils/professionalPresenter');

class MessageService {
  async createOrGetConversation({ customerId, professionalProfileId, initialMessage = '' }) {
    const profile = await ProfessionalProfile.findById(professionalProfileId).populate('user');
    if (!profile || !profile.user) {
      throw new Error('Professional profile not found');
    }

    let conversation = await Conversation.findOne({
      customer: customerId,
      professional: profile.user._id,
      professionalProfile: profile._id
    });

    if (!conversation) {
      conversation = await Conversation.create({
        customer: customerId,
        professional: profile.user._id,
        professionalProfile: profile._id,
        lastMessage: '',
        lastMessageAt: new Date(),
        customerUnreadCount: 0,
        professionalUnreadCount: 0
      });
    }

    if (initialMessage && initialMessage.trim()) {
      await this.sendMessage({
        conversationId: conversation._id.toString(),
        senderId: customerId,
        senderRole: 'user',
        body: initialMessage
      });
    }

    return this.getConversation(conversation._id.toString(), customerId);
  }

  async sendMessage({ conversationId, senderId, senderRole, body, attachments = [] }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const senderKey = senderId.toString();
    const customerId = this.toIdString(conversation.customer);
    const professionalId = this.toIdString(conversation.professional);
    const isParticipant = customerId === senderKey || professionalId === senderKey;

    if (!isParticipant) {
      throw new Error('Access denied');
    }

    const trimmedBody = String(body || '').trim();
    const normalizedAttachments = this.normalizeAttachments(attachments);
    if (!trimmedBody && !normalizedAttachments.length) {
      throw new Error('Message content is required');
    }

    const recipientId = customerId === senderKey ? professionalId : customerId;
    const deliveredAt = messageRealtimeService.hasConnections(recipientId) ? new Date() : null;

    const message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      senderRole,
      body: trimmedBody,
      attachments: normalizedAttachments,
      deliveredAt
    });

    await this.updateConversationSnapshot(conversation);
    if (recipientId === customerId) {
      conversation.customerUnreadCount = (Number(conversation.customerUnreadCount) || 0) + 1;
    } else {
      conversation.professionalUnreadCount = (Number(conversation.professionalUnreadCount) || 0) + 1;
    }
    await conversation.save();
    await message.populate('sender');

    return { message, recipientId };
  }

  async updateMessage({ conversationId, messageId, userId, body }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.assertParticipant(conversation, userId);
    const message = await Message.findOne({ _id: messageId, conversation: conversation._id }).populate('sender');
    if (!message) {
      throw new Error('Message not found');
    }

    if (this.toIdString(message.sender) !== userId.toString()) {
      throw new Error('Only the sender can edit this message');
    }

    if (message.isDeleted) {
      throw new Error('Deleted messages cannot be edited');
    }

    const trimmedBody = String(body || '').trim();
    if (!trimmedBody && !message.attachments.length) {
      throw new Error('Message content is required');
    }

    message.body = trimmedBody;
    message.editedAt = new Date();
    await message.save();
    await this.updateConversationSnapshot(conversation);
    await conversation.save();
    await message.populate('sender');

    return message;
  }

  async deleteMessage({ conversationId, messageId, userId }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.assertParticipant(conversation, userId);
    const message = await Message.findOne({ _id: messageId, conversation: conversation._id }).populate('sender');
    if (!message) {
      throw new Error('Message not found');
    }

    if (this.toIdString(message.sender) !== userId.toString()) {
      throw new Error('Only the sender can delete this message');
    }

    if (!message.isDeleted) {
      message.body = '';
      message.attachments = [];
      message.isDeleted = true;
      message.deletedAt = new Date();
      await message.save();
      await this.updateConversationSnapshot(conversation);
      await conversation.save();
    }

    await message.populate('sender');
    return message;
  }

  async listConversations(userId, role) {
    const filter = role === 'professional' ? { professional: userId } : { customer: userId };

    const conversations = await Conversation.find(filter)
      .populate('customer')
      .populate({
        path: 'professionalProfile',
        populate: { path: 'user' }
      })
      .sort({ lastMessageAt: -1 });

    return Promise.all(conversations.map(async (conversation) => {
      await this.ensureUnreadCounters(conversation);
      return this.serializeConversationSummary(conversation, userId);
    }));
  }

  async getConversation(conversationId, userId) {
    const conversation = await Conversation.findById(conversationId)
      .populate('customer')
      .populate({
        path: 'professionalProfile',
        populate: { path: 'user' }
      });

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    await this.assertParticipant(conversation, userId);
    await this.ensureUnreadCounters(conversation);
    const statusUpdates = await this.markConversationAsRead(conversation, userId);
    const messages = await Message.find({ conversation: conversation._id })
      .populate('sender')
      .sort({ createdAt: 1 });

    return {
      ...this.serializeConversationSummary(conversation, userId),
      statusUpdates,
      messages: messages.map((message) => this.serializeMessage(message))
    };
  }

  async markConversationAsRead(conversationOrId, userId) {
    const conversation = typeof conversationOrId === 'string'
      ? await Conversation.findById(conversationOrId)
      : conversationOrId;

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const userKey = userId.toString();
    const isCustomer = this.toIdString(conversation.customer) === userKey;
    const isProfessional = this.toIdString(conversation.professional) === userKey;

    if (!isCustomer && !isProfessional) {
      throw new Error('Access denied');
    }

    const now = new Date();
    const unreadMessages = await Message.find({
      conversation: conversation._id,
      sender: { $ne: userId },
      readAt: null
    }).select('_id sender deliveredAt readAt');

    if (!unreadMessages.length) {
      if (isCustomer && conversation.customerUnreadCount !== 0) {
        conversation.customerUnreadCount = 0;
        await conversation.save();
      }

      if (isProfessional && conversation.professionalUnreadCount !== 0) {
        conversation.professionalUnreadCount = 0;
        await conversation.save();
      }

      return [];
    }

    await Message.updateMany(
      { _id: { $in: unreadMessages.map((message) => message._id) } },
      { $set: { deliveredAt: now, readAt: now, isRead: true } }
    );

    if (isCustomer) {
      conversation.customerUnreadCount = 0;
    } else {
      conversation.professionalUnreadCount = 0;
    }
    await conversation.save();

    return unreadMessages.map((message) => ({
      conversationId: conversation._id.toString(),
      messageId: message._id.toString(),
      senderId: message.sender.toString(),
      deliveredAt: (message.deliveredAt || now).toISOString(),
      readAt: now.toISOString()
    }));
  }

  async markMessagesDeliveredForUser(userId) {
    const conversations = await Conversation.find({
      $or: [{ customer: userId }, { professional: userId }]
    }).select('_id');

    if (!conversations.length) {
      return [];
    }

    const now = new Date();
    const pendingMessages = await Message.find({
      conversation: { $in: conversations.map((conversation) => conversation._id) },
      sender: { $ne: userId },
      deliveredAt: null
    }).select('_id sender conversation readAt');

    if (!pendingMessages.length) {
      return [];
    }

    await Message.updateMany(
      { _id: { $in: pendingMessages.map((message) => message._id) } },
      { $set: { deliveredAt: now } }
    );

    return pendingMessages.map((message) => ({
      conversationId: message.conversation.toString(),
      messageId: message._id.toString(),
      senderId: message.sender.toString(),
      deliveredAt: now.toISOString(),
      readAt: message.readAt ? message.readAt.toISOString() : null
    }));
  }

  serializeMessage(message) {
    return {
      id: message._id.toString(),
      body: message.isDeleted ? 'This message was deleted.' : message.body,
      attachments: message.isDeleted ? [] : this.normalizeAttachments(message.attachments),
      senderId: message.sender?._id?.toString() || message.sender?.toString?.() || null,
      senderName: [message.sender?.firstName, message.sender?.lastName].filter(Boolean).join(' ').trim() || 'User',
      senderRole: message.senderRole,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      isDeleted: !!message.isDeleted,
      isRead: !!message.readAt || !!message.isRead
    };
  }

  serializeConversationSummary(conversation, userId) {
    const profile = conversation.professionalProfile;
    const professionalSummary = profile
      ? buildProfessionalSummary({ profile, reviewStats: {}, bookmarkedIds: new Set() })
      : null;

    return {
      id: conversation._id.toString(),
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
      unreadCount: this.getUnreadCountForViewer(conversation, userId),
      customer: conversation.customer ? {
        id: conversation.customer._id?.toString?.() || conversation.customer.toString(),
        fullName: [conversation.customer.firstName, conversation.customer.lastName].filter(Boolean).join(' ').trim(),
        email: conversation.customer.email || '',
        mobile: conversation.customer.mobile || ''
      } : null,
      professional: professionalSummary
    };
  }

  getUnreadCountForViewer(conversation, userId) {
    const userKey = userId.toString();

    if (conversation.customer?._id?.toString() === userKey || conversation.customer?.toString?.() === userKey) {
      return Number(conversation.customerUnreadCount || 0);
    }

    if (conversation.professional?._id?.toString() === userKey || conversation.professional?.toString?.() === userKey) {
      return Number(conversation.professionalUnreadCount || 0);
    }

    if (conversation.professionalProfile?.user?._id?.toString() === userKey) {
      return Number(conversation.professionalUnreadCount || 0);
    }

    return 0;
  }

  async ensureUnreadCounters(conversation) {
    if (
      typeof conversation.customerUnreadCount === 'number' &&
      typeof conversation.professionalUnreadCount === 'number'
    ) {
      return;
    }

    const customerId = this.toIdString(conversation.customer);
    const professionalId = this.toIdString(conversation.professional);

    const [customerUnreadCount, professionalUnreadCount] = await Promise.all([
      Message.countDocuments({
        conversation: conversation._id,
        sender: { $ne: customerId },
        readAt: null
      }),
      Message.countDocuments({
        conversation: conversation._id,
        sender: { $ne: professionalId },
        readAt: null
      })
    ]);

    conversation.customerUnreadCount = customerUnreadCount;
    conversation.professionalUnreadCount = professionalUnreadCount;
    await conversation.save();
  }

  async updateConversationSnapshot(conversation) {
    const latestMessage = await Message.findOne({ conversation: conversation._id }).sort({ createdAt: -1 });
    if (!latestMessage) {
      conversation.lastMessage = '';
      conversation.lastMessageAt = conversation.updatedAt || new Date();
      return;
    }

    if (latestMessage.isDeleted) {
      conversation.lastMessage = 'Message deleted';
    } else if (latestMessage.attachments?.length && !latestMessage.body) {
      conversation.lastMessage = latestMessage.attachments.length === 1 ? 'Attachment' : 'Attachments';
    } else {
      conversation.lastMessage = latestMessage.body;
    }
    conversation.lastMessageAt = latestMessage.createdAt;
  }

  async assertParticipant(conversation, userId) {
    const userKey = userId.toString();
    const isParticipant =
      this.toIdString(conversation.customer) === userKey ||
      this.toIdString(conversation.professional) === userKey ||
      conversation.professionalProfile?.user?._id?.toString() === userKey;

    if (!isParticipant) {
      throw new Error('Access denied');
    }
  }

  normalizeAttachments(attachments = []) {
    return (attachments || [])
      .map((attachment) => {
        if (!attachment) {
          return null;
        }

        if (attachment.url) {
          return {
            url: attachment.url,
            originalName: attachment.originalName || '',
            mimeType: attachment.mimeType || '',
            size: Number(attachment.size || 0)
          };
        }

        const storedPath = attachment.path || '';
        if (!storedPath) {
          return null;
        }

        const normalizedPath = String(storedPath).replace(/\\/g, '/');
        const publicPath = normalizedPath.startsWith('uploads/')
          ? `/${normalizedPath}`
          : normalizedPath.startsWith('/uploads/')
            ? normalizedPath
            : `/uploads/${normalizedPath.split('/').pop()}`;

        return {
          url: publicPath,
          originalName: attachment.originalname || attachment.originalName || '',
          mimeType: attachment.mimetype || attachment.mimeType || '',
          size: Number(attachment.size || 0)
        };
      })
      .filter(Boolean);
  }

  toIdString(value) {
    if (!value) {
      return '';
    }

    return value._id?.toString?.() || value.toString();
  }
}

module.exports = new MessageService();
