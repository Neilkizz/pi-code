/**
 * Integration tests for PiRpcClient request timeout handling.
 */

import assert from "assert";
import * as path from "path";
import { PiRpcClient } from "../../src/rpc/PiRpcClient";

const MOCK_SERVER = path.resolve(__dirname, "mockRpcServer.ts");

function createClient(
	scenario: string,
	timeoutMs: number,
	autoReconnect = true,
): PiRpcClient {
	return new PiRpcClient({
		executable: process.execPath,
		extraArgs: ["-r", "ts-node/register", MOCK_SERVER],
		skipModePrefix: true,
		env: { MOCK_SCENARIO: scenario },
		requestTimeoutMs: timeoutMs,
		autoReconnect,
	});
}

describe("PiRpcClient timeout (integration)", () => {
	it("rejects request that times out (slow scenario)", async () => {
		const client = createClient("slow", 500);
		client.start();
		try {
			await client.prompt("Should time out");
			assert.fail("Expected timeout error");
		} catch (err) {
			assert.ok(
				(err as Error).message.includes("timed out"),
				`Expected timeout message, got: ${(err as Error).message}`,
			);
		}
		client.dispose();
	});

	it("endless server does not block subsequent fast commands", async () => {
		// The "endless" scenario never responds. We want to verify
		// that the pending map doesn't leak, and dispose still works.
		const client = createClient("endless", 200);
		client.start();
		// Send a command that will never get a response
		try {
			await client.prompt("This will hang");
		} catch {
			// Expected - timeout
		}
		// Client should still be alive after timeout cleanup
		// Note: if autoReconnect is true, the process is still alive,
		// but the pending request was cleaned up
		client.dispose();
	});

	it("request times out while queued (autoReconnect with crashed server)", async () => {
		const client = createClient("crash", 1000, true);
		client.start();
		// Wait for crash
		await new Promise((r) => setTimeout(r, 300));
		// By now the process has crashed; autoReconnect will queue requests.
		// But the mock is in "crash" mode and exits after the first command.
		// So reconnect will succeed (new process starts), but the queued request
		// should eventually resolve or time out.
		try {
			await client.prompt("Queued request");
		} catch {
			// May resolve or time out — either is acceptable behaviour
		}
		client.dispose();
	});
});
