/**
 * JsonlLineReader — a strict JSONL record reader for streams.
 *
 * IMPORTANT: Node's `readline` is NOT protocol-compliant for Pi RPC mode.
 * `readline` treats U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR)
 * as line terminators, but those code points are valid inside JSON string
 * values. Splitting on them corrupts the JSON. This reader splits ONLY on
 * LF (\n, 0x0A), as the Pi protocol requires, and strips a trailing \r.
 *
 * Usage:
 *   const reader = new JsonlLineReader();
 *   stdout.on("data", (chunk: Buffer) => reader.push(chunk));
 *   reader.onRecord((line: string) => {
 *     const obj = JSON.parse(line);
 *     ...
 *   });
 *
 * Works on Buffer chunks (decode as UTF-8) or string chunks. TextDecoder is
 * used to correctly handle multi-byte UTF-8 characters that span chunk
 * boundaries — a naive `chunk.toString()` on a partial multi-byte sequence
 * would produce replacement characters.
 */

export type RecordCallback = (line: string) => void;

export class JsonlLineReader {
  private buffer = '';
  private decoder: TextDecoder | null = null;
  private callback: RecordCallback | null = null;

  /** Register the handler invoked once per complete LF-delimited record. */
  onRecord(cb: RecordCallback): void {
    this.callback = cb;
  }

  /** Feed bytes. The Buffer is decoded incrementally to respect multi-byte boundaries. */
  push(chunk: Buffer | string): void {
    if (typeof chunk === 'string') {
      this.append(chunk);
    } else {
      // Prefer streaming TextDecoder so a chunk ending mid-codepoint does not
      // emit U+FFFD. Fallback to toString("utf8") if TextDecoder is unavailable.
      if (typeof TextDecoder !== 'undefined') {
        if (!this.decoder) {
          this.decoder = new TextDecoder('utf-8', { fatal: false });
        }
        this.append(this.decoder.decode(chunk, { stream: true }));
      } else {
        this.append(chunk.toString('utf8'));
      }
    }
  }

  /** Flush any trailing partial record (without a trailing LF). */
  flush(): void {
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = '';
      this.emit(line);
    }
    // Finalise the streaming decoder so it emits any pending tail bytes.
    if (this.decoder) {
      const tail = this.decoder.decode();
      if (tail) {
        this.emit(tail);
      }
    }
  }

  private append(text: string): void {
    this.buffer += text;
    let nl: number;
    // Split ONLY on LF (\n). Strip a single trailing CR (\r) if present.
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, nl);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0) {
        this.emit(line);
      }
    }
  }

  private emit(line: string): void {
    if (this.callback) {
      try {
        this.callback(line);
      } catch (err) {
        // Swallow handler errors so a bad callback can't crash the stream loop.
        // The caller is responsible for surfacing parse/handler errors via logs.
        // eslint-disable-next-line no-console
        console.error('[JsonlLineReader] record handler threw:', err);
      }
    }
  }
}
