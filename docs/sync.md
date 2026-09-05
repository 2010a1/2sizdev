# Sync

## Endpoints
- `POST /api/sync/push`
- `GET /api/sync/pull?cursor=N`
- `GET /api/health`

Push is idempotent by `mutationId`. Pull is cursor based and batched.

Remote apply uses one Dexie read/write transaction covering exams, questions, assets, vocabulary, sets, set items and sync state. A validation error aborts the transaction and leaves the previous cursor unchanged.

## Status
`IDLE`, `SYNCING`, `OFFLINE`, `ERROR`.

`navigator.onLine` is only an early offline signal. Successful HTTP requests determine actual API availability.
