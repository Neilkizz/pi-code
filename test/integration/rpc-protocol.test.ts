/**
 * Integration tests for PiRpcClient protocol handling —
 * non-JSON output, special characters, edge cases.
 */

import assert from "assert";
import * as path from "path";
import { PiRpcClient } from "../../src/rpc/PiRpcClient";

const MOCK_SERVER = path.resolve(__dirname, "mockRpcServer.ts");

function createClient(scenario = "echo", timeoutMs = 30000): PiRpcClient {
	return new PiRpcClient({
		executable: process.execPath,
		extraArgs: ["-r", "ts-node/register", MOCK_SERVER],
		skipModePrefix: true,
		env: { MOCK_SCENARIO: scenario },
		autoReconnect: false,
		requestTimeoutMs: timeoutMs,
	});
}

describe("PiRpcClient protocol (integration)", () => {
	it("survives garbage lines before valid JSON (garbage scenario)", async () => {
		const client = createClient("garbage");
		client.start();
		// The garbage scenario spits random non-JSON lines before responding.
		// The client should not crash and still handle the next command.
		const state = await client.getState();
		assert.ok(state !== undefined);
		client.dispose();
	});

	it("handles multiple sequential commands", async () => {
		const client = createClient("echo");
		client.start();
		await client.prompt("First");
		await client.getState();
		await client.abort();
		await client.prompt("Second");
		assert.strictEqual(client.commandCount >= 4, true);
		client.dispose();
	});

	it("handles concurrent commands (FIFO order)", async () => {
		const client = createClient("echo");
		client.start();
		const results = await Promise.all([
			client.getState(),
			client.getAvailableModels(),
			client.getMessages(),
		]);
		assert.strictEqual(results.length, 3);
		assert.ok(results[0].thinkingLevel !== undefined);
		client.dispose();
	});

	it("tracks command count and round-trip timing", async () => {
		const client = createClient("echo");
		client.start();
		assert.strictEqual(client.commandCount, 0);
		assert.strictEqual(client.roundTripMs, 0);
		await client.prompt("Measure me");
		assert.strictEqual(client.commandCount >= 1, true);
		assert.ok(client.roundTripMs >= 0);
		client.dispose();
	});

	it("resolves round-trip time after response", async () => {
		const client = createClient("echo");
		client.start();
		await client.getState();
		const rt = client.roundTripMs;
		assert.ok(rt > 0, `expected positive round-trip time, got ${rt}`);
		client.dispose();
	});
});
