import { RequestQueue } from '../../src/rpc/requestQueue';
import assert from 'assert';

describe('RequestQueue', () => {
  it('enqueues and drains in FIFO order', () => {
    const q = new RequestQueue();
    const order: string[] = [];
    q.enqueue({
      id: 'a',
      command: 'prompt',
      payload: '',
      resolve: () => order.push('a'),
      reject: () => {},
      timeoutMs: 5000,
    });
    q.enqueue({
      id: 'b',
      command: 'prompt',
      payload: '',
      resolve: () => order.push('b'),
      reject: () => {},
      timeoutMs: 5000,
    });
    assert.strictEqual(q.length, 2);
    const items = q.drain();
    for (const item of items) item.resolve({});
    assert.deepStrictEqual(order, ['a', 'b']);
    assert.strictEqual(q.length, 0);
  });

  it('clear rejects all items', () => {
    const q = new RequestQueue();
    const rejected: string[] = [];
    q.enqueue({
      id: '1',
      command: 'prompt',
      payload: '',
      resolve: () => {},
      reject: (e: Error) => rejected.push(e.message),
      timeoutMs: 5000,
    });
    q.clear(new Error('shutdown'));
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0], 'shutdown');
    assert.strictEqual(q.length, 0);
  });

  it('remove drops a specific request', () => {
    const q = new RequestQueue();
    q.enqueue({
      id: 'x',
      command: 'prompt',
      payload: '',
      resolve: () => {},
      reject: () => {},
      timeoutMs: 5000,
    });
    q.enqueue({
      id: 'y',
      command: 'prompt',
      payload: '',
      resolve: () => {},
      reject: () => {},
      timeoutMs: 5000,
    });
    q.remove('x');
    assert.strictEqual(q.length, 1);
    const items = q.drain();
    assert.strictEqual(items[0].id, 'y');
  });

  it('remove returns undefined for unknown id', () => {
    const q = new RequestQueue();
    const removed = q.remove('nonexistent');
    assert.strictEqual(removed, undefined);
  });

  it('drops oldest when max size exceeded (default 100)', () => {
    const q = new RequestQueue(3);
    const dropped: string[] = [];
    q.enqueue({
      id: '1st',
      command: '',
      payload: '',
      resolve: () => {},
      reject: () => dropped.push('1st'),
      timeoutMs: 5000,
    });
    q.enqueue({
      id: '2nd',
      command: '',
      payload: '',
      resolve: () => {},
      reject: () => dropped.push('2nd'),
      timeoutMs: 5000,
    });
    q.enqueue({
      id: '3rd',
      command: '',
      payload: '',
      resolve: () => {},
      reject: () => dropped.push('3rd'),
      timeoutMs: 5000,
    });
    // Full — push a 4th item, 1st should be dropped.
    q.enqueue({
      id: '4th',
      command: '',
      payload: '',
      resolve: () => {},
      reject: () => dropped.push('4th'),
      timeoutMs: 5000,
    });
    assert.strictEqual(dropped.length, 1);
    assert.strictEqual(dropped[0], '1st');
    assert.strictEqual(q.length, 3);
    const items = q.drain();
    assert.strictEqual(items[0].id, '2nd');
    assert.strictEqual(items[1].id, '3rd');
    assert.strictEqual(items[2].id, '4th');
  });

  it('empty queue drain returns empty array', () => {
    const q = new RequestQueue();
    assert.deepStrictEqual(q.drain(), []);
  });
});
