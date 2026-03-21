require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk').default;
const { buildDemerzelSystemPrompt, buildSeldonSystemPrompt } = require('./context');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Conversation history per channel (last 10 messages for context)
const conversationHistory = new Map();
const MAX_HISTORY = 10;

// Build system prompts once at startup
let demerzelPrompt, seldonPrompt;

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2); // Remove oldest pair
  }
}

function detectPersona(message) {
  const content = message.content.toLowerCase();
  const channelName = message.channel.name || '';

  // Explicit persona triggers
  if (content.includes('seldon') || content.includes('teach') || content.includes('learn') ||
      content.includes('course') || content.includes('lesson') || content.includes('academy') ||
      channelName.includes('seldon') || channelName.includes('academy')) {
    return 'seldon';
  }

  if (content.includes('demerzel') || content.includes('govern') || content.includes('constitution') ||
      content.includes('policy') || content.includes('audit') || content.includes('conscience') ||
      channelName.includes('demerzel') || channelName.includes('governance') || channelName.includes('dev-ops')) {
    return 'demerzel';
  }

  // Research channel → Seldon
  if (channelName.includes('research')) {
    return 'seldon';
  }

  // Default: if it's a question about music/guitar → Seldon, otherwise → Demerzel
  if (content.includes('guitar') || content.includes('chord') || content.includes('scale') ||
      content.includes('music') || content.includes('theory') || content.includes('practice') ||
      content.includes('song') || content.includes('fretboard') || content.includes('improvise')) {
    return 'seldon';
  }

  return 'demerzel';
}

async function generateResponse(persona, channelId, userMessage) {
  const systemPrompt = persona === 'seldon' ? seldonPrompt : demerzelPrompt;
  const history = getHistory(channelId);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...history,
        { role: 'user', content: userMessage },
      ],
    });

    const reply = response.content[0].text;
    addToHistory(channelId, 'user', userMessage);
    addToHistory(channelId, 'assistant', reply);
    return reply;
  } catch (error) {
    console.error('Claude API error:', error.message);
    if (error.message.includes('api_key')) {
      return '⚠️ I need an Anthropic API key to respond. Please set `ANTHROPIC_API_KEY` in the `.env` file.';
    }
    return `⚠️ I encountered an error: ${error.message}`;
  }
}

function shouldRespond(message) {
  // Ignore bots
  if (message.author.bot) return false;

  // Always respond to DMs
  if (!message.guild) return true;

  // Respond when mentioned
  if (message.mentions.has(client.user)) return true;

  // Respond in dedicated channels
  const channelName = message.channel.name || '';
  if (channelName.includes('demerzel') || channelName.includes('seldon') || channelName.includes('academy') ||
      channelName.includes('governance') || channelName.includes('research') || channelName.includes('dev-ops')) {
    return true;
  }

  // Respond to messages starting with ! (command prefix)
  if (message.content.startsWith('!')) return true;

  return false;
}

client.on('ready', () => {
  console.log(`✓ ${client.user.tag} is online`);
  console.log(`✓ Serving ${client.guilds.cache.size} guild(s)`);

  // Build prompts at startup
  demerzelPrompt = buildDemerzelSystemPrompt();
  seldonPrompt = buildSeldonSystemPrompt();
  console.log('✓ Demerzel and Seldon prompts loaded');

  client.user.setActivity('Governing the Foundation', { type: 3 }); // WATCHING
});

client.on('messageCreate', async (message) => {
  if (!shouldRespond(message)) return;

  // Clean the message content (remove bot mention)
  let content = message.content
    .replace(/<@!?\d+>/g, '')
    .replace(/^!\s*/, '')
    .trim();

  if (!content) {
    content = 'Hello';
  }

  const persona = detectPersona(message);

  // Show typing indicator
  await message.channel.sendTyping();

  const reply = await generateResponse(persona, message.channel.id, content);

  // Split long messages (Discord 2000 char limit)
  const chunks = splitMessage(reply, 1900);

  for (const chunk of chunks) {
    const embed = new EmbedBuilder()
      .setDescription(chunk)
      .setColor(persona === 'seldon' ? 0x7289DA : 0x4CB050)
      .setFooter({
        text: persona === 'seldon'
          ? 'Seldon • Streeling University'
          : 'Demerzel • Autonomous Governance',
      });

    await message.reply({ embeds: [embed] });
  }
});

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (newline or space)
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt === -1 || splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt === -1) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
