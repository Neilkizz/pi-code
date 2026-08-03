import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./parseUnifiedDiff";

const SAMPLE_DIFF = `diff --git a/src/hello.ts b/src/hello.ts
index 1111111..2222222 100644
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1,5 +1,5 @@
 const greeting = "hello";
-function greet() {
+export function greet() {
   return greeting;
 }
@@ -20,3 +20,4 @@ export function other() {
   return "other";
 }
+// reviewed
`;

describe("parseUnifiedDiff", () => {
  it("parses hunks with ranges and verbatim bodies", () => {
    const hunks = parseUnifiedDiff(SAMPLE_DIFF);
    expect(hunks).toHaveLength(2);

    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].oldLines).toBe(5);
    expect(hunks[0].newStart).toBe(1);
    expect(hunks[0].newLines).toBe(5);
    expect(hunks[0].lines).toEqual([
      { prefix: " ", content: "const greeting = \"hello\";" },
      { prefix: "-", content: "function greet() {" },
      { prefix: "+", content: "export function greet() {" },
      { prefix: " ", content: "  return greeting;" },
      { prefix: " ", content: "}" },
    ]);
    expect(hunks[0].body).toContain("@@ -1,5 +1,5 @@\n");
    expect(hunks[0].body).toContain("+export function greet() {\n");

    expect(hunks[1].oldStart).toBe(20);
    expect(hunks[1].oldLines).toBe(3);
    expect(hunks[1].newStart).toBe(20);
    expect(hunks[1].newLines).toBe(4);
  });

  it("handles single-line counts without an explicit line count", () => {
    const hunks = parseUnifiedDiff(
      `--- a/f.ts
+++ b/f.ts
@@ -10 +10,2 @@
 original
+added`,
    );
    expect(hunks).toHaveLength(1);
    expect(hunks[0].oldStart).toBe(10);
    expect(hunks[0].oldLines).toBe(1);
    expect(hunks[0].newStart).toBe(10);
    expect(hunks[0].newLines).toBe(2);
  });

  it("returns empty for content without hunks", () => {
    expect(parseUnifiedDiff("no hunks here\n")).toEqual([]);
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
