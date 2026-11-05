-- Doran's To-Do Lists — one row per task, including deleted "tombstones".
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL,
  list       TEXT    NOT NULL CHECK (list IN ('business', 'personal')),
  title      TEXT    NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  urgent     INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_updated_at ON tasks (updated_at);
