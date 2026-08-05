import sqlite3
import os
import uuid
import hmac
import hashlib
import secrets
import threading
import time
from datetime import datetime, timezone

# Defaults to the container's /data volume; override with JOURNERY_DB to run
# natively (e.g. JOURNERY_DB=~/journery-data/journery.db, no Docker needed).
DB_PATH = os.path.expanduser(os.environ.get("JOURNERY_DB", "/data/clippery.db"))


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


_SCHEMA_VERSION = 6


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
                _insert_welcome_note(conn)
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

        if current < 4:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shares (
                    token TEXT PRIMARY KEY,
                    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shares_note ON shares(note_id)")
            conn.execute("UPDATE schema_version SET version = 4")

        if current < 5:
            # Public "share a tag" links (tag-as-publish-set). Separate table so the
            # note-shares table (with its NOT NULL note_id) is untouched.
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tag_shares (
                    token TEXT PRIMARY KEY,
                    tag TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tagshares_tag ON tag_shares(tag)")
            conn.execute("UPDATE schema_version SET version = 5")

        if current < 6:
            # Optional password protection for public share links. NULL = open link
            # (unchanged behavior); a value is a pbkdf2 hash the /shared page checks
            # before rendering any note content.
            conn.execute("ALTER TABLE shares ADD COLUMN password_hash TEXT")
            conn.execute("ALTER TABLE tag_shares ADD COLUMN password_hash TEXT")
            conn.execute("UPDATE schema_version SET version = 6")

    conn.close()
    purge_old_trash()
    purge_expired_shares()
    # The two purges above only run once, right here at startup. On a
    # long-running container (weeks between deploys/restarts), that's not
    # often enough: get_trash() has no read-time age filter (unlike shares,
    # which double-check expiry on every read as a safety net), so a trashed
    # note past 30 days would just sit there, visibly contradicting the "cleared
    # automatically after 30 days" promise, until the next restart happens to
    # purge it. This daemon thread re-runs both purges every 24h so cleanup
    # doesn't depend on how often the container restarts.
    threading.Thread(target=_periodic_cleanup, daemon=True).start()


def _periodic_cleanup():
    while True:
        time.sleep(24 * 60 * 60)
        try:
            purge_old_trash()
            purge_expired_shares()
        except Exception as e:
            print(f"[cleanup] periodic purge failed: {e}")


def now():
    return datetime.now(timezone.utc).isoformat()


def new_id():
    return str(uuid.uuid4())


# A one-time welcome note, inserted only into a genuinely fresh database (see
# the `current == 0` branch in init_db() — never touches an existing install
# on upgrade). Deletable like any other note; nothing else about it is special.
_WELCOME_NOTE_BODY = """Hey! Welcome to Journery, and thanks a lot for trying this app.<br><br>
I'm a product designer &mdash; I'd never built a full-stack product before, because I didn't know how to write the code one needs. But with AI, it's now possible to bring ideas like this to life.<br><br>
I built Journery because I believe in privacy and ownership of your data. What you produce should be in your control, and you should decide who can access or use it &mdash; not a company you pay to use a product, that then also uses your data to train its models on top of that. If a company wants to use your data, they should be paying <b>you</b>. Otherwise, it's not a fair deal.<br><br>
Journery is my attempt at solving that. It's privacy-first: you choose where your data lives &mdash; your own server, a NAS, a spare computer, a cheap VPS, or a managed option like PikaPods if you don't want to run a server yourself. Once it's set up, Journery can back your data up on a schedule you choose, and you can export everything &mdash; full metadata included &mdash; any time you want. Because your data, just like the money in your bank account, belongs to you.<br><br>
Privacy and security aren't all Journery has to offer, though. You get instant sync across every device, shareable links, a fully customizable look with themes, flexible ways to organize your notes, and more.<br><br>
Of course, this isn't perfect &mdash; far from it, in fact. And I want to keep making it better. So please don't hesitate to tell me if something isn't working, or if a feature's missing &mdash; there's a &ldquo;Report bug / Feedback&rdquo; option under your profile at the bottom of the sidebar, and I read every single one.<br><br>
Thanks! 🙏<br><br>
&mdash; Setu"""


def _insert_welcome_note(conn):
    ts = now()
    conn.execute(
        "INSERT INTO notes (id, title, body, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (new_id(), "A note from Setu 👋", _WELCOME_NOTE_BODY, None, ts, ts),
    )


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


def would_create_cycle(folder_id, parent_id):
    """True if setting folder_id's parent to parent_id would nest the folder
    inside itself or its own subtree (which would orphan the resulting cycle).
    The client already prevents this in the move UI; this is the server-side
    backstop so a malformed request can't corrupt the folder tree."""
    if not parent_id:
        return False
    if folder_id == parent_id:
        return True
    conn = get_conn()
    rows = conn.execute("SELECT id, parent_id FROM folders").fetchall()
    conn.close()
    children = {}
    for r in rows:
        children.setdefault(r["parent_id"], []).append(r["id"])
    stack = list(children.get(folder_id, []))
    seen = set()
    while stack:
        cur = stack.pop()
        if cur == parent_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(children.get(cur, []))
    return False


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
        # The pragma is per-connection and every get_conn() re-enables it, so this
        # is belt-and-suspenders — restore enforcement before handing the conn back.
        conn.execute("PRAGMA foreign_keys = ON")
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


# ── MCP access (Claude / AI connector) ──────────────────────────────────────────
# Opt-in, off by default. Two settings rows: `mcp_enabled` gates the /mcp
# endpoint, `mcp_token_hash` is the sha256 of the single bearer token (the token
# itself is shown once at generation and never stored). Revoking clears the hash.
# The token is high-entropy random, so a plain sha256 (constant-time compared) is
# the right primitive here — pbkdf2 is for low-entropy passwords, not this.

def get_mcp_enabled():
    return get_setting("mcp_enabled") == "1"


def set_mcp_enabled(on):
    set_setting("mcp_enabled", "1" if on else "")


def _hash_mcp_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_mcp_token():
    """Mint a new bearer token, store only its hash, and return the plaintext
    ONCE (the caller shows it to the user; it can never be recovered after)."""
    token = secrets.token_urlsafe(32)
    set_setting("mcp_token_hash", _hash_mcp_token(token))
    return token


def has_mcp_token():
    return bool(get_setting("mcp_token_hash"))


def revoke_mcp_token():
    set_setting("mcp_token_hash", "")


def verify_mcp_token(token):
    stored = get_setting("mcp_token_hash") or ""
    if not stored or not token:
        return False
    return hmac.compare_digest(_hash_mcp_token(token), stored)


# ── Sync ──────────────────────────────────────────────────────────────────────

def get_sync_version():
    conn = get_conn()
    row = conn.execute("SELECT MAX(updated_at) as v FROM notes").fetchone()
    conn.close()
    return row["v"] or ""


# ── Public share links ─────────────────────────────────────────────────────────
# One share per note. The token is the public, unguessable key; expires_at is an
# ISO timestamp or None (never expires). Deleting the row revokes the link.

# Sentinel so callers can update expiry WITHOUT touching the password (the common
# case), distinct from explicitly setting a new password or clearing it (None).
KEEP_PASSWORD = object()


def hash_share_password(pw):
    """Salted pbkdf2 hash, stdlib-only (no werkzeug dep). Format:
    pbkdf2$<iters>$<salt_hex>$<hash_hex>."""
    salt = secrets.token_bytes(16)
    iters = 200_000
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, iters)
    return f"pbkdf2${iters}${salt.hex()}${dk.hex()}"


def verify_share_password(pw, stored):
    if not stored or pw is None:
        return False
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), bytes.fromhex(salt_hex), int(iters))
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(dk.hex(), hash_hex)


