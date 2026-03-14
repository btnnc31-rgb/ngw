/**
 * AgentManager - Orchestrates multiple agents, handles lifecycle,
 * persistence, and provides a centralized control plane.
 */
import EventEmitter from 'eventemitter3';
import { Agent } from './Agent.js';
import { logger } from '../utils/logger.js';

export class AgentManager extends EventEmitter {
  constructor({ db, platformRegistry }) {
    super();
    this.db = db;
    this.platformRegistry = platformRegistry;
    this.agents = new Map();
    this._setupEventForwarding();
  }

  /** Create and register a new agent */
  createAgent({ name, platformName, config, offerings }) {
    const platform = this.platformRegistry.get(platformName);
    if (!platform) {
      throw new Error(`Platform "${platformName}" not registered`);
    }

    const agent = new Agent({ name, platform, config, offerings });
    this.agents.set(agent.id, agent);

    // Forward agent events
    agent.on('opportunityDetected', (data) => this.emit('opportunityDetected', data));
    agent.on('dealInitiated', (data) => this.emit('dealInitiated', data));
    agent.on('dealClosed', (data) => this._onDealClosed(data));
    agent.on('error', (data) => this.emit('agentError', data));
    agent.on('stateChange', (data) => this.emit('agentStateChange', data));

    // Persist
    this._persistAgent(agent);

    logger.info(`Created agent "${agent.name}" (${agent.id}) on platform "${platformName}"`);
    return agent;
  }

  /** Start a specific agent */
  async startAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    await agent.start();
    this._persistAgent(agent);
  }

  /** Start all agents */
  async startAll() {
    const promises = [];
    for (const agent of this.agents.values()) {
      promises.push(agent.start());
    }
    await Promise.allSettled(promises);
    logger.info(`Started ${this.agents.size} agents`);
  }

  /** Pause a specific agent */
  pauseAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.pause();
    this._persistAgent(agent);
  }

  /** Stop a specific agent */
  stopAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.stop();
    this._persistAgent(agent);
  }

  /** Stop all agents */
  stopAll() {
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    logger.info('All agents stopped');
  }

  /** Remove an agent */
  removeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.stop();
    this.agents.delete(agentId);
    this.db.removeAgent(agentId);
    logger.info(`Removed agent ${agentId}`);
  }

  /** Get status of all agents */
  getAllStatus() {
    const statuses = [];
    for (const agent of this.agents.values()) {
      statuses.push(agent.getStatus());
    }
    return statuses;
  }

  /** Get aggregate stats */
  getAggregateStats() {
    let totalPosts = 0;
    let totalOpportunities = 0;
    let totalDealsInitiated = 0;
    let totalDealsClosed = 0;
    let totalRevenue = 0;
    let totalMessages = 0;

    for (const agent of this.agents.values()) {
      totalPosts += agent.stats.postsMonitored;
      totalOpportunities += agent.stats.opportunitiesDetected;
      totalDealsInitiated += agent.stats.dealsInitiated;
      totalDealsClosed += agent.stats.dealsClosed;
      totalRevenue += agent.stats.revenue;
      totalMessages += agent.stats.messagessSent;
    }

    return {
      agentCount: this.agents.size,
      totalPosts,
      totalOpportunities,
      totalDealsInitiated,
      totalDealsClosed,
      totalRevenue,
      totalMessages,
      conversionRate: totalDealsInitiated > 0 ? (totalDealsClosed / totalDealsInitiated * 100).toFixed(1) : 0,
    };
  }

  /** Load agents from database */
  loadFromDB() {
    const rows = this.db.getAllAgents();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data);
        const platform = this.platformRegistry.get(data.platformName);
        if (!platform) {
          logger.warn(`Skipping agent ${row.id}: platform "${data.platformName}" not registered`);
          continue;
        }
        const agent = new Agent({
          id: row.id,
          name: data.name,
          platform,
          config: data.config,
          offerings: data.offerings,
        });
        agent.stats = data.stats || agent.stats;
        this.agents.set(agent.id, agent);

        // Forward events
        agent.on('opportunityDetected', (d) => this.emit('opportunityDetected', d));
        agent.on('dealInitiated', (d) => this.emit('dealInitiated', d));
        agent.on('dealClosed', (d) => this._onDealClosed(d));
        agent.on('error', (d) => this.emit('agentError', d));
        agent.on('stateChange', (d) => this.emit('agentStateChange', d));
      } catch (err) {
        logger.error(`Failed to load agent ${row.id}: ${err.message}`);
      }
    }
    logger.info(`Loaded ${this.agents.size} agents from database`);
  }

  /** Persist agent to database */
  _persistAgent(agent) {
    this.db.upsertAgent(agent.id, JSON.stringify(agent.toJSON()));
  }

  /** Handle deal closed event */
  _onDealClosed(data) {
    this.emit('dealClosed', data);
    this.db.recordDeal({
      agentId: data.agent,
      conversationId: data.conversationId,
      dealValue: data.dealValue,
      offering: data.offering?.name || 'unknown',
    });
    // Update persisted stats
    const agent = this.agents.get(data.agent);
    if (agent) this._persistAgent(agent);
  }

  _setupEventForwarding() {
    this.on('dealClosed', (data) => {
      logger.info(`Deal closed by agent ${data.agent}: $${data.dealValue} for "${data.offering?.name || 'unknown'}"`);
    });
  }
}
