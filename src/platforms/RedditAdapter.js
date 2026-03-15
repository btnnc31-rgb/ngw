/**
 * RedditAdapter - Monitors subreddits, comments on posts, sends DMs.
 * Requires Reddit API credentials (client_id, client_secret, username, password).
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

export class RedditAdapter extends BasePlatform {
  constructor(config = {}) {
    super('reddit');
    this.clientId = config.clientId || process.env.REDDIT_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.REDDIT_CLIENT_SECRET;
    this.username = config.username || process.env.REDDIT_USERNAME;
    this.password = config.password || process.env.REDDIT_PASSWORD;
    this.userAgent = config.userAgent || 'ngw-minigent/1.0';
    this.accessToken = null;
    this._lastSeen = new Map(); // subreddit -> last post timestamp
  }

  async connect() {
    if (!this.clientId || !this.clientSecret) {
      logger.warn('Reddit: Missing credentials, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      // OAuth2 token fetch
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
      const resp = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: `grant_type=password&username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`,
      });
      const data = await resp.json();
      this.accessToken = data.access_token;
      this._connected = true;
      logger.info('Reddit: Connected successfully');
    } catch (err) {
      logger.error(`Reddit: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];
    for (const subreddit of groups) {
      try {
        const resp = await fetch(`https://oauth.reddit.com/r/${subreddit}/new?limit=10`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'User-Agent': this.userAgent,
          },
        });
        const data = await resp.json();
        const children = data?.data?.children || [];

        for (const child of children) {
          const post = child.data;
          posts.push({
            id: post.id,
            title: post.title,
            content: post.selftext,
            author: post.author,
            groupId: subreddit,
            timestamp: new Date(post.created_utc * 1000).toISOString(),
            url: `https://reddit.com${post.permalink}`,
          });
        }
      } catch (err) {
        logger.error(`Reddit: Failed to fetch from r/${subreddit}: ${err.message}`);
      }
    }
    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`Reddit [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-${Date.now()}` };
    }

    try {
      if (channel === 'dm') {
        const resp = await fetch('https://oauth.reddit.com/api/compose', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
          },
          body: `to=${encodeURIComponent(target)}&subject=${encodeURIComponent('Quick question')}&text=${encodeURIComponent(content)}`,
        });
        return { success: resp.ok, messageId: `dm-${Date.now()}` };
      } else {
        const resp = await fetch('https://oauth.reddit.com/api/comment', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.userAgent,
          },
          body: `thing_id=t3_${postId}&text=${encodeURIComponent(content)}`,
        });
        return { success: resp.ok, messageId: `comment-${Date.now()}` };
      }
    } catch (err) {
      logger.error(`Reddit: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies({ targetUser }) {
    if (this._simMode) return [];
    // In a real implementation, poll inbox for replies
    return [];
  }

  async joinGroup(subreddit) {
    if (this._simMode) {
      logger.info(`Reddit [SIM]: Joined r/${subreddit}`);
      return;
    }
    await fetch('https://oauth.reddit.com/api/subscribe', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      body: `action=sub&sr_name=${encodeURIComponent(subreddit)}`,
    });
  }

  _simulatePosts(groups) {
    // Generate realistic-looking simulated posts for testing
    const samplePosts = [
      { title: 'Looking for a good VPN service', content: 'Need recommendations for a reliable VPN that works for streaming. Budget around $10/mo.', author: 'user123' },
      { title: 'Best hosting provider 2024?', content: 'Starting a new project and need web hosting. Preferably with good uptime and support.', author: 'devguy456' },
      { title: 'Need help with SEO tools', content: 'Running a small business and want to improve my search rankings. Any affordable SEO tools?', author: 'bizowner789' },
      { title: 'Recommendations for email marketing', content: 'Looking for an email marketing platform that can handle 10k subscribers.', author: 'marketer101' },
    ];

    // Return 0-2 random posts per poll to simulate realistic activity
    const count = Math.floor(Math.random() * 3);
    return samplePosts.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-${Date.now()}-${i}`,
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
