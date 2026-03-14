/**
 * LinkedInAdapter - Monitors LinkedIn groups and feeds for business opportunities.
 * Uses LinkedIn Marketing API / Community Management API.
 */
import { BasePlatform } from './BasePlatform.js';
import { logger } from '../utils/logger.js';

const API_BASE = 'https://api.linkedin.com/v2';

export class LinkedInAdapter extends BasePlatform {
  constructor(config = {}) {
    super('linkedin');
    this.accessToken = config.accessToken || process.env.LINKEDIN_ACCESS_TOKEN;
    this._simMode = false;
    this._personId = null;
  }

  async connect() {
    if (!this.accessToken) {
      logger.warn('LinkedIn: No access token, running in simulation mode');
      this._connected = true;
      this._simMode = true;
      return;
    }

    try {
      const resp = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      this._personId = data.id;
      logger.info(`LinkedIn: Connected as ${data.localizedFirstName} ${data.localizedLastName}`);
      this._connected = true;
    } catch (err) {
      logger.error(`LinkedIn: Connection failed - ${err.message}`);
      this._connected = true;
      this._simMode = true;
    }
  }

  async fetchNewPosts(groups) {
    if (this._simMode) return this._simulatePosts(groups);

    const posts = [];

    for (const groupId of groups) {
      try {
        // Fetch group posts
        const resp = await fetch(
          `${API_BASE}/groups/${groupId}/posts?count=20&fields=id,author,commentary,createdAt`,
          { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        if (!resp.ok) continue;
        const data = await resp.json();

        for (const post of data.elements || []) {
          posts.push({
            id: post.id,
            title: '',
            content: post.commentary?.text || '',
            body: post.commentary?.text || '',
            author: post.author,
            groupId,
            timestamp: post.createdAt ? new Date(post.createdAt).toISOString() : new Date().toISOString(),
          });
        }
      } catch (err) {
        logger.error(`LinkedIn: Failed to fetch group ${groupId}: ${err.message}`);
      }
    }

    return posts;
  }

  async sendMessage({ target, channel, postId, content }) {
    if (this._simMode) {
      logger.info(`LinkedIn [SIM]: ${channel} to ${target}: ${content.slice(0, 80)}...`);
      return { success: true, messageId: `sim-li-${Date.now()}` };
    }

    try {
      if (channel === 'dm') {
        // LinkedIn Messaging API
        const resp = await fetch(`${API_BASE}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            recipients: [target],
            subject: 'Quick question',
            body: content,
          }),
        });
        return { success: resp.ok, messageId: `li-dm-${Date.now()}` };
      } else {
        // Comment on post
        const resp = await fetch(`${API_BASE}/socialActions/${postId}/comments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            actor: `urn:li:person:${this._personId}`,
            message: { text: content },
          }),
        });
        return { success: resp.ok, messageId: `li-comment-${Date.now()}` };
      }
    } catch (err) {
      logger.error(`LinkedIn: sendMessage failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async checkReplies({ postId }) {
    if (this._simMode) return [];

    try {
      const resp = await fetch(
        `${API_BASE}/socialActions/${postId}/comments?count=20`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      const data = await resp.json();
      return (data.elements || []).map(c => ({
        content: c.message?.text || '',
        author: c.actor,
        timestamp: c.created?.time ? new Date(c.created.time).toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      logger.error(`LinkedIn: checkReplies error - ${err.message}`);
      return [];
    }
  }

  async joinGroup(groupId) {
    if (this._simMode) {
      logger.info(`LinkedIn [SIM]: Requested to join group ${groupId}`);
      return;
    }
    try {
      await fetch(`${API_BASE}/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ member: `urn:li:person:${this._personId}` }),
      });
      logger.info(`LinkedIn: Requested to join group ${groupId}`);
    } catch (err) {
      logger.error(`LinkedIn: joinGroup failed - ${err.message}`);
    }
  }

  _simulatePosts(groups) {
    const samples = [
      { content: 'Our startup is looking for a B2B SaaS solution for lead generation. Budget around $500/mo. Any recommendations from this group?', author: 'li_user_1' },
      { content: 'We need enterprise-grade cybersecurity software. Currently evaluating vendors. What does everyone use?', author: 'li_user_2' },
      { content: 'Looking for a reliable payroll service for our 50-person company. Suggestions?', author: 'li_user_3' },
      { content: 'Does anyone have experience with AI-powered customer support tools? Trying to reduce ticket volume.', author: 'li_user_4' },
    ];

    const count = Math.floor(Math.random() * 2);
    return samples.slice(0, count).map((p, i) => ({
      ...p,
      id: `sim-li-${Date.now()}-${i}`,
      title: '',
      body: p.content,
      groupId: groups[0] || 'general',
      timestamp: new Date().toISOString(),
    }));
  }
}
