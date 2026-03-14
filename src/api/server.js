/**
 * Admin API Server - REST endpoints for managing agents, offerings,
 * deals, and monitoring the entire mini-agent system.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export function createAPIServer({ agentManager, db }) {
  const app = express();

  app.use(cors());
  app.use(helmet());
  app.use(express.json());

  // Simple auth middleware
  const authMiddleware = (req, res, next) => {
    const secret = req.headers['x-admin-secret'] || req.query.secret;
    const expected = process.env.ADMIN_SECRET || 'change-me-in-production';
    if (secret !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };

  // Health check (no auth)
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // =========== DASHBOARD ===========
  app.get('/api/dashboard', authMiddleware, (req, res) => {
    const agentStats = agentManager.getAggregateStats();
    const revenueStats = db.getRevenueStats();
    const recentDeals = db.getAllDeals(10);
    const recentOpportunities = db.getRecentOpportunities(10);

    res.json({
      agents: agentStats,
      revenue: revenueStats,
      recentDeals,
      recentOpportunities,
      platforms: agentManager.platformRegistry.list(),
    });
  });

  // =========== AGENTS ===========
  app.get('/api/agents', authMiddleware, (req, res) => {
    res.json(agentManager.getAllStatus());
  });

  app.post('/api/agents', authMiddleware, (req, res) => {
    try {
      const { name, platform, config, offeringIds } = req.body;
      const offerings = (offeringIds || []).map(id => db.getOffering(id)).filter(Boolean);
      const agent = agentManager.createAgent({
        name,
        platformName: platform,
        config: config || {},
        offerings,
      });
      res.status(201).json(agent.getStatus());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/agents/:id/start', authMiddleware, async (req, res) => {
    try {
      await agentManager.startAgent(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/agents/:id/pause', authMiddleware, (req, res) => {
    try {
      agentManager.pauseAgent(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/agents/:id/stop', authMiddleware, (req, res) => {
    try {
      agentManager.stopAgent(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/agents/:id', authMiddleware, (req, res) => {
    try {
      agentManager.removeAgent(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/agents/start-all', authMiddleware, async (req, res) => {
    await agentManager.startAll();
    res.json({ success: true, count: agentManager.agents.size });
  });

  app.post('/api/agents/stop-all', authMiddleware, (req, res) => {
    agentManager.stopAll();
    res.json({ success: true });
  });

  // =========== OFFERINGS ===========
  app.get('/api/offerings', authMiddleware, (req, res) => {
    res.json(db.getAllOfferings());
  });

  app.post('/api/offerings', authMiddleware, (req, res) => {
    try {
      const offering = {
        id: uuidv4(),
        name: req.body.name,
        description: req.body.description || '',
        keywords: req.body.keywords || [],
        price: req.body.price || 0,
        signupUrl: req.body.signupUrl || '',
        actionUrl: req.body.actionUrl || '',
        pitch: req.body.pitch || '',
        negotiationPitch: req.body.negotiationPitch || '',
        preferDM: req.body.preferDM || false,
        minKeywordMatch: req.body.minKeywordMatch || 1,
      };
      db.createOffering(offering);
      res.status(201).json(offering);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/offerings/:id', authMiddleware, (req, res) => {
    try {
      db.updateOffering(req.params.id, req.body);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/offerings/:id', authMiddleware, (req, res) => {
    db.deleteOffering(req.params.id);
    res.json({ success: true });
  });

  // =========== DEALS ===========
  app.get('/api/deals', authMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    res.json(db.getAllDeals(limit));
  });

  app.get('/api/deals/stats', authMiddleware, (req, res) => {
    res.json(db.getRevenueStats());
  });

  // =========== OPPORTUNITIES ===========
  app.get('/api/opportunities', authMiddleware, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(db.getRecentOpportunities(limit));
  });

  // =========== ADMIN PLANS ===========
  app.get('/api/plans', authMiddleware, (req, res) => {
    res.json(db.getAllPlans());
  });

  app.post('/api/plans', authMiddleware, (req, res) => {
    try {
      const { name, description, targetRevenue, config } = req.body;
      const result = db.createPlan({ name, description, targetRevenue, config });
      res.status(201).json({ id: result.lastInsertRowid, success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/plans/:id', authMiddleware, (req, res) => {
    try {
      db.updatePlan(parseInt(req.params.id), req.body);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // =========== PLATFORMS ===========
  app.get('/api/platforms', authMiddleware, (req, res) => {
    res.json(agentManager.platformRegistry.list());
  });

  // Error handler
  app.use((err, req, res, _next) => {
    logger.error(`API Error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
