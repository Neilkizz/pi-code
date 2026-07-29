/**
 * Mock Pi RPC server — a Node.js process that speaks JSONL over stdio,
 * simulating `pi --mode rpc` behaviour for integration testing.
 *
 * Behaviour is selected by the MOCK_SCENARIO env var:
 *   echo     — respond immediately to every command with success
 *   events   — for "prompt" commands, emit a stream of events before responding
 *   garbage  — write random garbage lines before the normal response
 *   slow     — delay response by 5 seconds (for timeout tests)
 *   crash    — exit(1) after processing the first command
 *   endless  — never respond (simulates a hung process)
 *
 * Usage (spawned as child process, NOT run directly):
 *   node -r ts-node/register test/integration/mockRpcServer.ts
 */

// ---------------------------------------------------------------------------
// Mock event sequences
// ---------------------------------------------------------------------------
function makeEventSequence(): object[] {
	return [
		{ type: "agent_start" },
		{
			type: "message_start",
			message: { role: "assistant", content: [] },
		},
		{
			type: "message_update",
			message: { role: "assistant" },
			assistantMessageEvent: { type: "text_delta", delta: "Hello" },
		},
		{
			type: "message_end",
			message: { role: "assistant", content: [{ text: "Hello" }] },
		},
		{ type: "agent_end", messages: [] },
	];
}

// ---------------------------------------------------------------------------
// Garbage generation
// ---------------------------------------------------------------------------
function randomGarbage(): string[] {
	const lines: string[] = [];
	const count = Math.floor(Math.random() * 3) + 1;
	for (let i = 0; i < count; i++) {
		if (Math.random() < 0.5) {
			lines.push(`not json at all ${Math.random()}`);
		} else {
			lines.push(`${Math.random()}`);
		}
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Response construction
// ---------------------------------------------------------------------------
function makeResponse(
	id: string | undefined,
	command: string,
): object {
	const defaultData: Record<string, unknown> = { ok: true };

	if (command === "get_state") {
		defaultData.thinkingLevel = "medium";
		defaultData.isStreaming = false;
		defaultData.isCompacting = false;
	} else if (command === "get_messages") {
		defaultData.messages = [];
	} else if (command === "get_available_models") {
		defaultData.models = [
			{
				id: "claude-sonnet-5",
				provider: "anthropic",
				label: "Claude Sonnet 5",
			},
		];
	} else if (command === "new_session") {
		defaultData.cancelled = false;
	} else if (command === "cycle_model") {
		defaultData.model = {
			id: "claude-opus-5",
			provider: "anthropic",
			label: "Claude Opus 5",
		};
		defaultData.thinkingLevel = "medium";
		defaultData.isScoped = false;
	}

	return {
		id,
		type: "response",
		command,
		success: true,
		data: defaultData,
	};
}

function makeErrorResponse(
	id: string | undefined,
	command: string,
	message: string,
): object {
	return {
		id,
		type: "response",
		command,
		success: false,
		errorMessage: message,
	};
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const scenario = (process.env.MOCK_SCENARIO ?? "echo").trim().toLowerCase();
let firstCommand = true;

import * as readline from "readline";

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line: string) => {
	const trimmed = line.trim();
	if (!trimmed) return;

	let obj: any;
	try {
		obj = JSON.parse(trimmed);
	} catch {
		// Non-JSON line — silently ignore (mirrors real pi stderr behaviour)
		writeLine(`{"type":"__ignored__","raw":"${trimmed.replace(/"/g, '\\"')}"}`);
		return;
	}

	const id = typeof obj.id === "string" ? obj.id : undefined;
	const type = typeof obj.type === "string" ? obj.type : "";

	// Handle special control commands
	if (type === "__crash__") {
		process.exit(1);
	}
	if (type === "__end__") {
		process.exit(0);
	}
	if (type.startsWith("__")) {
		// Unknown control command — respond with ack
		writeLine(
			JSON.stringify({ id, type: "response", command: type, success: true }),
		);
		return;
	}

	// Scenario-specific behaviour
	switch (scenario) {
		case "crash":
			if (firstCommand) {
				firstCommand = false;
				const resp = makeResponse(id, type);
				writeLine(JSON.stringify(resp));
				setTimeout(() => process.exit(1), 50);
				return;
			}
			break;

		case "slow":
			setTimeout(() => {
				writeLine(JSON.stringify(makeResponse(id, type)));
			}, 5000);
			return;

		case "endless":
			// Never respond — simulate hang
			return;

		case "events":
			// First emit events, then respond
			if (type === "prompt" || type === "steer" || type === "follow_up") {
				const events = makeEventSequence();
				for (const ev of events) {
					writeLine(JSON.stringify(ev));
				}
				setTimeout(() => {
					writeLine(JSON.stringify(makeResponse(id, type)));
				}, 50);
				return;
			}
			break;

		case "garbage":
			const garbageLines = randomGarbage();
			for (const g of garbageLines) {
				writeLine(g);
			}
			writeLine(JSON.stringify(makeResponse(id, type)));
			return;

		default:
			// "echo" — respond immediately
			break;
	}

	writeLine(JSON.stringify(makeResponse(id, type)));
});

rl.on("close", () => {
	// stdin closed — exit cleanly
	process.exit(0);
});

// Handle SIGTERM from parent
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function writeLine(text: string): void {
	process.stdout.write(text + "\n");
}
