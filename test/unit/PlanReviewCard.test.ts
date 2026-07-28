import assert from "assert";

export function formatPlanFeedback(feedback: string): string {
	if (!feedback.trim()) return "";
	return `Instead of the proposed plan, please do this: ${feedback.trim()}`;
}

describe("PlanReviewCard feedback formatting", () => {
	it("formats user feedback for plan revision", () => {
		const formatted = formatPlanFeedback("Use PostgreSQL instead of SQLite");
		assert.strictEqual(
			formatted,
			"Instead of the proposed plan, please do this: Use PostgreSQL instead of SQLite",
		);
	});

	it("returns empty string for blank feedback", () => {
		assert.strictEqual(formatPlanFeedback("   "), "");
	});
});
