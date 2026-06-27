import sqlite3
import os
import uuid
from datetime import datetime, timezone

DB_PATH = "/data/clippery.db"


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


_SCHEMA_VERSION = 2


def init_db():
    conn = get_conn()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            )
        """)
        row = conn.execute("SELECT version FROM schema_version").fetchone()
        current = int(row["version"]) if row else 0

        if current < 1:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tags (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE
                );
                CREATE TABLE IF NOT EXISTS note_tags (
                    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    PRIMARY KEY (note_id, tag_id)
                );
                CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
                CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
            """)
            if current == 0:
                conn.execute("INSERT INTO schema_version VALUES (1)")
            else:
                conn.execute("UPDATE schema_version SET version = 1")

        if current < 2:
            conn.execute("ALTER TABLE notes ADD COLUMN deleted_at TEXT DEFAULT NULL")
            conn.execute("UPDATE schema_version SET version = 2")

        if current < 3:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            """)
            conn.execute("UPDATE schema_version SET version = 3")

    conn.close()
    purge_old_trash()


def now():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


# ── Folders ──────────────────────────────────────────────────────────────────

def get_folders():
    conn = get_conn()
    rows = conn.execute("SELECT * FROM folders ORDER BY name COLLATE NOCASE").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_folder(name, parent_id=None):
    conn = get_conn()
    folder = {"id": new_id(), "name": name, "parent_id": parent_id,
              "created_at": now(), "updated_at": now()}
    with conn:
        conn.execute(
            "INSERT INTO folders VALUES (:id,:name,:parent_id,:created_at,:updated_at)",
            folder
        )
    conn.close()
    return folder


def rename_folder(folder_id, name):
    conn = get_conn()
    ts = now()
    with conn:
        conn.execute("UPDATE folders SET name=?, updated_at=? WHERE id=?", (name, ts, folder_id))
    row = conn.execute("SELECT * FROM folders WHERE id=?", (folder_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def move_folder(folder_id, parent_id):
    conn = get_conn()
    ts = now()
    with conn:
        conn.execute(
            "UPDATE folders SET parent_id=?, updated_at=? WHERE id=?",
            (parent_id, ts, folder_id)
        )
    row = conn.execute("SELECT * FROM folders WHERE id=?", (folder_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_folder(folder_id):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM folders WHERE id=?", (folder_id,))
    conn.close()


# ── Notes ─────────────────────────────────────────────────────────────────────

def _note_tags(conn, note_id):
    rows = conn.execute(
        "SELECT t.name FROM tags t JOIN note_tags nt ON t.id=nt.tag_id WHERE nt.note_id=? ORDER BY t.name",
        (note_id,)
    ).fetchall()
    return [r["name"] for r in rows]


def get_notes(folder_id=None, tag=None, query=None, year=None):
    conn = get_conn()
    sql = "SELECT DISTINCT n.* FROM notes n"
    params = []
    joins, wheres = [], ["n.deleted_at IS NULL"]

    if tag:
        joins.append("JOIN note_tags nt ON n.id=nt.note_id JOIN tags t ON nt.tag_id=t.id")
        wheres.append("t.name=?")
        params.append(tag)

    if folder_id == "root":
        wheres.append("n.folder_id IS NULL")
    elif folder_id:
        wheres.append("n.folder_id=?")
        params.append(folder_id)

    if year:
        wheres.append("strftime('%Y', n.created_at) = ?")
        params.append(str(year))

    if query:
        wheres.append("(n.title LIKE ? OR n.body LIKE ?)")
        q = f"%{query}%"
        params += [q, q]

    if joins:
        sql += " " + " ".join(joins)
    if wheres:
        sql += " WHERE " + " AND ".join(wheres)
    sql += " ORDER BY n.updated_at DESC"

    rows = conn.execute(sql, params).fetchall()
    notes = []
    for row in rows:
        n = dict(row)
        n["tags"] = _note_tags(conn, n["id"])
        notes.append(n)
    conn.close()
    return notes


def get_note(note_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return None
    n = dict(row)
    n["tags"] = _note_tags(conn, note_id)
    conn.close()
    return n


def create_note(title="", body="", folder_id=None, created_at=None, tags=None):
    conn = get_conn()
    ts = now()
    nid = new_id()
    note = {"id": nid, "title": title, "body": body,
            "folder_id": folder_id, "created_at": created_at or ts, "updated_at": ts}
    with conn:
        conn.execute(
            "INSERT INTO notes (id,title,body,folder_id,created_at,updated_at)"
            " VALUES (:id,:title,:body,:folder_id,:created_at,:updated_at)",
            note
        )
        if tags:
            for tag_name in tags:
                tag_name = tag_name.strip().lower()
                if not tag_name:
                    continue
                row = conn.execute("SELECT id FROM tags WHERE name=?", (tag_name,)).fetchone()
                tag_id = row["id"] if row else new_id()
                if not row:
                    conn.execute("INSERT INTO tags VALUES (?,?)", (tag_id, tag_name))
                conn.execute("INSERT OR IGNORE INTO note_tags VALUES (?,?)", (nid, tag_id))
    note["tags"] = [t.strip().lower() for t in tags if t.strip()] if tags else []
    conn.close()
    return note


def update_note(note_id, **kwargs):
    conn = get_conn()
    sets, params = ["updated_at=?"], [now()]

    for field in ("title", "body", "folder_id", "created_at"):
        if field in kwargs:
            sets.append(f"{field}=?")
            params.append(kwargs[field])

    params.append(note_id)
    with conn:
        conn.execute(f"UPDATE notes SET {','.join(sets)} WHERE id=?", params)

        if "tags" in kwargs:
            conn.execute("DELETE FROM note_tags WHERE note_id=?", (note_id,))
            for tag_name in kwargs["tags"]:
                tag_name = tag_name.strip().lower()
                if not tag_name:
                    continue
                row = conn.execute("SELECT id FROM tags WHERE name=?", (tag_name,)).fetchone()
                tag_id = row["id"] if row else new_id()
                if not row:
                    conn.execute("INSERT INTO tags VALUES (?,?)", (tag_id, tag_name))
                conn.execute("INSERT OR IGNORE INTO note_tags VALUES (?,?)", (note_id, tag_id))

        conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM note_tags)")

    result = get_note(note_id)
    conn.close()
    return result


def delete_note(note_id):
    """Soft delete — moves to trash. Use permanent_delete() to hard-delete."""
    conn = get_conn()
    with conn:
        conn.execute(
            "UPDATE notes SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL",
            (now(), now(), note_id)
        )
    conn.close()


def get_trash(tag=None):
    conn = get_conn()
    if tag:
        rows = conn.execute(
            "SELECT DISTINCT n.* FROM notes n "
            "JOIN note_tags nt ON n.id=nt.note_id "
            "JOIN tags t ON nt.tag_id=t.id "
            "WHERE n.deleted_at IS NOT NULL AND t.name=? "
            "ORDER BY n.deleted_at DESC",
            (tag,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ).fetchall()
    notes = []
    for row in rows:
        n = dict(row)
        n["tags"] = _note_tags(conn, n["id"])
        notes.append(n)
    conn.close()
    return notes


def restore_note(note_id):
    conn = get_conn()
    with conn:
        conn.execute(
            "UPDATE notes SET deleted_at=NULL, updated_at=? WHERE id=?",
            (now(), note_id)
        )
    row = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return None
    n = dict(row)
    n["tags"] = _note_tags(conn, note_id)
    conn.close()
    return n


def permanent_delete(note_id):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    conn.close()


def purge_old_trash():
    conn = get_conn()
    with conn:
        conn.execute(
            "DELETE FROM notes WHERE deleted_at IS NOT NULL "
            "AND deleted_at < datetime('now', '-30 days')"
        )
    conn.close()


def delete_tag(name):
    conn = get_conn()
    with conn:
        row = conn.execute("SELECT id FROM tags WHERE name=?", (name,)).fetchone()
        if row:
            conn.execute("DELETE FROM note_tags WHERE tag_id=?", (row["id"],))
            conn.execute("DELETE FROM tags WHERE id=?", (row["id"],))
    conn.close()


def rename_tag(old_name, new_name):
    conn = get_conn()
    with conn:
        existing = conn.execute("SELECT id FROM tags WHERE name=?", (new_name,)).fetchone()
        old_row  = conn.execute("SELECT id FROM tags WHERE name=?", (old_name,)).fetchone()
        if not old_row:
            conn.close()
            return
        if existing:
            conn.execute("UPDATE OR IGNORE note_tags SET tag_id=? WHERE tag_id=?",
                         (existing["id"], old_row["id"]))
            conn.execute("DELETE FROM note_tags WHERE tag_id=?", (old_row["id"],))
            conn.execute("DELETE FROM tags WHERE id=?", (old_row["id"],))
        else:
            conn.execute("UPDATE tags SET name=? WHERE id=?", (new_name, old_row["id"]))
    conn.close()


# ── Tags ──────────────────────────────────────────────────────────────────────

def get_tags():
    conn = get_conn()
    rows = conn.execute(
        "SELECT t.name, COUNT(CASE WHEN n.deleted_at IS NULL THEN 1 END) as count "
        "FROM tags t "
        "LEFT JOIN note_tags nt ON t.id=nt.tag_id "
        "LEFT JOIN notes n ON nt.note_id=n.id "
        "GROUP BY t.id ORDER BY t.name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Export ────────────────────────────────────────────────────────────────────

def export_all():
    conn = get_conn()
    conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
    folders = [dict(r) for r in conn.execute("SELECT * FROM folders ORDER BY name COLLATE NOCASE").fetchall()]
    note_rows = conn.execute("SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY created_at").fetchall()
    notes = []
    for row in note_rows:
        n = dict(row)
        n["tags"] = _note_tags(conn, n["id"])
        notes.append(n)
    conn.close()
    return {"schema_version": _SCHEMA_VERSION, "folders": folders, "notes": notes}


# ── Import / restore ────────────────────────────────────────────────────────────

def import_data(data, mode="merge"):
    """Restore folders + notes (+ tags) from an export payload.

    mode="merge"   — add folders/notes whose id isn't already present. Never deletes.
    mode="replace" — WIPE folders/notes/tags/note_tags, then rebuild from the backup
                     (full disaster recovery).

    Returns counts. Raises ValueError on a malformed payload.
    """
    if mode not in ("merge", "replace"):
        raise ValueError("mode must be 'merge' or 'replace'")
    folders = data.get("folders")
    notes = data.get("notes")
    if not isinstance(folders, list) or not isinstance(notes, list):
        raise ValueError("invalid backup: 'folders' and 'notes' must be lists")
    if mode == "replace" and len(notes) == 0:
        raise ValueError("refusing to replace with an empty backup (0 notes)")

    conn = get_conn()
    # Bulk import: trust the backup's internal references and skip FK enforcement
    # so folder→parent and note→folder ordering can't trip us up. Must be set
    # before any transaction starts.
    conn.execute("PRAGMA foreign_keys = OFF")
    folders_in = notes_in = 0
    try:
        with conn:
            if mode == "replace":
                conn.execute("DELETE FROM note_tags")
                conn.execute("DELETE FROM tags")
                conn.execute("DELETE FROM notes")
                conn.execute("DELETE FROM folders")

            existing_folders = {r["id"] for r in conn.execute("SELECT id FROM folders").fetchall()}
            for f in folders:
                if not f.get("id") or (mode == "merge" and f["id"] in existing_folders):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO folders (id,name,parent_id,created_at,updated_at)"
                    " VALUES (?,?,?,?,?)",
                    (f["id"], f.get("name", ""), f.get("parent_id"),
                     f.get("created_at") or now(), f.get("updated_at") or now())
                )
                folders_in += 1

            existing_notes = {r["id"] for r in conn.execute("SELECT id FROM notes").fetchall()}
            tag_ids = {r["name"]: r["id"] for r in conn.execute("SELECT name,id FROM tags").fetchall()}
            for n in notes:
                if not n.get("id") or (mode == "merge" and n["id"] in existing_notes):
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO notes (id,title,body,folder_id,created_at,updated_at,deleted_at)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (n["id"], n.get("title", ""), n.get("body", ""), n.get("folder_id"),
                     n.get("created_at") or now(), n.get("updated_at") or now(), n.get("deleted_at"))
                )
                notes_in += 1
                for tag_name in (n.get("tags") or []):
                    tag_name = (tag_name or "").strip().lower()
                    if not tag_name:
                        continue
                    tid = tag_ids.get(tag_name)
                    if not tid:
                        tid = new_id()
                        conn.execute("INSERT INTO tags VALUES (?,?)", (tid, tag_name))
                        tag_ids[tag_name] = tid
                    conn.execute("INSERT OR IGNORE INTO note_tags VALUES (?,?)", (n["id"], tid))
    finally:
        conn.close()
    return {"mode": mode, "folders_imported": folders_in, "notes_imported": notes_in}


# ── Settings ──────────────────────────────────────────────────────────────────

def get_setting(key, default=None):
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key, value):
    conn = get_conn()
    with conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
    conn.close()


# ── Sync ──────────────────────────────────────────────────────────────────────

def get_sync_version():
    conn = get_conn()
    row = conn.execute("SELECT MAX(updated_at) as v FROM notes").fetchone()
    conn.close()
    return row["v"] or ""
