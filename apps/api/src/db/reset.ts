import { unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const url = process.env.DATABASE_URL ?? "file:./data/exam-platform.db";
if (process.env.NODE_ENV === "production") throw new Error("db:reset is disabled in production");
const file = url.startsWith("file:") ? resolve(process.cwd(), url.slice(5)) : resolve(process.cwd(), url);
if (existsSync(file)) unlinkSync(file);
if (existsSync(`${file}-shm`)) unlinkSync(`${file}-shm`);
if (existsSync(`${file}-wal`)) unlinkSync(`${file}-wal`);
console.log("SQLite database reset.");
