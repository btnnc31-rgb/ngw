/**
 * AdminNotifier - Sends real-time notifications and reports to admin
 * via their preferred channel (Telegram, Discord, email, webhook).
 * Provides scores, alerts, and summaries on demand.
 */
import { logger } from '../utils/logger.js';

export class AdminNotifier {
  constructor({ agentManager, db, config = {} }) {
    this.agentManager = agentManager;
    this.db = db;
    this.config = {
      notifyChannel: config.notifyChannel || process.env.ADMIN_NOTIFY_CHANNEL || 'console',
      telegramChatId: config.telegramChatId || process.env.ADMIN_TELEGRAM_CHAT_ID,
      telegramBotToken: config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN,
      discordWebhookUrl: config.discordWebhookUrl || process.env.ADMIN_DISCORD_WEBHOOK,
      webhookUrl: config.webhookUrl || process.env.ADMIN_WEBHOOK_URL,
      emailTo: config.emailTo || process.env.ADMIN_EMAIL,
      notifyOnDeal: config.notifyOnDeal !== false,
      notifyOnOpportunity: config.notifyOnOpportunity !== false,
      notifyOnError: config.notifyOnError !== false,
      dailyReport: config.dailyReport !== false,
      ...config,
    };
    this._setupListeners();
  }

  _setupListeners() {
    const mgr = this.agentManager;

    if (this.config.notifyOnDeal) {
      mgr.on('dealClosed', (data) => {
        this.send({
          type: 'deal_closed',
          title: 'Deal Closed!',
          message: `Agent ${data.agent} closed a deal worth $${data.dealValue || 0} for "${data.offering?.name || 'unknown'}"`,
          data,
          priority: 'high',
        });
      });

      mgr.on('dealInitiated', (data) => {
        this.send({
          type: 'deal_initiated',
          title: 'New Deal Started',
          message: `Agent ${data.agent} initiated a conversation (${data.conversationId?.slice(0, 8)})`,
          data,
          priority: 'normal',
        });
      });
    }

    if (this.config.notifyOnOpportunity) {
      mgr.on('opportunityDetected', (data) => {
        this.send({
          type: 'opportunity',
          title: 'Opportunity Detected',
          message: `Agent ${data.agent} found a match: "${data.opportunity?.need}" (confidence: ${((data.opportunity?.confidence || 0) * 100).toFixed(0)}%)`,
          data,
          priority: 'normal',
        });
      });
    }

    if (this.config.notifyOnError) {
      mgr.on('agentError', (data) => {
        this.send({
          type: 'error',
          title: 'Agent Error',
          message: `Agent ${data.agent}: ${data.error?.message || 'Unknown error'}`,
          data,
          priority: 'high',
        });
      });
    }
  }

  /**
   * Send a notification to the admin.
   * @param {{type, title, message, data, priority}} notification
   */
  async send(notification) {
    const channel = this.config.notifyChannel;
    const formatted = this._formatMessage(notification);

    try {
      switch (channel) {
        case 'telegram':
          await this._sendTelegram(formatted);
          break;
        case 'discord':
          await this._sendDiscord(formatted, notification);
          break;
        case 'webhook':
          await this._sendWebhook(notification);
          break;
        case 'console':
        default:
          this._sendConsole(notification);
          break;
      }
    } catch (err) {
      logger.error(`AdminNotifier: Failed to send via ${channel}: ${err.message}`);
      // Fallback to console
      this._sendConsole(notification);
    }

    // Log to database
    this.db.recordNotification?.(notification);
  }

