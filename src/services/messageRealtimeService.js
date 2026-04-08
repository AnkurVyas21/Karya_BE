class MessageRealtimeService {
  constructor() {
    this.clientsByUser = new Map();
  }

  registerClient(userId, res) {
    const key = userId.toString();
    const clients = this.clientsByUser.get(key) || new Set();
    clients.add(res);
    this.clientsByUser.set(key, clients);

    this.sendEvent(res, 'connected', { ok: true });

    const heartbeat = setInterval(() => {
      this.sendEvent(res, 'heartbeat', { ts: new Date().toISOString() });
    }, 25000);

    const cleanup = () => {
      clearInterval(heartbeat);
      this.unregisterClient(key, res);
    };

    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  unregisterClient(userId, res) {
    const key = userId.toString();
    const clients = this.clientsByUser.get(key);
    if (!clients) {
      return;
    }

    clients.delete(res);
    if (!clients.size) {
      this.clientsByUser.delete(key);
    }
  }

  hasConnections(userId) {
    const clients = this.clientsByUser.get(userId.toString());
    return !!clients?.size;
  }

  emitToUser(userId, eventName, payload) {
    const clients = this.clientsByUser.get(userId.toString());
    if (!clients?.size) {
      return;
    }

    for (const client of clients) {
      this.sendEvent(client, eventName, payload);
    }
  }

  sendEvent(res, eventName, payload) {
    if (!res.writableEnded) {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  }
}

module.exports = new MessageRealtimeService();
