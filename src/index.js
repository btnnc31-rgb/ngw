/**
 * NGW Minigent - AI Mini-Agent System
 *
 * Main entry point. Initializes all subsystems:
 * - Database persistence
 * - Platform adapters (Reddit, Discord, Telegram, Facebook, Twitter, LinkedIn)
 * - Agent manager with scoring, rate limiting, and smart templates
 * - Admin notification system
 * - Admin chat interface
 * - Webhook receiver for real-time events
 * - REST API server
 */
import dotenv from 'dotenv';
dotenv.config();

import { Database } from './db/Database.js';
import { PlatformRegistry } from './core/PlatformRegistry.js';
import { AgentManager } from './core/AgentManager.js';
import { ScoringEngine } from './core/ScoringEngine.js';
import { RateLimiter } from './core/RateLimiter.js';
import { createAPIServer } from './api/server.js';
import { RedditAdapter } from './platforms/RedditAdapter.js';
import { DiscordAdapter } from './platforms/DiscordAdapter.js';
import { TelegramAdapter } from './platforms/TelegramAdapter.js';
import { FacebookAdapter } from './platforms/FacebookAdapter.js';
import { TwitterAdapter } from './platforms/TwitterAdapter.js';
import { LinkedInAdapter } from './platforms/LinkedInAdapter.js';
import { WebhookReceiver } from './platforms/WebhookReceiver.js';
import { AdminNotifier } from './admin/AdminNotifier.js';
import { AdminChat } from './admin/AdminChat.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('=== NGW Minigent System Starting ===');

  // 1. Initialize database
  const dbPath = process.env.DB_PATH || './data/minigent.db';
  const db = new Database(dbPath);
  logger.info(`Database initialized at ${dbPath}`);

  // 2. Initialize scoring engine and rate limiter
  const scoringEngine = new ScoringEngine({ db });
  const rateLimiter = new RateLimiter();
  logger.info('Scoring engine and rate limiter initialized');

  // 3. Register platform adapters
  const platformRegistry = new PlatformRegistry();
  platformRegistry.register('reddit', new RedditAdapter());
  platformRegistry.register('discord', new DiscordAdapter());
  platformRegistry.register('telegram', new TelegramAdapter());
  platformRegistry.register('facebook', new FacebookAdapter());
  platformRegistry.register('twitter', new TwitterAdapter());
  platformRegistry.register('linkedin', new LinkedInAdapter());

  // Connect all platforms
  await platformRegistry.connectAll();

  // 4. Create agent manager (passes scoring + rate limiter to agents)
  const agentManager = new AgentManager({ db, platformRegistry, scoringEngine, rateLimiter });

  // Load any persisted agents
  agentManager.loadFromDB();

  // 5. Initialize admin notification system
  const adminNotifier = new AdminNotifier({ agentManager, db });
  logger.info(`Admin notifications via: ${adminNotifier.config.notifyChannel}`);

  // 6. Initialize admin chat interface
  const adminChat = new AdminChat({ agentManager, db, notifier: adminNotifier, scoringEngine });

  // 7. Initialize webhook receiver
  const webhookReceiver = new WebhookReceiver({ agentManager });

  // Handle webhook posts - route them to matching agents
  agentManager.on('webhookPost', async ({ platform, post }) => {
    logger.info(`[Webhook] Post from ${platform}: ${post.content?.slice(0, 80)}`);
    // Find agents on this platform and let them process the post
    for (const agent of agentManager.agents.values()) {
      if (agent.platform?.name === platform && agent.state === 'monitoring') {
        const opportunity = await agent._analyzePost(post);
        if (opportunity) {
          agent.stats.opportunitiesDetected++;
          agentManager.emit('opportunityDetected', { agent: agent.id, opportunity, post });
          await agent._engageOpportunity(opportunity, post);
        }
      }
    }
  });

  // 8. Set up event logging
  agentManager.on('opportunityDetected', ({ agent, opportunity }) => {
    logger.info(`[Opportunity] Agent ${agent}: ${opportunity.need} (confidence: ${((opportunity.confidence || 0) * 100).toFixed(0)}%, score: ${opportunity.score?.score || 'N/A'})`);
    db.recordOpportunity({
      agentId: agent,
      postId: opportunity.postId,
      platform: opportunity.matchedOffering?.platform || 'unknown',
      groupId: opportunity.groupId || '',
      matchedOffering: opportunity.matchedOffering?.name || '',
      confidence: opportunity.confidence,
    });
  });

  agentManager.on('dealInitiated', ({ agent, conversationId, score }) => {
    logger.info(`[Deal Initiated] Agent ${agent}, conversation ${conversationId}${score ? ` (score: ${score.score})` : ''}`);
  });

  agentManager.on('dealClosed', ({ agent, dealValue, offering }) => {
    logger.info(`[Deal Closed] Agent ${agent}: $${dealValue} for "${offering?.name || 'unknown'}"`);
  });

  agentManager.on('leadScored', ({ agent, conversationId, score }) => {
    logger.info(`[Lead Scored] Agent ${agent}, conv ${conversationId}: ${score.score}/100 (${score.grade}) - ${score.recommendation}`);
  });

  // 9. Start API server
  const port = parseInt(process.env.PORT) || 4000;
  const app = createAPIServer({
    agentManager, db, adminChat, adminNotifier,
    scoringEngine, rateLimiter, webhookReceiver,
  });

  app.listen(port, () => {
    logger.info(`Admin API server running on port ${port}`);
    logger.info('=== NGW Minigent System Ready ===');
    logger.info('');
    logger.info('Endpoints:');
    logger.info(`  Dashboard:    http://localhost:${port}/api/dashboard`);
    logger.info(`  Agents:       http://localhost:${port}/api/agents`);
    logger.info(`  Admin Chat:   http://localhost:${port}/api/admin/chat`);
    logger.info(`  Report:       http://localhost:${port}/api/admin/report`);
    logger.info(`  Scoring:      http://localhost:${port}/api/scoring/agents`);
    logger.info(`  Rate Limits:  http://localhost:${port}/api/ratelimits`);
    logger.info(`  Webhooks:     http://localhost:${port}/webhooks/:platform`);
    logger.info('');
    logger.info('Platforms: ' + platformRegistry.list().map(p => `${p.name}(${p.connected ? 'ok' : 'off'})`).join(', '));
  });

  // 10. Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    agentManager.stopAll();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
