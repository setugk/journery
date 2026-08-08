import os
import io
import re
import hmac
import json
import secrets
import zipfile
import html as _html
from html.parser import HTMLParser
from functools import wraps
from datetime import datetime, timezone, timedelta
from flask import Flask, request, jsonify, render_template, Response, redirect
import db
import htmlschema

app = Flask(__name__)
# Cap request bodies at 32MB — guards against unbounded uploads while staying
# well above the largest realistic payload (a full /api/import restore of the
# note corpus).
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
db.init_db()

# Optional basic auth. Set JOURNERY_USER + JOURNERY_PASS to require a login;
# leave unset to run open (e.g. behind Cloudflare Access). CLIPPERY_* still work
# as legacy env fallbacks.
AUTH_USER       = os.environ.get("JOURNERY_USER") or os.environ.get("CLIPPERY_USER")
AUTH_PASS       = os.environ.get("JOURNERY_PASS") or os.environ.get("CLIPPERY_PASS")
JOURNERY_NAME   = os.environ.get("JOURNERY_NAME", "")
# Demo mode: the browser stores all data locally (see static/demo.js); the server
# DB is unused. Set DEMO_MODE=1 on the public demo instance only.
DEMO_MODE       = os.environ.get("DEMO_MODE") == "1"
# Cloudflare Web Analytics beacon token — demo instance only, to gauge demo
# traffic. Never set this on prod/beta (self-hosted instances get no
# analytics of any kind — see README's privacy promise). Empty = no beacon.
CF_BEACON_TOKEN = os.environ.get("CF_BEACON_TOKEN", "")
APP_VERSION     = "1.31.19"
# Tie asset cache-busting to the app version, so caches invalidate only when we
# actually ship — not on every container restart (which str(time.time()) did).
STATIC_VERSION  = APP_VERSION
# Secret for signing the per-token "this visitor unlocked this password-protected
# share" cookie. Set SECRET_KEY to keep unlock cookies valid across restarts; the
# random fallback just means a container restart re-prompts for the password
# (harmless for a share gate).
SHARE_SECRET    = os.environ.get("SECRET_KEY") or secrets.token_hex(32)


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if AUTH_USER and AUTH_PASS:
            auth = request.authorization
            ok = (auth
                  and hmac.compare_digest(auth.username or "", AUTH_USER)
                  and hmac.compare_digest(auth.password or "", AUTH_PASS))
            if not ok:
                return Response(
                    "Authentication required.", 401,
                    {"WWW-Authenticate": 'Basic realm="Journery"'}
                )
        return f(*args, **kwargs)
    return decorated


@app.route("/")
@requires_auth
def index():
    # One-time opt-out of demo analytics for this browser: visiting
    # /?dnt=1 sets a year-long cookie and strips the query string; /?dnt=0
    # clears it again (e.g. to test the demo as a real visitor would see it).
    dnt_param = request.args.get("dnt")
    if dnt_param in ("1", "0"):
        resp = redirect(request.path)
        if dnt_param == "1":
            resp.set_cookie("journery_dnt", "1", max_age=365 * 24 * 3600, samesite="Lax")
        else:
            resp.delete_cookie("journery_dnt")
        return resp
    opted_out = request.cookies.get("journery_dnt") == "1"
    beacon_token = "" if opted_out else CF_BEACON_TOKEN
    return render_template("index.html", journery_name=JOURNERY_NAME, static_v=STATIC_VERSION, app_version=APP_VERSION, demo_mode=DEMO_MODE, cf_beacon_token=beacon_token)


# ── Folders ───────────────────────────────────────────────────────────────────

@app.route("/api/folders", methods=["GET"])
@requires_auth
def list_folders():
    return jsonify(db.get_folders())


@app.route("/api/folders", methods=["POST"])
@requires_auth
def create_folder():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    return jsonify(db.create_folder(name, data.get("parent_id") or None))


@app.route("/api/folders/<folder_id>", methods=["PUT"])
@requires_auth
def update_folder(folder_id):
    data = request.get_json(silent=True) or {}
    if "parent_id" in data:
        new_parent = data["parent_id"] or None
        if db.would_create_cycle(folder_id, new_parent):
            return jsonify({"error": "cannot move a folder into itself or its own subfolder"}), 400
        result = db.move_folder(folder_id, new_parent)
        if not result:
            return jsonify({"error": "not found"}), 404
        return jsonify(result)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    result = db.rename_folder(folder_id, name)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/folders/<folder_id>", methods=["DELETE"])
