# NGW Minigent - AI Mini-Agent System

Autonomous AI mini-agents that monitor social groups, detect opportunities, engage users, negotiate deals, and generate revenue -- all on autopilot.

## Architecture

```
+-------------------+     +------------------+     +-------------------+
|  Platform Adapters|     |   Agent Manager   |     |    Admin API      |
|  - Reddit         |<--->|   - Agent Pool    |<--->|  - Dashboard      |
|  - Discord        |     |   - Event Bus     |     |  - Agent CRUD     |
|  - Telegram       |     |   - Persistence   |     |  - Offerings      |
|  - Facebook       |     |                   |     |  - Deals/Revenue  |
+-------------------+     +------------------+     +-------------------+
                                  |
                          +-------+--------+
                          |     Agent      |
                          | IDLE -> MONITOR|
                          | -> ENGAGE      |
                          | -> NEGOTIATE   |
                          | -> CLOSE       |
                          +----------------+
```

## How It Works

1. **Agents join social groups** across Reddit, Discord, Telegram, and Facebook
2. **Monitor posts and discussions** for keywords matching configured offerings
3. **Detect opportunities** when users ask for products/services that match
4. **Engage automatically** via comments or DMs with tailored pitches
5. **Negotiate deals** by responding to price questions and objections
6. **Close deals** by sending signup/registration links when users agree
7. **Admin dashboard** tracks all agents, deals, revenue, and plans

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env

# Run database migrations (auto on first start)
npm start

# Or development mode
npm run dev
```

## API Endpoints

All endpoints (except health) require `x-admin-secret` header.

### Dashboard
- `GET /api/health` - Health check
- `GET /api/dashboard` - Full dashboard with stats

### Agents
- `GET /api/agents` - List all agents
- `POST /api/agents` - Create agent `{ name, platform, config, offeringIds }`
- `POST /api/agents/:id/start` - Start monitoring
- `POST /api/agents/:id/pause` - Pause agent
- `POST /api/agents/:id/stop` - Stop agent
- `DELETE /api/agents/:id` - Remove agent
- `POST /api/agents/start-all` - Start all agents
- `POST /api/agents/stop-all` - Stop all agents

### Offerings (Products/Services)
- `GET /api/offerings` - List offerings
- `POST /api/offerings` - Create offering
- `PUT /api/offerings/:id` - Update offering
- `DELETE /api/offerings/:id` - Deactivate offering

### Deals
- `GET /api/deals` - List closed deals
- `GET /api/deals/stats` - Revenue statistics

### Plans
- `GET /api/plans` - List admin plans
- `POST /api/plans` - Create revenue plan
- `PUT /api/plans/:id` - Update plan

### Platforms
- `GET /api/platforms` - List registered platforms

## Creating an Offering

```bash
curl -X POST http://localhost:4000/api/offerings \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-secret" \
  -d '{
    "name": "CloudVPN Pro",
    "description": "Enterprise VPN with 99.9% uptime",
    "keywords": ["vpn", "privacy", "secure", "streaming", "unblock"],
    "price": 9.99,
    "signupUrl": "https://example.com/signup?ref=minigent",
    "pitch": "Unlimited bandwidth, 50+ countries, works with all streaming services",
    "negotiationPitch": "We have a special intro rate for new users",
    "preferDM": true,
    "minKeywordMatch": 1
  }'
```

## Creating an Agent

```bash
curl -X POST http://localhost:4000/api/agents \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: your-secret" \
  -d '{
    "name": "vpn-hunter-reddit",
    "platform": "reddit",
    "config": {
      "groups": ["vpn", "privacy", "techsupport"],
      "pollIntervalMs": 30000
    },
    "offeringIds": ["<offering-id>"]
  }'
```

## Agent Lifecycle

Each agent goes through these states:

| State | Description |
|-------|-------------|
| `idle` | Created but not running |
| `monitoring` | Actively polling for new posts |
| `engaging` | Detected opportunity, sending initial message |
| `negotiating` | In active conversation about pricing/details |
| `closing` | Finalizing deal with signup link |
| `paused` | Temporarily stopped |
| `error` | Encountered an error |

## Running Tests

```bash
npm test
```

## Project Structure

```
src/
  core/
    Agent.js           # Base agent with full lifecycle
    AgentManager.js    # Orchestrates multiple agents
    PlatformRegistry.js # Platform adapter management
  platforms/
    BasePlatform.js    # Abstract platform interface
    RedditAdapter.js   # Reddit API integration
    DiscordAdapter.js  # Discord bot integration
    TelegramAdapter.js # Telegram bot integration
    FacebookAdapter.js # Facebook Graph API integration
  db/
    Database.js        # SQLite persistence layer
  api/
    server.js          # Express admin API
  utils/
    logger.js          # Winston logger
  index.js             # Entry point
tests/
  unit/
    Agent.test.js      # Agent framework tests
    api.test.js        # API endpoint tests
```

## Simulation Mode

When platform API credentials are not configured, adapters run in **simulation mode** -- they generate realistic fake posts for testing the full agent pipeline without needing real API access.
