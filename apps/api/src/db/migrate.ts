import { openSqliteDatabase } from "./sqlite.js";
const db = openSqliteDatabase(process.env.DATABASE_URL);
db.close();
console.log("SQLite migrations applied.");
