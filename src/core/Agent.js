/**
 * Base Agent class - the fundamental building block of the mini-agent system.
 * Each agent has a lifecycle: IDLE -> MONITORING -> ENGAGING -> NEGOTIATING -> CLOSING
 * Integrates with ScoringEngine, RateLimiter, and MessageTemplates for full functionality.
 */
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'eventemitter3';
import { logger } from '../utils/logger.js';
import { MessageTemplates } from './MessageTemplates.js';

export const AgentState = {
  IDLE: 'idle',
  MONITORING: 'monitoring',
  ENGAGING: 'engaging',
  NEGOTIATING: 'negotiating',
  CLOSING: 'closing',
  PAUSED: 'paused',
  ERROR: 'error',
};

export class Agent extends EventEmitter {
  constructor({ id, name, platform, config = {}, offerings = [], scoringEngine, rateLimiter }) {
    super();
    this.id = id || uuidv4();
    this.name = name || `agent-${this.id.slice(0, 8)}`;
    this.platform = platform; // platform adapter instance
    this.config = config;
    this.offerings = offerings; // products/services this agent can offer
    this.state = AgentState.IDLE;
    this.scoringEngine = scoringEngine || null;
    this.rateLimiter = rateLimiter || null;
    this.templates = new MessageTemplates();
    this.stats = {
      postsMonitored: 0,
      opportunitiesDetected: 0,
      dealsInitiated: 0,
      dealsNegotiated: 0,
      dealsClosed: 0,
      revenue: 0,
      messagessSent: 0,
      messagesBlocked: 0,
      lastActive: null,
    };
    this.activeConversations = new Map();
    this._pollTimer = null;
    this._followUpCounts = new Map(); // conversationId -> count
  }

  /** Start the agent's monitoring loop */
  async start() {
    if (this.state !== AgentState.IDLE && this.state !== AgentState.PAUSED) {
      logger.warn(`Agent ${this.name} cannot start from state ${this.state}`);
      return;
    }
    this.state = AgentState.MONITORING;
    this.emit('stateChange', { agent: this.id, state: this.state });
    logger.info(`Agent ${this.name} started monitoring on ${this.platform?.name || 'unknown'}`);

    await this._monitorLoop();
  }