def _password_hash_for(password):
    """Translate a set_share/set_tag_share `password` argument into the stored
    value: KEEP_PASSWORD → unchanged, None/"" → cleared, a string → hashed."""
    if password is KEEP_PASSWORD:
        return KEEP_PASSWORD
    if not password:
        return None
    return hash_share_password(password)


def get_share(note_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM shares WHERE note_id=?", (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def set_share(note_id, expires_at, password=KEEP_PASSWORD):
    """Create the share (new token) or update the existing one's expiry in place
    (keeps the link stable). `password` is KEEP_PASSWORD (leave as-is), None/"" to
    clear, or a plaintext string to (re)set. Returns {token, expires_at, has_password}."""
    pw_hash = _password_hash_for(password)
    conn = get_conn()
    with conn:
        row = conn.execute("SELECT token, password_hash FROM shares WHERE note_id=?", (note_id,)).fetchone()
        if row:
            token = row["token"]
            stored = row["password_hash"] if pw_hash is KEEP_PASSWORD else pw_hash
            conn.execute("UPDATE shares SET expires_at=?, password_hash=? WHERE token=?",
                         (expires_at, stored, token))
        else:
            token = secrets.token_urlsafe(16)
            stored = None if pw_hash is KEEP_PASSWORD else pw_hash
            conn.execute(
                "INSERT INTO shares (token, note_id, created_at, expires_at, password_hash) VALUES (?,?,?,?,?)",
                (token, note_id, now(), expires_at, stored),
            )
    conn.close()
    return {"token": token, "expires_at": expires_at, "has_password": bool(stored)}


def delete_share(note_id):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM shares WHERE note_id=?", (note_id,))
    conn.close()


def get_shared_note(token):
    """The live note for a valid, non-expired share token — else None."""
    conn = get_conn()
    row = conn.execute("SELECT note_id, expires_at FROM shares WHERE token=?", (token,)).fetchone()
    conn.close()
    if not row:
        return None
    if row["expires_at"] and row["expires_at"] < now():
        return None
    note = get_note(row["note_id"])
    if not note or note.get("deleted_at"):
        return None
    return note


def purge_expired_shares():
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?", (now(),))
        conn.execute("DELETE FROM tag_shares WHERE expires_at IS NOT NULL AND expires_at < ?", (now(),))
    conn.close()


# ── Public tag shares (tag-as-publish-set) ──────────────────────────────────────
# One share per tag; token is public. Resolving a token returns the tag, and the
# note set is computed LIVE (notes currently carrying that tag) — so adding the
# tag to a note publishes it, removing it un-publishes.

def get_tag_share(tag):
    conn = get_conn()
    row = conn.execute("SELECT * FROM tag_shares WHERE tag=?", (tag,)).fetchone()
    conn.close()
    return dict(row) if row else None


def set_tag_share(tag, expires_at, password=KEEP_PASSWORD):
    pw_hash = _password_hash_for(password)
    conn = get_conn()
    with conn:
        row = conn.execute("SELECT token, password_hash FROM tag_shares WHERE tag=?", (tag,)).fetchone()
        if row:
            token = row["token"]
            stored = row["password_hash"] if pw_hash is KEEP_PASSWORD else pw_hash
            conn.execute("UPDATE tag_shares SET expires_at=?, password_hash=? WHERE token=?",
                         (expires_at, stored, token))
        else:
            token = secrets.token_urlsafe(16)
            stored = None if pw_hash is KEEP_PASSWORD else pw_hash
            conn.execute(
                "INSERT INTO tag_shares (token, tag, created_at, expires_at, password_hash) VALUES (?,?,?,?,?)",
                (token, tag, now(), expires_at, stored),
            )
    conn.close()
    return {"token": token, "expires_at": expires_at, "has_password": bool(stored)}


def delete_tag_share(tag):
    conn = get_conn()
    with conn:
        conn.execute("DELETE FROM tag_shares WHERE tag=?", (tag,))
    conn.close()


def resolve_share(token):
    """Resolve a public token to its target, honoring expiry.
       {"kind":"note","note":{...}} | {"kind":"tag","tag":str,"notes":[...]} | None"""
    note = get_shared_note(token)
    if note:
        return {"kind": "note", "note": note}
    conn = get_conn()
    row = conn.execute("SELECT tag, expires_at FROM tag_shares WHERE token=?", (token,)).fetchone()
    conn.close()
    if row and not (row["expires_at"] and row["expires_at"] < now()):
        return {"kind": "tag", "tag": row["tag"], "notes": get_notes(tag=row["tag"])}
    return None


def get_share_auth(token):
    """Lightweight lookup for the public route's gate: is this token valid (exists
    and not expired), and does it require a password? Returns
    {"kind", "password_hash"} or None — does NOT fetch note content (that's
    resolve_share's job, called only after the password check passes)."""
    conn = get_conn()
    row = conn.execute("SELECT expires_at, password_hash FROM shares WHERE token=?", (token,)).fetchone()
    if row:
        conn.close()
        if row["expires_at"] and row["expires_at"] < now():
            return None
        return {"kind": "note", "password_hash": row["password_hash"]}
    row = conn.execute("SELECT expires_at, password_hash FROM tag_shares WHERE token=?", (token,)).fetchone()
    conn.close()
    if not row or (row["expires_at"] and row["expires_at"] < now()):
        return None
    return {"kind": "tag", "password_hash": row["password_hash"]}


def get_shared_tag_note(token, note_id):
    """A single live note within a tag share — only if the token is a valid tag
       share and the note currently carries that tag. Else None."""
    conn = get_conn()
    row = conn.execute("SELECT tag, expires_at FROM tag_shares WHERE token=?", (token,)).fetchone()
    conn.close()
    if not row or (row["expires_at"] and row["expires_at"] < now()):
        return None
    note = get_note(note_id)
    if not note or note.get("deleted_at"):
        return None
    if row["tag"] not in (note.get("tags") or []):
        return None
    return {"note": note, "tag": row["tag"]}
