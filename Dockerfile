# Railway-friendly single-service deployment.
# It serves the SPA and reverse-proxies /api/* to the Fastify process.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @exam/api build && pnpm --filter @exam/web build

FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends nginx gettext-base ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
# Serve the built SPA directly from nginx. Without this copy nginx has no
# index.html and Railway may appear healthy while / renders an empty/default page.
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint-railway.sh /entrypoint-railway.sh
RUN chmod +x /entrypoint-railway.sh
ENV NODE_ENV=production
ENV PORT=8080
ENV API_UPSTREAM=http://127.0.0.1:3001
ENV DATABASE_URL=file:/data/exam-platform.db
ENV STORAGE_DRIVER=sqlite
ENV SHARED_EXAMS_DIR=/data/shared-exams
EXPOSE 8080
ENTRYPOINT ["/entrypoint-railway.sh"]
