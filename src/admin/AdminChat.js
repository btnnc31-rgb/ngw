/**
 * AdminChat - Interactive admin interface for querying agents,
 * getting help, issuing commands, and receiving intelligent responses.
 * Works via API and can be integrated with Telegram/Discord for direct chat.
 */
import { logger } from '../utils/logger.js';

export class AdminChat {
  constructor({ agentManager, db, notifier, scoringEngine }) {
    this.agentManager = agentManager;
    this.db = db;
    this.notifier = notifier;
    this.scoringEngine = scoringEngine;
    this.conversationHistory = [];
  }

  /**
   * Process an admin message and return an intelligent response.
   * Supports natural language commands and queries.
   * @param {string} message - The admin's message
   * @returns {{response: string, data?: any, action?: string}}
   */
  async processMessage(message) {
    const lower = message.toLowerCase().trim();
    this.conversationHistory.push({ role: 'admin', content: message, timestamp: new Date().toISOString() });

    let result;

    // --- Status & Reports ---
    if (this._matches(lower, ['status', 'how are things', 'what\'s happening', 'overview', 'dashboard'])) {
      result = this._handleStatus();
    }
    else if (this._matches(lower, ['report', 'full report', 'give me a report', 'summary'])) {
      result = this._handleReport();
    }
    else if (this._matches(lower, ['scores', 'performance', 'how are we doing', 'metrics'])) {
      result = this._handleScores();
    }
    else if (this._matches(lower, ['revenue', 'money', 'earnings', 'income', 'how much'])) {
      result = this._handleRevenue();
    }

    // --- Agent Management ---
    else if (this._matches(lower, ['list agents', 'show agents', 'agents', 'who is running'])) {
      result = this._handleListAgents();
    }
    else if (lower.startsWith('start agent') || lower.startsWith('run agent')) {
      result = await this._handleStartAgent(lower);
    }
    else if (lower.startsWith('stop agent') || lower.startsWith('pause agent')) {
      result = await this._handleStopAgent(lower);
    }
    else if (this._matches(lower, ['start all', 'run all', 'activate all', 'launch all'])) {
      result = await this._handleStartAll();
    }
    else if (this._matches(lower, ['stop all', 'pause all', 'halt all', 'shutdown'])) {
      result = this._handleStopAll();
    }
    else if (lower.startsWith('create agent') || lower.startsWith('new agent')) {
      result = this._handleCreateAgentHelp();
    }

    // --- Deals ---
    else if (this._matches(lower, ['deals', 'recent deals', 'show deals', 'closed deals'])) {
      result = this._handleDeals();
    }
    else if (this._matches(lower, ['opportunities', 'recent opportunities', 'opps', 'leads'])) {
      result = this._handleOpportunities();
    }

    // --- Offerings ---
    else if (this._matches(lower, ['offerings', 'products', 'services', 'what are we selling'])) {
      result = this._handleOfferings();
    }

    // --- Plans ---
    else if (this._matches(lower, ['plans', 'revenue plans', 'targets', 'goals'])) {
      result = this._handlePlans();
    }

    // --- Platforms ---
    else if (this._matches(lower, ['platforms', 'connections', 'integrations', 'which platforms'])) {
      result = this._handlePlatforms();
    }

    // --- Help ---
    else if (this._matches(lower, ['help', 'commands', 'what can you do', 'guide', '?'])) {
      result = this._handleHelp();
    }

    // --- Recommendations ---
    else if (this._matches(lower, ['recommend', 'suggestion', 'advice', 'what should i do', 'optimize'])) {
      result = this._handleRecommendations();
    }

    // --- Fallback ---
    else {
      result = this._handleFallback(message);
    }

    this.conversationHistory.push({ role: 'system', content: result.response, timestamp: new Date().toISOString() });
    return result;
  }

  _matches(text, keywords) {
    return keywords.some(kw => text.includes(kw));
  }

  _handleStatus() {
    const stats = this.agentManager.getAggregateStats();
    const agents = this.agentManager.getAllStatus();
    const active = agents.filter(a => a.state === 'monitoring').length;

    let response = `Here's the current status:\n\n`;
    response += `Agents: ${agents.length} total, ${active} active\n`;
    response += `Posts monitored: ${stats.totalPosts}\n`;
    response += `Opportunities found: ${stats.totalOpportunities}\n`;
    response += `Deals: ${stats.totalDealsInitiated} started, ${stats.totalDealsClosed} closed\n`;
    response += `Revenue: $${stats.totalRevenue.toFixed(2)}\n`;
    response += `Messages sent: ${stats.totalMessages}\n`;

    if (active === 0 && agents.length > 0) {
      response += `\nHeads up: no agents are currently running. Say "start all" to activate them.`;
    }

    return { response, data: stats, action: 'status' };
  }

