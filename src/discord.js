import {Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits} from "discord.js";
import {readFileSync} from "fs";
import {join} from "path";

const CHESS_URL = process.env.CHESS_ENGINE_URL || "http://localhost:8000";

const client = new Client({intents: [GatewayIntentBits.Guilds]});

const commands = [
    new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Clears messages in this channel")
    .addIntegerOption(option =>
        option.setName("amount")
        .setDescription("Number of messages to clear")
        .setRequired(false))
    .addBooleanOption(option =>
        option.setName("all")
        .setDescription("Clear all messages (up to 14 days old)")
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with bot latency"),

    new SlashCommandBuilder()
    .setName("status")
    .setDescription("Shows bot server status, uptime, and memory usage"),

    new SlashCommandBuilder()
    .setName("consumers")
    .setDescription("Lists all configured consumers and their target channels (keeps keys hidden)"),

    new SlashCommandBuilder()
    .setName("test")
    .setDescription("Sends a test notification to the current channel to verify permissions"),

    // Chess commands (/lichess, /analysis, ...) live in JewkieBot's own bot,
    // which ships with the jewkiebot app; this bot only handles DSS-wide jobs.
    new SlashCommandBuilder()
    .setName("services")
    .setDescription("Check health status of all connected services"),
];

client.once("clientReady", async () => {
    console.log(`[Discord] Logged in as ${client.user.tag}!`);

    try {
        const rest = new REST({version: "10"}).setToken(client.token);
        const commandData = commands.map(c => c.toJSON());
        console.log(`[Discord] Registering ${commandData.length} command(s): ${commandData.map(c => c.name).join(", ")}`);

        // Clear any lingering guild-specific commands (prevents duplicates alongside global ones)
        await Promise.all(
            client.guilds.cache.map(guild =>
                rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {body: []}),
            ),
        );

        await rest.put(Routes.applicationCommands(client.user.id), {body: commandData});
        console.log(`[Discord] Successfully registered (/) commands.`);
    } catch (error) {
        console.error("[Discord] Error registering commands:", error);
    }
});

export function isCommandAllowed(channelId) {
    const restricted = process.env.COMMAND_CHANNEL_ID;
    return !restricted || channelId === restricted;
}

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        if (!isCommandAllowed(interaction.channelId)) {
            const restricted = process.env.COMMAND_CHANNEL_ID;
            return interaction.reply({content: `Commands for this bot must be used in <#${restricted}>.`, ephemeral: true});
        }

        const {commandName} = interaction;

        if (commandName === "clear") {
            const amount = interaction.options.getInteger("amount");
            const all = interaction.options.getBoolean("all");

            if (!amount && !all) {
                return interaction.reply({content: "You must specify either an `amount` or set `all` to True.", ephemeral: true});
            }

            await interaction.deferReply({ephemeral: true});

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
                await interaction.editReply({content: `✅ Successfully deleted \`${totalDeleted}\` messages.`});
            } catch (error) {
                console.error(error);
                await interaction.editReply({content: `Deleted \`${totalDeleted}\` messages before hitting an error (likely hit the Discord 14-day limit).`});
            }
        } else if (commandName === "ping") {
            await interaction.reply({
                content: `🏓 Pong! Latency: ${Date.now() - interaction.createdTimestamp}ms. API Latency: ${Math.round(client.ws.ping)}ms`,
                ephemeral: true,
            });
        } else if (commandName === "status") {
            const mem = process.memoryUsage();
            const memMb = (mem.rss / 1024 / 1024).toFixed(2);

            let consumerCount = 0;
            try {
                const consumersData = readFileSync(join(process.cwd(), "consumers.json"), "utf-8");
                consumerCount = Object.keys(JSON.parse(consumersData)).length;
            } catch (err) {
            }

            const upSec = Math.floor(process.uptime());
            const hours = Math.floor(upSec / 3600);
            const minutes = Math.floor((upSec % 3600) / 60);

            const embed = {
                title: "🤖 Bot Server Status",
                color: 0x2ecc71,
                fields: [
                    {name: "Uptime", value: `${hours}h ${minutes}m`, inline: true},
                    {name: "Memory (RSS)", value: `${memMb} MB`, inline: true},
                    {name: "Consumers", value: `${consumerCount} API Keys Configured`, inline: true},
                ],
            };
            await interaction.reply({embeds: [embed], ephemeral: true});
        } else if (commandName === "consumers") {
            let consumers = {};
            try {
                const consumersData = readFileSync(join(process.cwd(), "consumers.json"), "utf-8");
                consumers = JSON.parse(consumersData);
            } catch (err) {
            }

            const keys = Object.keys(consumers);
            if (keys.length === 0) {
                return interaction.reply({content: "No consumers configured in `consumers.json`.", ephemeral: true});
            }

            const fields = keys.map(k => {
                const c = consumers[k];
                const channels = Object.entries(c.channels || {}).map(([type, id]) => `**${type}:** <#${id}>`).join("\n");
                return {
                    name: `📡 ${c.name || "Unknown Consumer"}`,
                    value: channels || "*No channels mapped*",
                };
            });

            await interaction.reply({
                embeds: [{title: "Configured Integrations", color: 0x3498db, fields}],
                ephemeral: true,
            });
        } else if (commandName === "test") {
            await interaction.channel.send("✅ **[System Test]** If you see this, the bot has proper permissions in this channel!");
            await interaction.reply({content: "Test sent!", ephemeral: true});
        } else if (commandName === "services") {
            await interaction.deferReply({ephemeral: true});

            const services = [
                {name: "Chess Engine", url: `${CHESS_URL}/api/health`},
                {name: "DSS Auth", url: `${process.env.DSS_AUTH_URL || "http://localhost:4000"}/healthz`},
                {name: "DSS DB", url: `${process.env.DSS_DB_URL || "http://localhost:4001"}/healthz`},
            ];

            const results = await Promise.all(services.map(async svc => {
                try {
                    const res = await fetch(svc.url, {signal: AbortSignal.timeout(4000)});
                    return {name: svc.name, ok: res.ok, code: res.status};
                } catch {
                    return {name: svc.name, ok: false, code: null};
                }
            }));

            const allOk = results.every(r => r.ok);
            const fields = results.map(r => ({
                name: `${r.ok ? "🟢" : "🔴"} ${r.name}`,
                value: r.ok ? "Healthy" : (r.code ? `HTTP ${r.code}` : "Unreachable"),
                inline: true,
            }));

            const embed = {
                title: "🖥️ Service Health",
                color: allOk ? 0x2ecc71 : 0xe74c3c,
                fields,
                timestamp: new Date().toISOString(),
            };
            await interaction.editReply({embeds: [embed]});
        }

    } catch (error) {
        // Gracefully handle expired interaction tokens and other Discord API errors
        if (error.code === 10062) {
            console.warn("[Discord] Interaction expired (token timed out), ignoring.");
        } else {
            console.error("[Discord] Unhandled interaction error:", error);
        }
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
        const payload = typeof message === "string" ? {content: message} : message;
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

export {connect, sendMessage};
