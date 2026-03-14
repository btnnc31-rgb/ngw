/**
 * TwitterAdapter - Monitors Twitter/X for mentions, hashtags, and keyword searches.
 * Uses Twitter API v2. Supports posting replies, sending DMs, and liking/retweeting.
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

const API_BASE = 'https://api.twitter.com/2';

export class TwitterAdapter extends BasePlatform {
  constructor(config = {}) {
    super('twitter');
    this.bearerToken = config.bearerToken || process.env.TWITTER_BEARER_TOKEN;
    this.apiKey = config.apiKey || process.env.TWITTER_API_KEY;
    this.apiSecret = config.apiSecret || process.env.TWITTER_API_SECRET;
    this.accessToken = config.accessToken || process.env.TWITTER_ACCESS_TOKEN;
    this.accessTokenSecret = config.accessTokenSecret || process.env.TWITTER_ACCESS_TOKEN_SECRET;
    this._simMode = false;
    this._sinceIds = new Map(); // query -> sinceId
    this._userId = null;
  }

  async connect() {
    if (!this.bearerToken) {
      logger.warn('Twitter: No bearer token, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._userId = data.data.id;
      logger.info(`Twitter: Connected as @${data.data.username} (${this._userId})`);
      this._connected = true;
    } catch (err) {
      logger.error(`Twitter: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];

    for (const query of groups) {
      try {
        const sinceId = this._sinceIds.get(query);
        let url = `${API_BASE}/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=author_id,created_at,text,conversation_id`;
        if (sinceId) url += `&since_id=${sinceId}`;

        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${this.bearerToken}` },
        });

        if (!resp.ok) {
          logger.warn(`Twitter: Search failed for "${query}" - HTTP ${resp.status}`);
          continue;
        }

        const data = await resp.json();
        const tweets = data.data || [];

        for (const tweet of tweets) {
          posts.push({
            id: tweet.id,
            title: '',
            content: tweet.text,
            body: tweet.text,
            author: tweet.author_id,
            groupId: query,
            timestamp: tweet.created_at,
            conversationId: tweet.conversation_id,
            url: `https://twitter.com/i/status/${tweet.id}`,
          });
        }

        if (tweets.length > 0) {
          this._sinceIds.set(query, tweets[0].id);
        }
      } catch (err) {
        logger.error(`Twitter: fetchNewPosts error for "${query}": ${err.message}`);
      }
    }

    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`Twitter [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-tw-${Date.now()}` };
    }

    try {
      if (channel === 'dm') {
        // Send DM via Twitter API v2
        const resp = await fetch(`${API_BASE}/dm_conversations/with/${target}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: content }),
        });
        const data = await resp.json();
        return { success: resp.ok, messageId: data.data?.dm_event_id || '' };
      } else {
        // Reply to tweet
        const resp = await fetch(`${API_BASE}/tweets`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: content,
            reply: { in_reply_to_tweet_id: postId },
          }),
        });
        const data = await resp.json();
        return { success: resp.ok, messageId: data.data?.id || '' };
      }
    } catch (err) {
      logger.error(`Twitter: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies({ targetUser, postId }) {
    if (this._simMode) return [];

    try {
      const url = `${API_BASE}/tweets/search/recent?query=conversation_id:${postId}&tweet.fields=author_id,created_at,text&max_results=10`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
      });
      const data = await resp.json();
      return (data.data || [])
        .filter(t => t.author_id !== this._userId)
        .map(t => ({
          content: t.text,
          author: t.author_id,
          timestamp: t.created_at,
        }));
    } catch (err) {
      logger.error(`Twitter: checkReplies error - ${err.message}`);
      return [];
    }
  }

  /** Like a tweet to increase visibility */
  async likeTweet(tweetId) {
    if (this._simMode) return;
    try {
      await fetch(`${API_BASE}/users/${this._userId}/likes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweet_id: tweetId }),
      });
    } catch (err) {
      logger.error(`Twitter: likeTweet failed - ${err.message}`);
    }
  }

  /** Retweet for exposure */
  async retweet(tweetId) {
    if (this._simMode) return;
    try {
      await fetch(`${API_BASE}/users/${this._userId}/retweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweet_id: tweetId }),
      });
    } catch (err) {
      logger.error(`Twitter: retweet failed - ${err.message}`);
    }
  }

  async joinGroup(query) {
    // Twitter doesn't have groups to join, but we track search queries
    logger.info(`Twitter: Added search query "${query}" to monitoring`);
  }

  _simulatePosts(groups) {
    const samples = [
      { content: 'Anyone recommend a good VPN for remote work? Need something reliable #techhelp', author: 'tw_user_1' },
      { content: 'Looking for affordable web hosting for my startup. Any suggestions? #webdev #hosting', author: 'tw_user_2' },
      { content: 'Need a solid email marketing tool that won\'t break the bank. Recommendations? #marketing', author: 'tw_user_3' },
      { content: 'What project management tool does your team use? Trying to find the right fit #productivity', author: 'tw_user_4' },
      { content: 'Can someone point me to a good CRM? Outgrowing spreadsheets lol #smallbiz', author: 'tw_user_5' },
    ];

    const count = Math.floor(Math.random() * 3);
    return samples.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-tw-${Date.now()}-${i}`,
      title: '',
      body: p.content,
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
