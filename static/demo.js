/* ─────────────────────────────────────────────────────────────────────────────
 * Journery DEMO mode — a browser-only backend.
 *
 * When window.DEMO_MODE is true, app.js routes every api() call here instead of
 * to the Flask server. All data lives in this browser's localStorage, seeded with
 * sample content — nothing is stored on the server and nothing is shared between
 * visitors. Mirrors db.py's semantics (folders, notes, tags, trash, export).
 *
 * Inert on every non-demo instance (returns immediately if DEMO_MODE is false),
 * so it's safe to ship to beta/prod too.
 * ──────────────────────────────────────────────────────────────────────────── */
(function () {
  if (!window.DEMO_MODE) return;

  const KEY = "journery_demo_db_v1";
  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  const now = () => new Date().toISOString();
  const normTags = (tags) =>
    [...new Set((tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  const cloneNote = (n) => ({ ...n, tags: [...(n.tags || [])] });

  // ── Seed content ──────────────────────────────────────────────────────────
  function seed() {
    const journal = { id: uid(), name: "Journal", parent_id: null, created_at: now(), updated_at: now() };
    const ideas   = { id: uid(), name: "Ideas",   parent_id: null, created_at: now(), updated_at: now() };
    const mk = (title, body, folder_id, tags, created_at) => ({
      id: uid(), title, body, folder_id, created_at, updated_at: created_at,
      deleted_at: null, tags: normTags(tags),
    });
    const notes = [
      mk("Welcome to the Journery demo 👋",
         "This is a live demo of Journery.\n\n" +
         "Everything you do here is saved only in *your* browser — nothing is sent to a server and nothing is shared with anyone else. Refreshing keeps your changes; other people see their own copy.\n\n" +
         "Try it out: create notes, add tags, make folders, search, drop things in the Trash. When you want a clean slate, open Settings → Data → Reset demo data.\n\n" +
         "Install it as an app\n\n" +
         "Journery works as a home-screen app (PWA) — full screen, no browser bar.\n\n" +
         "On iPhone / iPad (Safari):\n" +
         "- Tap the Share button (the square with an upward arrow)\n" +
         "- Scroll down and tap \"Add to Home Screen\"\n" +
         "- Tap Add\n\n" +
         "On Android (Chrome):\n" +
         "- Tap the ⋮ menu (top-right)\n" +
         "- Tap \"Add to Home screen\" (or \"Install app\")\n" +
         "- Tap Install / Add\n\n" +
         "Tip: the installed app keeps its own separate copy of your notes, so it may start fresh from the sample content.",
         null, ["getting-started"], "2026-07-01T09:00:00.000Z"),
      mk("Morning pages",
         "Slow start today. Coffee, then twenty minutes of just writing whatever came to mind.\n\nNoticed I think more clearly on paper than on screen. Worth keeping this up.",
         journal.id, ["daily-journal"], "2026-06-30T07:30:00.000Z"),
      mk("Weekend trip",
         "Drove up the coast. No plan, no schedule — the good kind of weekend.\n\n- Found a tiny bookshop\n- Best tacos in ages\n- Watched the sunset from the pier",
         journal.id, ["daily-journal", "travel"], "2026-05-12T20:15:00.000Z"),
      mk("App idea: offline-first notes",
         "Random ideas, unfiltered:\n\n- Offline-first sync with CRDTs\n- End-to-end encrypted notes — keys stay on device\n- Keyboard shortcuts for everything\n- Weekly digest: your notes from this week last year",
         ideas.id, ["ideas", "product"], "2026-03-01T14:00:00.000Z"),
      mk("Books to read",
         "- A book on attention and focus\n- Something on systems thinking\n- A novel, for once\n\nStop buying faster than I read.",
         null, ["reading"], "2025-11-20T21:00:00.000Z"),
      mk("Reflections on 2025",
         "A full year of writing here. Some entries are one line, some are pages. Both count.\n\nGoal for next year: show up more than I skip.",
         journal.id, ["daily-journal"], "2025-12-31T23:00:00.000Z"),
    ];
    return { folders: [journal, ideas], notes, settings: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.folders) && Array.isArray(parsed.notes)) {
          parsed.settings = parsed.settings || {};
          return parsed;
        }
      }
    } catch (e) { /* fall through to a fresh seed */ }
    const fresh = seed();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  }

  let db = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));

  window.demoResetData = function () {
    db = seed();
    save();
  };

  // ── Store operations (mirror db.py) ─────────────────────────────────────────
  const liveNotes = () => db.notes.filter((n) => !n.deleted_at);

  function getFolders() {
    return db.folders.slice()
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((f) => ({ ...f }));
  }
  function createFolder(name, parent_id) {
    const f = { id: uid(), name, parent_id: parent_id ?? null, created_at: now(), updated_at: now() };
    db.folders.push(f); save(); return { ...f };
  }
  function renameFolder(id, name) {
    const f = db.folders.find((x) => x.id === id); if (!f) return null;
    f.name = name; f.updated_at = now(); save(); return { ...f };
  }
  function moveFolder(id, parent_id) {
    const f = db.folders.find((x) => x.id === id); if (!f) return null;
    f.parent_id = parent_id ?? null; f.updated_at = now(); save(); return { ...f };
  }
  function deleteFolder(id) {
    // Cascade to descendant folders (parent_id ON DELETE CASCADE); notes in any
    // deleted folder move to root (folder_id ON DELETE SET NULL).
    const del = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      db.folders.forEach((f) => {
        if (f.parent_id && del.has(f.parent_id) && !del.has(f.id)) { del.add(f.id); changed = true; }
      });
    }
    db.folders = db.folders.filter((f) => !del.has(f.id));
    db.notes.forEach((n) => { if (del.has(n.folder_id)) n.folder_id = null; });
    save();
  }

  function getNotes({ folder_id, tag, year, q }) {
    let ns = liveNotes();
    if (tag) ns = ns.filter((n) => (n.tags || []).includes(tag));
    if (folder_id === "root") ns = ns.filter((n) => !n.folder_id);
    else if (folder_id) ns = ns.filter((n) => n.folder_id === folder_id);
    if (year) ns = ns.filter((n) => String(n.created_at || "").slice(0, 4) === String(year));
    if (q) {
      const ql = q.toLowerCase();
      ns = ns.filter((n) => (n.title || "").toLowerCase().includes(ql) || (n.body || "").toLowerCase().includes(ql));
    }
    ns.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return ns.map(cloneNote);
  }
  function getNote(id) { const n = db.notes.find((x) => x.id === id); return n ? cloneNote(n) : null; }
  function createNote(b) {
    const ts = now();
    const note = {
      id: uid(), title: b.title || "", body: b.body || "",
      folder_id: b.folder_id ?? null, created_at: b.created_at || ts, updated_at: ts,
      deleted_at: null, tags: normTags(b.tags),
    };
    db.notes.push(note); save(); return cloneNote(note);
  }
  function updateNote(id, kw) {
    const n = db.notes.find((x) => x.id === id); if (!n) return null;
    ["title", "body", "folder_id", "created_at"].forEach((f) => { if (f in kw) n[f] = kw[f]; });
    if ("tags" in kw) n.tags = normTags(kw.tags);
    n.updated_at = now(); save(); return cloneNote(n);
  }
  function deleteNote(id) {
    const n = db.notes.find((x) => x.id === id);
    if (n && !n.deleted_at) { n.deleted_at = now(); n.updated_at = now(); save(); }
  }
  function restoreNote(id) {
    const n = db.notes.find((x) => x.id === id); if (!n) return null;
    n.deleted_at = null; n.updated_at = now(); save(); return cloneNote(n);
  }
  function permanentDelete(id) { db.notes = db.notes.filter((n) => n.id !== id); save(); }
  function getTrash(tag) {
    let ns = db.notes.filter((n) => n.deleted_at);
    if (tag) ns = ns.filter((n) => (n.tags || []).includes(tag));
    ns.sort((a, b) => (b.deleted_at || "").localeCompare(a.deleted_at || ""));
    return ns.map(cloneNote);
  }

  function getTags() {
    const names = new Set();
    db.notes.forEach((n) => (n.tags || []).forEach((t) => names.add(t)));
    const live = liveNotes();
    return [...names].sort().map((name) => ({
      name, count: live.filter((n) => (n.tags || []).includes(name)).length,
    }));
  }
  function deleteTag(name) { db.notes.forEach((n) => { n.tags = (n.tags || []).filter((t) => t !== name); }); save(); }
  function renameTag(oldName, newName) {
    newName = String(newName).trim().toLowerCase();
    if (!newName) return;
    db.notes.forEach((n) => {
      if ((n.tags || []).includes(oldName)) {
        n.tags = [...new Set(n.tags.map((t) => (t === oldName ? newName : t)))];
      }
    });
    save();
  }

  function exportAll() {
    const folders = getFolders();
    const notes = liveNotes()
      .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))
      .map(cloneNote);
    return { schema_version: 3, folders, notes };
  }
  function importData(data, mode) {
    if (mode === "replace") { db.folders = []; db.notes = []; }
    (data.folders || []).forEach((f) => { if (!db.folders.find((x) => x.id === f.id)) db.folders.push({ ...f }); });
    (data.notes || []).forEach((n) => {
      if (!db.notes.find((x) => x.id === n.id)) db.notes.push({ ...n, deleted_at: n.deleted_at ?? null, tags: normTags(n.tags) });
    });
    save();
    return { imported_folders: (data.folders || []).length, imported_notes: (data.notes || []).length };
  }

  // ── Router: mimics the Flask API surface ────────────────────────────────────
  async function demoApi(method, path, body) {
    const url = new URL(path, location.origin);
    const p = url.pathname;
    const qs = url.searchParams;
    const seg = p.split("/").filter(Boolean); // ["api", ...]

    if (p === "/api/folders") {
      if (method === "GET") return getFolders();
      if (method === "POST") return createFolder(body.name, body.parent_id ?? null);
    }
    if (seg[1] === "folders" && seg[2]) {
      if (method === "PUT") return "parent_id" in body ? moveFolder(seg[2], body.parent_id) : renameFolder(seg[2], body.name);
      if (method === "DELETE") { deleteFolder(seg[2]); return { ok: true }; }
    }

    if (p === "/api/notes") {
      if (method === "GET") return getNotes({ folder_id: qs.get("folder_id"), tag: qs.get("tag"), year: qs.get("year"), q: qs.get("q") });
      if (method === "POST") return createNote(body);
    }
    if (seg[1] === "notes" && seg[2]) {
      if (seg[3] === "restore" && method === "POST") return restoreNote(seg[2]);
      if (method === "GET") return getNote(seg[2]);
      if (method === "PUT") return updateNote(seg[2], body);
      if (method === "DELETE") { deleteNote(seg[2]); return { ok: true }; }
    }

    if (p === "/api/tags" && method === "GET") return getTags();
    if (seg[1] === "tags" && seg[2]) {
      const name = decodeURIComponent(seg[2]);
      if (method === "DELETE") { deleteTag(name); return { ok: true }; }
      if (method === "PUT") { renameTag(name, body.name); return { ok: true }; }
    }

    if (p === "/api/trash" && method === "GET") return getTrash(qs.get("tag"));
    if (seg[1] === "trash" && seg[2] && method === "DELETE") { permanentDelete(seg[2]); return { ok: true }; }

    if (p === "/api/sync") return { version: "demo" }; // constant → no phantom reloads

    if (seg[1] === "settings" && seg[2]) {
      if (method === "GET") return { value: db.settings[seg[2]] ?? null };
      if (method === "PUT") { db.settings[seg[2]] = body.value; save(); return { ok: true }; }
    }

    if (p === "/api/export" && method === "GET") return exportAll();
    if (p === "/api/import" && method === "POST") return importData(body, qs.get("mode") || "merge");

    throw new Error("demo: unhandled " + method + " " + p);
  }
  window.demoApi = demoApi;

  // ── Demo-only UI wiring ─────────────────────────────────────────────────────
  document.body.classList.add("demo-mode");

  // Export runs client-side (the <a href="/api/export"> would hit the empty server)
  const exportLink = document.querySelector('a[href="/api/export"]');
  if (exportLink) {
    exportLink.addEventListener("click", (e) => {
      e.preventDefault();
      const data = exportAll();
      data.exported_at = now();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `journery-demo-${data.exported_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  const resetBtn = document.getElementById("demo-reset-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Reset the demo to the sample notes? Anything you've added here will be cleared.")) {
        window.demoResetData();
        location.reload();
      }
    });
  }
})();
