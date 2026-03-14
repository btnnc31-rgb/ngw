/**
 * Unit tests for the Admin API endpoints.
 */
import http from 'http';

const results = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
  return fn().then(() => {
    results.passed++;
    console.log(`  PASS: ${name}`);
  }).catch(err => {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`  FAIL: ${name} - ${err.message}`);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(message || `Expected ${expected}, got ${actual}`);
}

async function request(port, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': 'test-secret',
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  // Set env before imports
  process.env.ADMIN_SECRET = 'test-secret';
  process.env.DB_PATH = ':memory:';

  const { Database } = await import('../../src/db/Database.js');
  const { PlatformRegistry } = await import('../../src/core/PlatformRegistry.js');
  const { AgentManager } = await import('../../src/core/AgentManager.js');
  const { createAPIServer } = await import('../../src/api/server.js');

  // Mock platform
  class MockPlatform {
    constructor() { this.name = 'mock'; }
    isConnected() { return true; }
    async fetchNewPosts() { return []; }
    async sendMessage() { return { success: true }; }
    async checkReplies() { return []; }
  }

  // Use in-memory database for testing
  const db = new Database(':memory:');
  const platformRegistry = new PlatformRegistry();
  platformRegistry.register('mock', new MockPlatform());

  const agentManager = new AgentManager({ db, platformRegistry });
  const app = createAPIServer({ agentManager, db });

  const server = app.listen(0); // random port
  const port = server.address().port;

  console.log(`\n=== API Tests (port ${port}) ===\n`);

  try {
    await test('GET /api/health returns ok', async () => {
      const res = await request(port, 'GET', '/api/health', null, { 'x-admin-secret': '' });
      assertEqual(res.status, 200);
      assertEqual(res.body.status, 'ok');
    });

    await test('GET /api/dashboard requires auth', async () => {
      const res = await request(port, 'GET', '/api/dashboard', null, { 'x-admin-secret': 'wrong' });
      assertEqual(res.status, 401);
    });

    await test('GET /api/dashboard returns data', async () => {
      const res = await request(port, 'GET', '/api/dashboard');
      assertEqual(res.status, 200);
      assert(res.body.agents !== undefined, 'Should have agents stats');
      assert(res.body.revenue !== undefined, 'Should have revenue stats');
    });

    await test('POST /api/offerings creates offering', async () => {
      const res = await request(port, 'POST', '/api/offerings', {
        name: 'Test VPN',
        description: 'A test VPN service',
        keywords: ['vpn', 'privacy', 'security'],
        price: 9.99,
        signupUrl: 'https://example.com/signup',
      });
      assertEqual(res.status, 201);
      assertEqual(res.body.name, 'Test VPN');
      assert(res.body.id, 'Should have an id');
    });

    await test('GET /api/offerings lists offerings', async () => {
      const res = await request(port, 'GET', '/api/offerings');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.length >= 1, 'Should have at least one offering');
    });

    await test('POST /api/agents creates agent', async () => {
      const res = await request(port, 'POST', '/api/agents', {
        name: 'test-bot',
        platform: 'mock',
        config: { groups: ['test-group'], pollIntervalMs: 60000 },
        offeringIds: [],
      });
      assertEqual(res.status, 201);
      assertEqual(res.body.name, 'test-bot');
      assertEqual(res.body.platform, 'mock');
    });

    await test('GET /api/agents lists agents', async () => {
      const res = await request(port, 'GET', '/api/agents');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.length >= 1);
    });

    await test('POST /api/plans creates plan', async () => {
      const res = await request(port, 'POST', '/api/plans', {
        name: 'Q1 Revenue Plan',
        description: 'Target 10k in Q1',
        targetRevenue: 10000,
        config: { agentsPerPlatform: 3 },
      });
      assertEqual(res.status, 201);
      assert(res.body.success);
    });

    await test('GET /api/plans lists plans', async () => {
      const res = await request(port, 'GET', '/api/plans');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.length >= 1);
    });

    await test('GET /api/platforms lists platforms', async () => {
      const res = await request(port, 'GET', '/api/platforms');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.some(p => p.name === 'mock'));
    });

    await test('GET /api/deals returns empty initially', async () => {
      const res = await request(port, 'GET', '/api/deals');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
    });

    await test('GET /api/deals/stats returns revenue stats', async () => {
      const res = await request(port, 'GET', '/api/deals/stats');
      assertEqual(res.status, 200);
      assert(res.body.total_deals !== undefined);
      assert(res.body.total_revenue !== undefined);
    });

  } finally {
    server.close();
    db.close();
  }

  console.log(`\n=== Results: ${results.passed} passed, ${results.failed} failed ===\n`);
  if (results.failed > 0) {
    console.log('Failures:');
    results.errors.forEach(e => console.log(`  - ${e.name}: ${e.error}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
