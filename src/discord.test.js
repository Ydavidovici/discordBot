import { expect, test, beforeEach, afterEach } from "bun:test";
import { isCommandAllowed } from "./discord.js";

// discord.js tries to connect on import — mock it out entirely
import { mock } from "bun:test";
mock.module("discord.js", () => {
    const builder = () => {
        const obj = new Proxy({}, { get: (_, prop) => prop === 'toJSON' ? () => ({}) : () => obj });
        return obj;
    };
    return {
        Client: class { on() {} once() {} },
        GatewayIntentBits: { Guilds: 1 },
        REST: class { setToken() { return this; } put() { return Promise.resolve(); } },
        Routes: { applicationCommands: () => '', applicationGuildCommands: () => '' },
        SlashCommandBuilder: class { constructor() { return builder(); } },
        PermissionFlagsBits: { ManageMessages: 0n },
    };
});

const ORIGINAL_ENV = process.env.COMMAND_CHANNEL_ID;

beforeEach(() => {
    delete process.env.COMMAND_CHANNEL_ID;
});

afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
        process.env.COMMAND_CHANNEL_ID = ORIGINAL_ENV;
    } else {
        delete process.env.COMMAND_CHANNEL_ID;
    }
});

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
