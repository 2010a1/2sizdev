# Phase 9 Release Checklist

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm --filter @exam/api db:migrate`
- [ ] `pnpm build`
- [ ] `pnpm exec playwright install --with-deps chromium`
- [ ] `pnpm e2e`
- [ ] API restart preserves sync data
- [ ] API restart preserves share data
- [ ] deleted/expired share state persists
- [ ] backup/restore validated
- [ ] CI workflow passes
