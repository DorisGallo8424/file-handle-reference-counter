/**
 * Core reference-counting logic for a shared file handle.
 *
 * The RefCountedHandle wraps a single underlying resource (represented by an
 * opaque `close()` callback) and lets multiple consumers hold references to it.
 * The underlying resource is closed exactly once, when the last reference is
 * released.
 *
 * Design decisions:
 *
 * 1. Synchronous close. `close()` on the underlying resource is assumed to be
 *    synchronous. Node's `fs.closeSync` is synchronous; `fs.close` is async.
 *    Supporting async close would force every consumer to await release(),
 *    which is a different API shape. This library picks the synchronous shape
 *    so callers don't need to thread promises through cleanup paths.
 *
 * 2. Idempotent release. Calling `release()` more times than `acquire()` is
 *    a programming error and throws. This is stricter than silently ignoring,
 *    because a missed acquire would silently leak the handle; failing loudly
 *    catches the bug at the call site that caused it.
 *
 * 3. Use-after-close returns undefined. Once the handle is closed, `get()`
 *    returns undefined rather than throwing. Threading throws through
 *    consumers that are already tearing down tends to mask the real error.
 *    Returning undefined lets teardown code check `if (handle.get())` cleanly.
 */

/**
 * @callback CloseFn
 * @returns {void}
 */

/**
 * Wraps an underlying resource with reference counting.
 */
export class RefCountedHandle {
  /**
   * @param {object} opts
   * @param {unknown} opts.resource  The underlying resource (e.g. a numeric fd).
   * @param {CloseFn} opts.close      Called exactly once when refcount hits zero.
   */
  constructor({ resource, close }) {
    if (typeof close !== 'function') {
      throw new TypeError('RefCountedHandle: close must be a function');
    }
    this._resource = resource;
    this._close = close;
    // Starts at 1: the creator implicitly holds one reference and must release it.
    this._refcount = 1;
    this._closed = false;
  }

  /**
   * Increment the reference count. Returns a thin wrapper so consumers can
   * release their own reference without touching the shared handle directly.
   *
   * @returns {{ release: () => void }}
   */
  acquire() {
    if (this._closed) {
      throw new Error('RefCountedHandle: cannot acquire a closed handle');
    }
    this._refcount += 1;
    const self = this;
    let released = false;
    return {
      release() {
        if (released) {
          // Guard against double-release of the same reference. Same rationale
          // as over-releasing the handle: fail loudly so the bug surfaces.
          throw new Error('RefCountedHandle: reference already released');
        }
        released = true;
        self._release();
      },
    };
  }

  /**
   * Release one reference held by the creator. Most consumers should use the
   * per-reference `release()` returned by `acquire()`; this method exists for
   * the implicit initial reference.
   */
  release() {
    this._release();
  }

  _release() {
    if (this._closed) {
      throw new Error('RefCountedHandle: handle already closed');
    }
    this._refcount -= 1;
    if (this._refcount === 0) {
      this._closed = true;
      this._close();
    } else if (this._refcount < 0) {
      // Should be unreachable given the guards above, but assert anyway so
      // any future refactor that breaks the invariant fails loudly.
      throw new Error('RefCountedHandle: refcount underflow');
    }
  }

  /**
   * @returns {unknown} The underlying resource, or undefined once closed.
   */
  get() {
    if (this._closed) {
      return undefined;
    }
    return this._resource;
  }

  /**
   * @returns {number} Current reference count. Zero once fully released.
   */
  refcount() {
    return this._refcount;
  }

  /**
   * @returns {boolean} True once the underlying resource has been closed.
   */
  isClosed() {
    return this._closed;
  }
}
