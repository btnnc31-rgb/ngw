/**
 * End-to-end demo/smoke test.
 * Starts the full system, creates offerings and agents,
 * runs a monitoring cycle with simulated posts, and shows results.
 */
import http from 'http';

const SECRET = 'demo-secret';
process.env.ADMIN_SECRET = SECRET;
process.env.DB_PATH = './data/demo-test.db';

let serverPort;
let server;

// ---- HTTP helper ----
function req(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: serverPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': SECRET,
      },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function banner(text) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(60));
}

function printJSON(label, data) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(data, null, 2));
}

async function run() {
  // Clean up any previous demo db
  const fs = await import('fs');
  try { fs.unlinkSync('./data/demo-test.db'); } catch {}

  // Import and start the system
  const { Database } = await import('../../src/db/Database.js');
  const { PlatformRegistry } = await import('../../src/core/PlatformRegistry.js');
  const { AgentManager } = await import('../../src/core/AgentManager.js');
  const { createAPIServer } = await import('../../src/api/server.js');
  const { RedditAdapter } = await import('../../src/platforms/RedditAdapter.js');
  const { DiscordAdapter } = await import('../../src/platforms/DiscordAdapter.js');
  const { TelegramAdapter } = await import('../../src/platforms/TelegramAdapter.js');
  const { FacebookAdapter } = await import('../../src/platforms/FacebookAdapter.js');

  banner('STARTING NGW MINIGENT SYSTEM');

  const db = new Database(process.env.DB_PATH);
  const platformRegistry = new PlatformRegistry();
  platformRegistry.register('reddit', new RedditAdapter());
  platformRegistry.register('discord', new DiscordAdapter());
  platformRegistry.register('telegram', new TelegramAdapter());
  platformRegistry.register('facebook', new FacebookAdapter());
  await platformRegistry.connectAll();

  const agentManager = new AgentManager({ db, platformRegistry });

  // Wire up events for demo logging
  agentManager.on('opportunityDetected', ({ agent, opportunity }) => {
    console.log(`  [EVENT] Opportunity detected by agent ${agent.slice(0,8)}...: "${opportunity.need}" (${(opportunity.confidence*100).toFixed(0)}% confidence)`);
  });
  agentManager.on('dealInitiated', ({ agent, conversationId }) => {
    console.log(`  [EVENT] Deal initiated by agent ${agent.slice(0,8)}..., conversation ${conversationId.slice(0,8)}...`);
  });
  agentManager.on('dealClosed', ({ agent, dealValue, offering }) => {
    console.log(`  [EVENT] DEAL CLOSED by agent ${agent.slice(0,8)}...: $${dealValue} for "${offering?.name}"`);
  });

  const app = createAPIServer({ agentManager, db });
  server = app.listen(0);
  serverPort = server.address().port;
  console.log(`\nAPI server running on port ${serverPort}`);

  // ---- STEP 1: Health check ----
  banner('STEP 1: Health Check');
  const health = await req('GET', '/api/health');
  printJSON('Health', health.body);

  // ---- STEP 2: List platforms ----
  banner('STEP 2: Available Platforms');
  const platforms = await req('GET', '/api/platforms');
  printJSON('Platforms', platforms.body);

  // ---- STEP 3: Create offerings ----
  banner('STEP 3: Create Offerings (Products/Services)');

  const vpn = await req('POST', '/api/offerings', {
    name: 'CloudVPN Pro',
    description: 'Enterprise VPN with 99.9% uptime, 50+ countries',
    keywords: ['vpn', 'privacy', 'secure', 'streaming', 'unblock', 'anonymous'],
    price: 9.99,
    signupUrl: 'https://cloudvpn.example.com/signup?ref=minigent',
    pitch: 'Unlimited bandwidth, works with Netflix, Hulu, and more',
    negotiationPitch: 'We have a 30% intro discount for new users',
    preferDM: true,
    minKeywordMatch: 1,
  });
  console.log(`Created: ${vpn.body.name} (id: ${vpn.body.id})`);

  const hosting = await req('POST', '/api/offerings', {
    name: 'TurboHost',
    description: 'Lightning-fast web hosting with free SSL and 24/7 support',
    keywords: ['hosting', 'web hosting', 'server', 'website', 'deploy', 'uptime'],
    price: 14.99,
    signupUrl: 'https://turbohost.example.com/signup?ref=minigent',
    pitch: '99.99% uptime guaranteed, free migrations',
    negotiationPitch: 'First 3 months at 50% off for new customers',
    preferDM: false,
    minKeywordMatch: 1,
  });
  console.log(`Created: ${hosting.body.name} (id: ${hosting.body.id})`);

  const seo = await req('POST', '/api/offerings', {
    name: 'SEO Toolkit',
    description: 'All-in-one SEO tool for keyword research, rank tracking, and site audits',
    keywords: ['seo', 'search ranking', 'keyword', 'backlink', 'google rank', 'traffic'],
    price: 29.99,
    signupUrl: 'https://seotoolkit.example.com/signup?ref=minigent',
    pitch: 'Used by 10,000+ businesses to dominate search results',
    negotiationPitch: 'Free 14-day trial, no credit card required',
    preferDM: true,
    minKeywordMatch: 1,
  });
  console.log(`Created: ${seo.body.name} (id: ${seo.body.id})`);

  // List all offerings
  const allOfferings = await req('GET', '/api/offerings');
  printJSON('All Offerings', allOfferings.body.map(o => ({ name: o.name, price: o.price, keywords: o.keywords })));

  // ---- STEP 4: Create agents ----
  banner('STEP 4: Create Agents');

  const agent1 = await req('POST', '/api/agents', {
    name: 'vpn-hunter-reddit',
    platform: 'reddit',
    config: { groups: ['vpn', 'privacy', 'techsupport'], pollIntervalMs: 60000 },
    offeringIds: [vpn.body.id],
  });
  console.log(`Created agent: ${agent1.body.name} on ${agent1.body.platform} (${agent1.body.id})`);

  const agent2 = await req('POST', '/api/agents', {
    name: 'hosting-scout-discord',
    platform: 'discord',
    config: { groups: ['webdev', 'hosting'], pollIntervalMs: 60000 },
    offeringIds: [hosting.body.id],
  });
  console.log(`Created agent: ${agent2.body.name} on ${agent2.body.platform} (${agent2.body.id})`);

  const agent3 = await req('POST', '/api/agents', {
    name: 'seo-finder-telegram',
    platform: 'telegram',
    config: { groups: ['marketing', 'seo'], pollIntervalMs: 60000 },
    offeringIds: [seo.body.id],
  });
  console.log(`Created agent: ${agent3.body.name} on ${agent3.body.platform} (${agent3.body.id})`);

  // List all agents
  const allAgents = await req('GET', '/api/agents');
  printJSON('All Agents', allAgents.body.map(a => ({ name: a.name, platform: a.platform, state: a.state })));

  // ---- STEP 5: Manually run a monitoring cycle ----
  banner('STEP 5: Simulate Monitoring Cycle');
  console.log('\nRunning simulated monitoring cycle for each agent...\n');

  // Directly trigger the internal monitoring for demo purposes
  for (const [id, agent] of agentManager.agents) {
    console.log(`--- Agent "${agent.name}" polling ${agent.platform.name} ---`);
    const posts = await agent.platform.fetchNewPosts(agent.config.groups || []);
    console.log(`  Found ${posts.length} new posts`);
    agent.stats.postsMonitored += posts.length;

    for (const post of posts) {
      console.log(`  Post: "${post.title || post.content?.slice(0, 60)}..." by ${post.author}`);
      const opportunity = await agent._analyzePost(post);
      if (opportunity) {
        agent.stats.opportunitiesDetected++;
        console.log(`  -> MATCH! Need: "${opportunity.need}", Confidence: ${(opportunity.confidence * 100).toFixed(0)}%`);
        console.log(`  -> Matched offering: ${opportunity.matchedOffering.name}`);

        // Simulate engagement
        const message = agent._craftMessage(opportunity, post);
        console.log(`  -> Sending: "${message.slice(0, 100)}..."`);
        const result = await agent.platform.sendMessage({
          target: post.author,
          channel: opportunity.preferDM ? 'dm' : 'comment',
          postId: post.id,
          content: message,
        });
        agent.stats.messagessSent++;
        agent.stats.dealsInitiated++;
        console.log(`  -> Message sent (${result.success ? 'OK' : 'FAIL'})`);

        // Simulate a user replying positively
        console.log(`  -> Simulating user reply: "Yes, interested! How much?"`);
        const action1 = agent._determineAction(
          { stage: 'initial_contact', offering: opportunity.matchedOffering },
          { content: 'Yes, interested! How much?' }
        );
        console.log(`  -> Action: ${action1.type}`);

        if (action1.type === 'negotiate') {
          const negResponse = agent._craftNegotiationResponse(
            { offering: opportunity.matchedOffering }, {}, action1
          );
          console.log(`  -> Negotiation: "${negResponse.slice(0, 100)}..."`);
          agent.stats.dealsNegotiated++;

          // User agrees
          console.log(`  -> Simulating user reply: "Sounds good, let's go!"`);
          const action2 = agent._determineAction(
            { stage: 'negotiating', offering: opportunity.matchedOffering },
            { content: "Sounds good, let's go!" }
          );
          console.log(`  -> Action: ${action2.type}`);

          if (action2.type === 'close') {
            const closeMsg = agent._craftClosingMessage({}, action2);
            console.log(`  -> Closing: "${closeMsg.slice(0, 100)}..."`);
            agent.stats.dealsClosed++;
            agent.stats.revenue += opportunity.matchedOffering.price || 0;

            db.recordDeal({
              agentId: agent.id,
              conversationId: `demo-${Date.now()}`,
              dealValue: opportunity.matchedOffering.price || 0,
              offering: opportunity.matchedOffering.name,
            });
            console.log(`  -> DEAL CLOSED! Revenue: $${opportunity.matchedOffering.price}`);
          }
        }
      } else {
        console.log(`  -> No match for this post`);
      }
    }
    console.log('');
  }

  // ---- STEP 6: Create an admin plan ----
  banner('STEP 6: Create Admin Revenue Plan');
  const plan = await req('POST', '/api/plans', {
    name: 'Q1 2024 Revenue Target',
    description: 'Deploy 10 agents across 4 platforms, target $5000/month',
    targetRevenue: 15000,
    config: {
      agentsPerPlatform: 3,
      targetPlatforms: ['reddit', 'discord', 'telegram', 'facebook'],
      offeringFocus: ['vpn', 'hosting', 'seo'],
      startDate: '2024-01-01',
      endDate: '2024-03-31',
    },
  });
  printJSON('Created Plan', { id: plan.body.id, success: plan.body.success });

  const plans = await req('GET', '/api/plans');
  printJSON('All Plans', plans.body);

  // ---- STEP 7: Final dashboard ----
  banner('STEP 7: Full Dashboard');
  const dashboard = await req('GET', '/api/dashboard');
  printJSON('Dashboard', dashboard.body);

  // ---- STEP 8: Revenue stats ----
  banner('STEP 8: Revenue Stats');
  const deals = await req('GET', '/api/deals');
  printJSON('Closed Deals', deals.body);

  const stats = await req('GET', '/api/deals/stats');
  printJSON('Revenue Summary', stats.body);

  // ---- Summary ----
  banner('DEMO COMPLETE');
  const d = dashboard.body;
  console.log(`
  Agents running:        ${d.agents.agentCount}
  Posts monitored:       ${d.agents.totalPosts}
  Opportunities found:   ${d.agents.totalOpportunities}
  Deals initiated:       ${d.agents.totalDealsInitiated}
  Deals closed:          ${d.agents.totalDealsClosed}
  Total revenue:         $${d.agents.totalRevenue}
  Conversion rate:       ${d.agents.conversionRate}%
  Messages sent:         ${d.agents.totalMessages}
  Platforms connected:   ${d.platforms.length} (${d.platforms.map(p => p.name).join(', ')})
  `);

  // Cleanup
  server.close();
  db.close();
  try { fs.unlinkSync('./data/demo-test.db'); } catch {}

  console.log('Server shut down. Demo finished.\n');
}

run().catch((err) => {
  console.error('Demo error:', err);
  if (server) server.close();
  process.exit(1);
});
