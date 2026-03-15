/**
 * WebhookReceiver - Receives real-time events from platforms via webhooks.
 * Platforms can push events here instead of us polling them.
 * Supports Discord interactions, Telegram webhook mode, and custom webhooks.
 */
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

export class WebhookReceiver {
  constructor({ agentManager }) {
    this.agentManager = agentManager;
    this.handlers = new Map();
  }

  /**
   * Mount webhook routes on an Express app.
   * @param {import('express').Express} app
   */
  mount(app) {
    // Generic webhook endpoint
    app.post('/webhooks/:platform', (req, res) => {
      const platform = req.params.platform;
      const handler = this.handlers.get(platform);

      if (!handler) {
        logger.warn(`Webhook received for unregistered platform: ${platform}`);
        return res.status(404).json({ error: 'Platform not registered' });
      }

      try {
        handler(req.body, req.headers);
        res.json({ ok: true });
      } catch (err) {
        logger.error(`Webhook handler error (${platform}): ${err.message}`);
        res.status(500).json({ error: 'Handler error' });
      }
    });

    // Telegram webhook
    this.handlers.set('telegram', (body) => {
      this._handleTelegramWebhook(body);
    });

    // Discord interactions
    this.handlers.set('discord', (body, headers) => {
      this._handleDiscordWebhook(body, headers);
    });

    // Generic platform webhook
    this.handlers.set('generic', (body) => {
      this._handleGenericWebhook(body);
    });

    logger.info('Webhook receiver mounted at /webhooks/:platform');
  }

  /** Register a custom webhook handler */
  registerHandler(platform, handler) {
    this.handlers.set(platform, handler);
    logger.info(`Custom webhook handler registered for "${platform}"`);
  }

  _handleTelegramWebhook(body) {
    const msg = body.message;
    if (!msg || !msg.text) return;

    const post = {
      id: String(msg.message_id),
      title: '',
      content: msg.text,
      body: msg.text,
      author: String(msg.from.id),
      authorName: msg.from.username || msg.from.first_name,
      groupId: String(msg.chat.id),
      timestamp: new Date(msg.date * 1000).toISOString(),
      platform: 'telegram',
    };

    this.agentManager.emit('webhookPost', { platform: 'telegram', post });
    logger.info(`Telegram webhook: message from ${post.authorName} in chat ${post.groupId}`);
  }

  _handleDiscordWebhook(body, headers) {
    // Discord interaction verification
    if (body.type === 1) {
      // PING - respond with PONG
      return;
    }

    if (body.type === 2) {
      // APPLICATION_COMMAND
      logger.info(`Discord webhook: command "${body.data?.name}" from ${body.member?.user?.username}`);
    }

    // Message component or other interaction
    if (body.message) {
      const post = {
        id: body.message.id,
        title: '',
        content: body.message.content,
        body: body.message.content,
        author: body.message.author?.id,
        authorName: body.message.author?.username,
        groupId: body.channel_id,
        timestamp: body.message.timestamp,
        platform: 'discord',
      };
      this.agentManager.emit('webhookPost', { platform: 'discord', post });
    }
  }

  _handleGenericWebhook(body) {
    // Accept posts in a standard format
    if (body.post) {
      const post = {
        id: body.post.id || `generic-${Date.now()}`,
        title: body.post.title || '',
        content: body.post.content || body.post.text || '',
        body: body.post.content || body.post.text || '',
        author: body.post.author || 'unknown',
        groupId: body.post.group || body.post.channel || 'generic',
        timestamp: body.post.timestamp || new Date().toISOString(),
        platform: body.platform || 'generic',
      };
      this.agentManager.emit('webhookPost', { platform: body.platform || 'generic', post });
      logger.info(`Generic webhook: post from ${post.author}`);
    }
  }

  /** Verify webhook signature (for platforms that support it) */
  static verifySignature(payload, signature, secret, algorithm = 'sha256') {
    const hmac = crypto.createHmac(algorithm, secret);
    hmac.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
    const expected = hmac.digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
}
