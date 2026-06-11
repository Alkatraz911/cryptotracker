// Pick storage backend: Postgres if DATABASE_URL is set, else lowdb JSON file.
import { LowdbStorage } from "./lowdb.js";
import { PostgresStorage } from "./postgres.js";

export async function createStorage() {
  const url = process.env.DATABASE_URL;
  const storage = url ? new PostgresStorage(url) : new LowdbStorage();
  await storage.init();
  console.log(`[storage] ${storage.kind()}`);
  return storage;
}