  /** Pause the agent */
  pause() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this.state = AgentState.PAUSED;
    this.emit('stateChange', { agent: this.id, state: this.state });
    logger.info(`Agent ${this.name} paused`);
  }

  /** Stop the agent completely */
  stop() {
    if (this._pollTimer) clearTimeout(this._pollTimer);
    this.state = AgentState.IDLE;
    this.activeConversations.clear();
    this.emit('stateChange', { agent: this.id, state: this.state });
    logger.info(`Agent ${this.name} stopped`);
  }

  /** Main monitoring loop */
  async _monitorLoop() {
    if (this.state !== AgentState.MONITORING) return;

    try {
      // 1. Fetch new posts/messages from the platform
      const posts = await this.platform.fetchNewPosts(this.config.groups || []);
      this.stats.postsMonitored += posts.length;

      // 2. Analyze each post for opportunities
      for (const post of posts) {
        const opportunity = await this._analyzePost(post);
        if (opportunity) {
          this.stats.opportunitiesDetected++;
          this.emit('opportunityDetected', { agent: this.id, opportunity, post });

          // 3. Engage with the opportunity
          await this._engageOpportunity(opportunity, post);
        }
      }

      // 4. Process ongoing conversations
      await this._processConversations();

      this.stats.lastActive = new Date().toISOString();
    } catch (err) {
      logger.error(`Agent ${this.name} error in monitor loop: ${err.message}`);
      this.emit('error', { agent: this.id, error: err });
    }

    // Schedule next poll
    const interval = this.config.pollIntervalMs || 30000;
    this._pollTimer = setTimeout(() => this._monitorLoop(), interval);
  }

  /** Analyze a post for opportunities that match our offerings */
  async _analyzePost(post) {
    const matcher = this.config.matcher || defaultMatcher;
    return matcher(post, this.offerings);
  }

  /** Engage with a detected opportunity */
  async _engageOpportunity(opportunity, post) {
    // Check rate limits before engaging
    if (this.rateLimiter) {
      const check = this.rateLimiter.check(
        this.platform?.name || 'unknown',
        post.author || post.userId,
        post.groupId
      );
      if (!check.allowed) {
        logger.info(`Agent ${this.name} rate limited: ${check.reason}`);
        this.stats.messagesBlocked++;
        return;
      }
    }

    // Score the opportunity if scoring engine available
    let score = null;
    if (this.scoringEngine) {
      score = this.scoringEngine.scoreOpportunity(opportunity, post);
      // Skip low-score opportunities
      if (score.score < (this.config.minOpportunityScore || 20)) {
        logger.info(`Agent ${this.name} skipping low-score opportunity (${score.score}/100: ${score.grade})`);
        return;
      }
      opportunity.score = score;
    }

    this.state = AgentState.ENGAGING;
    this.emit('stateChange', { agent: this.id, state: this.state });

    try {
      // Use smart templates for message crafting
      const message = this.templates.initialContact({
        opportunity,
        post,
        platform: this.platform?.name || 'unknown',
        offering: opportunity.matchedOffering,
      });

      // Send via platform (comment, DM, etc.)
      const result = await this.platform.sendMessage({
        target: post.author || post.userId,
        channel: opportunity.preferDM ? 'dm' : 'comment',
        postId: post.id,
        content: message,
      });

      // Record in rate limiter
      if (this.rateLimiter) {
        this.rateLimiter.record(this.platform?.name || 'unknown', post.author || post.userId, post.groupId);
      }

      this.stats.messagessSent++;
      this.stats.dealsInitiated++;

      // Track the conversation
      const conversationId = uuidv4();
      this.activeConversations.set(conversationId, {
        id: conversationId,
        opportunityId: opportunity.id,
        postId: post.id,
        targetUser: post.author || post.userId,
        offering: opportunity.matchedOffering,
        stage: 'initial_contact',
        score: score || null,
        platform: this.platform?.name,
        messages: [{ role: 'agent', content: message, timestamp: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
      });

      this.emit('dealInitiated', {
        agent: this.id,
        conversationId,
        opportunity,
        score,
        result,
      });
    } catch (err) {
      logger.error(`Agent ${this.name} failed to engage: ${err.message}`);
    }

    this.state = AgentState.MONITORING;
    this.emit('stateChange', { agent: this.id, state: this.state });
  }

  /** Process ongoing conversations - check for replies, negotiate, close */
  async _processConversations() {
    for (const [convId, conv] of this.activeConversations) {
      try {
        // Check for new replies
        const replies = await this.platform.checkReplies({
          conversationId: convId,
          targetUser: conv.targetUser,
          postId: conv.postId,
        });

        if (!replies || replies.length === 0) continue;

        for (const reply of replies) {
          conv.messages.push({
            role: 'user',
            content: reply.content,
            timestamp: reply.timestamp || new Date().toISOString(),
          });

          // Determine next action based on conversation stage
          const action = this._determineAction(conv, reply);

          // Rate limit check before responding
          if (this.rateLimiter) {
            const check = this.rateLimiter.check(this.platform?.name || 'unknown', conv.targetUser);
            if (!check.allowed) {
              logger.info(`Agent ${this.name} conversation ${convId} rate limited: ${check.reason}`);
              this.stats.messagesBlocked++;
              continue;
            }
          }

          if (action.type === 'negotiate') {
            this.state = AgentState.NEGOTIATING;
            this.stats.dealsNegotiated++;
            const response = this.templates.negotiate({
              conversation: conv, reply, offering: conv.offering,
              platform: this.platform?.name || 'unknown',
            });
            await this.platform.sendMessage({
              target: conv.targetUser,
              channel: 'dm',
              content: response,
            });
            if (this.rateLimiter) this.rateLimiter.record(this.platform?.name, conv.targetUser);
            conv.messages.push({ role: 'agent', content: response, timestamp: new Date().toISOString() });
            conv.stage = 'negotiating';
            this.stats.messagessSent++;

            // Score the lead
            if (this.scoringEngine) {
              conv.leadScore = this.scoringEngine.scoreLead(conv);
              this.emit('leadScored', { agent: this.id, conversationId: convId, score: conv.leadScore });
            }
          } else if (action.type === 'close') {
            this.state = AgentState.CLOSING;
            const response = this.templates.close({
              conversation: conv, offering: conv.offering,
              platform: this.platform?.name || 'unknown',
            });
            await this.platform.sendMessage({
              target: conv.targetUser,
              channel: 'dm',
              content: response,
            });
            if (this.rateLimiter) this.rateLimiter.record(this.platform?.name, conv.targetUser);
            conv.messages.push({ role: 'agent', content: response, timestamp: new Date().toISOString() });
            conv.stage = 'closed';
            this.stats.dealsClosed++;
            this.stats.revenue += action.dealValue || 0;
            this.stats.messagessSent++;

            this.emit('dealClosed', {
              agent: this.id,
              conversationId: convId,
              dealValue: action.dealValue,
              offering: conv.offering,
              leadScore: conv.leadScore,
            });

            this.activeConversations.delete(convId);
          } else if (action.type === 'followup') {
            const attempt = (this._followUpCounts.get(convId) || 0) + 1;
            this._followUpCounts.set(convId, attempt);

            // Max 3 follow-ups
            if (attempt > 3) {
              logger.info(`Agent ${this.name} max follow-ups reached for ${convId}, dropping`);
              this.activeConversations.delete(convId);
              continue;
            }

            const response = this.templates.followUp({
              conversation: conv, offering: conv.offering,
              platform: this.platform?.name || 'unknown',
              attempt,
            });
            await this.platform.sendMessage({
              target: conv.targetUser,
              channel: 'dm',
              content: response,
            });
            if (this.rateLimiter) this.rateLimiter.record(this.platform?.name, conv.targetUser);
            conv.messages.push({ role: 'agent', content: response, timestamp: new Date().toISOString() });
            this.stats.messagessSent++;
          }
        }
      } catch (err) {
        logger.error(`Agent ${this.name} conversation ${convId} error: ${err.message}`);
      }
    }

    this.state = AgentState.MONITORING;
  }

  /** Craft an initial engagement message */
  _craftMessage(opportunity, post) {
    const offering = opportunity.matchedOffering;
    const templates = [
      `Hey! I noticed you're looking for ${opportunity.need}. I can help with that - we offer ${offering.name} which ${offering.description}. Want to hear more?`,
      `Hi there! Saw your post about ${opportunity.need}. We have exactly what you need - ${offering.name}. ${offering.pitch || 'Would love to chat about how we can help!'}`,
      `Hey, looks like you could use ${offering.name}! ${offering.description}. Happy to share details if you're interested.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  /** Determine the next action in a conversation */
  _determineAction(conversation, reply) {
    const content = (reply.content || '').toLowerCase();
    const stage = conversation.stage;

    // Positive signals
    const buySignals = ['yes', 'interested', 'how much', 'price', 'sign me up', 'deal', 'let\'s do it', 'send link', 'register'];
    const negotiateSignals = ['too expensive', 'discount', 'cheaper', 'lower price', 'budget', 'negotiate', 'what else'];
    const closeSignals = ['agreed', 'done', 'perfect', 'sounds good', 'let\'s go', 'i\'m in', 'sign up', 'take it'];

    if (closeSignals.some(s => content.includes(s)) || (stage === 'negotiating' && buySignals.some(s => content.includes(s)))) {
      return {
        type: 'close',
        dealValue: conversation.offering?.price || 0,
      };
    }

    if (negotiateSignals.some(s => content.includes(s))) {
      return { type: 'negotiate' };
    }

    if (buySignals.some(s => content.includes(s))) {
      return stage === 'initial_contact' ? { type: 'negotiate' } : { type: 'close', dealValue: conversation.offering?.price || 0 };
    }

    return { type: 'followup' };
  }

  /** Craft a negotiation response */
  _craftNegotiationResponse(conversation, reply, action) {
    const offering = conversation.offering;
    return `Great question! ${offering.name} is priced at $${offering.price || 'competitive rates'}. ${offering.negotiationPitch || 'We can definitely work something out that fits your budget.'} What works for you?`;
  }

  /** Craft a closing message */
  _craftClosingMessage(conversation, action) {
    const offering = conversation.offering || {};
    const name = offering.name || 'our service';
    const link = offering.signupUrl || offering.actionUrl || '[signup link]';
    return `Awesome, let's make it happen! Here's how to get started with ${name}: ${link}. Looking forward to working with you!`;
  }

  /** Craft a follow-up message */
  _craftFollowUp(conversation, reply) {
    const offering = conversation.offering;
    return `Thanks for your reply! Just to recap, ${offering.name} can really help with what you're looking for. ${offering.description}. Any questions I can answer?`;
  }

  /** Get agent status summary */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      platform: this.platform?.name || 'unknown',
      state: this.state,
      stats: { ...this.stats },
      activeConversations: this.activeConversations.size,
      offerings: this.offerings.map(o => o.name),
      config: {
        groups: this.config.groups || [],
        pollIntervalMs: this.config.pollIntervalMs,
      },
    };
  }

  /** Serialize agent for persistence */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      platformName: this.platform?.name,
      config: this.config,
      offerings: this.offerings,
      state: this.state,
      stats: this.stats,
    };
  }
}

/** Default keyword-based opportunity matcher */
function defaultMatcher(post, offerings) {
  const text = `${post.title || ''} ${post.content || ''} ${post.body || ''}`.toLowerCase();

  for (const offering of offerings) {
    const keywords = offering.keywords || [];
    const matchedKeywords = keywords.filter(kw => text.includes(kw.toLowerCase()));

    if (matchedKeywords.length >= (offering.minKeywordMatch || 1)) {
      return {
        id: uuidv4(),
        need: matchedKeywords.join(', '),
        matchedOffering: offering,
        confidence: matchedKeywords.length / keywords.length,
        preferDM: offering.preferDM || false,
        postId: post.id,
      };
    }
  }

  return null;
}
