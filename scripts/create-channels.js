#!/usr/bin/env node
/**
 * Create Demerzel governance channels in the GuitarAlchemist Discord guild.
 * Run once to set up channels, then update channels.json with the returned IDs.
 *
 * Usage: node scripts/create-channels.js
 * Requires: DISCORD_BOT_TOKEN in .env
 */

require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');

const GUILD_ID = '1484806750682218700';

const CHANNELS_TO_CREATE = [
  {
    name: 'governance',
    topic: 'Demerzel governance reports, directive compliance, conscience signals, audit results',
    reason: 'Demerzel governance channel setup',
  },
  {
    name: 'academy',
    topic: 'Streeling University course announcements, research cycle results, curriculum updates',
    reason: 'Streeling Academy channel setup',
  },
  {
    name: 'research',
    topic: 'Ideation discussions, Seldon research outputs, cross-model validation results',
    reason: 'Seldon research channel setup',
  },
  {
    name: 'dev-ops',
    topic: 'CI status, health scores, driver cycle summaries, cross-repo sync',
    reason: 'DevOps monitoring channel setup',
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error(`Guild ${GUILD_ID} not found. Is the bot a member?`);
    process.exit(1);
  }

  console.log(`Guild: ${guild.name}`);
  const created = {};

  for (const ch of CHANNELS_TO_CREATE) {
    // Check if channel already exists
    const existing = guild.channels.cache.find(
      (c) => c.name === ch.name && c.type === ChannelType.GuildText
    );

    if (existing) {
      console.log(`  ✓ #${ch.name} already exists (${existing.id})`);
      created[ch.name] = existing.id;
      continue;
    }

    try {
      const newChannel = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        topic: ch.topic,
        reason: ch.reason,
      });
      console.log(`  + #${ch.name} created (${newChannel.id})`);
      created[ch.name] = newChannel.id;
    } catch (err) {
      console.error(`  ✗ Failed to create #${ch.name}: ${err.message}`);
    }
  }

  console.log('\nChannel IDs (update channels.json with these):');
  console.log(JSON.stringify(created, null, 2));

  client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_BOT_TOKEN);
