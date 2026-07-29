import assert from "assert";
import { decodeFromWebview } from "../../src/view/WebviewMessenger";

describe("decodeFromWebview", () => {
	it("accepts a valid prompt message", () => {
		const result = decodeFromWebview({ kind: "prompt", text: "hello" });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "prompt");
	});

	it("accepts abort message", () => {
		const result = decodeFromWebview({ kind: "abort" });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "abort");
	});

	it("accepts cycleModel with direction", () => {
		const result = decodeFromWebview({ kind: "cycleModel", direction: "prev" });
		assert.ok(result !== null);
		if (result!.kind === "cycleModel") {
			assert.strictEqual(result.direction, "prev");
		}
	});

	it("rejects null input", () => {
		assert.strictEqual(decodeFromWebview(null), null);
	});

	it("rejects non-object input", () => {
		assert.strictEqual(decodeFromWebview("string"), null);
		assert.strictEqual(decodeFromWebview(42), null);
		assert.strictEqual(decodeFromWebview(undefined), null);
	});

	it("rejects input without kind field", () => {
		assert.strictEqual(decodeFromWebview({ text: "hi" }), null);
	});

	it("rejects unknown kind values", () => {
		assert.strictEqual(decodeFromWebview({ kind: "unknownKind" }), null);
	});

	it("accepts setThinkingLevel with valid level", () => {
		const result = decodeFromWebview({ kind: "setThinkingLevel", level: "max" });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "setThinkingLevel");
	});

	it("accepts requestFileSuggestions", () => {
		const result = decodeFromWebview({ kind: "requestFileSuggestions" });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "requestFileSuggestions");
	});

	it("accepts acceptDiff with optional diffId", () => {
		const result = decodeFromWebview({ kind: "acceptDiff", diffId: "abc" });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "acceptDiff");
	});

	it("rejects input with extra unknown properties (still valid shape)", () => {
		const result = decodeFromWebview({ kind: "abort", extra: true });
		assert.ok(result !== null);
		assert.strictEqual(result!.kind, "abort");
	});
});
