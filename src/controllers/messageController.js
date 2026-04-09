const jwt = require('jsonwebtoken');
const User = require('../models/User');
const messageService = require('../services/messageService');
const messageRealtimeService = require('../services/messageRealtimeService');

const authenticateStreamUser = async (req) => {
  const header = req.header('Authorization') || '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = String(req.query.token || bearerToken || '').trim();

  if (!token) {
    throw new Error('Please authenticate.');
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id);
  if (!user || user.isBanned) {
    throw new Error('Please authenticate.');
  }

  return user;
};

const emitStatusUpdates = (updates = []) => {
  for (const update of updates) {
    messageRealtimeService.emitToUser(update.senderId, 'message.status', update);
  }
};

const emitMessageEventToParticipants = (conversation, eventName, message) => {
  const payload = {
    conversationId: conversation.id,
    message: messageService.serializeMessage(message)
  };

  if (conversation.customer?.id) {
    messageRealtimeService.emitToUser(conversation.customer.id, eventName, payload);
  }

  if (conversation.professional?.userId) {
    messageRealtimeService.emitToUser(conversation.professional.userId, eventName, payload);
  }
};

const getConversations = async (req, res) => {
  try {
    const conversations = await messageService.listConversations(req.user._id, req.user.role);
    res.json({ success: true, data: conversations });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const createConversation = async (req, res) => {
  try {
    if (req.user.role !== 'user') {
      return res.status(403).json({ success: false, message: 'Only users can start new conversations.' });
    }

    const conversation = await messageService.createOrGetConversation({
      customerId: req.user._id,
      professionalProfileId: req.body.professionalProfileId,
      initialMessage: req.body.message
    });

    emitStatusUpdates(conversation.statusUpdates);
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getConversation = async (req, res) => {
  try {
    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    emitStatusUpdates(conversation.statusUpdates);
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteConversation = async (req, res) => {
  try {
    await messageService.deleteConversation({
      conversationId: req.params.id,
      userId: req.user._id
    });

    const conversations = await messageService.listConversations(req.user._id, req.user.role);
    res.json({
      success: true,
      message: 'Conversation moved to 30-day backup before permanent deletion.',
      data: conversations
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    const { message, recipientId } = await messageService.sendMessage({
      conversationId: req.params.id,
      senderId: req.user._id,
      senderRole: req.user.role,
      body: req.body.body,
      attachments: req.files || [],
      replyToId: req.body.replyToId
    });

    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    emitStatusUpdates(conversation.statusUpdates);
    emitMessageEventToParticipants(conversation, 'message.new', message);

    if (message.deliveredAt) {
      messageRealtimeService.emitToUser(req.user._id, 'message.status', {
        conversationId: req.params.id,
        messageId: message._id.toString(),
        senderId: req.user._id.toString(),
        recipientId,
        deliveredAt: message.deliveredAt.toISOString(),
        readAt: null
      });
    }

    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const updateMessage = async (req, res) => {
  try {
    const message = await messageService.updateMessage({
      conversationId: req.params.id,
      messageId: req.params.messageId,
      userId: req.user._id,
      body: req.body.body
    });

    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    emitStatusUpdates(conversation.statusUpdates);
    emitMessageEventToParticipants(conversation, 'message.updated', message);
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const message = await messageService.deleteMessage({
      conversationId: req.params.id,
      messageId: req.params.messageId,
      userId: req.user._id
    });

    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    emitStatusUpdates(conversation.statusUpdates);
    emitMessageEventToParticipants(conversation, 'message.updated', message);
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const reactToMessage = async (req, res) => {
  try {
    const message = await messageService.toggleReaction({
      conversationId: req.params.id,
      messageId: req.params.messageId,
      userId: req.user._id,
      emoji: req.body.emoji
    });

    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    emitStatusUpdates(conversation.statusUpdates);
    emitMessageEventToParticipants(conversation, 'message.updated', message);
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const streamMessages = async (req, res) => {
  try {
    const user = await authenticateStreamUser(req);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 5000\n\n');

    messageRealtimeService.registerClient(user._id, res);
    const deliveredUpdates = await messageService.markMessagesDeliveredForUser(user._id);
    emitStatusUpdates(deliveredUpdates);
  } catch (error) {
    res.status(401).json({ success: false, message: error.message || 'Please authenticate.' });
  }
};

module.exports = {
  getConversations,
  createConversation,
  getConversation,
  deleteConversation,
  sendMessage,
  updateMessage,
  deleteMessage,
  reactToMessage,
  streamMessages
};
