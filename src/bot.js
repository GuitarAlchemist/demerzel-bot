require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ChannelType } = require('discord.js');
const voice = require('./voice');
const fs = require('fs');
const path = require('path');

// Prevent duplicate instances
const LOCK_FILE = path.join(__dirname, '.bot.lock');
if (fs.existsSync(LOCK_FILE)) {
  const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
  try {
    process.kill(parseInt(pid), 0); // Check if process exists
    console.error(`Bot already running (PID ${pid}). Exiting.`);
    process.exit(1);
  } catch {
    // Process doesn't exist, stale lock file
  }
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
const Anthropic = require('@anthropic-ai/sdk').default;
const OpenAI = require('openai').default;
const { buildDemerzelSystemPrompt, buildSeldonSystemPrompt, buildGASystemPrompt, buildBSPrompt, getMusicTools, getGovernanceTools } = require('./context');
const { renderFretboard, renderChordProgression, tryRenderFromText } = require('./vexRenderer');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Conversation history per channel (last 10 messages for context)
const conversationHistory = new Map();
const MAX_HISTORY = 10;

// Track threads created by the bot so we respond in them
const createdThreadIds = new Set();

// Build system prompts once at startup
let demerzelPrompt, seldonPrompt, gaPrompt, bsPrompt, musicTools, governanceTools;

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

  // BS detector / clarity channels
  if (channelName.includes('bs-detector') || channelName.includes('clarity') || channelName.includes('bs') ||
      content.includes('translate this bs') || content.includes('detect bs') ||
      content.includes('generate bs') || content.includes('corporate speak') ||
      content.includes('buzzword')) {
    return 'bs';
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

async function generateResponse(persona, channelId, userMessage, currentChannel) {
  let systemPrompt;
  if (persona === 'seldon') systemPrompt = seldonPrompt;
  else if (persona === 'ga') systemPrompt = gaPrompt;
  else if (persona === 'bs') systemPrompt = bsPrompt;
  else systemPrompt = demerzelPrompt;

  const history = getHistory(channelId);
  const useTools = persona === 'ga' || persona === 'demerzel';

  try {
    // Try primary model first, then fallback
    let modelName = 'claude-sonnet-4-20250514';
    let response;

    try {
      const apiParams = {
        model: modelName,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          ...history,
          { role: 'user', content: userMessage },
        ],
      };

      // Register tools based on persona
      if (persona === 'ga') {
        apiParams.tools = musicTools;
      } else if (persona === 'demerzel') {
        apiParams.tools = governanceTools;
      }

      response = await anthropic.messages.create(apiParams);
    } catch (primaryError) {
      // If primary model fails, try fallback
      console.warn(`Primary model (${modelName}) failed:`, primaryError.message);
      console.log('Attempting fallback to claude-3-5-sonnet-20241022...');

      modelName = 'claude-3-5-sonnet-20241022';
      const apiParams = {
        model: modelName,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          ...history,
          { role: 'user', content: userMessage },
        ],
      };

      // Register tools based on persona
      if (persona === 'ga') {
        apiParams.tools = musicTools;
      } else if (persona === 'demerzel') {
        apiParams.tools = governanceTools;
      }

      response = await anthropic.messages.create(apiParams);
      console.log('✓ Anthropic fallback model succeeded');
    } catch (anthropicFallbackError) {
      // All Anthropic models failed — try OpenAI as cross-provider backup
      const isCreditsError = [primaryError?.message, anthropicFallbackError?.message]
        .some(m => m && (m.includes('credit') || m.includes('balance') || m.includes('quota') || m.includes('billing')));

      if (openai && isCreditsError) {
        console.log('⚠️ All Anthropic models failed (credits). Falling back to OpenAI gpt-4o...');
        const openaiResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage },
          ],
        });
        const openaiText = openaiResponse.choices?.[0]?.message?.content ?? '';
        console.log('✓ OpenAI fallback succeeded');
        addToHistory(channelId, 'user', userMessage);
        addToHistory(channelId, 'assistant', openaiText);
        return { text: `${openaiText}\n\n_[Powered by OpenAI — Anthropic credits depleted]_`, attachments: [] };
      }
      // Re-throw if not a credits issue or no OpenAI key
      throw anthropicFallbackError;
    }
    }

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
        } else if (block.name === 'render_chords') {
          // Render chord progression staff notation as PNG
          try {
            const input = block.input;
            const imgPath = renderChordProgression(input.chords, {
              title: input.title || 'Chord Progression',
            });
            attachments.push(imgPath);
            toolResult = `[Chord progression rendered as staff notation PNG and will be attached. Describe the chords and their harmonic function in text for accessibility.]`;
            console.log(`[bot] Rendered chord progression: ${input.chords.join(' - ')}`);
          } catch (e) {
            console.error('Chord render error:', e.message);
            toolResult = `[Chord notation rendering failed: ${e.message}. Show the chord names and analysis in text instead.]`;
          }
        } else if (block.name === 'create_channel') {
          try {
            const guild = client.guilds.cache.first();
            const existing = guild.channels.cache.find(
              (c) => c.name === block.input.name && c.type === ChannelType.GuildText
            );
            if (existing) {
              toolResult = `Channel #${existing.name} already exists (${existing.id}). No action needed.`;
            } else {
              const newCh = await guild.channels.create({
                name: block.input.name,
                type: ChannelType.GuildText,
                topic: block.input.topic || '',
                reason: `Created by Demerzel governance tool`,
              });
              toolResult = `Channel #${newCh.name} created successfully (${newCh.id}). It is now available in the server.`;
            }
          } catch (e) {
            toolResult = `Channel creation failed: ${e.message}. The bot may need Manage Channels permission in Discord server settings.`;
          }
        } else if (block.name === 'create_thread') {
          try {
            const thread = await currentChannel.threads.create({
              name: block.input.name,
              reason: block.input.reason || 'Created by Demerzel for experiment isolation',
            });
            createdThreadIds.add(thread.id);
            toolResult = `Thread "${thread.name}" created successfully (${thread.id}). It is now available in #${currentChannel.name}. You can direct users to it.`;
            if (block.input.reason) {
              await thread.send(`**Thread created:** ${block.input.reason}`);
            }
          } catch (e) {
            toolResult = `Thread creation failed: ${e.message}. The bot may need Create Public Threads permission in Discord server settings.`;
          }
        } else if (block.name === 'list_channels') {
          try {
            const guild = client.guilds.cache.first();
            const channels = guild.channels.cache
              .filter((c) => c.type === ChannelType.GuildText)
              .map((c) => `#${c.name}: ${c.topic || '(no topic)'}`)
              .join('\n');
            toolResult = channels || 'No text channels found.';
          } catch (e) {
            toolResult = `Failed to list channels: ${e.message}`;
          }
        } else {
          toolResult = `[Tool ${block.name} called with: ${JSON.stringify(block.input)}. Generate a detailed, musician-friendly response using your music theory knowledge.]`;
        }

        // Continue the conversation with tool result
        const followUp = await anthropic.messages.create({
          model: modelName,
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
    console.error('Full error:', JSON.stringify(error, null, 2));

    if (error.message.includes('api_key')) {
      return '⚠️ I need an Anthropic API key to respond. Please set `ANTHROPIC_API_KEY` in the `.env` file.';
    }
    if (error.message.includes('credit') || error.message.includes('quota') || error.message.includes('balance')) {
      return `⚠️ API Quota Error: ${error.message}. The API key may have exhausted its usage limit. Check https://console.anthropic.com/account/limits for billing status.`;
    }
    return `⚠️ I encountered an error: ${error.message}`;
  }
}

