# Railway persistence checklist

## Before the first redeploy

1. In Railway, open the service running this application.
2. Add/keep a Volume attached to that service.
3. Set its mount path to `/data`.
4. Verify the service has the runtime variables `RAILWAY_VOLUME_NAME` and
   `RAILWAY_VOLUME_MOUNT_PATH`.
5. If the old deployment already contains data, back it up before redeploying.

## Important

Do not use a normal container path such as `/app/data` for the production SQLite
file unless a Railway Volume is mounted there. Container storage is ephemeral.

The application now forces Railway production SQLite storage onto the attached
Volume. If the Volume is missing, startup stops with a clear error instead of
running with disposable storage.

## Backup

The existing API backup command can create a consistent SQLite backup:

```bash
pnpm --filter @exam/api db:backup ./backups/exam-platform.db
```

For Railway Volume data, use Railway's Volume backup/CLI facilities. Keep an
independent backup before migrations or destructive maintenance.


### Railway port topology

The public Railway `PORT` belongs to nginx. Fastify always uses internal port `3001` and is never exposed publicly. Do not set `API_PORT=8080` in Railway variables.

## Gemini API key persistence

- `GEMINI_API_KEY(S)` and `GEMINI_MODEL` are read from Railway environment variables. Railway Variables persist across redeploys; keep the secret there for the simplest setup.
- API keys added from the Admin → AI & Gemini API page are now stored in the same persistent SQLite database (`ai_keys` table), so they survive API restart/redeploy when the Railway Volume remains attached.
- The Admin API only returns a masked key; the raw key never goes to the browser.
- The built-in `env-default` key cannot be deleted or disabled from the Admin UI.
- Keys added through the Admin UI in older builds were in-memory only and cannot be recovered after the old process/container was replaced. Add that key again once on the fixed build, or set `GEMINI_API_KEY(S)` in Railway Variables.
