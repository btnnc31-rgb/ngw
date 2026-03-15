/**
 * FacebookAdapter - Monitors Facebook groups, posts comments, sends messages.
 * Uses the Facebook Graph API.
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

const GRAPH_API = 'https://graph.facebook.com/v18.0';

export class FacebookAdapter extends BasePlatform {
  constructor(config = {}) {
    super('facebook');
    this.accessToken = config.accessToken || process.env.FACEBOOK_ACCESS_TOKEN;
    this._simMode = false;
    this._lastTimestamps = new Map();
  }

  async connect() {
    if (!this.accessToken) {
      logger.warn('Facebook: No access token, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      const resp = await fetch(`${GRAPH_API}/me?access_token=${this.accessToken}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      logger.info(`Facebook: Connected as ${data.name}`);
      this._connected = true;
    } catch (err) {
      logger.error(`Facebook: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];
    for (const groupId of groups) {
      try {
        const since = this._lastTimestamps.get(groupId) || '';
        const sinceParam = since ? `&since=${since}` : '';
        const resp = await fetch(
          `${GRAPH_API}/${groupId}/feed?fields=id,message,from,created_time&limit=25${sinceParam}&access_token=${this.accessToken}`
        );
        const data = await resp.json();

        for (const post of data.data || []) {
          posts.push({
            id: post.id,
            title: '',
            content: post.message || '',
            author: post.from?.id,
            authorName: post.from?.name,
            groupId,
            timestamp: post.created_time,
          });
        }

        if (data.data?.length > 0) {
          this._lastTimestamps.set(groupId, Math.floor(Date.now() / 1000));
        }
      } catch (err) {
        logger.error(`Facebook: Failed to fetch group ${groupId}: ${err.message}`);
      }
    }
    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`Facebook [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-${Date.now()}` };
    }

    try {
      if (channel === 'comment') {
        const resp = await fetch(`${GRAPH_API}/${postId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            access_token: this.accessToken,
          }),
        });
        const data = await resp.json();
        return { success: !data.error, messageId: data.id };
      }
      // Facebook Messenger requires approved use cases
      logger.warn('Facebook: DM sending requires approved Messenger API access');
      return { success: false, error: 'DM not available' };
    } catch (err) {
      logger.error(`Facebook: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies() {
    if (this._simMode) return [];
    return [];
  }

  async joinGroup(groupId) {
    logger.info(`Facebook: Group joining is manual - request to join group ${groupId}`);
  }

  _simulatePosts(groups) {
    const samples = [
      { content: 'Can someone recommend a good website builder? Not too technical please.', author: 'fb_user_1', authorName: 'WebWanter' },
      { content: 'Looking for affordable graphic design software. Photoshop alternatives?', author: 'fb_user_2', authorName: 'DesignDiana' },
    ];

    const count = Math.floor(Math.random() * 2);
    return samples.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-fb-${Date.now()}-${i}`,
      title: '',
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
