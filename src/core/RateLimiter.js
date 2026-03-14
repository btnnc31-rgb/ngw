/**
 * RateLimiter - Prevents agents from sending too many messages,
 * respects platform rate limits, and implements anti-spam safeguards.
 */
import { logger } from '../utils/logger.js';

export class RateLimiter {
  constructor(config = {}) {
    // Default limits per platform (messages per window)
    this.platformLimits = {
      reddit: { maxPerWindow: 10, windowMs: 600000, cooldownMs: 60000 },      // 10 per 10 min
      discord: { maxPerWindow: 20, windowMs: 60000, cooldownMs: 5000 },        // 20 per minute
      telegram: { maxPerWindow: 30, windowMs: 60000, cooldownMs: 3000 },       // 30 per minute
      facebook: { maxPerWindow: 10, windowMs: 600000, cooldownMs: 30000 },     // 10 per 10 min
      twitter: { maxPerWindow: 15, windowMs: 900000, cooldownMs: 60000 },      // 15 per 15 min
      linkedin: { maxPerWindow: 5, windowMs: 600000, cooldownMs: 120000 },     // 5 per 10 min (strict)
      ...config.platformLimits,
    };

    // Global limits
    this.globalLimit = config.globalLimit || { maxPerWindow: 100, windowMs: 3600000 }; // 100/hour
    this.maxPerUser = config.maxPerUser || 3;        // Max messages to same user per day
    this.maxPerGroup = config.maxPerGroup || 10;     // Max messages per group per hour

    // Tracking
    this._platformCounters = new Map();   // platform -> [{timestamp}]
    this._globalCounter = [];              // [{timestamp}]
    this._userCounters = new Map();        // `${platform}:${userId}` -> [{timestamp}]
    this._groupCounters = new Map();       // `${platform}:${groupId}` -> [{timestamp}]
    this._lastSend = new Map();            // platform -> timestamp
  }

  /**
   * Check if an action is allowed (won't be rate limited).
   * @param {string} platform - Platform name
   * @param {string} userId - Target user
   * @param {string} groupId - Group/channel
   * @returns {{allowed: boolean, reason?: string, retryAfterMs?: number}}
   */
  check(platform, userId = '', groupId = '') {
    const now = Date.now();

    // 1. Platform cooldown
    const lastSend = this._lastSend.get(platform) || 0;
    const limits = this.platformLimits[platform] || this.platformLimits.reddit;
    if (now - lastSend < limits.cooldownMs) {
      const retryAfter = limits.cooldownMs - (now - lastSend);
      return { allowed: false, reason: `Platform cooldown (${platform})`, retryAfterMs: retryAfter };
    }

    // 2. Platform rate limit
    const platformKey = platform;
    this._cleanCounter(this._platformCounters, platformKey, limits.windowMs);
    const platformCount = (this._platformCounters.get(platformKey) || []).length;
    if (platformCount >= limits.maxPerWindow) {
      return { allowed: false, reason: `Platform rate limit exceeded (${platformCount}/${limits.maxPerWindow})`, retryAfterMs: limits.windowMs };
    }

    // 3. Global rate limit
    this._cleanGlobal(this.globalLimit.windowMs);
    if (this._globalCounter.length >= this.globalLimit.maxPerWindow) {
      return { allowed: false, reason: 'Global rate limit exceeded', retryAfterMs: this.globalLimit.windowMs };
    }

    // 4. Per-user limit (anti-spam)
    if (userId) {
      const userKey = `${platform}:${userId}`;
      this._cleanCounter(this._userCounters, userKey, 86400000); // 24 hours
      const userCount = (this._userCounters.get(userKey) || []).length;
      if (userCount >= this.maxPerUser) {
        return { allowed: false, reason: `Per-user limit reached (${userCount}/${this.maxPerUser} per day)`, retryAfterMs: 86400000 };
      }
    }

    // 5. Per-group limit
    if (groupId) {
      const groupKey = `${platform}:${groupId}`;
      this._cleanCounter(this._groupCounters, groupKey, 3600000); // 1 hour
      const groupCount = (this._groupCounters.get(groupKey) || []).length;
      if (groupCount >= this.maxPerGroup) {
        return { allowed: false, reason: `Per-group limit reached (${groupCount}/${this.maxPerGroup} per hour)`, retryAfterMs: 3600000 };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a sent message for rate limiting tracking.
   */
  record(platform, userId = '', groupId = '') {
    const now = Date.now();

    // Platform counter
    if (!this._platformCounters.has(platform)) this._platformCounters.set(platform, []);
    this._platformCounters.get(platform).push(now);

    // Global counter
    this._globalCounter.push(now);

    // User counter
    if (userId) {
      const userKey = `${platform}:${userId}`;
      if (!this._userCounters.has(userKey)) this._userCounters.set(userKey, []);
      this._userCounters.get(userKey).push(now);
    }

    // Group counter
    if (groupId) {
      const groupKey = `${platform}:${groupId}`;
      if (!this._groupCounters.has(groupKey)) this._groupCounters.set(groupKey, []);
      this._groupCounters.get(groupKey).push(now);
    }

    // Last send time
    this._lastSend.set(platform, now);
  }

  /**
   * Get current rate limit status for all platforms.
   */
  getStatus() {
    const status = {};
    for (const [platform, limits] of Object.entries(this.platformLimits)) {
      this._cleanCounter(this._platformCounters, platform, limits.windowMs);
      const count = (this._platformCounters.get(platform) || []).length;
      status[platform] = {
        used: count,
        limit: limits.maxPerWindow,
        remaining: Math.max(0, limits.maxPerWindow - count),
        windowMs: limits.windowMs,
        cooldownMs: limits.cooldownMs,
      };
    }

    this._cleanGlobal(this.globalLimit.windowMs);
    status.global = {
      used: this._globalCounter.length,
      limit: this.globalLimit.maxPerWindow,
      remaining: Math.max(0, this.globalLimit.maxPerWindow - this._globalCounter.length),
    };

    return status;
  }

  /** Reset all counters */
  reset() {
    this._platformCounters.clear();
    this._globalCounter = [];
    this._userCounters.clear();
    this._groupCounters.clear();
    this._lastSend.clear();
  }

  _cleanCounter(map, key, windowMs) {
    const now = Date.now();
    const entries = map.get(key) || [];
    const cleaned = entries.filter(ts => now - ts < windowMs);
    map.set(key, cleaned);
  }

  _cleanGlobal(windowMs) {
    const now = Date.now();
    this._globalCounter = this._globalCounter.filter(ts => now - ts < windowMs);
  }
}
