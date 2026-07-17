import os
import io
import re
import time
import json
import zipfile
from html.parser import HTMLParser
from functools import wraps
from flask import Flask, request, jsonify, render_template, Response
import db

app = Flask(__name__)
db.init_db()

# Optional basic auth. Set JOURNERY_USER + JOURNERY_PASS to require a login;
# leave unset to run open (e.g. behind Cloudflare Access). CLIPPERY_* still work
# as legacy fallbacks.
CLIPPERY_USER   = os.environ.get("JOURNERY_USER") or os.environ.get("CLIPPERY_USER")
CLIPPERY_PASS   = os.environ.get("JOURNERY_PASS") or os.environ.get("CLIPPERY_PASS")
JOURNERY_NAME   = os.environ.get("JOURNERY_NAME", "")
# Demo mode: the browser stores all data locally (see static/demo.js); the server
# DB is unused. Set DEMO_MODE=1 on the public demo instance only.
DEMO_MODE       = os.environ.get("DEMO_MODE") == "1"
STATIC_VERSION  = str(int(time.time()))
APP_VERSION     = "1.27.1"


def requires_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if CLIPPERY_USER and CLIPPERY_PASS:
            auth = request.authorization
            if not auth or auth.username != CLIPPERY_USER or auth.password != CLIPPERY_PASS:
                return Response(
                    "Authentication required.", 401,
                    {"WWW-Authenticate": 'Basic realm="Journery"'}
                )
        return f(*args, **kwargs)
    return decorated


@app.route("/")
@requires_auth
def index():
    return render_template("index.html", journery_name=JOURNERY_NAME, static_v=STATIC_VERSION, app_version=APP_VERSION, demo_mode=DEMO_MODE)


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
        result = db.move_folder(folder_id, data["parent_id"] or None)
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


if __name__ == "__main__":
    db.init_db()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")))
