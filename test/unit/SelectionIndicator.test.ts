import assert from "assert";

export function formatSelectionBadge(lineCount: number, visible: boolean): string {
	if (lineCount <= 0 || !visible) return "";
	return `${lineCount} ${lineCount === 1 ? "line" : "lines"} selected`;
}

describe("Selection line range indicator", () => {
	it("formats single line selection", () => {
		assert.strictEqual(formatSelectionBadge(1, true), "1 line selected");
	});

	it("formats multi line selection", () => {
		assert.strictEqual(formatSelectionBadge(33, true), "33 lines selected");
	});

	it("returns empty when selection is hidden or count is 0", () => {
		assert.strictEqual(formatSelectionBadge(33, false), "");
		assert.strictEqual(formatSelectionBadge(0, true), "");
	});
});