  _handleReport() {
    const textReport = this.notifier.generateTextReport();
    return { response: textReport, action: 'report' };
  }

  _handleScores() {
    const report = this.notifier.generateReport();
    const scores = report.scores;

    let response = `Performance Scores:\n\n`;
    response += `Overall Health: ${scores.overallHealth}/100\n`;
    response += `Efficiency: ${scores.efficiency}/100 (conversion quality)\n`;
    response += `Revenue Score: ${scores.revenueScore}/100 (revenue per agent)\n`;
    response += `Activity Score: ${scores.activityScore}/100 (agents uptime)\n\n`;

    if (scores.overallHealth < 30) {
      response += `Things need attention. Consider adding more agents or adjusting offering keywords.`;
    } else if (scores.overallHealth < 60) {
      response += `Decent performance. Some room for improvement in ${scores.efficiency < scores.activityScore ? 'conversion rate' : 'agent activity'}.`;
    } else {
      response += `Looking strong! Keep the momentum going.`;
    }

    return { response, data: scores, action: 'scores' };
  }

  _handleRevenue() {
    const revenueStats = this.db.getRevenueStats();
    const recentDeals = this.db.getAllDeals(5);

    let response = `Revenue Overview:\n\n`;
    response += `Total revenue: $${revenueStats.total_revenue.toFixed(2)}\n`;
    response += `Total deals closed: ${revenueStats.total_deals}\n`;
    response += `Average deal value: $${revenueStats.avg_deal_value.toFixed(2)}\n`;
    response += `Largest deal: $${revenueStats.max_deal_value.toFixed(2)}\n`;

    if (recentDeals.length > 0) {
      response += `\nRecent deals:\n`;
      for (const deal of recentDeals) {
        response += `  - $${deal.deal_value} for "${deal.offering}" (${deal.closed_at})\n`;
      }
    }

    return { response, data: revenueStats, action: 'revenue' };
  }

  _handleListAgents() {
    const agents = this.agentManager.getAllStatus();

    if (agents.length === 0) {
      return { response: 'No agents configured yet. Create one via the API or say "create agent" for instructions.', action: 'list_agents' };
    }

    let response = `Agents (${agents.length}):\n\n`;
    for (const agent of agents) {
      const stateIcon = { monitoring: 'ACTIVE', paused: 'PAUSED', idle: 'IDLE', error: 'ERROR' };
      response += `[${stateIcon[agent.state] || agent.state.toUpperCase()}] ${agent.name} (${agent.platform})\n`;
      response += `  Deals: ${agent.stats.dealsClosed} closed, $${agent.stats.revenue} revenue\n`;
      response += `  Posts: ${agent.stats.postsMonitored} monitored, ${agent.stats.opportunitiesDetected} opportunities\n`;
      response += `  Groups: ${agent.config.groups?.join(', ') || 'none'}\n\n`;
    }

    return { response, data: agents, action: 'list_agents' };
  }

  async _handleStartAgent(command) {
    const parts = command.split(' ');
    const nameOrId = parts.slice(2).join(' ').trim();

    if (!nameOrId) {
      return { response: 'Which agent? Say "start agent <name>" or "start all".', action: 'start_agent' };
    }

    // Find by name or id
    const agents = this.agentManager.getAllStatus();
    const agent = agents.find(a => a.name === nameOrId || a.id === nameOrId || a.id.startsWith(nameOrId));

    if (!agent) {
      return { response: `Couldn't find an agent matching "${nameOrId}". Use "list agents" to see available agents.`, action: 'start_agent' };
    }

    try {
      await this.agentManager.startAgent(agent.id);
      return { response: `Started agent "${agent.name}" on ${agent.platform}. It's now monitoring.`, action: 'start_agent' };
    } catch (err) {
      return { response: `Failed to start "${agent.name}": ${err.message}`, action: 'start_agent' };
    }
  }