  /** Generate a full report for the admin */
  generateReport() {
    const agentStats = this.agentManager.getAggregateStats();
    const revenueStats = this.db.getRevenueStats();
    const recentDeals = this.db.getAllDeals(10);
    const recentOpps = this.db.getRecentOpportunities(10);
    const agents = this.agentManager.getAllStatus();

    const activeAgents = agents.filter(a => a.state === 'monitoring').length;
    const pausedAgents = agents.filter(a => a.state === 'paused').length;

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalAgents: agents.length,
        activeAgents,
        pausedAgents,
        totalPostsMonitored: agentStats.totalPosts,
        totalOpportunities: agentStats.totalOpportunities,
        totalDealsInitiated: agentStats.totalDealsInitiated,
        totalDealsClosed: agentStats.totalDealsClosed,
        totalRevenue: revenueStats.total_revenue,
        avgDealValue: revenueStats.avg_deal_value,
        conversionRate: agentStats.conversionRate,
      },
      agents: agents.map(a => ({
        name: a.name,
        platform: a.platform,
        state: a.state,
        stats: a.stats,
        activeConversations: a.activeConversations,
      })),
      recentDeals,
      recentOpportunities: recentOpps,
      scores: this._calculateScores(agents, agentStats, revenueStats),
    };
  }

  /** Generate text report for sending via chat */
  generateTextReport() {
    const report = this.generateReport();
    const s = report.summary;
    const scores = report.scores;

    let text = `--- MINIGENT REPORT ---\n`;
    text += `Generated: ${report.generatedAt}\n\n`;
    text += `AGENTS: ${s.totalAgents} total (${s.activeAgents} active, ${s.pausedAgents} paused)\n`;
    text += `POSTS MONITORED: ${s.totalPostsMonitored}\n`;
    text += `OPPORTUNITIES: ${s.totalOpportunities}\n`;
    text += `DEALS: ${s.totalDealsInitiated} initiated, ${s.totalDealsClosed} closed\n`;
    text += `REVENUE: $${s.totalRevenue.toFixed(2)} (avg $${s.avgDealValue.toFixed(2)}/deal)\n`;
    text += `CONVERSION: ${s.conversionRate}%\n\n`;
    text += `SCORES:\n`;
    text += `  Overall Health: ${scores.overallHealth}/100\n`;
    text += `  Efficiency: ${scores.efficiency}/100\n`;
    text += `  Revenue Score: ${scores.revenueScore}/100\n`;
    text += `  Activity Score: ${scores.activityScore}/100\n\n`;

    if (report.agents.length > 0) {
      text += `TOP AGENTS:\n`;
      const sorted = [...report.agents].sort((a, b) => (b.stats?.dealsClosed || 0) - (a.stats?.dealsClosed || 0));
      for (const agent of sorted.slice(0, 5)) {
        text += `  ${agent.name} (${agent.platform}): ${agent.stats?.dealsClosed || 0} deals, $${agent.stats?.revenue || 0}\n`;
      }
    }

    return text;
  }

  /** Calculate performance scores */
  _calculateScores(agents, agentStats, revenueStats) {
    const activeRatio = agents.length > 0
      ? agents.filter(a => a.state === 'monitoring').length / agents.length
      : 0;

    const conversionRate = agentStats.totalDealsInitiated > 0
      ? agentStats.totalDealsClosed / agentStats.totalDealsInitiated
      : 0;

    const efficiency = Math.min(100, Math.round(conversionRate * 200));
    const activityScore = Math.min(100, Math.round(activeRatio * 100));
    const revenueScore = Math.min(100, Math.round((revenueStats.total_revenue / Math.max(1, agents.length)) / 10));
    const overallHealth = Math.round((efficiency + activityScore + revenueScore) / 3);

    return {
      overallHealth,
      efficiency,
      revenueScore,
      activityScore,
    };
  }

  _formatMessage(notification) {
    const emoji = {
      deal_closed: '[DEAL]',
      deal_initiated: '[NEW]',
      opportunity: '[OPP]',
      error: '[ERR]',
      report: '[RPT]',
      info: '[INFO]',
    };
    const prefix = emoji[notification.type] || '[NGW]';
    return `${prefix} ${notification.title}\n${notification.message}`;
  }

  async _sendTelegram(text) {
    if (!this.config.telegramChatId || !this.config.telegramBotToken) return;
    await fetch(`https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.config.telegramChatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
  }

  async _sendDiscord(text, notification) {
    if (!this.config.discordWebhookUrl) return;
    await fetch(this.config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        embeds: notification.priority === 'high' ? [{
          title: notification.title,
          description: notification.message,
          color: notification.type === 'error' ? 0xff0000 : 0x00ff00,
          timestamp: new Date().toISOString(),
        }] : undefined,
      }),
    });
  }

  async _sendWebhook(notification) {
    if (!this.config.webhookUrl) return;
    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...notification,
        timestamp: new Date().toISOString(),
        source: 'ngw-minigent',
      }),
    });
  }

  _sendConsole(notification) {
    const formatted = this._formatMessage(notification);
    if (notification.priority === 'high') {
      logger.warn(`ADMIN: ${formatted}`);
    } else {
      logger.info(`ADMIN: ${formatted}`);
    }
  }
}
