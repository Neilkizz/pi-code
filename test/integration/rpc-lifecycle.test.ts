/**
 * Integration tests for PiRpcClient lifecycle — start, stop, restart, crash.
 *
 * Uses the mock RPC server as a child process to avoid real `pi` dependency.
 */

import assert from "assert";
import * as path from "path";
import { PiRpcClient } from "../../src/rpc/PiRpcClient";

const MOCK_SERVER = path.resolve(__dirname, "mockRpcServer.ts");

function createClient(
	scenario: string,
	extra?: Partial<{
		autoReconnect: boolean;
		maxBackoffMs: number;
		requestTimeoutMs: number;
	}>,
): PiRpcClient {
	const client = new PiRpcClient({
		executable: process.execPath,
		extraArgs: ["-r", "ts-node/register", MOCK_SERVER],
		skipModePrefix: true,
		env: { MOCK_SCENARIO: scenario },
		autoReconnect: extra?.autoReconnect ?? true,
		maxBackoffMs: extra?.maxBackoffMs ?? 1000,
		requestTimeoutMs: extra?.requestTimeoutMs ?? 30000,
	});
	return client;
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

describe("PiRpcClient lifecycle (integration)", () => {
	it("starts subprocess and becomes alive", () => {
		const client = createClient("echo");
		client.start();
		assert.strictEqual(client.isAlive, true);
		client.dispose();
	});

	it("dispose sends SIGTERM and cleans up", async () => {
		const client = createClient("echo");
		client.start();
		assert.strictEqual(client.isAlive, true);
		client.dispose();
		assert.strictEqual(client.isAlive, false);
		// dispose is idempotent
		client.dispose();
	});

	it("start() is safe to call on a running process (no-op)", () => {
		const client = createClient("echo");
		client.start();
		client.start(); // should not throw or restart
		assert.strictEqual(client.isAlive, true);
		client.dispose();
	});

	it("start() is safe to call after disposal (no-op)", () => {
		const client = createClient("echo");
		client.start();
		client.dispose();
		client.start(); // should not throw
		assert.strictEqual(client.isAlive, false);
	});

	it("sends a prompt and receives a response", async () => {
		const client = createClient("echo");
		client.start();
		await client.prompt("Hello");
		assert.strictEqual(client.commandCount >= 1, true);
		client.dispose();
	});

	it("rejects requests when autoReconnect is false and process exits", async () => {
		const client = createClient("crash", { autoReconnect: false });
		client.start();
		// First command triggers the crash (server responds then schedules exit)
		await client.prompt("Trigger crash");
		// Wait for process to actually exit (50ms delay in mock server)
		await delay(300);
		try {
			await client.prompt("Should fail after crash");
			assert.fail("Expected error was not thrown");
		} catch (err) {
			assert.ok(
				(err as Error).message.includes("exited") ||
					(err as Error).message.includes("not running"),
				`Expected error about exited/not running in: ${(err as Error).message}`,
			);
		}
		client.dispose();
	});

	it("autoReconnect=true restarts the process after crash", async () => {
		const client = createClient("crash", {
			autoReconnect: true,
			maxBackoffMs: 250,
		});
		client.start();
		// First command triggers the crash
		await client.prompt("Trigger crash");
		// Wait for crash + reconnect cycle (crash 50ms + backoff 250ms + spawn)
		await delay(1500);
		assert.strictEqual(client.isAlive, true);
		assert.strictEqual(client.restartCountTotal >= 1, true);
		await client.prompt("Hello after reconnect");
		client.dispose();
	});

	it("dispose while restarting cancels the restart", async () => {
		const client = createClient("crash", {
			autoReconnect: true,
			maxBackoffMs: 5000,
		});
		client.start();
		// Trigger crash, dispose before reconnect backoff fires
		await client.prompt("Trigger crash");
		await delay(200);
		client.dispose();
		await delay(500);
		assert.strictEqual(client.isAlive, false);
	});
});