  async _handleStopAgent(command) {
    const action = command.startsWith('pause') ? 'pause' : 'stop';
    const parts = command.split(' ');
    const nameOrId = parts.slice(2).join(' ').trim();

    if (!nameOrId) {
      return { response: `Which agent? Say "${action} agent <name>".`, action: `${action}_agent` };
    }

    const agents = this.agentManager.getAllStatus();
    const agent = agents.find(a => a.name === nameOrId || a.id === nameOrId || a.id.startsWith(nameOrId));

    if (!agent) {
      return { response: `Couldn't find agent "${nameOrId}".`, action: `${action}_agent` };
    }

    try {
      if (action === 'pause') {
        this.agentManager.pauseAgent(agent.id);
      } else {
        this.agentManager.stopAgent(agent.id);
      }
      return { response: `${action === 'pause' ? 'Paused' : 'Stopped'} agent "${agent.name}".`, action: `${action}_agent` };
    } catch (err) {
      return { response: `Failed: ${err.message}`, action: `${action}_agent` };
    }
  }

  async _handleStartAll() {
    await this.agentManager.startAll();
    const count = this.agentManager.agents.size;
    return { response: `All ${count} agents are now running.`, action: 'start_all' };
  }

  _handleStopAll() {
    this.agentManager.stopAll();
    return { response: 'All agents stopped.', action: 'stop_all' };
  }

  _handleCreateAgentHelp() {
    const response = `To create a new agent, use the API:\n\n` +
      `POST /api/agents\n` +
      `{\n` +
      `  "name": "my-reddit-bot",\n` +
      `  "platform": "reddit|discord|telegram|facebook|twitter|linkedin",\n` +
      `  "config": {\n` +
      `    "groups": ["subreddit1", "channel_id"],\n` +
      `    "pollIntervalMs": 30000\n` +
      `  },\n` +
      `  "offeringIds": ["<offering-id>"]\n` +
      `}\n\n` +
      `Available platforms: reddit, discord, telegram, facebook, twitter, linkedin\n` +
      `Make sure you've created offerings first via POST /api/offerings.`;

    return { response, action: 'create_agent_help' };
  }

  _handleDeals() {
    const deals = this.db.getAllDeals(10);

    if (deals.length === 0) {
      return { response: 'No deals closed yet. Agents need to be running and monitoring groups to find opportunities.', action: 'deals' };
    }

    let response = `Recent Deals (${deals.length}):\n\n`;
    for (const deal of deals) {
      response += `  $${deal.deal_value} - "${deal.offering}" by agent ${deal.agent_id.slice(0, 8)} (${deal.closed_at})\n`;
    }

    return { response, data: deals, action: 'deals' };
  }

  _handleOpportunities() {
    const opps = this.db.getRecentOpportunities(10);

    if (opps.length === 0) {
      return { response: 'No opportunities detected yet. Make sure agents are running with proper keyword-matched offerings.', action: 'opportunities' };
    }

    let response = `Recent Opportunities (${opps.length}):\n\n`;
    for (const opp of opps) {
      response += `  "${opp.matched_offering}" on ${opp.platform} (confidence: ${(opp.confidence * 100).toFixed(0)}%) - ${opp.created_at}\n`;
    }

    return { response, data: opps, action: 'opportunities' };
  }

  _handleOfferings() {
    const offerings = this.db.getAllOfferings();

    if (offerings.length === 0) {
      return { response: 'No offerings configured. Create one via POST /api/offerings with name, keywords, and price.', action: 'offerings' };
    }

    let response = `Active Offerings (${offerings.length}):\n\n`;
    for (const off of offerings) {
      response += `  ${off.name} - $${off.price}\n`;
      response += `    Keywords: ${off.keywords.join(', ')}\n`;
      response += `    ${off.description}\n\n`;
    }

    return { response, data: offerings, action: 'offerings' };
  }

  _handlePlans() {
    const plans = this.db.getAllPlans();

    if (plans.length === 0) {
      return { response: 'No plans created yet. Create a revenue plan via POST /api/plans.', action: 'plans' };
    }

    let response = `Revenue Plans (${plans.length}):\n\n`;
    for (const plan of plans) {
      const revenueStats = this.db.getRevenueStats();
      const progress = plan.target_revenue > 0
        ? ((revenueStats.total_revenue / plan.target_revenue) * 100).toFixed(1)
        : '0';
      response += `  "${plan.name}" - Target: $${plan.target_revenue} (${progress}% achieved)\n`;
      response += `    ${plan.description || ''}\n`;
      response += `    Status: ${plan.status}\n\n`;
    }

    return { response, data: plans, action: 'plans' };
  }