/**
 * Handle voice commands. Returns a response string if handled, null otherwise.
 */
async function handleVoiceCommand(content, message) {
  const lower = content.toLowerCase();

  // /join or !join — join the user's voice channel
  if (lower === 'join' || lower === 'voice join') {
    const vc = message.member?.voice?.channel;
    if (!vc) return 'You need to be in a voice channel first.';
    try {
      await voice.joinChannel(vc);
      return `Joined **${vc.name}**. Use \`speak <text>\` to hear me, or \`leave\` to disconnect.`;
    } catch (e) {
      return `Failed to join voice channel: ${e.message}`;
    }
  }

  // /leave or !leave — disconnect from voice
  if (lower === 'leave' || lower === 'voice leave' || lower === 'disconnect') {
    if (!message.guild) return null;
    const left = voice.leave(message.guild.id);
    return left ? 'Disconnected from voice.' : 'I am not in a voice channel.';
  }

  // /speak <text> — synthesize and play in voice channel
  const speakMatch = content.match(/^(?:speak|say|voice)\s+(.+)$/is);
  if (speakMatch) {
    const text = speakMatch[1].trim();
    if (!text) return 'Provide text to speak. Example: `speak Hello world`';

    const vc = message.member?.voice?.channel;
    const conn = message.guild ? voice.getConnection(message.guild.id) : null;
    const targetChannel = conn ? null : vc; // Use existing connection or join user's channel

    if (!conn && !vc) return 'Join a voice channel first, or use `join` to have me connect.';

    try {
      if (targetChannel) {
        await voice.joinChannel(targetChannel);
      }
      await voice.speak(vc || { guild: message.guild, id: conn.channelId }, text);
      return `Spoke: "${text.length > 100 ? text.slice(0, 100) + '...' : text}"`;
    } catch (e) {
      return `Voice error: ${e.message}`;
    }
  }

  // /announce — read latest governance report via voice
  if (lower === 'announce' || lower === 'voice announce') {
    const vc = message.member?.voice?.channel;
    const conn = message.guild ? voice.getConnection(message.guild.id) : null;

    if (!conn && !vc) return 'Join a voice channel first.';

    try {
      // Read the latest governance state for announcement
      const fs = require('fs');
      const path = require('path');
      const repoPath = process.env.DEMERZEL_REPO_PATH || '../Demerzel';

      let announcement = 'Governance cycle status report. ';

      // Try to read governance health
      try {
        const healthPath = path.join(repoPath, 'state/governance-health.json');
        const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
        announcement += `Governance health score: ${health.R || health.score || 'unknown'}. `;
      } catch { /* no health file */ }

      // Try to read latest beliefs summary
      try {
        const beliefsPath = path.join(repoPath, 'state/beliefs.json');
        const beliefs = JSON.parse(fs.readFileSync(beliefsPath, 'utf-8'));
        const count = Array.isArray(beliefs) ? beliefs.length : Object.keys(beliefs).length;
        announcement += `${count} beliefs in belief currency ledger. `;
      } catch { /* no beliefs file */ }

      announcement += 'All autonomous agents are within constitutional bounds. Demerzel out.';

      if (vc && !conn) await voice.joinChannel(vc);
      await voice.speak(vc || { guild: message.guild, id: conn.channelId }, announcement);
      return `Governance announcement delivered to voice channel.`;
    } catch (e) {
      return `Announce error: ${e.message}`;
    }
  }

  return null; // Not a voice command
}

