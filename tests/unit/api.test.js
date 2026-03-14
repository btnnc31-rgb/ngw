/**
 * Unit tests for the Admin API endpoints (including v2 enhancements).
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
  const { ScoringEngine } = await import('../../src/core/ScoringEngine.js');
  const { RateLimiter } = await import('../../src/core/RateLimiter.js');
  const { AdminNotifier } = await import('../../src/admin/AdminNotifier.js');
  const { AdminChat } = await import('../../src/admin/AdminChat.js');
  const { WebhookReceiver } = await import('../../src/platforms/WebhookReceiver.js');
  const { createAPIServer } = await import('../../src/api/server.js');

  // Mock platform
  class MockPlatform {
    constructor() { this.name = 'mock'; }
    isConnected() { return true; }
    async fetchNewPosts() { return []; }
    async sendMessage() { return { success: true }; }
    async checkReplies() { return []; }
  }

  // Setup
  const db = new Database(':memory:');
  const platformRegistry = new PlatformRegistry();
  platformRegistry.register('mock', new MockPlatform());

  const scoringEngine = new ScoringEngine({ db });
  const rateLimiter = new RateLimiter();
  const agentManager = new AgentManager({ db, platformRegistry, scoringEngine, rateLimiter });
  const adminNotifier = new AdminNotifier({ agentManager, db });
  const adminChat = new AdminChat({ agentManager, db, notifier: adminNotifier, scoringEngine });
  const webhookReceiver = new WebhookReceiver({ agentManager });

  const app = createAPIServer({
    agentManager, db, adminChat, adminNotifier,
    scoringEngine, rateLimiter, webhookReceiver,
  });

  const server = app.listen(0);
  const port = server.address().port;

  console.log(`\n=== API Tests v2 (port ${port}) ===\n`);

  try {
    // --- Original endpoints ---
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
      assert(res.body.agents !== undefined);
      assert(res.body.revenue !== undefined);
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
    });

    await test('GET /api/offerings lists offerings', async () => {
      const res = await request(port, 'GET', '/api/offerings');
      assertEqual(res.status, 200);
      assert(res.body.length >= 1);
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
    });

    await test('GET /api/agents lists agents', async () => {
      const res = await request(port, 'GET', '/api/agents');
      assertEqual(res.status, 200);
      assert(res.body.length >= 1);
    });

    await test('POST /api/plans creates plan', async () => {
      const res = await request(port, 'POST', '/api/plans', {
        name: 'Q1 Revenue Plan',
        description: 'Target 10k in Q1',
        targetRevenue: 10000,
      });
      assertEqual(res.status, 201);
      assert(res.body.success);
    });

    await test('GET /api/platforms lists platforms', async () => {
      const res = await request(port, 'GET', '/api/platforms');
      assertEqual(res.status, 200);
      assert(res.body.some(p => p.name === 'mock'));
    });

    await test('GET /api/deals returns list', async () => {
      const res = await request(port, 'GET', '/api/deals');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
    });

    await test('GET /api/deals/stats returns revenue stats', async () => {
      const res = await request(port, 'GET', '/api/deals/stats');
      assertEqual(res.status, 200);
      assert(res.body.total_deals !== undefined);
    });

    // --- New v2 endpoints ---
    await test('POST /api/admin/chat responds to "help"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'help' });
      assertEqual(res.status, 200);
      assert(res.body.response, 'Should have a response');
      assert(res.body.response.includes('STATUS'), 'Should include help content');
    });

    await test('POST /api/admin/chat responds to "status"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'status' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('Agents'));
      assertEqual(res.body.action, 'status');
    });

    await test('POST /api/admin/chat responds to "revenue"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'revenue' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('Revenue'));
    });

    await test('POST /api/admin/chat responds to "report"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'report' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('MINIGENT REPORT'));
    });

    await test('POST /api/admin/chat responds to "scores"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'scores' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('Performance'));
    });

    await test('POST /api/admin/chat responds to "recommend"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'recommend' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('Recommendations'));
    });

    await test('POST /api/admin/chat responds to "list agents"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'list agents' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('test-bot'));
    });

    await test('POST /api/admin/chat responds to "platforms"', async () => {
      const res = await request(port, 'POST', '/api/admin/chat', { message: 'platforms' });
      assertEqual(res.status, 200);
      assert(res.body.response.includes('mock'));
    });

    await test('GET /api/admin/chat/history returns history', async () => {
      const res = await request(port, 'GET', '/api/admin/chat/history');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.length > 0, 'Should have chat history from previous tests');
    });

    await test('GET /api/admin/report returns JSON report', async () => {
      const res = await request(port, 'GET', '/api/admin/report');
      assertEqual(res.status, 200);
      assert(res.body.summary);
      assert(res.body.scores);
      assert(res.body.generatedAt);
    });

    await test('GET /api/scoring/agents returns scored agents', async () => {
      const res = await request(port, 'GET', '/api/scoring/agents');
      assertEqual(res.status, 200);
      assert(Array.isArray(res.body));
      if (res.body.length > 0) {
        assert(res.body[0].scoring, 'Should have scoring data');
        assert(res.body[0].scoring.score !== undefined);
      }
    });

    await test('POST /api/scoring/opportunity scores an opportunity', async () => {
      const res = await request(port, 'POST', '/api/scoring/opportunity', {
        opportunity: { confidence: 0.8, matchedOffering: { name: 'Test' } },
        post: { title: 'Need a VPN urgently', content: 'Budget $20', timestamp: new Date().toISOString() },
      });
      assertEqual(res.status, 200);
      assert(res.body.score !== undefined);
      assert(res.body.grade);
    });

    await test('GET /api/ratelimits returns rate limit status', async () => {
      const res = await request(port, 'GET', '/api/ratelimits');
      assertEqual(res.status, 200);
      assert(res.body.global);
    });

    await test('POST /api/ratelimits/reset clears counters', async () => {
      const res = await request(port, 'POST', '/api/ratelimits/reset');
      assertEqual(res.status, 200);
      assert(res.body.success);
    });

    await test('POST /webhooks/generic accepts webhook', async () => {
      const res = await request(port, 'POST', '/webhooks/generic', {
        platform: 'test',
        post: { id: 'wh-1', content: 'Looking for hosting', author: 'webhook_user' },
      });
      assertEqual(res.status, 200);
      assert(res.body.ok);
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
