/**
 * BasePlatform - Abstract base class for all platform adapters.
 * Provides a consistent interface for monitoring and interacting
 * with social platforms (Reddit, Discord, Telegram, Facebook, etc.)
 */
export class BasePlatform {
  constructor(name) {
    this.name = name;
    this._connected = false;
  }

  isConnected() {
    return this._connected;
  }

  async connect() {
    this._connected = true;
  }

  async disconnect() {
    this._connected = false;
  }

  /**
   * Fetch new posts from specified groups/channels.
   * @param {string[]} groups - List of group/channel identifiers
   * @returns {Promise<Array<{id, title, content, author, groupId, timestamp}>>}
   */
  async fetchNewPosts(groups) {
    throw new Error(`${this.name}: fetchNewPosts not implemented`);
  }

  /**
   * Send a message (comment, DM, etc.)
   * @param {{target, channel, postId, content}} opts
   * @returns {Promise<{success, messageId}>}
   */
  async sendMessage(opts) {
    throw new Error(`${this.name}: sendMessage not implemented`);
  }

  /**
   * Check for replies to our messages.
   * @param {{conversationId, targetUser, postId}} opts
   * @returns {Promise<Array<{content, author, timestamp}>>}
   */
  async checkReplies(opts) {
    throw new Error(`${this.name}: checkReplies not implemented`);
  }

  /**
   * Join a group/channel.
   * @param {string} groupId
   */
  async joinGroup(groupId) {
    throw new Error(`${this.name}: joinGroup not implemented`);
  }

  /**
   * List available groups the bot has access to.
   */
  async listGroups() {
    throw new Error(`${this.name}: listGroups not implemented`);
  }
}
