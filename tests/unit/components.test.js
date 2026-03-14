/**
 * Unit tests for ScoringEngine, RateLimiter, and MessageTemplates.
 */

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
  if (actual !== expected) throw new Error(message || `Expected ${expected}, got ${actual}`);
}

async function runTests() {
  const { ScoringEngine } = await import('../../src/core/ScoringEngine.js');
  const { RateLimiter } = await import('../../src/core/RateLimiter.js');
  const { MessageTemplates } = await import('../../src/core/MessageTemplates.js');

  // Mock DB for scoring engine
  const mockDb = {
    getAllDeals: () => [],
  };

  console.log('\n=== ScoringEngine Tests ===\n');

  test('ScoringEngine scores an opportunity', () => {
    const engine = new ScoringEngine({ db: mockDb });
    const opportunity = { confidence: 0.8, matchedOffering: { name: 'VPN' } };
    const post = { title: 'Need VPN urgently', content: 'Budget $20', timestamp: new Date().toISOString() };
    const score = engine.scoreOpportunity(opportunity, post);
    assert(score.score >= 0 && score.score <= 100, `Score ${score.score} should be 0-100`);
    assert(score.grade, 'Should have a grade');
    assert(score.recommendation, 'Should have a recommendation');
    assert(score.breakdown, 'Should have a breakdown');
  });

  test('ScoringEngine gives higher score for high-confidence opportunities', () => {
    const engine = new ScoringEngine({ db: mockDb });
    const highConf = { confidence: 0.9, matchedOffering: { name: 'VPN' } };
    const lowConf = { confidence: 0.1, matchedOffering: { name: 'VPN' } };
    const post = { title: 'Need VPN', content: 'Looking for VPN', timestamp: new Date().toISOString() };
    const highScore = engine.scoreOpportunity(highConf, post);
    const lowScore = engine.scoreOpportunity(lowConf, post);
    assert(highScore.score > lowScore.score, `High conf score (${highScore.score}) should beat low (${lowScore.score})`);
  });

  test('ScoringEngine scores an agent', () => {
    const engine = new ScoringEngine({ db: mockDb });
    const stats = {
      postsMonitored: 100,
      opportunitiesDetected: 20,
      dealsInitiated: 10,
      dealsClosed: 5,
      revenue: 250,
    };
    const score = engine.scoreAgent(stats);
    assert(score.score >= 0 && score.score <= 100);
    assert(score.grade);
    assert(score.breakdown);
    assert(score.stats.conversionRate);
  });

  test('ScoringEngine scores a lead', () => {
    const engine = new ScoringEngine({ db: mockDb });
    const conversation = {
      stage: 'negotiating',
      messages: [
        { role: 'agent', content: 'Hey! We offer VPN...' },
        { role: 'user', content: 'Yes, interested! How much?' },
        { role: 'agent', content: 'It is $9.99/mo' },
        { role: 'user', content: 'Sounds good, sign me up!' },
      ],
    };
    const score = engine.scoreLead(conversation);
    assert(score.score > 50, `Lead score (${score.score}) should be above 50 for interested lead`);
    assert(score.recommendation);
  });

  test('ScoringEngine grades correctly', () => {
    const engine = new ScoringEngine({ db: mockDb });
    // Test edge cases through agent scoring
    const perfectAgent = { postsMonitored: 1000, opportunitiesDetected: 100, dealsInitiated: 50, dealsClosed: 40, revenue: 5000 };
    const score = engine.scoreAgent(perfectAgent);
    assert(['A+', 'A', 'B+'].includes(score.grade), `Good agent should get high grade, got ${score.grade}`);
  });

  console.log('\n=== RateLimiter Tests ===\n');

  test('RateLimiter allows first message', () => {
    const limiter = new RateLimiter();
    const result = limiter.check('reddit', 'user1', 'group1');
    assert(result.allowed, 'First message should be allowed');
  });

  test('RateLimiter enforces per-user limit', () => {
    const limiter = new RateLimiter({
      maxPerUser: 2,
      platformLimits: { testplat: { maxPerWindow: 1000, windowMs: 60000, cooldownMs: 0 } },
    });
    limiter.record('testplat', 'user1');
    limiter.record('testplat', 'user1');
    const result = limiter.check('testplat', 'user1');
    assert(!result.allowed, 'Should be blocked after reaching per-user limit');
    assert(result.reason.includes('Per-user'), `Reason should mention per-user: ${result.reason}`);
  });

  test('RateLimiter enforces platform cooldown', () => {
    const limiter = new RateLimiter({
      platformLimits: { test: { maxPerWindow: 100, windowMs: 60000, cooldownMs: 5000 } }
    });
    limiter.record('test', 'user1');
    const result = limiter.check('test', 'user2');
    assert(!result.allowed, 'Should be blocked by cooldown');
    assert(result.retryAfterMs > 0, 'Should have retry time');
  });

  test('RateLimiter getStatus returns all platforms', () => {
    const limiter = new RateLimiter();
    const status = limiter.getStatus();
    assert(status.reddit, 'Should have reddit status');
    assert(status.discord, 'Should have discord status');
    assert(status.twitter, 'Should have twitter status');
    assert(status.linkedin, 'Should have linkedin status');
    assert(status.global, 'Should have global status');
  });

  test('RateLimiter reset clears all counters', () => {
    const limiter = new RateLimiter();
    limiter.record('reddit', 'user1');
    limiter.record('discord', 'user2');
    limiter.reset();
    const status = limiter.getStatus();
    assertEqual(status.reddit.used, 0);
    assertEqual(status.discord.used, 0);
    assertEqual(status.global.used, 0);
  });

  console.log('\n=== MessageTemplates Tests ===\n');

  test('MessageTemplates generates initial contact message', () => {
    const templates = new MessageTemplates();
    const msg = templates.initialContact({
      opportunity: { need: 'vpn service' },
      post: { author: 'testuser', authorName: 'TestUser' },
      platform: 'reddit',
      offering: { name: 'CloudVPN', description: 'Fast, secure VPN', pitch: 'Try it free' },
    });
    assert(msg.length > 0, 'Should generate a message');
    assert(msg.includes('CloudVPN') || msg.includes('vpn'), 'Should mention the offering');
  });

  test('MessageTemplates adapts to platform tone', () => {
    const templates = new MessageTemplates();
    const offering = { name: 'VPN', description: 'Secure VPN', price: 9.99 };
    const post = { author: 'user', authorName: 'User' };
    const opp = { need: 'vpn' };

    const twitterMsg = templates.initialContact({ opportunity: opp, post, platform: 'twitter', offering });
    const linkedinMsg = templates.initialContact({ opportunity: opp, post, platform: 'linkedin', offering });

    assert(twitterMsg.length <= 280, `Twitter message should be <= 280 chars, got ${twitterMsg.length}`);
    // LinkedIn tends to be more professional/longer
    assert(linkedinMsg.length > 0, 'LinkedIn message should exist');
  });

  test('MessageTemplates generates negotiation response for price query', () => {
    const templates = new MessageTemplates();
    const msg = templates.negotiate({
      conversation: {},
      reply: { content: 'How much does it cost?' },
      offering: { name: 'VPN', price: 9.99, negotiationPitch: 'Great value' },
      platform: 'reddit',
    });
    assert(msg.includes('9.99'), 'Should mention the price');
  });

  test('MessageTemplates generates discount response', () => {
    const templates = new MessageTemplates();
    const msg = templates.negotiate({
      conversation: {},
      reply: { content: 'That is too expensive, any discount?' },
      offering: { name: 'VPN', price: 9.99 },
      platform: 'reddit',
    });
    assert(msg.includes('7.99') || msg.includes('20%'), 'Should offer a discount');
  });

  test('MessageTemplates generates closing message', () => {
    const templates = new MessageTemplates();
    const msg = templates.close({
      conversation: {},
      offering: { name: 'VPN', signupUrl: 'https://example.com/signup' },
      platform: 'reddit',
    });
    assert(msg.includes('https://example.com/signup'), 'Should include signup URL');
  });

  test('MessageTemplates generates follow-up messages with increasing attempts', () => {
    const templates = new MessageTemplates();
    const offering = { name: 'VPN', description: 'Secure VPN', negotiationPitch: 'Special offer!' };
    const msg1 = templates.followUp({ conversation: {}, offering, platform: 'reddit', attempt: 1 });
    const msg2 = templates.followUp({ conversation: {}, offering, platform: 'reddit', attempt: 2 });
    const msg3 = templates.followUp({ conversation: {}, offering, platform: 'reddit', attempt: 3 });
    assert(msg1 !== msg2, 'Follow-up messages should differ');
    assert(msg2 !== msg3, 'Third follow-up should be different');
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
