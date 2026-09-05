# Backup / Restore

## Backup

Stop writes when possible, then run:

`pnpm --filter @exam/api db:backup ./backups/exam-platform.db`

The command uses SQLite `VACUUM INTO` to create an atomic consistent backup.

## Restore

Restore during a maintenance window with the API stopped:

`ALLOW_DB_RESTORE=true NODE_ENV=production pnpm --filter @exam/api db:restore ./backups/exam-platform.db`

The backup is validated with SQLite `integrity_check` before replacement. The command refuses production restore unless explicitly enabled.

Never overwrite a live database while the API is serving traffic.