function shouldRespond(message) {
  // Ignore other bots, but allow self-messages from Claude Code MCP
  // (MCP sends as the bot account — we detect these via a marker prefix)
  if (message.author.bot) {
    // Allow self-test messages prefixed with [DEMERZEL-TEST]
    if (message.author.id === client.user?.id && message.content.startsWith('[DEMERZEL-TEST]')) {
      return true;
    }
    return false;
  }

  // Always respond to DMs
  if (!message.guild) return true;

  // Respond in threads created by the bot
  if (message.channel.isThread() && createdThreadIds.has(message.channel.id)) return true;

  // Respond when mentioned
  if (message.mentions.has(client.user)) return true;

  // Respond in dedicated channels
  const channelName = message.channel.name || '';
  if (channelName.includes('demerzel') || channelName.includes('seldon') || channelName.includes('academy') ||
      channelName.includes('governance') || channelName.includes('research') || channelName.includes('dev-ops') ||
      channelName.includes('music') || channelName.includes('guitar') || channelName.includes('bs-detector') ||
      channelName.includes('clarity')) {
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
  bsPrompt = buildBSPrompt();
  musicTools = getMusicTools();
  governanceTools = getGovernanceTools();
  console.log('✓ Demerzel, Seldon, GA, and BS Detector prompts loaded');
  console.log(`✓ ${musicTools.length} music tools + ${governanceTools.length} governance tools registered`);

  client.user.setActivity('🎸 Ask me about guitar', { type: 3 }); // WATCHING
});

