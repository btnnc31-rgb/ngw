/**
 * Database - SQLite-based persistence layer for agents, deals, and offerings.
 * Uses better-sqlite3 for synchronous, fast local storage.
 */
import BetterSqlite3 from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

export class Database {
  constructor(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS offerings (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        keywords TEXT,
        price REAL DEFAULT 0,
        signup_url TEXT,
        action_url TEXT,
        pitch TEXT,
        negotiation_pitch TEXT,
        prefer_dm INTEGER DEFAULT 0,
        min_keyword_match INTEGER DEFAULT 1,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        conversation_id TEXT,
        deal_value REAL DEFAULT 0,
        offering TEXT,
        status TEXT DEFAULT 'closed',
        closed_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        post_id TEXT,
        platform TEXT,
        group_id TEXT,
        matched_offering TEXT,
        confidence REAL,
        status TEXT DEFAULT 'detected',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        target_user TEXT,
        platform TEXT,
        offering TEXT,
        stage TEXT DEFAULT 'initial_contact',
        messages TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS admin_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        target_revenue REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        config TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    logger.info('Database migrations complete');
  }

  // --- Agent operations ---
  upsertAgent(id, data) {
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, data, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
    `);
    stmt.run(id, data);
  }

  getAllAgents() {
    return this.db.prepare('SELECT * FROM agents').all();
  }

  getAgent(id) {
    return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  }

  removeAgent(id) {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  // --- Offering operations ---
  createOffering(offering) {
    const stmt = this.db.prepare(`
      INSERT INTO offerings (id, name, description, keywords, price, signup_url, action_url, pitch, negotiation_pitch, prefer_dm, min_keyword_match)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      offering.id, offering.name, offering.description,
      JSON.stringify(offering.keywords || []),
      offering.price || 0, offering.signupUrl || '', offering.actionUrl || '',
      offering.pitch || '', offering.negotiationPitch || '',
      offering.preferDM ? 1 : 0, offering.minKeywordMatch || 1
    );
  }

  getAllOfferings() {
    return this.db.prepare('SELECT * FROM offerings WHERE active = 1').all().map(row => ({
      ...row,
      keywords: JSON.parse(row.keywords || '[]'),
      preferDM: !!row.prefer_dm,
      minKeywordMatch: row.min_keyword_match,
      signupUrl: row.signup_url,
      actionUrl: row.action_url,
      negotiationPitch: row.negotiation_pitch,
    }));
  }

  getOffering(id) {
    const row = this.db.prepare('SELECT * FROM offerings WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      keywords: JSON.parse(row.keywords || '[]'),
      preferDM: !!row.prefer_dm,
      minKeywordMatch: row.min_keyword_match,
    };
  }

  updateOffering(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${dbKey} = ?`);
      values.push(key === 'keywords' ? JSON.stringify(val) : val);
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE offerings SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteOffering(id) {
    this.db.prepare('UPDATE offerings SET active = 0 WHERE id = ?').run(id);
  }

  // --- Deal operations ---
  recordDeal({ agentId, conversationId, dealValue, offering }) {
    const stmt = this.db.prepare(`
      INSERT INTO deals (agent_id, conversation_id, deal_value, offering)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(agentId, conversationId, dealValue, offering);
  }

  getAllDeals(limit = 100) {
    return this.db.prepare('SELECT * FROM deals ORDER BY closed_at DESC LIMIT ?').all(limit);
  }

  getDealsByAgent(agentId) {
    return this.db.prepare('SELECT * FROM deals WHERE agent_id = ? ORDER BY closed_at DESC').all(agentId);
  }

  getRevenueStats() {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_deals,
        COALESCE(SUM(deal_value), 0) as total_revenue,
        COALESCE(AVG(deal_value), 0) as avg_deal_value,
        COALESCE(MAX(deal_value), 0) as max_deal_value
      FROM deals
    `).get();
    return row;
  }

  // --- Opportunity operations ---
  recordOpportunity({ agentId, postId, platform, groupId, matchedOffering, confidence }) {
    const stmt = this.db.prepare(`
      INSERT INTO opportunities (agent_id, post_id, platform, group_id, matched_offering, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(agentId, postId, platform, groupId, matchedOffering, confidence);
  }

  getRecentOpportunities(limit = 50) {
    return this.db.prepare('SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  // --- Admin plan operations ---
  createPlan({ name, description, targetRevenue, config }) {
    const stmt = this.db.prepare(`
      INSERT INTO admin_plans (name, description, target_revenue, config)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(name, description, targetRevenue || 0, JSON.stringify(config || {}));
  }

  getAllPlans() {
    return this.db.prepare('SELECT * FROM admin_plans ORDER BY created_at DESC').all().map(p => ({
      ...p,
      config: JSON.parse(p.config || '{}'),
    }));
  }

  updatePlan(id, updates) {
    const fields = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      fields.push(`${dbKey} = ?`);
      values.push(key === 'config' ? JSON.stringify(val) : val);
    }
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE admin_plans SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  close() {
    this.db.close();
  }
}