@requires_auth
def delete_folder(folder_id):
    db.delete_folder(folder_id)
    return jsonify({"ok": True})


# ── Notes ─────────────────────────────────────────────────────────────────────

@app.route("/api/notes", methods=["GET"])
@requires_auth
def list_notes():
    return jsonify(db.get_notes(
        folder_id=request.args.get("folder_id"),
        tag=request.args.get("tag"),
        query=request.args.get("q"),
        year=request.args.get("year"),
    ))


@app.route("/api/notes/<note_id>", methods=["GET"])
@requires_auth
def get_note(note_id):
    note = db.get_note(note_id)
    if not note:
        return jsonify({"error": "not found"}), 404
    return jsonify(note)


@app.route("/api/notes", methods=["POST"])
@requires_auth
def create_note():
    data = request.get_json(silent=True) or {}
    return jsonify(db.create_note(
        title=data.get("title", ""),
        body=data.get("body", ""),
        folder_id=data.get("folder_id") or None,
        created_at=data.get("created_at") or None,
        tags=data.get("tags") or None,
    )), 201


@app.route("/api/notes/<note_id>", methods=["PUT"])
@requires_auth
def update_note(note_id):
    data = request.get_json(silent=True) or {}
    kwargs = {k: data[k] for k in ("title", "body", "folder_id", "tags", "created_at") if k in data}
    if "folder_id" in kwargs and not kwargs["folder_id"]:
        kwargs["folder_id"] = None
    result = db.update_note(note_id, **kwargs)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/notes/<note_id>", methods=["DELETE"])
@requires_auth
def delete_note(note_id):
    db.delete_note(note_id)
    return jsonify({"ok": True})


# ── Trash ──────────────────────────────────────────────────────────────────────

@app.route("/api/trash", methods=["GET"])
@requires_auth
def list_trash():
    tag = request.args.get("tag")
    return jsonify(db.get_trash(tag=tag))


@app.route("/api/notes/<note_id>/restore", methods=["POST"])
@requires_auth
def restore_note(note_id):
    result = db.restore_note(note_id)
    if not result:
        return jsonify({"error": "not found"}), 404
    return jsonify(result)


@app.route("/api/trash/<note_id>", methods=["DELETE"])
@requires_auth
def permanent_delete(note_id):
    db.permanent_delete(note_id)
    return jsonify({"ok": True})


# ── Tags ──────────────────────────────────────────────────────────────────────

@app.route("/api/tags", methods=["GET"])
@requires_auth
def list_tags():
    return jsonify(db.get_tags())


@app.route("/api/tags/<tag_name>", methods=["DELETE"])
@requires_auth
def delete_tag(tag_name):
    db.delete_tag(tag_name)
    return jsonify({"ok": True})


@app.route("/api/tags/<tag_name>", methods=["PUT"])
@requires_auth
def rename_tag(tag_name):
    data = request.get_json(silent=True) or {}
    new_name = (data.get("name") or "").strip().lower()
    if not new_name:
        return jsonify({"error": "name required"}), 400
    db.rename_tag(tag_name, new_name)
    return jsonify({"ok": True})


# ── Export ────────────────────────────────────────────────────────────────────

@app.route("/api/import", methods=["POST"])
@requires_auth
def import_backup():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "notes" not in data:
        return jsonify({"error": "invalid backup payload"}), 400
    mode = request.args.get("mode", "merge")
    try:
        result = db.import_data(data, mode=mode)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(result)


