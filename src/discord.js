import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHESS_URL = process.env.CHESS_ENGINE_URL || 'http://localhost:8000';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
    .setDescription('Sends a test notification to the current channel to verify permissions'),

  new SlashCommandBuilder()
    .setName('lichess')
    .setDescription('Control the JewkieBot Lichess chess bot')
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Show bot status and active games'))
    .addSubcommand(sub =>
      sub.setName('start').setDescription('Start accepting Lichess challenges'))
    .addSubcommand(sub =>
      sub.setName('stop').setDescription('Stop the Lichess bot'))
    .addSubcommand(sub =>
      sub.setName('weakest').setDescription('Challenge the weakest available bot'))
    .addSubcommandGroup(group =>
      group.setName('autoplay').setDescription('Auto-play mode controls')
        .addSubcommand(sub =>
          sub.setName('start').setDescription('Start auto-play mode')
            .addIntegerOption(opt =>
              opt.setName('limit').setDescription('Seconds per side (default: 180 = 3+0)').setRequired(false).setMinValue(15))
            .addIntegerOption(opt =>
              opt.setName('increment').setDescription('Seconds added per move (default: 2)').setRequired(false).setMinValue(0))
            .addStringOption(opt =>
              opt.setName('mode').setDescription('Opponent selection mode (default: near)').setRequired(false)
                .addChoices({ name: 'near — match bots close to a target rating', value: 'near' },
                             { name: 'weakest — always challenge the lowest-rated bot', value: 'weakest' }))
            .addIntegerOption(opt =>
              opt.setName('target').setDescription('Concurrent games to maintain (default: 1)').setRequired(false).setMinValue(1).setMaxValue(8))
            .addIntegerOption(opt =>
              opt.setName('window').setDescription('Rating window around target (near mode, default: 200)').setRequired(false).setMinValue(10))
            .addBooleanOption(opt =>
              opt.setName('rated').setDescription('Play rated games (default: true)').setRequired(false))
        )
        .addSubcommand(sub => sub.setName('stop').setDescription('Stop auto-play mode'))
    ),

  new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('Analyze a chess position with the engine')
    .addStringOption(opt =>
      opt.setName('fen')
        .setDescription('FEN string of the position to analyze')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('depth')
        .setDescription('Search depth (default: 15)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(30)),

  new SlashCommandBuilder()
    .setName('services')
    .setDescription('Check health status of all connected services'),
];

client.once('clientReady', async () => {
  console.log(`[Discord] Logged in as ${client.user.tag}!`);

  try {
    const rest = new REST({ version: '10' }).setToken(client.token);
    const commandData = commands.map(c => c.toJSON());
    console.log(`[Discord] Registering ${commandData.length} command(s): ${commandData.map(c => c.name).join(', ')}`);

    await rest.put(Routes.applicationCommands(client.user.id), { body: commandData });
    console.log(`[Discord] Successfully registered (/) commands.`);
  } catch (error) {
    console.error('[Discord] Error registering commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'clear') {
    const amount = interaction.options.getInteger('amount');
    const all = interaction.options.getBoolean('all');

    if (!amount && !all) {
      return interaction.reply({ content: 'You must specify either an `amount` or set `all` to True.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let totalDeleted = 0;
    try {
      if (all) {
        let deleted;
        do {
          deleted = await interaction.channel.bulkDelete(100, true);
          totalDeleted += deleted.size;
        } while (deleted.size === 100);
      } else {
        let remaining = amount;
        while (remaining > 0) {
          const toDelete = Math.min(remaining, 100);
          const deleted = await interaction.channel.bulkDelete(toDelete, true);
          totalDeleted += deleted.size;
          remaining -= deleted.size;
          if (deleted.size < toDelete) break;
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
      color: 0x2ecc71,
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

  else if (commandName === 'lichess') {
    await interaction.deferReply({ ephemeral: true });
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();

    try {
      if (group === 'autoplay') {
        let body = undefined;
        if (sub === 'start') {
          const limit     = interaction.options.getInteger('limit')     ?? undefined;
          const increment = interaction.options.getInteger('increment') ?? undefined;
          const mode      = interaction.options.getString('mode')       ?? undefined;
          const target    = interaction.options.getInteger('target')    ?? undefined;
          const window    = interaction.options.getInteger('window')    ?? undefined;
          const rated     = interaction.options.getBoolean('rated')     ?? undefined;
          // Only include keys that were explicitly set so the API keeps its own defaults for the rest
          body = Object.fromEntries(
            Object.entries({ limit, increment, mode, target, window, rated }).filter(([, v]) => v !== undefined)
          );
        }
        const res = await fetch(`${CHESS_URL}/api/lichess/autoplay/${sub}`, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return interaction.editReply({ content: `❌ Failed: ${data.error || res.status}` });
        }
        if (sub === 'stop') {
          return interaction.editReply({ content: '✅ Auto-play stopped.' });
        }
        // Summarise what was started
        const ap = data.autoplay ?? {};
        const timeCtrl = ap.limit !== undefined ? `${ap.limit}+${ap.increment ?? 0}` : '—';
        const modeStr  = ap.mode === 'weakest' ? 'weakest bot' : `near ±${ap.window ?? 200}`;
        const ratedStr = ap.rated === false ? 'casual' : 'rated';
        await interaction.editReply({
          content: `✅ Auto-play started — **${timeCtrl}** ${ratedStr}, mode: **${modeStr}**, target: **${ap.target ?? 1}** game(s).`,
        });

      } else if (sub === 'status') {
        const res = await fetch(`${CHESS_URL}/api/lichess/status`);
        if (!res.ok) {
          return interaction.editReply({ content: `❌ Chess engine returned HTTP ${res.status}.` });
        }
        const data = await res.json();
        const gameList = data.activeGames?.length
          ? data.activeGames.map(g => `• **${g.id || '?'}** vs ${g.opponent || '?'} (${g.color || '?'})`).join('\n')
          : '*No active games*';
        const embed = {
          title: '♟️ Lichess Bot Status',
          color: data.running ? 0x2ecc71 : 0xe74c3c,
          fields: [
            { name: 'Bot Running', value: data.running ? 'Yes' : 'No', inline: true },
            { name: 'Active Games', value: String(data.activeGames?.length ?? 0), inline: true },
            { name: 'Auto-play', value: data.autoplay ? 'On' : 'Off', inline: true },
            { name: 'Games', value: gameList },
          ],
          timestamp: new Date().toISOString(),
        };
        await interaction.editReply({ embeds: [embed] });

      } else if (sub === 'start') {
        const res = await fetch(`${CHESS_URL}/api/lichess/start`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        await interaction.editReply({ content: res.ok ? '✅ Lichess bot started.' : `❌ Failed: ${data.error || res.status}` });

      } else if (sub === 'stop') {
        const res = await fetch(`${CHESS_URL}/api/lichess/stop`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        await interaction.editReply({ content: res.ok ? '✅ Lichess bot stopped.' : `❌ Failed: ${data.error || res.status}` });

      } else if (sub === 'weakest') {
        const res = await fetch(`${CHESS_URL}/api/lichess/challenge/weakest`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        const detail = data.message ? ` ${data.message}` : '';
        await interaction.editReply({ content: res.ok ? `✅ Challenge sent!${detail}` : `❌ Failed: ${data.error || res.status}` });
      }

    } catch (err) {
      console.error('[Discord] Lichess command error:', err);
      await interaction.editReply({ content: `❌ Could not reach chess engine at \`${CHESS_URL}\`. Is it running?` });
    }
  }

  else if (commandName === 'analyze') {
    const fen = interaction.options.getString('fen');
    const depth = interaction.options.getInteger('depth') ?? 15;
    await interaction.deferReply({ ephemeral: false });

    try {
      const res = await fetch(`${CHESS_URL}/api/engine/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, depth }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return interaction.editReply({ content: `❌ Analysis failed: ${err.error || res.status}` });
      }
      const data = await res.json();
      const embed = {
        title: '♟️ Engine Analysis',
        color: 0x3498db,
        fields: [
          { name: 'Position (FEN)', value: `\`\`\`${fen}\`\`\`` },
          { name: 'Best Move', value: `**${data.bestMove}**`, inline: true },
          { name: 'Depth', value: String(data.depth ?? depth), inline: true },
        ],
        timestamp: new Date().toISOString(),
      };
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[Discord] Analyze error:', err);
      await interaction.editReply({ content: `❌ Could not reach chess engine at \`${CHESS_URL}\`. Is it running?` });
    }
  }

  else if (commandName === 'services') {
    await interaction.deferReply({ ephemeral: true });

    const services = [
      { name: 'Chess Engine', url: `${CHESS_URL}/api/health` },
      { name: 'DSS Auth', url: `${process.env.DSS_AUTH_URL || 'http://localhost:4000'}/healthz` },
      { name: 'DSS DB', url: `${process.env.DSS_DB_URL || 'http://localhost:4001'}/healthz` },
    ];

    const results = await Promise.all(services.map(async svc => {
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(4000) });
        return { name: svc.name, ok: res.ok, code: res.status };
      } catch {
        return { name: svc.name, ok: false, code: null };
      }
    }));

    const allOk = results.every(r => r.ok);
    const fields = results.map(r => ({
      name: `${r.ok ? '🟢' : '🔴'} ${r.name}`,
      value: r.ok ? 'Healthy' : (r.code ? `HTTP ${r.code}` : 'Unreachable'),
      inline: true,
    }));

    const embed = {
      title: '🖥️ Service Health',
      color: allOk ? 0x2ecc71 : 0xe74c3c,
      fields,
      timestamp: new Date().toISOString(),
    };
    await interaction.editReply({ embeds: [embed] });
  }
});

/**
 * Sends a plain-text or embed message to a Discord channel.
 * @param {string} channelId
 * @param {string|object} message String or discord.js message options object.
 */
async function sendMessage(channelId, message) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);
    if (!channel.isTextBased()) throw new Error(`Channel ${channelId} is not text-based`);
    const payload = typeof message === 'string' ? { content: message } : message;
    await channel.send(payload);
    return true;
  } catch (error) {
    console.error(`[Discord] Error sending message to ${channelId}:`, error);
    return false;
  }
}

async function connect(token) {
  await client.login(token);
}

export { connect, sendMessage };
