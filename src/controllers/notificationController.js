const notificationService = require('../services/notificationService');

const listNotifications = async (req, res) => {
  try {
    const data = await notificationService.listForUser(req.user._id, req.query.limit);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const data = await notificationService.markRead(req.user._id, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    const data = await notificationService.markAllRead(req.user._id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
};
