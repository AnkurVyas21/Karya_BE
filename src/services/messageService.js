const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const ProfessionalProfile = require('../models/ProfessionalProfile');
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
        lastMessageAt: new Date()
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

    const isParticipant =
      conversation.customer.toString() === senderId.toString() ||
      conversation.professional.toString() === senderId.toString();

    if (!isParticipant) {
      throw new Error('Access denied');
    }

    const message = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      senderRole,
      body: String(body || '').trim()
    });

    conversation.lastMessage = message.body;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();

    return message;
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

    return conversations.map((conversation) => {
      const profile = conversation.professionalProfile;
      const professionalSummary = profile
        ? buildProfessionalSummary({ profile, reviewStats: {}, bookmarkedIds: new Set() })
        : null;

      return {
        id: conversation._id.toString(),
        lastMessage: conversation.lastMessage,
        lastMessageAt: conversation.lastMessageAt,
        customer: conversation.customer ? {
          id: conversation.customer._id.toString(),
          fullName: [conversation.customer.firstName, conversation.customer.lastName].filter(Boolean).join(' ').trim(),
          email: conversation.customer.email || '',
          mobile: conversation.customer.mobile || ''
        } : null,
        professional: professionalSummary
      };
    });
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

    const isParticipant =
      conversation.customer?._id?.toString() === userId.toString() ||
      conversation.professional?.toString() === userId.toString() ||
      conversation.professionalProfile?.user?._id?.toString() === userId.toString();

    if (!isParticipant) {
      throw new Error('Access denied');
    }

    const messages = await Message.find({ conversation: conversation._id })
      .populate('sender')
      .sort({ createdAt: 1 });

    const profile = conversation.professionalProfile;
    const professionalSummary = profile
      ? buildProfessionalSummary({ profile, reviewStats: {}, bookmarkedIds: new Set() })
      : null;

    return {
      id: conversation._id.toString(),
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
      customer: conversation.customer ? {
        id: conversation.customer._id.toString(),
        fullName: [conversation.customer.firstName, conversation.customer.lastName].filter(Boolean).join(' ').trim(),
        email: conversation.customer.email || '',
        mobile: conversation.customer.mobile || ''
      } : null,
      professional: professionalSummary,
      messages: messages.map((message) => ({
        id: message._id.toString(),
        body: message.body,
        senderId: message.sender?._id?.toString() || null,
        senderName: [message.sender?.firstName, message.sender?.lastName].filter(Boolean).join(' ').trim() || 'User',
        senderRole: message.senderRole,
        createdAt: message.createdAt
      }))
    };
  }
}

module.exports = new MessageService();
