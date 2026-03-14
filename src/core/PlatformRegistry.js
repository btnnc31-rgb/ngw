/**
 * PlatformRegistry - Manages platform adapters.
 * Each platform adapter provides a consistent interface for monitoring
 * and interacting with different social platforms.
 */
import { logger } from '../utils/logger.js';

export class PlatformRegistry {
  constructor() {
    this.platforms = new Map();
  }

  /** Register a platform adapter */
  register(name, adapter) {
    if (this.platforms.has(name)) {
      logger.warn(`Platform "${name}" already registered, overwriting`);
    }
    this.platforms.set(name, adapter);
    logger.info(`Platform "${name}" registered`);
  }

  /** Get a platform adapter by name */
  get(name) {
    return this.platforms.get(name) || null;
  }

  /** List all registered platforms */
  list() {
    return Array.from(this.platforms.entries()).map(([name, adapter]) => ({
      name,
      type: adapter.constructor.name,
      connected: adapter.isConnected?.() ?? false,
    }));
  }

  /** Connect all platforms */
  async connectAll() {
    for (const [name, adapter] of this.platforms) {
      try {
        if (adapter.connect) {
          await adapter.connect();
          logger.info(`Platform "${name}" connected`);
        }
      } catch (err) {
        logger.error(`Failed to connect platform "${name}": ${err.message}`);
      }
    }
  }

  /** Disconnect all platforms */
  async disconnectAll() {
    for (const [name, adapter] of this.platforms) {
      try {
        if (adapter.disconnect) {
          await adapter.disconnect();
        }
      } catch (err) {
        logger.error(`Failed to disconnect platform "${name}": ${err.message}`);
      }
    }
  }
}
