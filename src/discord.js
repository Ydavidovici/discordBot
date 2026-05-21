import { Client, GatewayIntentBits } from 'discord.js';

// The Discord client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`[Discord] Logged in as ${client.user.tag}!`);
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
