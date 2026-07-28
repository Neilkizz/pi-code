import assert from "assert";

export interface SessionItem {
	id: string;
	name: string;
	timestamp: number;
}

export function filterSessions(sessions: SessionItem[], query: string): SessionItem[] {
	if (!query.trim()) return sessions;
	const q = query.toLowerCase();
	return sessions.filter((s) => s.name.toLowerCase().includes(q));
}

describe("HeaderBar filterSessions", () => {
	it("returns all sessions when search query is empty", () => {
		const sessions: SessionItem[] = [
			{ id: "1", name: "Fix authentication bug", timestamp: 1000 },
			{ id: "2", name: "Refactor database layer", timestamp: 2000 },
		];
		assert.strictEqual(filterSessions(sessions, "").length, 2);
	});

	it("filters sessions by case-insensitive name match", () => {
		const sessions: SessionItem[] = [
			{ id: "1", name: "Fix authentication bug", timestamp: 1000 },
			{ id: "2", name: "Refactor database layer", timestamp: 2000 },
		];
		const result = filterSessions(sessions, "auth");
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].id, "1");
	});
});
