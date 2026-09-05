# Offline behavior

IndexedDB is the frontend source of truth. The service worker precaches only the application shell and static assets. `/api/*` is excluded from navigation fallback and has no runtime API cache.

After the shell has been cached, application routes can be navigated offline:
- `/library`
- `/practice`
- `/tournament`
- `/vocabulary`
- `/vocabulary/sets`
- `/share`
- `/share/:code`
- `/wiki`
- `/profile`

Exam/vocabulary data is not placed in the service-worker cache. Offline mutations stay in IndexedDB and the sync queue; reconnect triggers synchronization. Server failure must not delete local data.

Service-worker cache versioning is `exam-platform-v8`; outdated caches are cleaned and `autoUpdate`/`skipWaiting` is enabled so a new app shell can replace a stale shell safely.
