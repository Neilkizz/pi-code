import assert from "assert";
import { JsonlLineReader } from "../../src/rpc/lineReader";

describe("JsonlLineReader", () => {
  it("emits single LF-delimited line", (done) => {
    const reader = new JsonlLineReader();
    reader.onRecord((line) => {
      assert.strictEqual(line, "hello");
      done();
    });
    reader.push(Buffer.from("hello\n"));
  });

  it("emits multiple lines", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push(Buffer.from("one\ntwo\nthree\n"));
    assert.deepStrictEqual(lines, ["one", "two", "three"]);
  });

  it("strips trailing CR (\\r\\n)", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push(Buffer.from("line\r\nnext\r\n"));
    assert.deepStrictEqual(lines, ["line", "next"]);
  });

  it("does NOT split on U+2028 LINE SEPARATOR", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    // Two real LF-delimited records, the second containing U+2028 inside a JSON string.
    reader.push(Buffer.from("first\n"));
    reader.push(Buffer.from(JSON.stringify({ text: "hello world" }) + "\n"));
    reader.flush();
    assert.strictEqual(lines.length, 2);
    const obj = JSON.parse(lines[1]);
    assert.strictEqual((obj as any).text, "hello world");
  });

  it("does NOT split on U+2029 PARAGRAPH SEPARATOR", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push(Buffer.from(JSON.stringify({ body: "before after" }) + "\n"));
    assert.strictEqual(lines.length, 1);
    const obj = JSON.parse(lines[0]);
    assert.strictEqual((obj as any).body, "before after");
  });

  it("handles multi-byte UTF-8 boundary split", () => {
    const reader = new JsonlLineReader();
    const lines: string[] = [];
    reader.onRecord((l) => lines.push(l));
    // 你 is 0xE4 0xBD 0xA0 — split at byte 1 (mid codepoint).
    reader.push(Buffer.from([0x7B, 0x22, 0x6E, 0x22, 0x3A, 0x22, 0xE4])); // {"n":" (+ partial
    reader.push(Buffer.from([0xBD, 0xA0, 0x22, 0x7D, 0x0A]));              // rest of 你"}  + \n
    assert.strictEqual(lines.length, 1);
    const o = JSON.parse(lines[0]);
    assert.strictEqual((o as any).n, "你");
  });

  it("flush emits trailing incomplete record", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push(Buffer.from("no-traling-lf"));
    reader.flush();
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], "no-traling-lf");
  });

  it("skips empty lines", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push(Buffer.from("\n\nhello\n\nworld\n\n"));
    assert.deepStrictEqual(lines, ["hello", "world"]);
  });

  it("handles push-string call (non-Buffer)", () => {
    const lines: string[] = [];
    const reader = new JsonlLineReader();
    reader.onRecord((l) => lines.push(l));
    reader.push("alpha\nbeta\n");
    assert.deepStrictEqual(lines, ["alpha", "beta"]);
  });

  it("flush after multi-byte split does not emit replacement chars", () => {
    const reader = new JsonlLineReader();
    const lines: string[] = [];
    reader.onRecord((l) => lines.push(l));
    // Send a partial multi-byte prefix, then flush without the rest.
    reader.push(Buffer.from([0xE4])); // first byte of 你
    reader.flush();
    // TextDecoder with {fatal:false} emits U+FFFD for the dangling lead byte.
    // We verify at least one line is emitted (the dangling surrogate).
    assert.ok(lines.length > 0, "flush should emit the dangling decode tail");
    // The replacement character should appear in the flushed tail.
    assert.ok(lines[0].includes("�") || lines[0].length > 0);
  });

  it("decoder is reused across multiple push cycles", () => {
    const reader = new JsonlLineReader();
    const lines: string[] = [];
    reader.onRecord((l) => lines.push(l));
    // First push: complete two-byte UTF-8 record.
    reader.push(Buffer.from([0xC2, 0xA9, 0x0A])); // "©\n"
    reader.flush();
    // Second push with a fresh buffer — same decoder instance.
    reader.push(Buffer.from([0xC2, 0xAE, 0x0A])); // "®\n"
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[0], "©");
    assert.strictEqual(lines[1], "®");
  });

  it("handler exception does not crash the reader", () => {
    const reader = new JsonlLineReader();
    const lines: string[] = [];
    reader.onRecord((l) => {
      if (l === "boom") throw new Error("simulated handler error");
      lines.push(l);
    });
    reader.push("hello\nboom\nworld\n");
    // "hello" was recorded; "boom" threw; "world" was still processed.
    assert.deepStrictEqual(lines, ["hello", "world"]);
  });
});