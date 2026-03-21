# Demerzel Discord Bot

Always-on governance coordinator and teaching assistant for the [GuitarAlchemist](https://github.com/GuitarAlchemist) AI ecosystem.

## What It Does

- **Demerzel persona** — governance reports, constitutional guidance, audit results, conscience signals
- **Seldon persona** — music theory teaching, research outputs, course delivery, knowledge transfer
- Auto-detects persona from channel context and message content
- Embeds responses with color-coded persona indicators
- Maintains per-channel conversation history (last 10 exchanges)

## Architecture

- **Runtime:** Node.js (>= 18.0.0)
- **Discord:** discord.js v14 with Message Content Intent
- **AI:** Anthropic SDK (Claude Sonnet) with dual system prompts
- **Governance:** Operates under the [Demerzel constitution](https://github.com/GuitarAlchemist/Demerzel/blob/master/constitutions/default.constitution.md)

## Channels

| Channel | Persona | Posts |
|---------|---------|-------|
| `#general` | Auto-detect | Welcome, announcements |
| `#governance` | Demerzel | Audits, directives, conscience |
| `#academy` | Seldon | Courses, research results |
| `#research` | Seldon | Ideation, knowledge digests |
| `#dev-ops` | Demerzel | CI, health scores, driver cycles |

## Setup

```bash
git clone https://github.com/GuitarAlchemist/demerzel-bot.git
cd demerzel-bot
npm install
cp .env.example .env
# Edit .env with your tokens
node src/bot.js
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token from [Developer Portal](https://discord.com/developers/applications) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |

### Channel Setup (one-time)

```bash
node scripts/create-channels.js
```

Creates governance, academy, research, and dev-ops channels in your guild.

## Related

- [Demerzel](https://github.com/GuitarAlchemist/Demerzel) — AI governance framework
- [GuitarAlchemist](https://github.com/GuitarAlchemist/ga) — Music theory chatbot
