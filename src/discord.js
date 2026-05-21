import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// The Discord client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Define our slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clears messages in this channel')
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('Number of messages to clear')
        .setRequired(false))
    .addBooleanOption(option => 
      option.setName('all')
        .setDescription('Clear all messages (up to 14 days old)')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with bot latency'),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Shows bot server status, uptime, and memory usage'),
  new SlashCommandBuilder()
    .setName('consumers')
    .setDescription('Lists all configured consumers and their target channels (keeps keys hidden)'),
  new SlashCommandBuilder()
    .setName('test')
    .setDescription('Sends a test notification to the current channel to verify permissions')
];

client.once('clientReady', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}!`);
  
  // Register slash commands automatically on startup
  try {
    const rest = new REST({ version: '10' }).setToken(client.token);
    console.log(`[Discord] Registering (/) commands...`);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands },
    );
    console.log(`[Discord] Successfully registered (/) commands.`);
  } catch (error) {
    console.error('[Discord] Error registering commands:', error);
  }
});

// Handle Slash Commands
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('amount');
    const all = interaction.options.getBoolean('all');

    if (!amount && !all) {
      return interaction.reply({ content: 'You must specify either an `amount` or set `all` to True.', ephemeral: true });
    }

    // Since deleting many messages can take longer than 3 seconds, we must defer the reply
    await interaction.deferReply({ ephemeral: true });

    let totalDeleted = 0;
    try {
      if (all) {
        let deleted;
        do {
          deleted = await interaction.channel.bulkDelete(100, true);
          totalDeleted += deleted.size;
        } while (deleted.size === 100); // keep deleting until less than 100 are found
      } else {
        let remaining = amount;
        while (remaining > 0) {
          const toDelete = Math.min(remaining, 100);
          const deleted = await interaction.channel.bulkDelete(toDelete, true);
          totalDeleted += deleted.size;
          remaining -= deleted.size;
          if (deleted.size < toDelete) break; // hit the 14-day limit or channel is empty
        }
      }
      await interaction.editReply({ content: `✅ Successfully deleted \`${totalDeleted}\` messages.` });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: `Deleted \`${totalDeleted}\` messages before hitting an error (likely hit the Discord 14-day limit).` });
    }
  } 
  
  else if (commandName === 'ping') {
    await interaction.reply({ 
      content: `🏓 Pong! Latency: ${Date.now() - interaction.createdTimestamp}ms. API Latency: ${Math.round(client.ws.ping)}ms`, 
      ephemeral: true 
    });
  }

  else if (commandName === 'status') {
    const mem = process.memoryUsage();
    const memMb = (mem.rss / 1024 / 1024).toFixed(2);
    
    let consumerCount = 0;
    try {
      const consumersData = readFileSync(join(process.cwd(), 'consumers.json'), 'utf-8');
      consumerCount = Object.keys(JSON.parse(consumersData)).length;
    } catch (err) {}

    const upSec = Math.floor(process.uptime());
    const hours = Math.floor(upSec / 3600);
    const minutes = Math.floor((upSec % 3600) / 60);

    const embed = {
      title: '🤖 Bot Server Status',
      color: 0x2ecc71, // Green
      fields: [
        { name: 'Uptime', value: `${hours}h ${minutes}m`, inline: true },
        { name: 'Memory (RSS)', value: `${memMb} MB`, inline: true },
        { name: 'Consumers', value: `${consumerCount} API Keys Configured`, inline: true }
      ]
    };
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  else if (commandName === 'consumers') {
    let consumers = {};
    try {
      const consumersData = readFileSync(join(process.cwd(), 'consumers.json'), 'utf-8');
      consumers = JSON.parse(consumersData);
    } catch (err) {}

    const keys = Object.keys(consumers);
    if (keys.length === 0) {
      return interaction.reply({ content: 'No consumers configured in `consumers.json`.', ephemeral: true });
    }

    const fields = keys.map(k => {
      const c = consumers[k];
      const channels = Object.entries(c.channels || {}).map(([type, id]) => `**${type}:** <#${id}>`).join('\n');
      return {
        name: `📡 ${c.name || 'Unknown Consumer'}`,
        value: channels || '*No channels mapped*',
      };
    });

    await interaction.reply({ 
      embeds: [{ title: 'Configured Integrations', color: 0x3498db, fields }], 
      ephemeral: true 
    });
  }

  else if (commandName === 'test') {
    await interaction.channel.send('✅ **[System Test]** If you see this, the bot has proper permissions in this channel!');
    await interaction.reply({ content: 'Test sent!', ephemeral: true });
  }
});

/**
 * Sends a message to a specific Discord channel.
 * @param {string} channelId The ID of the channel to send to.
 * @param {string} message The message content.
 */
async function sendMessage(channelId, message) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }
    if (channel.isTextBased()) {
      await channel.send(message);
      return true;
    } else {
      throw new Error(`Channel ${channelId} is not text-based`);
    }
  } catch (error) {
    console.error(`[Discord] Error sending message to ${channelId}:`, error);
    return false;
  }
}

/**
 * Connects to Discord using the provided token.
 * @param {string} token 
 */
async function connect(token) {
  await client.login(token);
}

export { connect, sendMessage };
