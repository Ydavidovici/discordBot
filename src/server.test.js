import {expect, test, mock} from "bun:test";
import {handleRequest} from "./server.js";

// Mock discord sendMessage to avoid real API calls during test
mock.module("./discord.js", () => {
    return {
        sendMessage: async (channelId, message) => {
            // Simulate success for a fake channel ID, failure for others
            if (channelId === "fake_notify_id" || channelId === "fake_logs_id") return true;
            return false;
        },
    };
});

// Mock fs to return a fake consumers.json in memory so we don't depend on the real file for tests
mock.module("fs", () => {
    return {
        readFileSync: (path, encoding) => {
            if (path.includes("consumers.json")) {
                return JSON.stringify({
                    "test_key_123": {
                        "name": "Test Consumer",
                        "channels": {
                            "notifications": "fake_notify_id",
                            "logs": "fake_logs_id"
                        }
                    }
                });
            }
            return "";
        }
    };
});

test("POST /notify without auth returns 401", async () => {
    const req = new Request("http://localhost:3535/notify", {
        method: "POST",
        body: JSON.stringify({message: "hello"}),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(401);
});

test("POST /notify with bad auth returns 403", async () => {
    const req = new Request("http://localhost:3535/notify", {
        method: "POST",
        headers: {
            "Authorization": "Bearer wrong_key"
        },
        body: JSON.stringify({message: "hello"}),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(403);
});

test("POST /notify with valid auth returns 200", async () => {
    const req = new Request("http://localhost:3535/notify", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test_key_123",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({message: "test message", project: "test"}),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
});

test("POST /notify to specific channel returns 200", async () => {
    const req = new Request("http://localhost:3535/notify", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test_key_123",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({message: "test message", channel: "logs"}),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(200);
});

test("POST /notify to unconfigured channel returns 400", async () => {
    const req = new Request("http://localhost:3535/notify", {
        method: "POST",
        headers: {
            "Authorization": "Bearer test_key_123",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({message: "test message", channel: "invalid_channel"}),
    });
    const res = await handleRequest(req);
    expect(res.status).toBe(400);
});