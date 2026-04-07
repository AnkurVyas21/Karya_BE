const messageService = require('../services/messageService');

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
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getConversation = async (req, res) => {
  try {
    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    res.json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const sendMessage = async (req, res) => {
  try {
    await messageService.sendMessage({
      conversationId: req.params.id,
      senderId: req.user._id,
      senderRole: req.user.role,
      body: req.body.body
    });
    const conversation = await messageService.getConversation(req.params.id, req.user._id);
    res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  getConversations,
  createConversation,
  getConversation,
  sendMessage
};
