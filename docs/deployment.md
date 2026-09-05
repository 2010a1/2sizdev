# Deployment

## Web
1. Install with pnpm.
2. Run `pnpm build`.
3. Host `apps/web/dist` on HTTPS static hosting.
4. Configure SPA fallback to `index.html` for application routes, but do not rewrite `/api/*`.
5. Serve the generated service worker and manifest with normal static caching rules.
6. Set `VITE_API_URL` at build time when the API is on another origin.

## API
- Run the compiled Node process from `apps/api/dist/server.js`.
- Set `PORT`, `CORS_ORIGINS`, `REQUEST_TIMEOUT_MS`, and rate limits.
- Put the API behind HTTPS/reverse proxy in production.
- Expose `/api/health` for readiness/liveness checks.
- SIGTERM/SIGINT close the Fastify server gracefully.

## Persistence
The production default is SQLite through the repository interfaces. For Railway, mount a persistent Volume at `/data` and configure:

```text
DATABASE_URL=file:/data/exam-platform.db
SHARED_EXAMS_DIR=/data/shared-exams
STORAGE_DRIVER=sqlite
```

If the deployment has no persistent volume, SQLite and shared exam files are ephemeral and can be lost on restart/redeploy. Memory repositories are retained for tests only.

## Railway single-service deployment

If Railway is deploying only one service from this repository, use the repository root `Dockerfile`, not `Dockerfile.web`. The root image runs both Fastify and nginx. Configure a persistent Volume at `/data`. The web server listens on Railway's `PORT` and proxies `/api/*` internally to Fastify.

Recommended variables:

```text
NODE_ENV=production
DATABASE_URL=file:/data/exam-platform.db
STORAGE_DRIVER=sqlite
SHARED_EXAMS_DIR=/data/shared-exams
CORS_ORIGINS=*
API_PORT=3001
```

Do not set `VITE_API_URL` for this single-service deployment; same-origin `/api` is intentionally used.

If web and API are separate Railway services, either set `VITE_API_URL` on the web build to the API's HTTPS origin, or configure `API_UPSTREAM` on the web container. The API service must include the web origin in `CORS_ORIGINS`.

## TRUST_PROXY and the real client IP

`TRUST_PROXY` controls how many reverse-proxy hops Fastify trusts when resolving `req.ip` from `X-Forwarded-For`. This value drives per-IP rate limiting, security-event/audit-log IPs, and the trust-proxy IP allow/deny logic.

- `TRUST_PROXY=true` trusts exactly **1** hop (our supported topology: `Internet -> nginx -> Fastify`), not an unbounded chain. Trusting an unbounded chain would let a client set `X-Forwarded-For: <anything>` and have it accepted as their IP, because nginx's `X-Forwarded-For $proxy_add_x_forwarded_for` directive *appends* the real address rather than replacing the header.
- `TRUST_PROXY=false` (default) trusts no proxy headers; `req.ip` is the direct socket peer.
- `TRUST_PROXY=<integer>` trusts that many hops, for topologies with an extra load balancer in front of nginx.
- The single-service Railway image (root `Dockerfile`) sets `TRUST_PROXY=true` automatically in `docker/entrypoint-railway.sh`, since its API process only ever listens on `127.0.0.1` behind the bundled nginx.
- The multi-container `docker/docker-compose.yml` also sets `TRUST_PROXY=true` for the `api` service, and intentionally does **not** publish the API's port to the host (`expose`, not `ports`) — the API must only be reachable through the `web` (nginx) service. Publishing the API port directly would let clients bypass nginx and present themselves as the trusted hop, spoofing `req.ip`.
- If you deploy the API and nginx as separate, independently-reachable services (e.g. two separate Railway services with the API also given a public URL), do not set `TRUST_PROXY=true` unless the API is also firewalled to only accept connections from nginx — otherwise the same spoofing issue applies.
