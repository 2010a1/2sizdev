#!/bin/sh
set -eu

: "${WEB_PORT:=${PORT:-8080}}"
: "${STORAGE_DRIVER:=sqlite}"
# The API is internal-only. Never reuse Railway's public PORT (normally 8080)
# for Fastify, because nginx must own the public port. Ignore any stale
# API_PORT variable that may have been configured on the Railway service.
API_PORT=3001
API_UPSTREAM="http://127.0.0.1:${API_PORT}"

# Railway Volume is the persistence boundary. Railway does not guarantee that
# the RAILWAY_VOLUME_* helper variables are present in every runtime/build
# configuration, so do NOT use their presence as the only way to detect a
# mounted Volume. The canonical mount path for this service is /data.
#
# If Railway exposes RAILWAY_VOLUME_MOUNT_PATH, use it. Otherwise use /data
# and verify that /data is actually a mounted filesystem. This avoids both
# false failures (Volume is attached but helper vars are absent) and the
# dangerous case of silently writing SQLite data into ephemeral /app storage.
if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  DATA_ROOT="$RAILWAY_VOLUME_MOUNT_PATH"
else
  DATA_ROOT="${DATA_ROOT:-/data}"
fi

if [ "${STORAGE_DRIVER}" = "sqlite" ] && [ -n "${RAILWAY_ENVIRONMENT_NAME:-}" ]; then
  if [ ! -d "$DATA_ROOT" ]; then
    echo "FATAL: Railway Volume mount path '$DATA_ROOT' does not exist." >&2
    echo "Attach the Railway Volume to this service at mount path /data." >&2
    exit 78
  fi

  # Check the Linux mount table, not merely directory existence. A plain
  # /data directory inside the container is ephemeral and must never be used
  # for production SQLite state.
  if ! awk -v p="$DATA_ROOT" '$2 == p { found=1 } END { exit(found ? 0 : 1) }' /proc/mounts; then
    echo "FATAL: Railway Volume is not mounted at $DATA_ROOT." >&2
    echo "Attach the Volume to THIS service with mount path /data, then redeploy." >&2
    exit 78
  fi

  DATABASE_URL="file:${DATA_ROOT}/exam-platform.db"
  SHARED_EXAMS_DIR="${DATA_ROOT}/shared-exams"
else
  : "${DATABASE_URL:=file:${DATA_ROOT}/exam-platform.db}"
  : "${SHARED_EXAMS_DIR:=${DATA_ROOT}/shared-exams}"
fi
RAILWAY_VOLUME_MOUNT_PATH="$DATA_ROOT"
export DATABASE_URL STORAGE_DRIVER SHARED_EXAMS_DIR RAILWAY_VOLUME_MOUNT_PATH
# nginx is the sole path to the API here (it listens on 127.0.0.1 only, never
# exposed directly), so it is safe -- and necessary -- to trust that one hop.
# Without this, Fastify's trustProxy defaults to false and req.ip resolves to
# 127.0.0.1 for every request (the loopback nginx->api connection), which
# collapses per-client rate limiting into a single shared bucket and records
# 127.0.0.1 instead of the real client IP in security_events/audit_logs.
: "${TRUST_PROXY:=true}"
export TRUST_PROXY

mkdir -p "$RAILWAY_VOLUME_MOUNT_PATH" "$SHARED_EXAMS_DIR"
ESCAPED_API_UPSTREAM=$(printf '%s' "$API_UPSTREAM" | sed 's/[\\&|]/\\&/g')
ESCAPED_WEB_PORT=$(printf '%s' "$WEB_PORT" | sed 's/[\\&|]/\\&/g')
sed -e "s|\${API_UPSTREAM}|${ESCAPED_API_UPSTREAM}|g" -e "s/listen 8080;/listen ${ESCAPED_WEB_PORT};/" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

PORT="$API_PORT" pnpm --filter @exam/api exec tsx src/server.ts &
API_PID=$!

cleanup() {
  kill -TERM "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Do not start nginx until Fastify is ready. This prevents Railway from
# accepting traffic while /api is still booting/migrating SQLite.
i=0
until node -e "fetch('http://127.0.0.1:${API_PORT}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i+1))
  [ "$i" -ge 60 ] && { echo 'API failed to become ready' >&2; exit 1; }
  sleep 1
done

exec nginx -g 'daemon off;'
