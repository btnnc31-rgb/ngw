/**
 * TelegramAdapter - Monitors Telegram groups, sends messages and DMs.
 * Requires a Telegram Bot token from @BotFather.
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

const TG_API = 'https://api.telegram.org';

export class TelegramAdapter extends BasePlatform {
  constructor(config = {}) {
    super('telegram');
    this.token = config.token || process.env.TELEGRAM_BOT_TOKEN;
    this._simMode = false;
    this._lastUpdateId = 0;
  }

  async connect() {
    if (!this.token) {
      logger.warn('Telegram: No bot token, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      const resp = await fetch(`${TG_API}/bot${this.token}/getMe`);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.description);
      logger.info(`Telegram: Connected as @${data.result.username}`);
      this._connected = true;
    } catch (err) {
      logger.error(`Telegram: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];
    try {
      const resp = await fetch(`${TG_API}/bot${this.token}/getUpdates?offset=${this._lastUpdateId + 1}&limit=50&timeout=0`);
      const data = await resp.json();
      if (!data.ok) return posts;

      for (const update of data.result) {
        this._lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        // Only process messages from monitored groups
        const chatId = String(msg.chat.id);
        if (groups.length > 0 && !groups.includes(chatId)) continue;

        posts.push({
          id: String(msg.message_id),
          title: '',
          content: msg.text,
          author: String(msg.from.id),
          authorName: msg.from.username || msg.from.first_name,
          groupId: chatId,
          timestamp: new Date(msg.date * 1000).toISOString(),
        });
      }
    } catch (err) {
      logger.error(`Telegram: fetchNewPosts error - ${err.message}`);
    }
    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`Telegram [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-${Date.now()}` };
    }

    try {
      const chatId = channel === 'dm' ? target : postId;
      const resp = await fetch(`${TG_API}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: content,
          parse_mode: 'Markdown',
        }),
      });
      const data = await resp.json();
      return { success: data.ok, messageId: String(data.result?.message_id || '') };
    } catch (err) {
      logger.error(`Telegram: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies({ targetUser }) {
    if (this._simMode) return [];
    // Replies come through getUpdates which is handled in fetchNewPosts
    return [];
  }

  async joinGroup(chatId) {
    if (this._simMode) {
      logger.info(`Telegram [SIM]: Bot added to chat ${chatId}`);
      return;
    }
    logger.info('Telegram: Bots must be added to groups by an admin');
  }

  _simulatePosts(groups) {
    const samples = [
      { content: 'Does anyone have a recommendation for cloud storage? Need at least 1TB.', author: 'tg_user_1', authorName: 'CloudSeeker' },
      { content: 'Looking for a good CRM for my startup - any suggestions?', author: 'tg_user_2', authorName: 'StartupSteve' },
    ];

    const count = Math.floor(Math.random() * 2);
    return samples.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-tg-${Date.now()}-${i}`,
      title: '',
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
