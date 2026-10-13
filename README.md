# file-handle-reference-counter

Wraps a file handle (or any closeable resource) with reference counting so multiple consumers can share one underlying descriptor and close it safely.

## Usage

```js
import { RefCountedHandle } from 'file-handle-reference-counter';

// `resource` is whatever you're sharing — a numeric fd, a stream, an object.
// `close` is called exactly once, when the last reference goes away.
const handle = new RefCountedHandle({
  resource: 42,
  close: () => {},
});

// Hand out references to other consumers. Each gets its own release().
const a = handle.acquire();
const b = handle.acquire();

a.release();  // resource stays open
b.release();  // resource stays open
handle.release();  // last reference — close() is called now
```

## Why

When several parts of a program need to read from the same open file, tying the lifetime of the descriptor to a single owner is awkward: either one consumer closes it while another is mid-read, or nobody closes it and the descriptor leaks. Reference counting lets each consumer manage its own scope independently, with the descriptor closed exactly once when the last consumer finishes.

The trade-off: close is synchronous. `close()` on the underlying resource is assumed to return `void` and run to completion inline. This keeps the release path free of promises, which matters because cleanup code is often called from `finally` blocks and error handlers where an unexpected `await` distorts control flow. If you need async close, wrap the call yourself.

## Edge cases

- Releasing a reference more than once throws. A double-release almost always means a consumer lost track of its lifecycle; failing loudly catches that at the source rather than silently under-counting and leaking the descriptor.
- Acquiring on an already-closed handle throws. The descriptor is gone; handing out a new reference against it would be a lie.
- After close, `get()` returns `undefined` rather than throwing. Teardown paths that check `if (handle.get())` keep working without try/catch noise.