client.on('messageCreate', async (message) => {
  const willRespond = shouldRespond(message);
  console.log(`📨 ${message.channel.name || 'DM'} | ${message.author.tag} | bot=${message.author.bot} | respond=${willRespond} | "${message.content.slice(0, 50)}"`);
  if (!willRespond) return;

  // Clean the message content (remove bot mention)
  let content = message.content
    .replace(/<@!?\d+>/g, '')
    .replace(/^!\s*/, '')
    .trim();

  if (!content) {
    content = 'Hello';
  }

  const persona = detectPersona(message);

  // Handle voice commands
  const voiceResult = await handleVoiceCommand(content, message);
  if (voiceResult) {
    const embed = new EmbedBuilder()
      .setDescription(voiceResult)
      .setColor(0x4CB050)
      .setFooter({ text: 'Demerzel • Voice' });
    await message.reply({ embeds: [embed] });
    return;
  }

  // Handle "help" command — show channel tutorial
  if (content.toLowerCase() === 'help') {
    const tutorials = {
      'ga': '🎸 **Guitar Alchemist Help**\n\n• `What chord is Cmaj7?` — chord analysis\n• `Show me A minor pentatonic` — fretboard diagram\n• `Analyze Em - C - G - D` — harmonic analysis\n• `Reharmonize I-V-vi-IV in jazz` — chord substitution\n• `Practice routine, intermediate, 30 min` — practice plan\n• `OPTIC analysis: Cmaj7 to Fmaj7` — voice leading\n• `What scale over Dm7-G7-Cmaj7?` — scale suggestions',
      'demerzel': '🏛️ **Demerzel Help**\n\n• `What are the Asimov Laws?` — Articles 0-5\n• `Explain ERGOL vs LOLLI` — compounding economics\n• `What is tetravalent logic?` — T/F/U/C\n• `What is D_c?` — compounding dimension\n• `Explain the AI-Age Manifesto` — 10 principles\n• `Explain Article 3 (Reversibility)` — constitutional principles\n\n🔊 **Voice Commands**\n• `join` — join your voice channel\n• `leave` — disconnect from voice\n• `speak <text>` — speak text via TTS\n• `announce` — read governance report aloud',
      'seldon': '📚 **Seldon Help**\n\n• `Teach me about modes` — adaptive lesson\n• `What departments exist?` — 21 departments\n• `Explain cybernetics` — VSM, feedback loops\n• `What is ERGOL vs LOLLI?` — compounding economics\n• `How does entropy relate to governance?` — Info Theory',
      'bs': '🔴 **BS Detector Help**\n\n• Paste any text → get BS score (4 tests)\n• `Generate BS about Q3 results` → inflate clear speech\n• `Translate: We need to rightsize our operational footprint` → decode jargon\n\nTests: Specificity · Falsifiability · Density · Commitment\nScore: 🟢 T (real) · 🟡 U (unclear) · 🔴 C (BS)',
    };
    const helpText = tutorials[persona] || tutorials['demerzel'];
    const embed = new EmbedBuilder()
      .setDescription(helpText)
      .setColor(persona === 'bs' ? 0xE06C75 : persona === 'ga' ? 0xF0883E : persona === 'seldon' ? 0x7289DA : 0x4CB050);
    await message.reply({ embeds: [embed] });
    return;
  }

  // Show typing indicator
  await message.channel.sendTyping();

  const result = await generateResponse(persona, message.channel.id, content, message.channel);
  const reply = typeof result === 'string' ? result : result.text;
  let replyAttachments = typeof result === 'object' ? (result.attachments || []) : [];

  // Auto-render chord progressions from GA responses
  if (persona === 'ga' && replyAttachments.length === 0) {
    try {
      const rendered = tryRenderFromText(reply);
      if (rendered) {
        replyAttachments.push(rendered);
        console.log('🎼 Auto-rendered chord progression from response');
      }
    } catch (e) {
      console.error('Auto-render error:', e.message);
    }
  }

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
      .setColor(persona === 'bs' ? 0xE06C75 : persona === 'ga' ? 0xF0883E : persona === 'seldon' ? 0x7289DA : 0x4CB050)
      .setFooter({
        text: persona === 'bs'
          ? '🔴 BS Detector • gov-bs-generators.ebnf'
          : persona === 'ga'
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

// Graceful shutdown + lock cleanup
function cleanup() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  client.destroy();
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });

client.login(process.env.DISCORD_BOT_TOKEN);
