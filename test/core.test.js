import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RefCountedHandle } from '../src/index.js';

function makeHandle(resource = 42) {
  let closed = false;
  const close = () => {
    closed = true;
  };
  const h = new RefCountedHandle({ resource, close });
  return { h, isClosed: () => closed };
}

test('starts with refcount 1 and exposes the resource', () => {
  const { h } = makeHandle(7);
  assert.equal(h.refcount(), 1);
  assert.equal(h.get(), 7);
  assert.equal(h.isClosed(), false);
});

test('release of the initial reference closes the handle', () => {
  const { h, isClosed } = makeHandle();
  h.release();
  assert.equal(isClosed(), true);
  assert.equal(h.isClosed(), true);
  assert.equal(h.refcount(), 0);
  assert.equal(h.get(), undefined);
});

test('acquire increments refcount and returns a releasable reference', () => {
  const { h } = makeHandle();
  const ref = h.acquire();
  assert.equal(h.refcount(), 2);
  ref.release();
  assert.equal(h.refcount(), 1);
});

test('handle is closed when the last of multiple references is released', () => {
  const { h, isClosed } = makeHandle();
  const a = h.acquire();
  const b = h.acquire();
  assert.equal(h.refcount(), 3);
  h.release();
  assert.equal(isClosed(), false);
  a.release();
  assert.equal(isClosed(), false);
  b.release();
  assert.equal(isClosed(), true);
});

test('close is called exactly once', () => {
  let closeCount = 0;
  const h = new RefCountedHandle({
    resource: 1,
    close: () => { closeCount += 1; },
  });
  const ref = h.acquire();
  h.release();
  ref.release();
  assert.equal(closeCount, 1);
});

test('acquire on a closed handle throws', () => {
  const { h } = makeHandle();
  h.release();
  assert.throws(() => h.acquire(), /closed/);
});

test('releasing more references than acquired throws', () => {
  const { h } = makeHandle();
  const ref = h.acquire();
  ref.release();
  assert.throws(() => ref.release(), /already released/);
});

test('release after handle fully closed throws', () => {
  const { h } = makeHandle();
  h.release();
  assert.throws(() => h.release(), /closed/);
});

test('constructor validates close is a function', () => {
  assert.throws(
    () => new RefCountedHandle({ resource: 1, close: 'nope' }),
    /close must be a function/,
  );
});

test('get returns undefined after close, not the stale resource', () => {
  const { h } = makeHandle(99);
  h.release();
  assert.equal(h.get(), undefined);
});

test('many references can be acquired and released in arbitrary order', () => {
  const { h, isClosed } = makeHandle();
  const refs = [h.acquire(), h.acquire(), h.acquire(), h.acquire()];
  assert.equal(h.refcount(), 5);
  refs[2].release();
  refs[0].release();
  refs[3].release();
  assert.equal(isClosed(), false);
  refs[1].release();
  h.release();
  assert.equal(isClosed(), true);
});
