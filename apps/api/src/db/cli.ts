import { existsSync } from "node:fs";
import { backupSqlite, restoreSqlite } from "./sqlite.js";

const command = process.argv[2];
const source = process.env.DATABASE_URL ?? "file:./data/exam-platform.db";
const target = process.argv[3];

if (command === "backup") {
  if (!target) throw new Error("Usage: db:backup <destination>");
  backupSqlite(source, target);
  console.log(`SQLite backup created: ${target}`);
} else if (command === "restore") {
  if (!target) throw new Error("Usage: db:restore <backup>");
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DB_RESTORE !== "true") throw new Error("Refusing production restore. Set ALLOW_DB_RESTORE=true during a maintenance window.");
  restoreSqlite(target, source);
  console.log(`SQLite database restored from: ${target}`);
} else {
  throw new Error("Usage: db:backup <destination> | db:restore <backup>");
}