  _handlePlatforms() {
    const platforms = this.agentManager.platformRegistry.list();

    let response = `Registered Platforms (${platforms.length}):\n\n`;
    for (const p of platforms) {
      response += `  ${p.name} - ${p.connected ? 'Connected' : 'Disconnected'} (${p.type})\n`;
    }
    response += `\nTo add API credentials, update your .env file with the platform's tokens.`;

    return { response, data: platforms, action: 'platforms' };
  }

  _handleHelp() {
    const response = `Here's what I can help with:\n\n` +
      `STATUS & REPORTS:\n` +
      `  "status" - Current system overview\n` +
      `  "report" - Full detailed report with scores\n` +
      `  "scores" / "performance" - Performance metrics\n` +
      `  "revenue" - Revenue and deal stats\n\n` +
      `AGENT MANAGEMENT:\n` +
      `  "list agents" - Show all agents\n` +
      `  "start agent <name>" - Start a specific agent\n` +
      `  "stop agent <name>" - Stop a specific agent\n` +
      `  "start all" - Activate all agents\n` +
      `  "stop all" - Stop all agents\n` +
      `  "create agent" - Instructions to create a new agent\n\n` +
      `DATA:\n` +
      `  "deals" - Recent closed deals\n` +
      `  "opportunities" - Recent detected opportunities\n` +
      `  "offerings" - Current products/services\n` +
      `  "plans" - Revenue plans and targets\n` +
      `  "platforms" - Connected platforms\n\n` +
      `STRATEGY:\n` +
      `  "recommend" / "optimize" - Get strategic recommendations\n\n` +
      `Just type naturally - I'll understand what you need.`;

    return { response, action: 'help' };
  }

  _handleRecommendations() {
    const report = this.notifier.generateReport();
    const agents = report.agents;
    const scores = report.scores;
    const stats = report.summary;

    const recommendations = [];

    if (agents.length === 0) {
      recommendations.push('Create your first agent! Start with Reddit or Discord - they have the most active communities.');
    }

    if (scores.activityScore < 50) {
      recommendations.push(`Only ${stats.activeAgents}/${stats.totalAgents} agents are active. Start the idle ones to increase coverage.`);
    }

    if (scores.efficiency < 30 && stats.totalDealsInitiated > 5) {
      recommendations.push('Conversion rate is low. Consider refining your offering keywords or improving message templates for better engagement.');
    }

    if (stats.totalOpportunities > 0 && stats.totalDealsInitiated === 0) {
      recommendations.push('Opportunities are being detected but no deals initiated. Check that agents have proper offerings configured.');
    }

    if (stats.totalDealsClosed > 0 && stats.avgDealValue < 10) {
      recommendations.push('Average deal value is low. Consider promoting higher-value offerings or adding upsell tiers.');
    }

    const offerings = this.db.getAllOfferings();
    if (offerings.length < 3) {
      recommendations.push('Add more offerings to cover different niches. More variety means more keyword matches.');
    }

    const platforms = this.agentManager.platformRegistry.list();
    const usedPlatforms = new Set(agents.map(a => a.platform));
    const unusedPlatforms = platforms.filter(p => !usedPlatforms.has(p.name));
    if (unusedPlatforms.length > 0) {
      recommendations.push(`You're not using ${unusedPlatforms.map(p => p.name).join(', ')} yet. Create agents for those platforms to expand reach.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Everything looks good! Keep monitoring and let the agents work. Consider A/B testing different message templates.');
    }

    let response = `Recommendations:\n\n`;
    recommendations.forEach((rec, i) => {
      response += `${i + 1}. ${rec}\n`;
    });

    return { response, data: recommendations, action: 'recommendations' };
  }

  _handleFallback(message) {
    return {
      response: `I'm not sure what you're asking about. Here's what I can help with:\n\n` +
        `- "status" for system overview\n` +
        `- "report" for detailed report\n` +
        `- "agents" to see all agents\n` +
        `- "revenue" for financial stats\n` +
        `- "help" for full command list\n\n` +
        `Just ask naturally and I'll do my best to help!`,
      action: 'fallback',
    };
  }
}
