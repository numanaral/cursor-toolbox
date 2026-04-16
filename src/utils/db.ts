import Database from "better-sqlite3";

export const openDb = (path: string): Database.Database => {
  return new Database(path);
};

export const getItemTableValue = <T = unknown>(db: Database.Database, key: string): T | null => {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    console.warn(`Failed to parse ItemTable value for key: ${key}`);
    return null;
  }
};

export const setItemTableValue = (db: Database.Database, key: string, value: unknown): void => {
  db.prepare("UPDATE ItemTable SET value = ? WHERE key = ?").run(JSON.stringify(value), key);
};

export const getDiskKVValue = <T = unknown>(db: Database.Database, key: string): T | null => {
  const row = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    console.warn(`Failed to parse cursorDiskKV value for key: ${key}`);
    return null;
  }
};
