/**
 * NGW Minigent - AI Mini-Agent System
 *
 * Main entry point. Initializes the database, platform adapters,
 * agent manager, and admin API server.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Database } from './db/Database.js';
import { PlatformRegistry } from './core/PlatformRegistry.js';
import { AgentManager } from './core/AgentManager.js';
import { createAPIServer } from './api/server.js';
import { RedditAdapter } from './platforms/RedditAdapter.js';
import { DiscordAdapter } from './platforms/DiscordAdapter.js';
import { TelegramAdapter } from './platforms/TelegramAdapter.js';
import { FacebookAdapter } from './platforms/FacebookAdapter.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('=== NGW Minigent System Starting ===');

  // 1. Initialize database
  const dbPath = process.env.DB_PATH || './data/minigent.db';
  const db = new Database(dbPath);
  logger.info(`Database initialized at ${dbPath}`);

  // 2. Register platform adapters
  const platformRegistry = new PlatformRegistry();
  platformRegistry.register('reddit', new RedditAdapter());
  platformRegistry.register('discord', new DiscordAdapter());
  platformRegistry.register('telegram', new TelegramAdapter());
  platformRegistry.register('facebook', new FacebookAdapter());

  // Connect all platforms
  await platformRegistry.connectAll();

  // 3. Create agent manager
  const agentManager = new AgentManager({ db, platformRegistry });

  // Load any persisted agents
  agentManager.loadFromDB();

  // 4. Set up event logging
  agentManager.on('opportunityDetected', ({ agent, opportunity }) => {
    logger.info(`[Opportunity] Agent ${agent}: ${opportunity.need} (confidence: ${(opportunity.confidence * 100).toFixed(0)}%)`);
    db.recordOpportunity({
      agentId: agent,
      postId: opportunity.postId,
      platform: opportunity.matchedOffering?.platform || 'unknown',
      groupId: opportunity.groupId || '',
      matchedOffering: opportunity.matchedOffering?.name || '',
      confidence: opportunity.confidence,
    });
  });

  agentManager.on('dealInitiated', ({ agent, conversationId }) => {
    logger.info(`[Deal Initiated] Agent ${agent}, conversation ${conversationId}`);
  });

  agentManager.on('dealClosed', ({ agent, dealValue, offering }) => {
    logger.info(`[Deal Closed] Agent ${agent}: $${dealValue} for "${offering?.name || 'unknown'}"`);
  });

  // 5. Start API server
  const port = parseInt(process.env.PORT) || 4000;
  const app = createAPIServer({ agentManager, db });

  app.listen(port, () => {
    logger.info(`Admin API server running on port ${port}`);
    logger.info('=== NGW Minigent System Ready ===');
    logger.info(`Dashboard: http://localhost:${port}/api/dashboard`);
    logger.info(`Agents: http://localhost:${port}/api/agents`);
  });

  // 6. Graceful shutdown
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
