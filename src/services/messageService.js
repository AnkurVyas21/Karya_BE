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

  async sendMessage({ conversationId, senderId, senderRole, body }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const senderKey = senderId.toString();
    const customerId = this.toIdString(conversation.customer);
    const professionalId = this.toIdString(conversation.professional);
    const isParticipant =
      customerId === senderKey ||
      professionalId === senderKey;

    if (!isParticipant) {
      throw new Error('Access denied');
    }

    const trimmedBody = String(body || '').trim();
    if (!trimmedBody) {
      throw new Error('Message body is required');
    }

    const recipientId = customerId === senderKey ? professionalId : customerId;

    const deliveredAt = messageRealtimeService.hasConnections(recipientId) ? new Date() : null;

    const message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      senderRole,
      body: trimmedBody,
      deliveredAt
    });

    conversation.lastMessage = message.body;
    conversation.lastMessageAt = message.createdAt;

    if (recipientId === customerId) {
      conversation.customerUnreadCount = (Number(conversation.customerUnreadCount) || 0) + 1;
    } else {
      conversation.professionalUnreadCount = (Number(conversation.professionalUnreadCount) || 0) + 1;
    }

    await conversation.save();
    await message.populate('sender');

    return {
      message,
      recipientId
    };
  }

  async listConversations(userId, role) {
    const filter = role === 'professional'
      ? { professional: userId }
      : { customer: userId };

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

    const userKey = userId.toString();
    const isParticipant =
      conversation.customer?._id?.toString() === userKey ||
      conversation.professional?.toString() === userKey ||
      conversation.professionalProfile?.user?._id?.toString() === userKey;

    if (!isParticipant) {
      throw new Error('Access denied');
    }

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
      {
        $set: {
          deliveredAt: now,
          readAt: now,
          isRead: true
        }
      }
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
      body: message.body,
      senderId: message.sender?._id?.toString() || message.sender?.toString?.() || null,
      senderName: [message.sender?.firstName, message.sender?.lastName].filter(Boolean).join(' ').trim() || 'User',
      senderRole: message.senderRole,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
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

  toIdString(value) {
    if (!value) {
      return '';
    }

    return value._id?.toString?.() || value.toString();
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
}

module.exports = new MessageService();
