// Makes IndexedDB available under Node's test runner (vitest runs this repo
// without a browser). Dexie talks to `indexedDB`/`IDBKeyRange` exactly as it
// would in Chrome/Safari — this just provides those globals in-process so
// repository/service tests exercise the real Dexie code path, not a mock.
import "fake-indexeddb/auto";
