require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk').default;
const { buildDemerzelSystemPrompt, buildSeldonSystemPrompt, buildGASystemPrompt, getMusicTools } = require('./context');
const { renderFretboard, renderNotation } = require('./vexRenderer');

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
let demerzelPrompt, seldonPrompt, gaPrompt, musicTools;

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

  // Music/guitar questions → GA musician persona
  if (content.includes('guitar') || content.includes('chord') || content.includes('scale') ||
      content.includes('tab') || content.includes('fretboard') || content.includes('improvise') ||
      content.includes('progression') || content.includes('reharmonize') || content.includes('optic') ||
      content.includes('practice') || content.includes('song') || content.includes('pentatonic') ||
      content.includes('mode') || content.includes('dorian') || content.includes('mixolydian') ||
      content.includes('voice leading') || content.includes('backing track') ||
      channelName.includes('music') || channelName.includes('guitar')) {
    return 'ga';
  }

  // General music theory → Seldon for teaching
  if (content.includes('music') || content.includes('theory') || content.includes('lesson')) {
    return 'seldon';
  }

  return 'demerzel';
}

async function generateResponse(persona, channelId, userMessage) {
  let systemPrompt;
  if (persona === 'seldon') systemPrompt = seldonPrompt;
  else if (persona === 'ga') systemPrompt = gaPrompt;
  else systemPrompt = demerzelPrompt;

  const history = getHistory(channelId);
  const useTools = persona === 'ga';

  try {
    const apiParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        ...history,
        { role: 'user', content: userMessage },
      ],
    };

    // GA persona uses tool_use for structured music analysis
    if (useTools) {
      apiParams.tools = musicTools;
    }

    let response = await anthropic.messages.create(apiParams);

    // Handle tool_use responses
    let reply = '';
    const attachments = []; // file paths to attach as images

    for (const block of response.content) {
      if (block.type === 'text') {
        reply += block.text;
      } else if (block.type === 'tool_use') {
        console.log(`🎸 Tool call: ${block.name}(${JSON.stringify(block.input)})`);

        let toolResult = '';

        // Handle fretboard_diagram tool — render actual image
        if (block.name === 'fretboard_diagram') {
          try {
            const input = block.input;
            const imgPath = renderFretboard({
              title: `${input.name} ${input.position ? '(' + input.position + ')' : ''}`.trim(),
              notes: buildFretboardNotes(input.name, input.type),
              startFret: 0,
              endFret: 15,
            });
            attachments.push(imgPath);
            toolResult = `[Fretboard diagram rendered as PNG image and will be attached. Describe the scale/chord positions in text too for accessibility.]`;
          } catch (e) {
            console.error('Fretboard render error:', e.message);
            toolResult = `[Fretboard rendering failed: ${e.message}. Provide an ASCII fretboard diagram instead.]`;
          }
        } else {
          toolResult = `[Tool ${block.name} called with: ${JSON.stringify(block.input)}. Generate a detailed, musician-friendly response using your music theory knowledge.]`;
        }

        // Continue the conversation with tool result
        const followUp = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [
            ...history,
            { role: 'user', content: userMessage },
            { role: 'assistant', content: response.content },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, content: toolResult }] },
          ],
        });

        for (const b of followUp.content) {
          if (b.type === 'text') reply += b.text;
        }
      }
    }

    if (!reply) reply = 'I heard you, but I need a moment to think about that...';

    addToHistory(channelId, 'user', userMessage);
    addToHistory(channelId, 'assistant', reply);
    return { text: reply, attachments };
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
      channelName.includes('governance') || channelName.includes('research') || channelName.includes('dev-ops') ||
      channelName.includes('music') || channelName.includes('guitar')) {
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
  gaPrompt = buildGASystemPrompt();
  musicTools = getMusicTools();
  console.log('✓ Demerzel, Seldon, and GA prompts loaded');
  console.log(`✓ ${musicTools.length} music tools registered`);

  client.user.setActivity('🎸 Ask me about guitar', { type: 3 }); // WATCHING
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

  const result = await generateResponse(persona, message.channel.id, content);
  const reply = typeof result === 'string' ? result : result.text;
  const replyAttachments = typeof result === 'object' ? (result.attachments || []) : [];

  // Split long messages (Discord 2000 char limit)
  const chunks = splitMessage(reply, 1900);

  // Collect attachment files from tool rendering
  const files = replyAttachments.map((filePath, i) => ({
    attachment: filePath,
    name: `diagram-${i + 1}.png`,
  }));

  for (let i = 0; i < chunks.length; i++) {
    const embed = new EmbedBuilder()
      .setDescription(chunks[i])
      .setColor(persona === 'ga' ? 0xF0883E : persona === 'seldon' ? 0x7289DA : 0x4CB050)
      .setFooter({
        text: persona === 'ga'
          ? '🎸 Guitar Alchemist'
          : persona === 'seldon'
          ? 'Seldon • Streeling University'
          : 'Demerzel • Autonomous Governance',
      });

    const replyOptions = { embeds: [embed] };

    // Attach images on the last chunk
    if (i === chunks.length - 1 && files.length > 0) {
      replyOptions.files = files;
    }

    await message.reply(replyOptions);
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

// Build fretboard note positions for common scales/chords
function buildFretboardNotes(name, type) {
  const n = (name || '').toLowerCase();
  const notes = {};

  // A minor pentatonic (most common request)
  if (n.includes('minor pentatonic') || n.includes('am pentatonic') || n.includes('a minor pent')) {
    const root = '#e06c75';   // red
    const note = '#58a6ff';   // blue
    // String 6 (low E): A(5), C(8), D(10)
    notes[6] = [{ fret: 5, label: 'R', color: root }, { fret: 8, label: 'b3', color: note }, { fret: 10, label: '4', color: note }];
    notes[5] = [{ fret: 5, label: '4', color: note }, { fret: 7, label: '5', color: note }, { fret: 10, label: 'b7', color: note }];
    notes[4] = [{ fret: 5, label: 'b7', color: note }, { fret: 7, label: 'R', color: root }, { fret: 10, label: 'b3', color: note }];
    notes[3] = [{ fret: 5, label: 'b3', color: note }, { fret: 7, label: '4', color: note }, { fret: 9, label: '5', color: note }];
    notes[2] = [{ fret: 5, label: '5', color: note }, { fret: 8, label: 'b7', color: note }, { fret: 10, label: 'R', color: root }];
    notes[1] = [{ fret: 5, label: 'R', color: root }, { fret: 8, label: 'b3', color: note }, { fret: 10, label: '4', color: note }];
  }
  // E minor pentatonic
  else if (n.includes('e minor pent') || n.includes('em pentatonic')) {
    const root = '#e06c75';
    const note = '#58a6ff';
    notes[6] = [{ fret: 0, label: 'R', color: root }, { fret: 3, label: 'b3', color: note }, { fret: 5, label: '4', color: note }];
    notes[5] = [{ fret: 0, label: '4', color: note }, { fret: 2, label: '5', color: note }, { fret: 5, label: 'b7', color: note }];
    notes[4] = [{ fret: 0, label: 'b7', color: note }, { fret: 2, label: 'R', color: root }, { fret: 5, label: 'b3', color: note }];
    notes[3] = [{ fret: 0, label: 'b3', color: note }, { fret: 2, label: '4', color: note }, { fret: 4, label: '5', color: note }];
    notes[2] = [{ fret: 0, label: '5', color: note }, { fret: 3, label: 'b7', color: note }, { fret: 5, label: 'R', color: root }];
    notes[1] = [{ fret: 0, label: 'R', color: root }, { fret: 3, label: 'b3', color: note }, { fret: 5, label: '4', color: note }];
  }
  // Default: return empty (Claude will use ASCII)
  return notes;
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