@app.route("/api/export")
@requires_auth
def export_data():
    data = db.export_all()
    data["exported_at"] = db.now()
    filename = f"journery-{data['exported_at'][:10]}.json"
    return Response(
        json.dumps(data, indent=2, ensure_ascii=False),
        mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Markdown export ───────────────────────────────────────────────────────────
# Note bodies are stored as the editor's contenteditable HTML. Convert the exact
# tag set the editor emits into Markdown so a user can walk away with their notes
# as portable plain-text files (Obsidian, Bear, any editor). Stdlib only.

class _Node:
    __slots__ = ("tag", "attrs", "children", "text")
    def __init__(self, tag=None, attrs=None, text=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.text = text


class _HTMLTree(HTMLParser):
    _VOID = {"br", "hr", "img"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = _Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self._VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.stack[-1].children.append(_Node(tag, attrs))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(_Node(text=data))


def _text_of(node):
    if node.text is not None:
        return node.text
    return "".join(_text_of(c) for c in node.children)


def _inline(children):
    out = []
    for c in children:
        if c.text is not None:
            out.append(c.text)
        elif c.tag in ("b", "strong"):
            out.append("**%s**" % _inline(c.children))
        elif c.tag in ("i", "em"):
            out.append("*%s*" % _inline(c.children))
        elif c.tag in ("s", "strike", "del"):
            out.append("~~%s~~" % _inline(c.children))
        elif c.tag == "u":
            out.append("<u>%s</u>" % _inline(c.children))   # Markdown has no underline
        elif c.tag == "code":
            out.append("`%s`" % _text_of(c))
        elif c.tag == "a":
            out.append("[%s](%s)" % (_inline(c.children), c.attrs.get("href", "")))
        elif c.tag == "br":
            out.append("\n")
        elif c.tag in ("ul", "ol", "pre", "blockquote", "div", "p", "h1", "h2", "h3", "hr"):
            pass  # block-level, emitted by _blocks
        else:
            out.append(_inline(c.children))
    return "".join(out)


def _list_lines(node, ordered, depth):
    lines = []
    is_task = "task-list" in node.attrs.get("class", "")
    idx = 1
    for li in node.children:
        if li.tag != "li":
            continue
        inline_kids = [c for c in li.children if c.tag not in ("ul", "ol")]
        text = _inline(inline_kids).strip()
        indent = "  " * depth
        if is_task:
            marker = "- [x]" if "done" in li.attrs.get("class", "") else "- [ ]"
        elif ordered:
            marker = "%d." % idx
        else:
            marker = "-"
        lines.append("%s%s %s" % (indent, marker, text))
        for sub in (c for c in li.children if c.tag in ("ul", "ol")):
            lines.extend(_list_lines(sub, sub.tag == "ol", depth + 1))
        idx += 1
    return lines


def _blocks(node):
    lines = []
    for c in node.children:
        if c.text is not None:
            if c.text.strip():
                lines.append(c.text.strip()); lines.append("")
            continue
        tag = c.tag
        if tag in ("h1", "h2", "h3"):
            lines.append("%s %s" % ("#" * int(tag[1]), _inline(c.children).strip())); lines.append("")
        elif tag in ("ul", "ol"):
            lines.extend(_list_lines(c, tag == "ol", 0)); lines.append("")
        elif tag == "pre":
            lines.append("```"); lines.extend(_text_of(c).rstrip("\n").split("\n")); lines.append("```"); lines.append("")
        elif tag == "blockquote":
            for ln in _inline(c.children).split("\n"):
                lines.append("> " + ln)
            lines.append("")
        elif tag == "hr":
            lines.append("---"); lines.append("")
        elif tag in ("div", "p"):
            if any(ch.tag in ("ul", "ol", "pre", "blockquote", "h1", "h2", "h3", "hr") for ch in c.children):
                lines.extend(_blocks(c))   # a wrapper div holding real blocks
            else:
                lines.append(_inline(c.children).rstrip()); lines.append("")
        elif tag not in ("br",):
            inner = _inline(c.children).rstrip()
            if inner:
                lines.append(inner); lines.append("")
    return lines


def html_to_markdown(html):
    if not html:
        return ""
    p = _HTMLTree()
    p.feed(html)
    md = "\n".join(_blocks(p.root))
    return re.sub(r"\n{3,}", "\n\n", md).strip()


def _safe_filename(name):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", (name or "").strip()).strip(". ")
    return name[:80] or "Untitled"


def _yaml_str(s):
    return '"%s"' % str(s).replace("\\", "\\\\").replace('"', '\\"')


def _note_markdown_file(n):
    fm = ["---", "title: %s" % _yaml_str(n.get("title") or "Untitled")]
    if n.get("created_at"):
        fm.append("created: %s" % n["created_at"])
    if n.get("updated_at"):
        fm.append("updated: %s" % n["updated_at"])
    tags = n.get("tags") or []
    if tags:
        fm.append("tags: [%s]" % ", ".join(_yaml_str(t) for t in tags))
    fm.append("---")
    body = html_to_markdown(n.get("body") or "")
    return "\n".join(fm) + "\n\n# " + (n.get("title") or "Untitled") + "\n\n" + body + "\n"


def _folder_relpath(folders, fid):
    parts, seen = [], set()
    while fid and fid in folders and fid not in seen:
        seen.add(fid)
        parts.append(_safe_filename(folders[fid]["name"]))
        fid = folders[fid].get("parent_id")
    return "/".join(reversed(parts))


def _note_files(data):
    """Map every note to a unique '<folder>/<title>.md' path → file content."""
    folders = {f["id"]: f for f in data["folders"]}
    files, used = {}, set()
    for n in data["notes"]:
        path = _folder_relpath(folders, n.get("folder_id"))
        base = _safe_filename(n.get("title"))
        rel = ("%s/%s.md" % (path, base)) if path else ("%s.md" % base)
        key, c = rel.lower(), 2
        while key in used:   # avoid clobbering same-named notes in one folder
            nm = "%s (%d)" % (base, c)
            rel = ("%s/%s.md" % (path, nm)) if path else ("%s.md" % nm)
            key, c = rel.lower(), c + 1
        used.add(key)
        files[rel] = _note_markdown_file(n)
    return files


@app.route("/api/export/markdown")
@requires_auth
def export_markdown():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, content in _note_files(db.export_all()).items():
            z.writestr(rel, content)
    buf.seek(0)
    filename = "journery-markdown-%s.zip" % db.now()[:10]
    return Response(
        buf.getvalue(),
        mimetype="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Sync polling ──────────────────────────────────────────────────────────────

@app.route("/api/settings/<key>", methods=["GET"])
@requires_auth
def get_setting(key):
    value = db.get_setting(key)
    return jsonify({"value": value})


@app.route("/api/settings/<key>", methods=["PUT"])
@requires_auth
def set_setting(key):
    data = request.get_json(force=True)
    db.set_setting(key, data.get("value", ""))
    return jsonify({"ok": True})


@app.route("/api/sync")
@requires_auth
def sync():
    return jsonify({"version": db.get_sync_version()})


# ── MCP access config (owner-only, behind the app's normal auth) ────────────────
# These manage the toggle + named connection tokens from Settings. The actual
# /mcp endpoint (below) is bearer-authed instead, so AI clients can reach it.

def _mcp_config():
    return {"enabled": db.get_mcp_enabled(), "tokens": db.list_mcp_tokens()}


@app.route("/api/mcp/config", methods=["GET"])
@requires_auth
def mcp_config():
    return jsonify(_mcp_config())


@app.route("/api/mcp/enabled", methods=["PUT"])
@requires_auth
def mcp_set_enabled():
    data = request.get_json(silent=True) or {}
    db.set_mcp_enabled(bool(data.get("value")))
    return jsonify(_mcp_config())


@app.route("/api/mcp/token", methods=["POST"])
@requires_auth
def mcp_generate_token():
    # Mint a named connection. The plaintext token is returned ONCE — the client
    # shows it to the user and can never recover it after (only its hash is stored).
    data = request.get_json(silent=True) or {}
    created = db.create_mcp_token(data.get("name"))
    return jsonify({"token": created["token"], "id": created["id"],
                    "config": _mcp_config()})


@app.route("/api/mcp/token/<token_id>", methods=["DELETE"])
@requires_auth
def mcp_revoke_token(token_id):
    db.revoke_mcp_token(token_id)
    return jsonify(_mcp_config())


# ── Public share links ─────────────────────────────────────────────────────────

def _share_payload(share):
    if not share:
        return {"shared": False}
    return {"shared": True, "token": share["token"], "expires_at": share.get("expires_at"),
            "has_password": bool(share.get("password_hash") or share.get("has_password"))}


def _expires_at_from(data):
    # Custom absolute date wins: "YYYY-MM-DD" → end of that day, UTC.
    raw = data.get("expires_at")
    if raw:
        try:
            d = datetime.strptime(str(raw)[:10], "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc)
            return d.isoformat()
        except (TypeError, ValueError):
            pass
    days = data.get("expires_in_days")
    if days in (None, "", 0, "0"):
        return None
    try:
        d = int(days)
        return (datetime.now(timezone.utc) + timedelta(days=d)).isoformat() if d > 0 else None
    except (TypeError, ValueError):
        return None


def _password_from(data):
    """The `password` argument for db.set_share/set_tag_share, from a PUT payload:
    remove_password → clear (None), a non-empty password → set it, otherwise leave
    the existing password untouched (db.KEEP_PASSWORD)."""
    if data.get("remove_password"):
        return None
    pw = data.get("password")
    if pw:
        return str(pw)
    return db.KEEP_PASSWORD


@app.route("/api/notes/<note_id>/share", methods=["GET"])
@requires_auth
def get_share(note_id):
    return jsonify(_share_payload(db.get_share(note_id)))


@app.route("/api/notes/<note_id>/share", methods=["PUT"])
@requires_auth
def put_share(note_id):
    if not db.get_note(note_id):
        return jsonify({"error": "not found"}), 404
    data = request.get_json(silent=True) or {}
    return jsonify(_share_payload(db.set_share(note_id, _expires_at_from(data), _password_from(data))))


@app.route("/api/notes/<note_id>/share", methods=["DELETE"])
@requires_auth
def revoke_share(note_id):
    db.delete_share(note_id)
    return jsonify({"shared": False})


@app.route("/api/tags/<tag>/share", methods=["GET"])
@requires_auth
def tag_share_status(tag):
    return jsonify(_share_payload(db.get_tag_share(tag)))


@app.route("/api/tags/<tag>/share", methods=["PUT"])
@requires_auth
def tag_share_set(tag):
    data = request.get_json(silent=True) or {}
    return jsonify(_share_payload(db.set_tag_share(tag, _expires_at_from(data), _password_from(data))))


@app.route("/api/tags/<tag>/share", methods=["DELETE"])
@requires_auth
def tag_share_revoke(tag):
    db.delete_tag_share(tag)
    return jsonify({"shared": False})


_APP_CSS = None
def _app_css():
    # Inlined into the public share page so it needs no /static requests (only
    # /shared/* has to be public in Cloudflare). Cached; re-read on restart/deploy.
    global _APP_CSS
    if _APP_CSS is None:
        with open(os.path.join(os.path.dirname(__file__), "static", "style.css"), encoding="utf-8") as f:
            _APP_CSS = f.read()
    return _APP_CSS


def _render_shared(**kw):
    kw.setdefault("note", None)
    kw.setdefault("collection", None)
    kw.setdefault("back", None)
    kw.setdefault("password_prompt", None)
    return render_template("shared.html", app_css=_app_css(), **kw)


def _unlock_value(token):
    return hmac.new(SHARE_SECRET.encode(), ("unlock:" + token).encode(), "sha256").hexdigest()


def _is_unlocked(token):
    return hmac.compare_digest(request.cookies.get("jshare_" + token, ""), _unlock_value(token))


def _password_gate(token, password_hash):
    """For a password-protected share: returns a Response to send instead of the
    content (the unlock form, or a redirect that sets the unlock cookie on success),
    or None when the visitor is already unlocked / no password is set."""
    if not password_hash or _is_unlocked(token):
        return None
    error = False
    if request.method == "POST":
        if db.verify_share_password(request.form.get("password", ""), password_hash):
            resp = redirect(request.path)
            resp.set_cookie("jshare_" + token, _unlock_value(token),
                            max_age=30 * 24 * 3600, httponly=True, samesite="Lax")
            return resp
        error = True
    return _render_shared(password_prompt={"action": request.path, "error": error})


@app.route("/shared/<token>", methods=["GET", "POST"])
def shared_view(token):
    # PUBLIC — no @requires_auth. Cloudflare Access must BYPASS /shared/*.
    # Self-contained page (inlined CSS, rendered server-side), so no other endpoint
    # is public and the data never rides on an open API.
    auth = db.get_share_auth(token)
    if not auth:
        return _render_shared()
    gate = _password_gate(token, auth["password_hash"])
    if gate is not None:
        return gate
    r = db.resolve_share(token)
    if not r:
        return _render_shared()
    if r["kind"] == "note":
        return _render_shared(note=r["note"])
    return _render_shared(collection={"tag": r["tag"], "notes": r["notes"], "token": token})


@app.route("/shared/<token>/<note_id>", methods=["GET", "POST"])
def shared_note_in_tag(token, note_id):
    # A single note viewed within a tag share (live membership check).
    auth = db.get_share_auth(token)
    if auth:
        gate = _password_gate(token, auth["password_hash"])
        if gate is not None:
            return gate
    r = db.get_shared_tag_note(token, note_id)
    if not r:
        return _render_shared()
    return _render_shared(note=r["note"], back={"token": token, "tag": r["tag"]})


@app.route("/sw.js")
def service_worker():
    # Served from the root so its scope covers the whole app. Re-rendered each
    # deploy (static_v changes) so the browser sees a new SW and refreshes the
    # cached shell. no-cache so the browser always re-checks for a new version.
    return Response(
        render_template("sw.js", static_v=STATIC_VERSION),
        mimetype="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.route("/manifest.json")
def manifest():
    full_name  = f"Journery | {JOURNERY_NAME}" if JOURNERY_NAME else "Journery"
    short_name = JOURNERY_NAME if JOURNERY_NAME else "Journery"
    return jsonify({
        "name": full_name,
        "short_name": short_name,
        "start_url": "/",
        "display": "standalone",
        "background_color": "#F5F5F5",
        "theme_color": "#111111",
        "icons": [
            {"src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    })


# ── MCP endpoint (Model Context Protocol, Streamable HTTP / JSON-RPC 2.0) ───────
# Lets an AI client (Claude Code, or the Claude API's mcp_servers connector) do a
# SAFE subset of CRUD on notes/folders/tags. Opt-in: off by default, gated by the
# Settings toggle (db.get_mcp_enabled) AND a bearer token (db.verify_mcp_token).
# Stateless: no sessions, plain application/json responses (no SSE) — enough for a
# request/response tool server. Deliberately hand-rolled (no FastMCP dependency)
# so it ships inside the one Flask app every self-hoster already runs.
#
# Safe subset by design: create / append / tag / move / trash (recoverable), plus
# reads. NO blind full-body overwrite, NO permanent delete. Deleting only ever
# moves a note to Trash (30-day recovery, same as the UI).
#
# Cloudflare (one-time, like /shared/*): add an Access BYPASS for
# journery.setugk.com/mcp — the bearer token is the real gate, and an interactive
# Access OTP would block automated clients.

MCP_PROTOCOL_VERSION = "2025-06-18"


class _MCPToolError(Exception):
    """A tool-level failure — surfaced to the model as an isError tool result
    (not a JSON-RPC protocol error, which is for malformed requests)."""


def _mcp_token_id():
    """The id of the token in the request's Bearer header, or None."""
    hdr = request.headers.get("Authorization", "")
    if not hdr.startswith("Bearer "):
        return None
    return db.verify_mcp_token(hdr[7:].strip())


def _mcp_client_name(payload):
    """The client name reported at MCP `initialize` (e.g. "Claude Code"), if this
    request carries one — so we can show which AI a connection belongs to."""
    msgs = payload if isinstance(payload, list) else [payload]
    for m in msgs:
        if isinstance(m, dict) and m.get("method") == "initialize":
            info = (m.get("params") or {}).get("clientInfo") or {}
            name = (info.get("name") or "").strip()
            if name:
                return name[:80]
    return None


def _text_snippet(html, n=200):
    text = re.sub(r"<[^>]+>", " ", html or "")
    text = _html.unescape(text)          # decode &nbsp;, &middot;, &amp; → real chars
    text = re.sub(r"\s+", " ", text).strip()
    return text[:n]


def _note_summary(n):
    return {"id": n["id"], "title": n["title"], "tags": n.get("tags") or [],
            "folder_id": n["folder_id"], "created_at": n["created_at"],
            "updated_at": n["updated_at"], "snippet": _text_snippet(n["body"])}


# ── Tool handlers (each takes the arguments dict, returns a JSON-able result) ────

def _mcp_require_note(note_id):
    note = db.get_note(note_id)
    if not note or note.get("deleted_at"):
        raise _MCPToolError(f"No note found with id {note_id!r}.")
    return note


def _tool_list_notes(a):
    limit = int(a.get("limit") or 50)
    notes = db.get_notes(folder_id=a.get("folder_id") or None,
                         tag=a.get("tag") or None,
                         query=a.get("query") or None)
    return {"count": len(notes), "returned": min(len(notes), limit),
            "notes": [_note_summary(n) for n in notes[:limit]]}


def _tool_get_note(a):
    note = _mcp_require_note(a.get("note_id"))
    return {"id": note["id"], "title": note["title"], "body": note["body"],
            "tags": note["tags"], "folder_id": note["folder_id"],
            "created_at": note["created_at"], "updated_at": note["updated_at"]}


def _tool_list_folders(a):
    return {"folders": db.get_folders()}


def _tool_list_tags(a):
    return {"tags": db.get_tags()}


def _tool_create_note(a):
    body = a.get("body") or ""
    htmlschema.validate_html(body)   # rejects unsupported HTML before it's stored
    note = db.create_note(
        title=(a.get("title") or "").strip(),
        body=body,
        folder_id=a.get("folder_id") or None,
        tags=a.get("tags") or None,
    )
    return {"created": True, "note": _note_summary(note)}


def _tool_append_to_note(a):
    note = _mcp_require_note(a.get("note_id"))
    add = a.get("body") or ""
    if not add.strip():
        raise _MCPToolError("body is empty — nothing to append.")
    htmlschema.validate_html(add)    # validate only the new HTML, not the existing body
    sep = "<br><br>" if (note["body"] or "").strip() else ""
    updated = db.update_note(note["id"], body=note["body"] + sep + add)
    return {"appended": True, "note": _note_summary(updated)}


def _tool_update_note(a):
    note = _mcp_require_note(a.get("note_id"))
    kwargs = {}
    if "body" in a:
        body = a.get("body") or ""
        htmlschema.validate_html(body)
        kwargs["body"] = body
    if "title" in a:
        kwargs["title"] = (a.get("title") or "").strip()
    if not kwargs:
        raise _MCPToolError("nothing to update — pass body and/or title.")
    updated = db.update_note(note["id"], **kwargs)
    return {"updated": True, "note": _note_summary(updated)}


def _tool_add_tags_to_note(a):
    note = _mcp_require_note(a.get("note_id"))
    new = [t.strip().lower() for t in (a.get("tags") or []) if t and t.strip()]
    if not new:
        raise _MCPToolError("tags is empty.")
    merged = sorted(set(note["tags"]) | set(new))
    updated = db.update_note(note["id"], tags=merged)
    return {"tags": updated["tags"], "note": _note_summary(updated)}


def _tool_move_note(a):
    note = _mcp_require_note(a.get("note_id"))
    fid = a.get("folder_id") or None
    if fid and not any(f["id"] == fid for f in db.get_folders()):
        raise _MCPToolError(f"No folder found with id {fid!r}.")
    updated = db.update_note(note["id"], folder_id=fid)
    return {"moved": True, "note": _note_summary(updated)}


def _tool_create_folder(a):
    name = (a.get("name") or "").strip()
    if not name:
        raise _MCPToolError("name is required.")
    parent = a.get("parent_id") or None
    if parent and not any(f["id"] == parent for f in db.get_folders()):
        raise _MCPToolError(f"No parent folder found with id {parent!r}.")
    return {"created": True, "folder": db.create_folder(name, parent)}


def _tool_trash_note(a):
    note = _mcp_require_note(a.get("note_id"))
    db.delete_note(note["id"])
    return {"trashed": True, "id": note["id"],
            "note": "Moved to Trash — recoverable for 30 days from the app."}


# Generated from htmlschema.SUPPORTED_TAGS so the advertised contract can never
# drift from what the write validator enforces (Task: single source of truth).
_HTML_BODY_HELP = htmlschema.body_param_description()

MCP_TOOLS = [
    {"name": "list_notes",
     "description": "List or search notes. Returns metadata + a short text snippet per note (not full bodies) — call get_note for full content. Newest-edited first.",
     "inputSchema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "Full-text search over title and body."},
         "tag": {"type": "string", "description": "Only notes carrying this tag."},
         "folder_id": {"type": "string", "description": "Only notes in this folder ('root' for top level)."},
         "limit": {"type": "integer", "description": "Max notes to return (default 50)."}}}},
    {"name": "get_note",
     "description": "Get one note's full content, including its HTML body.",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string", "description": "The note's id."}}, "required": ["note_id"]}},
    {"name": "list_folders",
     "description": "List all folders (flat; each has id, name, parent_id).",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "list_tags",
     "description": "List all tags with their note counts.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "create_note",
     "description": "Create a new note.",
     "inputSchema": {"type": "object", "properties": {
         "title": {"type": "string"},
         "body": {"type": "string", "description": _HTML_BODY_HELP},
         "folder_id": {"type": "string", "description": "Folder to place it in (omit for top level)."},
         "tags": {"type": "array", "items": {"type": "string"}, "description": "Tag names to apply."}}}},
    {"name": "append_to_note",
     "description": "Append content to the END of an existing note's body (additive — never overwrites what's already there). To fix or restructure existing content, use update_note.",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string"},
         "body": {"type": "string", "description": _HTML_BODY_HELP}}, "required": ["note_id", "body"]}},
    {"name": "update_note",
     "description": "Replace a note's body (and/or title). DESTRUCTIVE: the old body is overwritten and NOT recoverable (Journery keeps no per-note history). Use this to repair your own earlier output — get_note first, fix the HTML, then update_note. To add without overwriting, use append_to_note instead.",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string"},
         "body": {"type": "string", "description": "New full body. " + _HTML_BODY_HELP},
         "title": {"type": "string", "description": "New title (optional)."}}, "required": ["note_id"]}},
    {"name": "add_tags_to_note",
     "description": "Add one or more tags to a note (merges with its existing tags).",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string"},
         "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["note_id", "tags"]}},
    {"name": "move_note",
     "description": "Move a note into a folder. Omit folder_id (or pass empty) to move it to the top level.",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string"},
         "folder_id": {"type": "string"}}, "required": ["note_id"]}},
    {"name": "create_folder",
     "description": "Create a folder.",
     "inputSchema": {"type": "object", "properties": {
         "name": {"type": "string"},
         "parent_id": {"type": "string", "description": "Parent folder id for a subfolder (omit for top level)."}}, "required": ["name"]}},
    {"name": "trash_note",
     "description": "Move a note to Trash. This is a recoverable soft-delete (restorable for 30 days from the app) — it is NOT a permanent delete.",
     "inputSchema": {"type": "object", "properties": {
         "note_id": {"type": "string"}}, "required": ["note_id"]}},
]

MCP_HANDLERS = {
    "list_notes": _tool_list_notes,
    "get_note": _tool_get_note,
    "list_folders": _tool_list_folders,
    "list_tags": _tool_list_tags,
    "create_note": _tool_create_note,
    "append_to_note": _tool_append_to_note,
    "update_note": _tool_update_note,
    "add_tags_to_note": _tool_add_tags_to_note,
    "move_note": _tool_move_note,
    "create_folder": _tool_create_folder,
    "trash_note": _tool_trash_note,
}


def _mcp_result(req_id, result):
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _mcp_error(req_id, code, message):
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _mcp_dispatch(method, params, req_id):
    params = params or {}
    if method == "initialize":
        return _mcp_result(req_id, {
            "protocolVersion": params.get("protocolVersion") or MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "journery", "version": APP_VERSION},
        })
    if method == "tools/list":
        return _mcp_result(req_id, {"tools": MCP_TOOLS})
    if method == "ping":
        return _mcp_result(req_id, {})
    if method == "tools/call":
        name = params.get("name")
        handler = MCP_HANDLERS.get(name)
        if not handler:
            return _mcp_error(req_id, -32602, f"Unknown tool: {name}")
        try:
            result = handler(params.get("arguments") or {})
        except htmlschema.UnsupportedHtmlError as e:
            # Invalid HTML params → a JSON-RPC error (-32602) whose message names the
            # offending tag, lists every supported tag, and suggests a substitution,
            # so the agent can correct itself and retry without a human.
            return _mcp_error(req_id, e.code, e.message)
        except _MCPToolError as e:
            return _mcp_result(req_id, {"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception as e:  # noqa: BLE001 — never leak a stack trace to the client
            return _mcp_result(req_id, {"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True})
        return _mcp_result(req_id, {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]})
    return _mcp_error(req_id, -32601, f"Method not found: {method}")


def _mcp_handle_message(msg):
    if not isinstance(msg, dict):
        return _mcp_error(None, -32600, "Invalid Request")
    method = msg.get("method")
    req_id = msg.get("id")
    # A JSON-RPC notification (no id, e.g. notifications/initialized) gets no reply.
    if req_id is None and isinstance(method, str) and method.startswith("notifications/"):
        return None
    return _mcp_dispatch(method, msg.get("params"), req_id)


@app.route("/mcp", methods=["POST"])
def mcp_endpoint():
    # Bearer-authed (NOT @requires_auth) so AI clients reach it; Cloudflare Access
    # must BYPASS /mcp. Off unless enabled in Settings AND the token matches.
    token_id = _mcp_token_id() if db.get_mcp_enabled() else None
    if not token_id:
        return Response(
            json.dumps(_mcp_error(None, -32001, "Unauthorized")),
            status=401, mimetype="application/json",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = request.get_json(silent=True)
    if payload is None:
        return Response(json.dumps(_mcp_error(None, -32700, "Parse error")),
                        status=400, mimetype="application/json")
    # Record activity so Settings can show which client is using this connection.
    db.touch_mcp_token(token_id, _mcp_client_name(payload))
    if isinstance(payload, list):  # JSON-RPC batch (defensive; removed in 2025-06-18)
        out = [r for r in (_mcp_handle_message(m) for m in payload) if r is not None]
        return (Response("", status=202) if not out
                else Response(json.dumps(out), mimetype="application/json"))
    resp = _mcp_handle_message(payload)
    if resp is None:
        return Response("", status=202)  # was a notification
    return Response(json.dumps(resp), mimetype="application/json")


@app.route("/mcp", methods=["GET"])
def mcp_endpoint_get():
    # This is a stateless JSON server — it doesn't serve the optional SSE stream.
    return Response(json.dumps(_mcp_error(None, -32000, "Method Not Allowed")),
                    status=405, mimetype="application/json",
                    headers={"Allow": "POST"})


if __name__ == "__main__":
    # init_db() already ran at import time (module level above).
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
