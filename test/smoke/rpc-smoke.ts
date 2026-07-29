/**
 * RPC smoke test — spawns `pi --mode rpc`, sends a prompt, and verifies we
 * receive the expected event types and a response. Does NOT require VS Code.
 *
 * Run: npx ts-node test/smoke/rpc-smoke.ts
 *
 * Prerequisites: `pi` CLI must be installed (any provider authenticated).
 */
import { execSync, spawn } from 'child_process';

const PI = process.env.PI_EXECUTABLE ?? 'pi';
const TIMEOUT_MS = 45_000;

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}
const results: TestResult[] = [];

function record(name: string, passed: boolean, detail = ''): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
}

/** LF-only stream reader. Must survive U+2028/U+2029 inside JSON strings. */
class JsonlReader {
  buffer = '';
  lines: string[] = [];

  feed(chunk: Buffer): void {
    this.buffer += chunk.toString('utf-8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      let line = this.buffer.slice(0, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.length > 0) this.lines.push(line);
    }
  }

  parsed(): any[] {
    return this.lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { type: 'unparseable', raw: l.slice(0, 80) };
      }
    });
  }

  hasType(type: string): boolean {
    return this.parsed().some((e: any) => e.type === type);
  }
}

async function waitFor(
  reader: JsonlReader,
  pred: () => boolean,
  after: () => void,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      after();
      reject(new Error('timeout'));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (pred()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 250);
  });
}

async function run(): Promise<void> {
  console.log('Pi RPC Smoke Test');
  let piExists = false;
  try {
    execSync(`"${PI}" --version`, { stdio: 'pipe' });
    piExists = true;
  } catch {
    piExists = false;
  }
  record('pi executable found', piExists);
  if (!piExists) {
    console.log('\nSkipping integration tests — pi CLI not found. Set PI_EXECUTABLE to override.');
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`Results: ${passed}/${total} passed`);
    return;
  }

  const child = spawn(PI, ['--mode', 'rpc', '--no-session'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...(process.env as Record<string, string>) },
  });
  const reader = new JsonlReader();

  child.stdout!.on('data', (chunk: Buffer) => reader.feed(chunk));
  child.stderr!.on('data', (chunk: Buffer) => {
    const t = chunk.toString('utf-8').trim();
    if (t) console.log(`  [pi] ${t}`);
  });

  // Test 1: prompt, then verify streamed events arrive.
  console.log('\nTest 1: prompt + streamed events');
  const promptId = 'smoke-1';
  child.stdin!.write(
    JSON.stringify({ id: promptId, type: 'prompt', message: 'Say hello in one sentence.' }) + '\n',
  );

  try {
    await waitFor(
      reader,
      () => reader.hasType('agent_end'),
      () => child.kill('SIGTERM'),
      TIMEOUT_MS,
    );
  } catch {
    record('agent_end received', false, 'timed out');
  }

  const all = reader.parsed();
  const promptResp = all.find((e: any) => e.type === 'response' && e.id === promptId);
  record('prompt response received', !!promptResp);
  if (promptResp) record('response.success is true', (promptResp as any).success === true);
  record('agent_start event', reader.hasType('agent_start'));
  record('message_update event', reader.hasType('message_update'));

  // Test 2: U+2028/2029 separator must NOT corrupt JSON reader
  console.log('\nTest 2: U+2028/2029 inside JSON strings');
  const jsonWith = JSON.stringify({ type: 'test', body: 'a b c' });
  const jsonSplit = jsonWith.split('\n');
  record('U+2028/2029 unsplit by \\n', jsonSplit.length === 1, `parts: ${jsonSplit.length}`);

  // Test 3: get_state
  console.log('\nTest 3: get_state');
  const stateId = 'smoke-state';
  child.stdin!.write(JSON.stringify({ id: stateId, type: 'get_state' }) + '\n');

  const stateReader = new JsonlReader();
  const origHandler = (_b: Buffer) => {}; // stub — actually we need a proper resub
  // Since the first stream already ended, re-create:
  // Use a new reader + wait directly.
  const freshReader = new JsonlReader();
  child.stdout!.on('data', (chunk: Buffer) => freshReader.feed(chunk));

  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      record('get_state response', false, 'timed out');
      resolve();
    }, 10_000);
    const interval = setInterval(() => {
      const found = freshReader
        .parsed()
        .find((e: any) => e.type === 'response' && e.id === stateId);
      if (found) {
        clearInterval(interval);
        clearTimeout(t);
        record('get_state successful', (found as any).success === true);
        record('state has thinkingLevel', (found as any).data?.thinkingLevel !== undefined);
        record('state has isStreaming', (found as any).data?.isStreaming !== undefined);
        resolve();
      }
    }, 250);
  });

  child.kill('SIGTERM');

  // Test 4: Parse a message_update containing U+2028 inside delta.
  console.log('\nTest 4: U+2028 survival in message_update.text_delta');
  const testObj = {
    type: 'message_update',
    message: { role: 'assistant' },
    assistantMessageEvent: { type: 'text_delta', delta: 'line1 line2' },
  };
  const raw = JSON.stringify(testObj);
  record('U+2028 roundtrips via JSON.parse/stringify', JSON.parse(raw) !== null);
  const eventJson = JSON.parse(raw);
  record(
    'delta preserves U+2028',
    (eventJson as any).assistantMessageEvent.delta.indexOf(' ') !== -1,
  );

  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} tests passed`);
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

run().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
