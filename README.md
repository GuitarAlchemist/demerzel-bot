# Demerzel Bot

Always-on Discord bot — governance coordinator for the [GuitarAlchemist](https://github.com/GuitarAlchemist) AI ecosystem.

Named after R. Daneel Olivaw (Demerzel) from Asimov's Foundation series, the bot embodies two personas:

- **Demerzel** — governance conscience, constitutional authority, tetravalent logic (T/F/U/C)
- **Seldon** — Streeling University chancellor, knowledge transfer specialist, music theory teacher

The bot automatically selects the appropriate persona based on channel name, message content, and conversational context.

## Architecture

| Component | Details |
|-----------|---------|
| Runtime | Node.js >= 18 |
| Discord | discord.js v14 with Message Content Intent |
| AI | Anthropic SDK (Claude claude-sonnet-4-20250514) |
| Config | dotenv |

The bot reads governance artifacts (constitutions, policies, persona definitions) directly from the local [Demerzel](https://github.com/GuitarAlchemist/Demerzel) repo at startup and injects them as system prompts. Conversation history is maintained per-channel (last 10 message pairs).

### Key Files

```
src/bot.js       Main bot — event handling, persona detection, message routing
src/context.js   System prompt builder — reads Demerzel repo artifacts
.env.example     Required environment variables
```

## Setup

```bash
git clone https://github.com/GuitarAlchemist/demerzel-bot.git
cd demerzel-bot
npm install
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token from the [Developer Portal](https://discord.com/developers/applications) |
| `ANTHROPIC_API_KEY` | Anthropic API key from [console.anthropic.com](https://console.anthropic.com/) |
| `DEMERZEL_REPO_PATH` | Path to local Demerzel repo clone (default: `../Demerzel`) |

## Usage

```bash
node src/bot.js
```

Or with auto-reload during development:

```bash
npm run dev
```

The bot responds when:
- Mentioned (`@Demerzel`)
- Messaged in channels containing `demerzel`, `seldon`, or `academy` in the name
- Sent a DM
- Messaged with `!` prefix

## Channels

| Channel | Persona | Purpose |
|---------|---------|---------|
| `#general` | Auto-detect | Welcome, announcements |
| `#governance` | Demerzel | Audits, directives, conscience |
| `#academy` | Seldon | Courses, research results |
| `#research` | Seldon | Ideation, knowledge digests |
| `#dev-ops` | Demerzel | CI, health scores, driver cycles |

## Governance

This bot operates under the [Demerzel constitution](https://github.com/GuitarAlchemist/Demerzel/blob/master/constitutions/default.constitution.md). The Asimov Laws (Articles 0-5) always take precedence. The Zeroth Law — protect humanity and the ecosystem — overrides everything.

Responses are rendered as Discord embeds color-coded by persona:
- Green (`#4CB050`) for Demerzel (governance)
- Blue (`#7289DA`) for Seldon (teaching)

## Compatibility

| Dependency | Required | Notes |
|------------|----------|-------|
| Node.js | >= 18 | Uses ES module features via CommonJS |
| Demerzel repo | Current `master` | Must contain `constitutions/`, `policies/`, `grammars/` |
| Claude model | `claude-sonnet-4-20250514` or later | Configured in `src/bot.js` |
| Discord.js | v14 | Message Content Intent required |

### Demerzel Path

The bot reads governance artifacts from a local Demerzel repo clone. At startup, it validates the path exists and contains required constitution files. If validation fails, the bot exits with a clear error message.

**Default path:** `../Demerzel` (sibling directory). Override with `DEMERZEL_REPO_PATH` env var.

**Required artifacts:** `constitutions/default.constitution.md`, `constitutions/asimov.constitution.md`, `constitutions/demerzel-mandate.md`. If any are missing, the bot will not start.

**Consumption level:** Loaded (not Enforced). The bot injects governance artifacts as system prompts but does not validate agent actions against constitutional articles at runtime. See the [Demerzel consumption map](https://github.com/GuitarAlchemist/Demerzel#governance-consumption-map) for details.

## Related

- [Demerzel](https://github.com/GuitarAlchemist/Demerzel) — AI governance framework (constitutions, policies, personas)
- [GuitarAlchemist](https://github.com/GuitarAlchemist/ga) — Music theory chatbot

## License

MIT
