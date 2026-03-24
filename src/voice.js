const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { Readable } = require('stream');

const KOKORO_ENDPOINT = process.env.KOKORO_ENDPOINT || 'http://localhost:8880';
const KOKORO_VOICE = process.env.KOKORO_VOICE || 'af_bella';
const KOKORO_SPEED = parseFloat(process.env.KOKORO_SPEED || '1.0');

// One player + connection per guild
const guildConnections = new Map();

/**
 * Synthesize text to audio via Kokoro TTS API.
 * Returns a Buffer of OGG/Opus audio.
 */
async function synthesize(text, options = {}) {
  const voice = options.voice || KOKORO_VOICE;
  const speed = options.speed || KOKORO_SPEED;

  const res = await fetch(`${KOKORO_ENDPOINT}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice,
      response_format: 'opus', // OGG/Opus — Discord native, no ffmpeg needed
      speed,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Kokoro TTS error ${res.status}: ${body}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Join a voice channel and return { connection, player }.
 */
async function joinChannel(voiceChannel) {
  const guildId = voiceChannel.guild.id;

  // Reuse existing connection if in the same channel
  const existing = guildConnections.get(guildId);
  if (existing && existing.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return existing;
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  const player = createAudioPlayer({
    behaviors: {
      noSubscriber: NoSubscriberBehavior.Pause,
    },
  });

  connection.subscribe(player);

  // Wait for ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch {
    connection.destroy();
    throw new Error('Voice connection timed out after 15s');
  }

  const entry = { connection, player, channelId: voiceChannel.id };
  guildConnections.set(guildId, entry);

  // Clean up on disconnect
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Try to reconnect
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      // Give up
      connection.destroy();
      guildConnections.delete(guildId);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    guildConnections.delete(guildId);
  });

  return entry;
}

/**
 * Speak text in a voice channel.
 * Joins the channel if not already connected.
 */
async function speak(voiceChannel, text, options = {}) {
  const audioBuffer = await synthesize(text, options);
  const { player } = await joinChannel(voiceChannel);

  const stream = Readable.from(audioBuffer);
  const resource = createAudioResource(stream, {
    inputType: StreamType.OggOpus,
  });

  player.play(resource);

  // Wait for the audio to finish playing
  return new Promise((resolve, reject) => {
    player.once(AudioPlayerStatus.Idle, resolve);
    player.once('error', reject);
    // Timeout after 5 minutes (very long messages)
    setTimeout(() => resolve(), 300_000);
  });
}

/**
 * Leave the voice channel in a guild.
 */
function leave(guildId) {
  const entry = guildConnections.get(guildId);
  if (entry) {
    entry.connection.destroy();
    guildConnections.delete(guildId);
    return true;
  }
  return false;
}

/**
 * Get current voice connection info for a guild.
 */
function getConnection(guildId) {
  return guildConnections.get(guildId) || null;
}

module.exports = { synthesize, joinChannel, speak, leave, getConnection };
