import { expect, test, beforeEach, afterEach, mock } from "bun:test";

// discord.js tries to connect on import — mock it out entirely
mock.module("discord.js", () => {
    const builder = () => {
        const obj = new Proxy({}, { get: (_, prop) => prop === 'toJSON' ? () => ({}) : () => obj });
        return obj;
    };
    return {
        Client: class {
            constructor() {
                this.ws = { ping: 42 };
                this.user = { id: "123", tag: "bot#1234" };
                this.guilds = { cache: [] };
            }
            on(event, cb) {
                if (event === "interactionCreate") globalThis.interactionCallback = cb;
            }
            once() {}
            login() {}
        },
        GatewayIntentBits: { Guilds: 1 },
        REST: class { setToken() { return this; } put() { return Promise.resolve(); } },
        Routes: { applicationCommands: () => '', applicationGuildCommands: () => '' },
        SlashCommandBuilder: class { constructor() { return builder(); } },
        PermissionFlagsBits: { ManageMessages: 0n },
    };
});

const { isCommandAllowed } = await import("./discord.js");

const ORIGINAL_ENV = process.env.COMMAND_CHANNEL_ID;
const originalFetch = globalThis.fetch;

beforeEach(() => {
    delete process.env.COMMAND_CHANNEL_ID;
    globalThis.fetch = mock(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
    }));
});

afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
        process.env.COMMAND_CHANNEL_ID = ORIGINAL_ENV;
    } else {
        delete process.env.COMMAND_CHANNEL_ID;
    }
    globalThis.fetch = originalFetch;
});

// Helper to create mocked interactions
function createInteraction(commandName, options = {}) {
    return {
        isChatInputCommand: () => true,
        channelId: "123",
        commandName,
        options: {
            getInteger: (name) => options[name],
            getBoolean: (name) => options[name],
            getString: (name) => options[name],
            getSubcommandGroup: () => options._subcommandGroup,
            getSubcommand: () => options._subcommand,
        },
        reply: mock(),
        deferReply: mock(),
        editReply: mock(),
        channel: {
            bulkDelete: mock().mockResolvedValue({ size: Math.min(options.amount || 0, 100) }),
            send: mock(),
        },
        createdTimestamp: Date.now() - 50,
    };
}

test("isCommandAllowed returns true when COMMAND_CHANNEL_ID is not set", () => {
    expect(isCommandAllowed("any_channel_id")).toBe(true);
    expect(isCommandAllowed("another_channel")).toBe(true);
});

test("isCommandAllowed returns true when channel matches COMMAND_CHANNEL_ID", () => {
    process.env.COMMAND_CHANNEL_ID = "123456789";
    expect(isCommandAllowed("123456789")).toBe(true);
});

test("isCommandAllowed returns false when channel does not match COMMAND_CHANNEL_ID", () => {
    process.env.COMMAND_CHANNEL_ID = "123456789";
    expect(isCommandAllowed("999999999")).toBe(false);
    expect(isCommandAllowed("")).toBe(false);
});

test("isCommandAllowed returns false when COMMAND_CHANNEL_ID is set and channel is undefined", () => {
    process.env.COMMAND_CHANNEL_ID = "123456789";
    expect(isCommandAllowed(undefined)).toBe(false);
});

test("isCommandAllowed returns true when COMMAND_CHANNEL_ID is empty string (treat as unset)", () => {
    process.env.COMMAND_CHANNEL_ID = "";
    expect(isCommandAllowed("any_channel")).toBe(true);
});

// Slash Command tests
test("command: ping", async () => {
    const interaction = createInteraction("ping");
    await globalThis.interactionCallback(interaction);
    expect(interaction.reply).toHaveBeenCalled();
    const replyArg = interaction.reply.mock.calls[0][0];
    expect(replyArg.content).toContain("Pong!");
});

test("command: status", async () => {
    const interaction = createInteraction("status");
    await globalThis.interactionCallback(interaction);
    expect(interaction.reply).toHaveBeenCalled();
    const replyArg = interaction.reply.mock.calls[0][0];
    expect(replyArg.embeds[0].title).toBe("🤖 Bot Server Status");
});

test("command: test", async () => {
    const interaction = createInteraction("test");
    await globalThis.interactionCallback(interaction);
    expect(interaction.channel.send).toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();
});

test("command: consumers", async () => {
    const interaction = createInteraction("consumers");
    await globalThis.interactionCallback(interaction);
    expect(interaction.reply).toHaveBeenCalled();
});

test("command: clear", async () => {
    const interaction = createInteraction("clear", { amount: 5 });
    await globalThis.interactionCallback(interaction);
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(interaction.channel.bulkDelete).toHaveBeenCalledWith(5, true);
    expect(interaction.editReply).toHaveBeenCalled();
    const replyArg = interaction.editReply.mock.calls[0][0];
    expect(replyArg.content).toContain("Successfully deleted");
});

test("command: services", async () => {
    const interaction = createInteraction("services");
    globalThis.fetch = mock().mockResolvedValue({
        ok: true,
        status: 200,
    });
    await globalThis.interactionCallback(interaction);
    expect(interaction.deferReply).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(interaction.editReply).toHaveBeenCalled();
});

// Chess commands belong to JewkieBot's own Discord bot (in the jewkiebot app).
// This bot used to answer /lichess and /analyze too, while logged in with the
// same token, so both answered one interaction ("Unknown interaction", 10062).
test("chess commands are not handled by this bot", async () => {
    for (const name of ["lichess", "analyze"]) {
        const interaction = createInteraction(name, { _subcommand: "status" });
        globalThis.fetch = mock();
        await globalThis.interactionCallback(interaction);
        expect(interaction.reply).not.toHaveBeenCalled();
        expect(interaction.deferReply).not.toHaveBeenCalled();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    }
});
