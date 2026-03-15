/**
 * Unit tests for the Agent class and core framework.
 */

// Simple test runner (no jest dependency needed for basic validation)
const results = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`  FAIL: ${name} - ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// ---- Mock platform ----
class MockPlatform {
  constructor() {
    this.name = 'mock';
    this.sentMessages = [];
    this.postsToReturn = [];
    this.repliesToReturn = [];
  }

  isConnected() { return true; }
  async fetchNewPosts() { return this.postsToReturn; }

  async sendMessage(opts) {
    this.sentMessages.push(opts);
    return { success: true, messageId: `mock-${Date.now()}` };
  }

  async checkReplies() { return this.repliesToReturn; }
}

// ---- Tests ----
async function runTests() {
  // Dynamic import for ESM
  const { Agent, AgentState } = await import('../../src/core/Agent.js');
  const { PlatformRegistry } = await import('../../src/core/PlatformRegistry.js');

  console.log('\n=== Agent Tests ===\n');

  test('Agent creates with default values', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    assert(agent.id, 'Should have an id');
    assert(agent.name.startsWith('agent-'), 'Should have a default name');
    assertEqual(agent.state, AgentState.IDLE, 'Should start in IDLE state');
    assertEqual(agent.stats.postsMonitored, 0);
    assertEqual(agent.stats.dealsClosed, 0);
  });

  test('Agent creates with custom name', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ name: 'test-agent', platform, offerings: [] });
    assertEqual(agent.name, 'test-agent');
  });

  test('Agent getStatus returns correct structure', () => {
    const platform = new MockPlatform();
    const agent = new Agent({
      name: 'status-test',
      platform,
      offerings: [{ name: 'TestProduct' }],
      config: { groups: ['group1'] },
    });
    const status = agent.getStatus();
    assertEqual(status.name, 'status-test');
    assertEqual(status.platform, 'mock');
    assertEqual(status.state, 'idle');
    assert(Array.isArray(status.offerings));
    assertEqual(status.offerings[0], 'TestProduct');
  });

  test('Agent toJSON serializes correctly', () => {
    const platform = new MockPlatform();
    const agent = new Agent({
      name: 'json-test',
      platform,
      offerings: [{ name: 'Product1' }],
      config: { groups: ['g1'] },
    });
    const json = agent.toJSON();
    assertEqual(json.name, 'json-test');
    assertEqual(json.platformName, 'mock');
    assertEqual(json.state, 'idle');
    assert(Array.isArray(json.offerings));
  });

  test('Agent pause sets state to PAUSED', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    agent.state = AgentState.MONITORING;
    agent.pause();
    assertEqual(agent.state, AgentState.PAUSED);
  });

  test('Agent stop sets state to IDLE and clears conversations', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    agent.state = AgentState.MONITORING;
    agent.activeConversations.set('test', {});
    agent.stop();
    assertEqual(agent.state, AgentState.IDLE);
    assertEqual(agent.activeConversations.size, 0);
  });

  test('Agent _analyzePost matches keywords', async () => {
    const platform = new MockPlatform();
    const offerings = [{
      name: 'VPN Service',
      keywords: ['vpn', 'privacy', 'secure'],
      price: 9.99,
      minKeywordMatch: 1,
    }];
    const agent = new Agent({ platform, offerings });

    const post = { id: '1', title: 'Looking for a VPN', content: 'Need a secure VPN for streaming' };
    const result = await agent._analyzePost(post);
    assert(result !== null, 'Should detect opportunity');
    assertEqual(result.matchedOffering.name, 'VPN Service');
    assert(result.confidence > 0, 'Should have positive confidence');
  });

  test('Agent _analyzePost returns null for non-matching post', async () => {
    const platform = new MockPlatform();
    const offerings = [{
      name: 'VPN Service',
      keywords: ['vpn', 'privacy'],
      minKeywordMatch: 1,
    }];
    const agent = new Agent({ platform, offerings });

    const post = { id: '2', title: 'Cat pictures', content: 'Look at my cute cat' };
    const result = await agent._analyzePost(post);
    assertEqual(result, null, 'Should not detect opportunity');
  });

  test('Agent _determineAction detects close signals', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    const conv = { stage: 'negotiating', offering: { price: 50 } };
    const reply = { content: 'Sounds good, let\'s go!' };
    const action = agent._determineAction(conv, reply);
    assertEqual(action.type, 'close');
  });

  test('Agent _determineAction detects negotiate signals', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    const conv = { stage: 'initial_contact', offering: { price: 50 } };
    const reply = { content: 'That seems too expensive, any discount?' };
    const action = agent._determineAction(conv, reply);
    assertEqual(action.type, 'negotiate');
  });

  test('Agent emits events', () => {
    const platform = new MockPlatform();
    const agent = new Agent({ platform, offerings: [] });
    let eventFired = false;
    agent.on('stateChange', () => { eventFired = true; });
    agent.pause();
    // pause changes from non-MONITORING, but still sets PAUSED and emits
    assert(eventFired, 'Should emit stateChange event');
  });

  console.log('\n=== PlatformRegistry Tests ===\n');

  test('PlatformRegistry registers and retrieves platforms', () => {
    const registry = new PlatformRegistry();
    const mock = new MockPlatform();
    registry.register('mock', mock);
    assertEqual(registry.get('mock'), mock);
    assertEqual(registry.get('nonexistent'), null);
  });

  test('PlatformRegistry lists platforms', () => {
    const registry = new PlatformRegistry();
    registry.register('mock1', new MockPlatform());
    registry.register('mock2', new MockPlatform());
    const list = registry.list();
    assertEqual(list.length, 2);
  });

  // Summary
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
