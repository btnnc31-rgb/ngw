/**
 * DiscordAdapter - Monitors Discord servers/channels, sends messages and DMs.
 * Requires a Discord bot token.
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

const API_BASE = 'https://discord.com/api/v10';

export class DiscordAdapter extends BasePlatform {
  constructor(config = {}) {
    super('discord');
    this.token = config.token || process.env.DISCORD_BOT_TOKEN;
    this._simMode = false;
    this._lastMessageIds = new Map(); // channelId -> lastMessageId
  }

  async connect() {
    if (!this.token) {
      logger.warn('Discord: No bot token, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/users/@me`, {
        headers: { Authorization: `Bot ${this.token}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const user = await resp.json();
      logger.info(`Discord: Connected as ${user.username}#${user.discriminator}`);
      this._connected = true;
    } catch (err) {
      logger.error(`Discord: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];
    for (const channelId of groups) {
      try {
        const after = this._lastMessageIds.get(channelId) || '0';
        const resp = await fetch(`${API_BASE}/channels/${channelId}/messages?limit=20&after=${after}`, {
          headers: { Authorization: `Bot ${this.token}` },
        });
        const messages = await resp.json();
        if (!Array.isArray(messages)) continue;

        for (const msg of messages) {
          posts.push({
            id: msg.id,
            title: '',
            content: msg.content,
            author: msg.author?.id,
            authorName: msg.author?.username,
            groupId: channelId,
            timestamp: msg.timestamp,
          });
        }

        if (messages.length > 0) {
          this._lastMessageIds.set(channelId, messages[0].id);
        }
      } catch (err) {
        logger.error(`Discord: Failed to fetch channel ${channelId}: ${err.message}`);
      }
    }
    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`Discord [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-${Date.now()}` };
    }

    try {
      if (channel === 'dm') {
        // Create DM channel first
        const dmResp = await fetch(`${API_BASE}/users/@me/channels`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ recipient_id: target }),
        });
        const dmChannel = await dmResp.json();

        // Send message
        const msgResp = await fetch(`${API_BASE}/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
        const msg = await msgResp.json();
        return { success: true, messageId: msg.id };
      } else {
        // Reply in channel
        const channelId = postId; // use postId as channel context
        const resp = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
        const msg = await resp.json();
        return { success: true, messageId: msg.id };
      }
    } catch (err) {
      logger.error(`Discord: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies({ targetUser }) {
    if (this._simMode) return [];
    return [];
  }

  async joinGroup(guildInvite) {
    if (this._simMode) {
      logger.info(`Discord [SIM]: Joined via invite ${guildInvite}`);
      return;
    }
    // Bot joins are done by adding the bot to a server via OAuth URL
    logger.info(`Discord: Bots join servers via OAuth, not invites`);
  }

  _simulatePosts(groups) {
    const samples = [
      { content: 'Anyone know a good project management tool for a small team?', author: 'discord_user_1', authorName: 'ProjectPete' },
      { content: 'Looking for crypto wallet recommendations - something secure and easy to use', author: 'discord_user_2', authorName: 'CryptoCarl' },
      { content: 'Need a freelancer platform, Upwork alternatives?', author: 'discord_user_3', authorName: 'FreelanceFiona' },
    ];

    const count = Math.floor(Math.random() * 2);
    return samples.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-discord-${Date.now()}-${i}`,
      title: '',
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
