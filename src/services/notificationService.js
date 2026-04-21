const Notification = require('../models/Notification');
const messageRealtimeService = require('./messageRealtimeService');

class NotificationService {
  serialize(item) {
    if (!item) {
      return null;
    }

    return {
      id: item._id?.toString?.() || String(item.id || ''),
      userId: item.userId?.toString?.() || String(item.userId || ''),
      type: String(item.type || 'system'),
      title: String(item.title || '').trim(),
      body: String(item.body || '').trim(),
      linkPath: String(item.linkPath || '').trim(),
      isRead: Boolean(item.isRead),
      metadata: item.metadata || {},
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
  }

  async createNotification({ userId, type = 'system', title = '', body = '', linkPath = '', metadata = {} }) {
    if (!userId || !String(title || '').trim()) {
      return null;
    }

    const notification = await Notification.create({
      userId,
      type,
      title: String(title).trim(),
      body: String(body || '').trim(),
      linkPath: String(linkPath || '').trim(),
      isRead: false,
      metadata
    });

    const payload = this.serialize(notification);
    messageRealtimeService.emitToUser(userId, 'notification.new', payload);
    return payload;
  }

  async listForUser(userId, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const [items, unreadCount] = await Promise.all([
      Notification.find({ userId }).sort({ createdAt: -1 }).limit(safeLimit).lean(),
      Notification.countDocuments({ userId, isRead: false })
    ]);

    return {
      notifications: items.map((item) => this.serialize(item)),
      unreadCount
    };
  }

  async markRead(userId, notificationId) {
    const item = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { $set: { isRead: true } },
      { new: true }
    ).lean();

    if (!item) {
      return null;
    }

    const payload = this.serialize(item);
    messageRealtimeService.emitToUser(userId, 'notification.read', { id: payload.id });
    return payload;
  }

  async markAllRead(userId) {
    await Notification.updateMany({ userId, isRead: false }, { $set: { isRead: true } });
    messageRealtimeService.emitToUser(userId, 'notification.read', { all: true });
    return this.listForUser(userId);
  }
}

module.exports = new NotificationService();
