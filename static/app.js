// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  folders: [],
  tags: [],
  notes: [],
  noteYears: [],        // [{ year, count }, …] sorted desc
  note: null,
  context: { type: "all", id: null, label: "All Notes" },
  searchQuery: "",
  paneSearchQuery: "",
  sortBy: localStorage.getItem("sortBy") || "created_desc",
  dateDisplay: localStorage.getItem("dateDisplay") || "created",
  recentsRange: localStorage.getItem("recentsRange") || "week",
  expandedFolders: new Set(JSON.parse(localStorage.getItem("expandedFolders") || "[]")),
  darkMode: localStorage.getItem("darkMode") === "true",
  subfoldersExpanded: localStorage.getItem("subfoldersExpanded") !== "false",
  // Sidebar section collapse states.
  // Only Pinned defaults to expanded; Tags and Timeline default to collapsed
  // (=== "true" means collapsed unless the user has explicitly expanded them).
  timelineExpanded:   localStorage.getItem("timelineExpanded")   === "true",
  pinnedTagsExpanded: localStorage.getItem("pinnedTagsExpanded") !== "false",
  allTagsExpanded:    localStorage.getItem("allTagsExpanded")    === "true",
  // Pinned tags (ordered array of tag names)
  pinnedTags: JSON.parse(localStorage.getItem("pinnedTags") || "[]"),
  // Folder visibility
  showFolders: localStorage.getItem("showFolders") === "true",
  // Show created/edited dates in the note editor (default on)
  showNoteDates: localStorage.getItem("showNoteDates") !== "false",
  dirty: false,
  saving: false,
  syncVersion: "",
  mobileView: "sidebar",
  navHistory: [],
  selectMode: false,
  selectedNoteIds: new Set(),
  trashCount: 0,
  tagTrashedNotes: [],
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const appEl          = $("app");
const folderTree     = $("folder-tree");
const allNotesCount  = $("all-notes-count");
const navAllNotes    = $("nav-all-notes");
const paneTitle      = $("pane-title");
const notesList      = $("notes-list");
const noteTitle      = $("note-title");
const noteBody       = $("note-body");
const tagsChips      = $("tags-chips");
const tagInput       = $("tag-input");
const autosaveEl     = $("autosave-indicator");
const editorBody     = $("editor-body");
const editorEmpty    = $("editor-empty-state");
const overflowMenu   = $("overflow-menu");
const searchInput    = $("search-input");
const navRecents     = $("nav-recents");
const formatBar      = $("format-bar");
const stickyFormatBar = $("sticky-format-bar");
const formatToggleBtn = $("format-toggle-btn");
const offlinePill = $("offline-pill");
const bodyPlaceholder = $("note-body-placeholder");
const notesPaneEl    = $("notes-pane");
const bulkActionBar  = $("bulk-action-bar");
const bulkCountEl    = $("bulk-count");

let editingTag = null;
let movingFolderNode = null;
let moveExpanded = new Set();   // folder ids expanded in the move-to-folder picker
let contextMenuNote = null;

// ── API helpers ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  // Demo mode: serve everything from the browser-local store (see demo.js).
  if (window.DEMO_MODE && window.demoApi) return window.demoApi(method, path, body);
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Dark mode ─────────────────────────────────────────────────────────────────

function applyDark(dark) {
  dark
    ? document.documentElement.setAttribute("data-dark", "")
    : document.documentElement.removeAttribute("data-dark");
  localStorage.setItem("darkMode", dark);
  state.darkMode = dark;
  syncThemeColorMeta();
}

// Keeps the browser-chrome theme-color in sync with whatever --bg actually
// resolves to right now — plain dark mode or one of the many custom themes.
function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) $("theme-color-meta").setAttribute("content", bg);
}

// ── Theme system ──────────────────────────────────────────────────────────────

const BUILT_IN_THEMES = [
  {
    id: "default-light", name: "Default Light", dark: false,
    tokens: { "--bg":"#F5F5F5","--surface":"#FFFFFF","--surface-2":"#FAFAFA","--border":"#E5E5E5","--border-mid":"#D4D4D4","--divider":"#F0F0F0","--text":"#111111","--text-2":"#444444","--text-muted":"#737373","--text-faint":"#B0B0B0","--accent":"#111111","--accent-fg":"#FFFFFF","--danger":"#DC2626","--danger-bg":"#FFF1F2" },
  },
  {
    id: "default-dark", name: "Default Dark", dark: true,
    tokens: { "--bg":"#1E2126","--surface":"#24272E","--surface-2":"#20232A","--border":"#30353E","--border-mid":"#3B414C","--divider":"#2A2E36","--text":"#B6C2D6","--text-2":"#909BAF","--text-muted":"#69727F","--text-faint":"#515863","--accent":"#C8CED8","--accent-fg":"#1E2126","--danger":"#F08C84","--danger-bg":"#2E2125" },
  },
  {
    id: "nord", name: "Nord", dark: true,
    tokens: { "--bg":"#242933","--surface":"#2E3440","--surface-2":"#272C38","--border":"#3B4252","--border-mid":"#434C5E","--divider":"#2B3040","--text":"#ECEFF4","--text-2":"#D8DEE9","--text-muted":"#8E98AC","--text-faint":"#5E6779","--accent":"#88C0D0","--accent-fg":"#2E3440","--danger":"#BF616A","--danger-bg":"#2D1E22" },
  },
  {
    id: "solarized-dark", name: "Solarized Dark", dark: true,
    tokens: { "--bg":"#002B36","--surface":"#073642","--surface-2":"#003845","--border":"#124F5E","--border-mid":"#17606F","--divider":"#054554","--text":"#839496","--text-2":"#657B83","--text-muted":"#586E75","--text-faint":"#435B62","--accent":"#2AA198","--accent-fg":"#002B36","--danger":"#DC322F","--danger-bg":"#1A0E00" },
  },
  {
    id: "solarized-light", name: "Solarized Light", dark: false,
    tokens: { "--bg":"#FDF6E3","--surface":"#EEE8D5","--surface-2":"#E9E2CF","--border":"#D3CBBA","--border-mid":"#C3BFAF","--divider":"#EDE7D2","--text":"#657B83","--text-2":"#839496","--text-muted":"#93A1A1","--text-faint":"#B3BFBF","--accent":"#268BD2","--accent-fg":"#FDF6E3","--danger":"#DC322F","--danger-bg":"#FCE7E6" },
  },
  {
    id: "monokai", name: "Monokai", dark: true,
    tokens: { "--bg":"#1E1F1C","--surface":"#272822","--surface-2":"#22231F","--border":"#3B3C35","--border-mid":"#464741","--divider":"#2D2E29","--text":"#F8F8F2","--text-2":"#CFCFC2","--text-muted":"#90908A","--text-faint":"#5C5C56","--accent":"#A6E22E","--accent-fg":"#272822","--danger":"#F92672","--danger-bg":"#2D1020" },
  },
  {
    id: "gruvbox-dark", name: "Gruvbox Dark", dark: true,
    tokens: { "--bg":"#1D2021","--surface":"#282828","--surface-2":"#242424","--border":"#3C3836","--border-mid":"#504945","--divider":"#32302F","--text":"#EBDBB2","--text-2":"#D5C4A1","--text-muted":"#928374","--text-faint":"#665C54","--accent":"#B8BB26","--accent-fg":"#282828","--danger":"#FB4934","--danger-bg":"#2D1010" },
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin Mocha", dark: true,
    tokens: { "--bg":"#11111B","--surface":"#1E1E2E","--surface-2":"#181825","--border":"#313244","--border-mid":"#45475A","--divider":"#1E1E35","--text":"#CDD6F4","--text-2":"#BAC2DE","--text-muted":"#7F849C","--text-faint":"#585B70","--accent":"#89B4FA","--accent-fg":"#1E1E2E","--danger":"#F38BA8","--danger-bg":"#2D1A22" },
  },
  {
    id: "catppuccin-macchiato", name: "Catppuccin Macchiato", dark: true,
    tokens: { "--bg":"#181926","--surface":"#24273A","--surface-2":"#1E2030","--border":"#363A4F","--border-mid":"#494D64","--divider":"#1E2132","--text":"#CAD3F5","--text-2":"#B8C0E0","--text-muted":"#6E738D","--text-faint":"#5B6078","--accent":"#8AADF4","--accent-fg":"#24273A","--danger":"#ED8796","--danger-bg":"#2D1A22" },
  },
  {
    id: "catppuccin-frappe", name: "Catppuccin Frappé", dark: true,
    tokens: { "--bg":"#232634","--surface":"#303446","--surface-2":"#292C3C","--border":"#414559","--border-mid":"#51576D","--divider":"#2B2E3F","--text":"#C6D0F5","--text-2":"#B5BFE2","--text-muted":"#737994","--text-faint":"#565878","--accent":"#8CAAEE","--accent-fg":"#303446","--danger":"#E78284","--danger-bg":"#2D1A1F" },
  },
  {
    id: "catppuccin-latte", name: "Catppuccin Latte", dark: false,
    tokens: { "--bg":"#EFF1F5","--surface":"#E6E9EF","--surface-2":"#DCE0E8","--border":"#CCD0DA","--border-mid":"#BCC0CC","--divider":"#E6E9EF","--text":"#4C4F69","--text-2":"#5C5F77","--text-muted":"#8C8FA1","--text-faint":"#ACB0BE","--accent":"#1E66F5","--accent-fg":"#EFF1F5","--danger":"#D20F39","--danger-bg":"#F8E8ED" },
  },
  {
    id: "gruvbox-light", name: "Gruvbox Light", dark: false,
    tokens: { "--bg":"#FBF1C7","--surface":"#F2E5BC","--surface-2":"#EBDBB2","--border":"#D5C4A1","--border-mid":"#BDAE93","--divider":"#EBDBB2","--text":"#3C3836","--text-2":"#504945","--text-muted":"#7C6F64","--text-faint":"#928374","--accent":"#B57614","--accent-fg":"#FBF1C7","--danger":"#CC241D","--danger-bg":"#FCE8E6" },
  },
  {
    id: "tokyo-night", name: "Tokyo Night", dark: true,
    tokens: { "--bg":"#1A1B26","--surface":"#24283B","--surface-2":"#1F2335","--border":"#292E42","--border-mid":"#3B4261","--divider":"#1F2335","--text":"#C0CAF5","--text-2":"#A9B1D6","--text-muted":"#565F89","--text-faint":"#414868","--accent":"#7AA2F7","--accent-fg":"#1A1B26","--danger":"#F7768E","--danger-bg":"#2D1A22" },
  },
  {
    id: "tokyo-night-storm", name: "Tokyo Night Storm", dark: true,
    tokens: { "--bg":"#1F2335","--surface":"#24283B","--surface-2":"#1A1E2E","--border":"#292E42","--border-mid":"#3B4261","--divider":"#1E2233","--text":"#C0CAF5","--text-2":"#A9B1D6","--text-muted":"#565F89","--text-faint":"#414868","--accent":"#BB9AF7","--accent-fg":"#1F2335","--danger":"#F7768E","--danger-bg":"#2D1A22" },
  },
  {
    id: "dracula", name: "Dracula", dark: true,
    tokens: { "--bg":"#21222C","--surface":"#282A36","--surface-2":"#1E1F29","--border":"#44475A","--border-mid":"#6272A4","--divider":"#2D2F3E","--text":"#F8F8F2","--text-2":"#E0DEF4","--text-muted":"#6272A4","--text-faint":"#44475A","--accent":"#BD93F9","--accent-fg":"#282A36","--danger":"#FF5555","--danger-bg":"#2D1010" },
  },
  {
    id: "one-dark", name: "One Dark", dark: true,
    tokens: { "--bg":"#21252B","--surface":"#282C34","--surface-2":"#23272E","--border":"#3E4451","--border-mid":"#4B5263","--divider":"#2C313A","--text":"#ABB2BF","--text-2":"#9DA5B4","--text-muted":"#5C6370","--text-faint":"#4B5263","--accent":"#61AFEF","--accent-fg":"#282C34","--danger":"#E06C75","--danger-bg":"#2D1010" },
  },
  {
    id: "github-light", name: "GitHub Light", dark: false,
    tokens: { "--bg":"#F6F8FA","--surface":"#FFFFFF","--surface-2":"#F0F2F4","--border":"#D0D7DE","--border-mid":"#BBC0C6","--divider":"#E8EAED","--text":"#1F2328","--text-2":"#24292F","--text-muted":"#656D76","--text-faint":"#8C959F","--accent":"#0969DA","--accent-fg":"#FFFFFF","--danger":"#CF222E","--danger-bg":"#FFF0EE" },
  },
  {
    id: "github-dark", name: "GitHub Dark", dark: true,
    tokens: { "--bg":"#0D1117","--surface":"#161B22","--surface-2":"#0D1117","--border":"#30363D","--border-mid":"#3D444D","--divider":"#21262D","--text":"#E6EDF3","--text-2":"#C9D1D9","--text-muted":"#8B949E","--text-faint":"#484F58","--accent":"#58A6FF","--accent-fg":"#0D1117","--danger":"#F85149","--danger-bg":"#2D1010" },
  },
  {
    id: "rose-pine", name: "Rosé Pine", dark: true,
    tokens: { "--bg":"#191724","--surface":"#1F1D2E","--surface-2":"#1B1929","--border":"#26233A","--border-mid":"#403D52","--divider":"#21202E","--text":"#E0DEF4","--text-2":"#C5C0D8","--text-muted":"#6E6A86","--text-faint":"#524F67","--accent":"#C4A7E7","--accent-fg":"#1F1D2E","--danger":"#EB6F92","--danger-bg":"#2D1020" },
  },
  {
    id: "rose-pine-dawn", name: "Rosé Pine Dawn", dark: false,
    tokens: { "--bg":"#FAF4ED","--surface":"#FFFAF3","--surface-2":"#F2E9E1","--border":"#DFDAD9","--border-mid":"#CECACD","--divider":"#F0EBE4","--text":"#575279","--text-2":"#797593","--text-muted":"#9893A5","--text-faint":"#B4B0C0","--accent":"#907AA9","--accent-fg":"#FFFAF3","--danger":"#B4637A","--danger-bg":"#FCE8EC" },
  },
  {
    id: "kanagawa", name: "Kanagawa", dark: true,
    tokens: { "--bg":"#1F1F28","--surface":"#2A2A37","--surface-2":"#252530","--border":"#363646","--border-mid":"#494958","--divider":"#282831","--text":"#DCD7BA","--text-2":"#C8C093","--text-muted":"#727169","--text-faint":"#54546D","--accent":"#7E9CD8","--accent-fg":"#1F1F28","--danger":"#C34043","--danger-bg":"#2D1010" },
  },
  {
    id: "everforest-dark", name: "Everforest Dark", dark: true,
    tokens: { "--bg":"#272E33","--surface":"#2D353B","--surface-2":"#272D32","--border":"#3D484D","--border-mid":"#475258","--divider":"#2C3338","--text":"#D3C6AA","--text-2":"#C0B89A","--text-muted":"#7A8478","--text-faint":"#545D5A","--accent":"#A7C080","--accent-fg":"#2D353B","--danger":"#E67E80","--danger-bg":"#2D1A1A" },
  },
  {
    id: "everforest-light", name: "Everforest Light", dark: false,
    tokens: { "--bg":"#FDF6E3","--surface":"#F4F0D9","--surface-2":"#EAE4CA","--border":"#E0DBC4","--border-mid":"#CEC9B4","--divider":"#F0EADA","--text":"#5C6A72","--text-2":"#6D7F86","--text-muted":"#829181","--text-faint":"#9DA9A0","--accent":"#8DA101","--accent-fg":"#FDF6E3","--danger":"#F85552","--danger-bg":"#FCE8E8" },
  },
  {
    id: "night-owl", name: "Night Owl", dark: true,
    tokens: { "--bg":"#011627","--surface":"#01121F","--surface-2":"#011020","--border":"#1D3B53","--border-mid":"#2D5170","--divider":"#01192E","--text":"#D6DEEB","--text-2":"#C5CEE0","--text-muted":"#4B6479","--text-faint":"#2D4057","--accent":"#82AAFF","--accent-fg":"#011627","--danger":"#EF5350","--danger-bg":"#1A0505" },
  },
  {
    id: "ayu-dark", name: "Ayu Dark", dark: true,
    tokens: { "--bg":"#0B0E14","--surface":"#0D1017","--surface-2":"#0A0D12","--border":"#1A1F29","--border-mid":"#272D38","--divider":"#131720","--text":"#BFBDB6","--text-2":"#A8A09E","--text-muted":"#636363","--text-faint":"#3D3D3D","--accent":"#FFB454","--accent-fg":"#0B0E14","--danger":"#F07178","--danger-bg":"#1F0A0B" },
  },
  {
    id: "ayu-mirage", name: "Ayu Mirage", dark: true,
    tokens: { "--bg":"#1F2430","--surface":"#242936","--surface-2":"#1C2128","--border":"#2D3440","--border-mid":"#3E4B59","--divider":"#232A37","--text":"#CCCAC2","--text-2":"#B8BDB5","--text-muted":"#5C6773","--text-faint":"#414A55","--accent":"#FFB454","--accent-fg":"#1F2430","--danger":"#F07178","--danger-bg":"#2D1010" },
  },
  {
    id: "ayu-light", name: "Ayu Light", dark: false,
    tokens: { "--bg":"#FAFAFA","--surface":"#F8F9FA","--surface-2":"#F0F1F3","--border":"#E0E1E4","--border-mid":"#CFD0D3","--divider":"#F0F0F0","--text":"#575F66","--text-2":"#6C7680","--text-muted":"#8A9199","--text-faint":"#A8B0B8","--accent":"#F5A623","--accent-fg":"#FFFFFF","--danger":"#F07178","--danger-bg":"#FFF0F0" },
  },
  {
    id: "palenight", name: "Palenight", dark: true,
    tokens: { "--bg":"#252837","--surface":"#292D3E","--surface-2":"#23263A","--border":"#3D4062","--border-mid":"#4F5379","--divider":"#2A2D3E","--text":"#A6ACCD","--text-2":"#959CB6","--text-muted":"#676E95","--text-faint":"#4E536A","--accent":"#C792EA","--accent-fg":"#292D3E","--danger":"#F07178","--danger-bg":"#2D1010" },
  },
  {
    id: "paper", name: "Paper", dark: false,
    tokens: { "--bg":"#F5F0E8","--surface":"#FAF6F0","--surface-2":"#EDE8DF","--border":"#D8D0C4","--border-mid":"#C8BDB0","--divider":"#E8E2D8","--text":"#2C2414","--text-2":"#4A3F30","--text-muted":"#7A6F60","--text-faint":"#A89F90","--accent":"#6B4C2A","--accent-fg":"#FAF6F0","--danger":"#B02020","--danger-bg":"#F9E8E8" },
  },
];

let activeTheme = null;  // null = default (dark mode toggle controls appearance)

function applyTheme(theme) {
  activeTheme = theme;
  let styleEl = document.getElementById("theme-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "theme-style";
    document.head.appendChild(styleEl);
  }
  if (!theme) {
    styleEl.textContent = "";
    return;
  }
  // Override all tokens. The injected style tag loads after the linked stylesheet
  // so same-specificity rules here win via cascade order.
  const decls = Object.entries(theme.tokens).map(([k, v]) => `${k}:${v}`).join(";");
  styleEl.textContent = `:root,html[data-dark]{${decls}}`;
  applyDark(theme.dark);
}

function themePreviewHTML(theme) {
  const t = theme.tokens;
  return `
    <div class="theme-swatch">
      <span style="background:${t["--surface-2"]}"></span>
      <span style="background:${t["--surface"]}"></span>
      <span style="background:${t["--accent"]}"></span>
      <span style="background:${t["--bg"]}"></span>
    </div>
    <span class="theme-card-name">${esc(theme.name)}</span>
    <span class="theme-card-check">
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="${t["--accent-fg"]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 6 5 9 10 3"/></svg>
    </span>`;
}

function renderThemeGrid() {
  const grid = $("theme-grid");
  if (!grid) return;
  const allThemes = [...BUILT_IN_THEMES, ...(window._customThemes || [])];
  grid.innerHTML = "";
  allThemes.forEach(theme => {
    const card = document.createElement("div");
    card.className = "theme-card" + (activeTheme && activeTheme.id === theme.id ? " active" : "");
    card.innerHTML = themePreviewHTML(theme);
    card.addEventListener("click", async () => {
      applyTheme(theme);
      localStorage.setItem("activeTheme", JSON.stringify(theme));
      await api("PUT", "/api/settings/activeTheme", { value: JSON.stringify(theme) });
      renderThemeGrid();
    });
    grid.appendChild(card);
  });
}

$("theme-import-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  try {
    const text = await file.text();
    const theme = JSON.parse(text);
    if (!theme.name || !theme.tokens || typeof theme.tokens !== "object") throw new Error("Invalid format");
    if (!theme.id) theme.id = "custom-" + theme.name.toLowerCase().replace(/\s+/g, "-");
    theme.dark = !!theme.dark;
    if (!window._customThemes) window._customThemes = [];
    const idx = window._customThemes.findIndex(t => t.id === theme.id);
    if (idx !== -1) window._customThemes[idx] = theme;
    else window._customThemes.push(theme);
    applyTheme(theme);
    localStorage.setItem("activeTheme", JSON.stringify(theme));
    await api("PUT", "/api/settings/activeTheme", { value: JSON.stringify(theme) });
    renderThemeGrid();
    showToast(`Theme "${theme.name}" applied`);
  } catch {
    showToast("Invalid theme file");
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2500);
}

// ── Settings ──────────────────────────────────────────────────────────────────

function updateDatePicker() {
  $("date-display-picker").querySelectorAll("button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === state.dateDisplay);
  });
}

function updateRecentsRangePicker() {
  $("recents-range-picker").querySelectorAll("button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === state.recentsRange);
  });
}

const SETTINGS_SECTION_LABELS = {
  general: "General", changelog: "What's New", sidebar: "Sidebar", tags: "Tags", themes: "Themes", data: "Data",
};

// User-facing changelog. Curated highlights only — major features per release,
// with smaller stuff rolled up as "Bug fixes & improvements". Newest first.
const CHANGELOG = [
  { version: "1.23", date: "July 2026", changes: [
    "Turn an existing line into a list by typing “* ” or “1. ” in front of it",
    "Create a new folder right from the Move-to-folder dialog",
    "Bug fixes & improvements",
  ]},
  { version: "1.22", date: "July 2026", changes: [
    "Works offline — opens and shows your latest notes without a connection (read-only for now)",
    "Bug fixes & improvements",
  ]},
  { version: "1.20", date: "July 2026", changes: [
    "Export your notes as Markdown files — take them anywhere, no lock-in",
    "Larger, clearer note titles",
    "Bug fixes & improvements",
  ]},
  { version: "1.19", date: "July 2026", changes: [
    "Show or hide the created & edited dates on a note (Settings → General)",
    "Bug fixes & improvements",
  ]},
  { version: "1.18", date: "July 2026", changes: [
    "Show or hide the formatting bar with the new toolbar button — a cleaner writing space",
    "Tick off checklist items without the keyboard popping up",
    "This What's New page in Settings",
    "Bug fixes & improvements",
  ]},
  { version: "1.16", date: "July 2026", changes: [
    "Checklists — tap the box to tick things off",
    "Nested lists: Tab to indent, with bullets that change shape by depth",
    "Bug fixes & improvements",
  ]},
  { version: "1.15", date: "July 2026", changes: [
    "Pull quotes and code blocks in the editor",
    "Bug fixes & improvements",
  ]},
  { version: "1.14", date: "July 2026", changes: [
    "Add links to your text",
    "Smoother typing and scrolling on iPhone",
    "Bug fixes & improvements",
  ]},
  { version: "1.10", date: "July 2026", changes: [
    "Trash with 30-day recovery for deleted notes",
    "Redesigned full-screen Settings",
    "Bug fixes & improvements",
  ]},
  { version: "1.6", date: "June 2026", changes: [
    "20+ editor themes",
    "Faster, smarter search",
    "Bug fixes & improvements",
  ]},
  { version: "1.1", date: "June 2026", changes: [
    "Journery is born — folders, tags, a rich-text editor, dark mode, and add-to-home-screen",
  ]},
];

function renderChangelog() {
  const el = $("changelog-list");
  if (!el) return;
  el.innerHTML = CHANGELOG.map(entry => `
    <div class="changelog-entry">
      <div class="changelog-head">
        <span class="changelog-version">Version ${esc(entry.version)}</span>
        <span class="changelog-date">${esc(entry.date)}</span>
      </div>
      <ul class="changelog-changes">
        ${entry.changes.map(c => `<li>${esc(c)}</li>`).join("")}
      </ul>
    </div>
  `).join("");
}

function openSettingsSection(section) {
  document.querySelectorAll(".settings-cat-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === section);
  });
  document.querySelectorAll(".settings-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `settings-panel-${section}`);
  });
  if (section === "changelog") renderChangelog();
  if (section === "tags") renderSettingsTags();
  if (section === "themes") renderThemeGrid();
  if (isMobile()) {
    $("settings-view").dataset.pane = "detail";
    $("settings-topbar-back").querySelector("span").textContent = "Settings";
    $("settings-topbar-title").textContent = SETTINGS_SECTION_LABELS[section] || section;
  }
}

function settingsBackToList() {
  $("settings-view").dataset.pane = "list";
  $("settings-topbar-back").querySelector("span").textContent = "Back";
  $("settings-topbar-title").textContent = "Settings";
}

function closeSettings() {
  $("settings-view").classList.add("hidden");
}

function openSettings() {
  $("settings-folders-toggle").classList.toggle("on", state.showFolders);
  $("settings-dates-toggle").classList.toggle("on", state.showNoteDates);
  $("settings-formatbar-toggle").classList.toggle("on", formatBarOpen);
  updateDatePicker();
  updateRecentsRangePicker();
  $("settings-view").dataset.pane = "list";
  $("settings-topbar-back").querySelector("span").textContent = "Back";
  $("settings-topbar-title").textContent = "Settings";
  if (!isMobile()) openSettingsSection("general");
  $("settings-view").classList.remove("hidden");
}

$("settings-topbar-back").addEventListener("click", () => {
  if ($("settings-view").dataset.pane === "detail") settingsBackToList();
  else closeSettings();
});

// Swipe from the left edge to go back within settings or close settings entirely
let settingsSwipeX = 0, settingsSwipeY = 0, settingsSwipeActive = false;
$("settings-view").addEventListener("touchstart", e => {
  settingsSwipeX = e.touches[0].clientX;
  settingsSwipeY = e.touches[0].clientY;
  settingsSwipeActive = settingsSwipeX < 32;
}, { passive: true });
$("settings-view").addEventListener("touchend", e => {
  if (!settingsSwipeActive) return;
  settingsSwipeActive = false;
  const dx = e.changedTouches[0].clientX - settingsSwipeX;
  const dy = Math.abs(e.changedTouches[0].clientY - settingsSwipeY);
  if (dx > 60 && dy < 80) {
    if ($("settings-view").dataset.pane === "detail") settingsBackToList();
    else closeSettings();
  }
}, { passive: true });

// Block pinch-to-zoom on iOS Safari (gesture events) — touch-action handles the rest.
// Does not affect text selection (gesture events are pinch/rotate only).
["gesturestart", "gesturechange", "gestureend"].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

$("date-display-picker").addEventListener("click", e => {
  const btn = e.target.closest("[data-value]");
  if (!btn) return;
  state.dateDisplay = btn.dataset.value;
  localStorage.setItem("dateDisplay", state.dateDisplay);
  updateDatePicker();
  renderNotesList();
});

$("recents-range-picker").addEventListener("click", e => {
  const btn = e.target.closest("[data-value]");
  if (!btn) return;
  state.recentsRange = btn.dataset.value;
  localStorage.setItem("recentsRange", state.recentsRange);
  updateRecentsRangePicker();
  if (state.context.type === "recents") paneTitle.textContent = recentsPaneTitle();
  renderNotesList();
});

// Settings category clicks
document.querySelectorAll(".settings-cat-item").forEach(btn => {
  btn.addEventListener("click", () => openSettingsSection(btn.dataset.section));
});

const PENCIL_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const CHECK_SVG  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const X_SVG      = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

async function doRenameTag(oldName) {
  const input = $("settings-tags-list").querySelector(".settings-tag-rename-input");
  if (!input) return;
  const newName = input.value.replace(/[,#]/g, "").trim().toLowerCase();
  editingTag = null;
  if (newName && newName !== oldName) {
    await api("PUT", `/api/tags/${encodeURIComponent(oldName)}`, { name: newName });
    if (state.context.type === "tag" && state.context.id === oldName) {
      state.context.id = newName;
      state.context.label = "#" + newName;
      paneTitle.textContent = "#" + newName;
    }
    // Update pinnedTags if the renamed tag was pinned
    const pinIdx = state.pinnedTags.indexOf(oldName);
    if (pinIdx !== -1) {
      state.pinnedTags[pinIdx] = newName;
      await savePinnedTags();
    }
    state.tags = await api("GET", "/api/tags");
    renderSidebar();
    await loadNotes();
    showToast(`Tag renamed to "#${newName}"`);
  }
  renderSettingsTags();
}

function renderSettingsTags() {
  const list = $("settings-tags-list");
  if (!state.tags.length) {
    list.innerHTML = `<p class="settings-empty">No tags yet.</p>`;
    return;
  }
  list.innerHTML = state.tags.map(tag => {
    if (editingTag === tag.name) {
      return `<div class="settings-tag-item" data-tag="${esc(tag.name)}">
        <input class="settings-tag-rename-input" value="${esc(tag.name)}" data-old-tag="${esc(tag.name)}">
        <button class="settings-tag-confirm-btn" data-tag="${esc(tag.name)}" title="Save">${CHECK_SVG}</button>
        <button class="settings-tag-cancel-btn" title="Cancel">${X_SVG}</button>
      </div>`;
    }
    return `<div class="settings-tag-item">
      <span class="settings-tag-name">#${esc(tag.name)}</span>
      <span class="settings-tag-count">${tag.count} note${tag.count !== 1 ? "s" : ""}</span>
      <button class="settings-tag-edit" data-tag="${esc(tag.name)}" title="Rename tag">${PENCIL_SVG}</button>
      <button class="settings-tag-delete" data-tag="${esc(tag.name)}" title="Delete tag">${X_SVG}</button>
    </div>`;
  }).join("");

  list.querySelectorAll(".settings-tag-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      editingTag = btn.dataset.tag;
      renderSettingsTags();
      const input = list.querySelector(".settings-tag-rename-input");
      if (input) { input.focus(); input.select(); }
    });
  });

  list.querySelectorAll(".settings-tag-confirm-btn").forEach(btn => {
    btn.addEventListener("click", () => doRenameTag(btn.dataset.tag));
  });

  list.querySelectorAll(".settings-tag-cancel-btn").forEach(btn => {
    btn.addEventListener("click", () => { editingTag = null; renderSettingsTags(); });
  });

  const renameInput = list.querySelector(".settings-tag-rename-input");
  if (renameInput) {
    renameInput.addEventListener("keydown", e => {
      if (e.key === "Enter")  { e.preventDefault(); doRenameTag(renameInput.dataset.oldTag); }
      if (e.key === "Escape") { editingTag = null; renderSettingsTags(); }
    });
  }

  list.querySelectorAll(".settings-tag-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tagName = btn.dataset.tag;
      if (!confirm(`Delete "#${tagName}" from all notes?`)) return;
      await api("DELETE", `/api/tags/${encodeURIComponent(tagName)}`);
      // Remove from pinned if pinned
      state.pinnedTags = state.pinnedTags.filter(t => t !== tagName);
      await savePinnedTags();
      state.tags = await api("GET", "/api/tags");
      renderSidebar();
      renderSettingsTags();
      await loadNotes();
      showToast(`Tag "#${tagName}" deleted`);
    });
  });
}

$("settings-btn").addEventListener("click", openSettings);
$("settings-folders-toggle").addEventListener("click", () => {
  state.showFolders = !state.showFolders;
  localStorage.setItem("showFolders", state.showFolders);
  $("settings-folders-toggle").classList.toggle("on", state.showFolders);
  updateFoldersVisibility();
});
$("settings-dates-toggle").addEventListener("click", () => {
  state.showNoteDates = !state.showNoteDates;
  localStorage.setItem("showNoteDates", state.showNoteDates);
  $("settings-dates-toggle").classList.toggle("on", state.showNoteDates);
  renderNoteDates(state.note);   // reflect immediately on the open note
});
$("settings-formatbar-toggle").addEventListener("click", () => {
  formatBarOpen = !formatBarOpen;               // same preference the header "T" toggle uses
  localStorage.setItem("formatBarOpen", formatBarOpen);
  $("settings-formatbar-toggle").classList.toggle("on", formatBarOpen);
  applyFormatBar();
});

// ── Sidebar rendering ─────────────────────────────────────────────────────────

const PIN_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
const PIN_OUTLINE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

async function savePinnedTags() {
  localStorage.setItem("pinnedTags", JSON.stringify(state.pinnedTags));
  await api("PUT", "/api/settings/pinnedTags", { value: JSON.stringify(state.pinnedTags) });
}

async function pinTag(tagName) {
  if (state.pinnedTags.includes(tagName)) return;
  if (state.pinnedTags.length >= 5) { showToast("Max 5 pinned tags"); return; }
  state.pinnedTags.push(tagName);
  await savePinnedTags();
  renderSidebar();
}

async function unpinTag(tagName) {
  state.pinnedTags = state.pinnedTags.filter(t => t !== tagName);
  await savePinnedTags();
  renderSidebar();
}

function renderTimeline() {
  const chev = $("timeline-chev");
  const list = $("timeline-list");
  if (chev) chev.classList.toggle("open", state.timelineExpanded);
  list.innerHTML = "";
  if (!state.timelineExpanded || !state.noteYears.length) return;
  state.noteYears.forEach(({ year, count }) => {
    const btn = document.createElement("button");
    btn.className = "year-nav-item" + (state.context.type === "year" && state.context.id === year ? " active" : "");
    btn.innerHTML = `${year}<span class="year-note-count">${count}</span>`;
    btn.addEventListener("click", () => navigateToYear(year));
    list.appendChild(btn);
  });
}

function renderPinnedTags() {
  const chev = $("pinned-tags-chev");
  const list = $("pinned-tags-list");
  if (chev) chev.classList.toggle("open", state.pinnedTagsExpanded);
  list.innerHTML = "";
  if (!state.pinnedTagsExpanded) return;
  const pinned = state.pinnedTags.filter(name => state.tags.some(t => t.name === name));
  if (!pinned.length) {
    list.innerHTML = `<div class="sidebar-empty">No pinned tags yet</div>`;
    return;
  }
  pinned.forEach(name => {
    const tag = state.tags.find(t => t.name === name);
    if (!tag) return;
    const isActive = state.context.type === "tag" && state.context.id === name;
    const btn = document.createElement("button");
    btn.className = "tag-nav-item" + (isActive ? " active" : "");
    btn.innerHTML = `<button class="tag-pin-btn pinned tag-pin-left" title="Unpin">${PIN_SVG}</button><span class="tag-hash">#</span>${esc(name)}<span class="tag-right"><span class="tag-count">${tag.count}</span></span>`;
    btn.addEventListener("click", () => navigateToTag(name));
    btn.querySelector(".tag-pin-btn").addEventListener("click", e => {
      e.stopPropagation();
      unpinTag(name);
    });
    list.appendChild(btn);
  });
}

function renderAllTags() {
  const chev = $("all-tags-chev");
  const list = $("all-tags-list");
  const countEl = $("all-tags-count");
  // Tags is the full index of every tag; the Pinned section above is just a
  // filtered shortcut. So list all tags here — pinned ones appear in both,
  // each showing the correct pin/unpin control.
  if (countEl) countEl.textContent = state.tags.length || "";
  if (chev) chev.classList.toggle("open", state.allTagsExpanded);
  list.innerHTML = "";
  const section = $("all-tags-section");
  if (section) section.style.display = !state.tags.length ? "none" : "";
  if (!state.allTagsExpanded || !state.tags.length) return;
  state.tags.forEach(tag => {
    const isPinned = state.pinnedTags.includes(tag.name);
    const isActive = state.context.type === "tag" && state.context.id === tag.name;
    const btn = document.createElement("button");
    btn.className = "tag-nav-item" + (isActive ? " active" : "");
    // Pin sits to the left, same as the Pinned section, for a consistent look.
    const pinBtn = isPinned
      ? `<button class="tag-pin-btn pinned tag-pin-left" title="Unpin">${PIN_SVG}</button>`
      : `<button class="tag-pin-btn tag-pin-left" title="Pin">${PIN_OUTLINE_SVG}</button>`;
    btn.innerHTML = `${pinBtn}<span class="tag-hash">#</span>${esc(tag.name)}<span class="tag-right"><span class="tag-count">${tag.count}</span></span>`;
    btn.addEventListener("click", () => navigateToTag(tag.name));
    btn.querySelector(".tag-pin-btn").addEventListener("click", e => {
      e.stopPropagation();
      isPinned ? unpinTag(tag.name) : pinTag(tag.name);
    });
    list.appendChild(btn);
  });
}

function renderSidebar() {
  renderTimeline();
  renderPinnedTags();
  renderAllTags();
  renderFolderTree();
  updateFoldersVisibility();
}

function updateFoldersVisibility() {
  const section = $("folders-section");
  const folderBtn = $("new-folder-btn");
  if (section) section.style.display = state.showFolders ? "" : "none";
  if (folderBtn) folderBtn.style.display = state.showFolders ? "" : "none";
}

// Toggle handlers for sidebar sections
$("timeline-toggle").addEventListener("click", () => {
  state.timelineExpanded = !state.timelineExpanded;
  localStorage.setItem("timelineExpanded", state.timelineExpanded);
  renderTimeline();
});
$("pinned-tags-toggle").addEventListener("click", () => {
  state.pinnedTagsExpanded = !state.pinnedTagsExpanded;
  localStorage.setItem("pinnedTagsExpanded", state.pinnedTagsExpanded);
  renderPinnedTags();
});
$("all-tags-toggle").addEventListener("click", () => {
  state.allTagsExpanded = !state.allTagsExpanded;
  localStorage.setItem("allTagsExpanded", state.allTagsExpanded);
  renderAllTags();
});

// ── Mobile view ───────────────────────────────────────────────────────────────

function setMobileView(view) {
  state.mobileView = view;
  appEl.dataset.view = view;
  if (window.innerWidth <= 768 && view !== 'editor') {
    noteBody.blur();
    // blur() alone doesn't collapse the text selection — window.getSelection()
    // is document-level, not tied to focus. Without clearing it too, the
    // selectionchange listener still sees a live selection inside noteBody
    // moments later and calls showFormatBar() again, undoing hideFormatBar()
    // and leaving the floating bar stranded over the notes list.
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    hideFormatBar();
  }
}

$("notes-back-btn").addEventListener("click", () => {
  if (state.navHistory.length > 0) {
    const prev = state.navHistory.pop();
    state.context = prev;
    paneTitle.textContent = prev.label;
    if (prev.type === "all")     setActiveNav(navAllNotes);
    else if (prev.type === "recents") setActiveNav(navRecents);
    else setActiveNav(null);
    renderSidebar();
    loadNotes();
  } else {
    setMobileView("sidebar");
  }
});
$("editor-back-btn").addEventListener("click", async () => {
  await saveNoteNow();
  state.note = null;
  state.dirty = false;
  clearTimeout(saveTimer);
  setMobileView("notes");
  renderNotesList();
  showEditorEmpty();
});

// ── Swipe-back gesture ────────────────────────────────────────────────────────

let swipeStartX = 0, swipeStartY = 0, swipeActive = false;

appEl.addEventListener("touchstart", e => {
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
  swipeActive = swipeStartX < 32;
}, { passive: true });

appEl.addEventListener("touchend", e => {
  if (!swipeActive) return;
  swipeActive = false;
  const dx = e.changedTouches[0].clientX - swipeStartX;
  const dy = Math.abs(e.changedTouches[0].clientY - swipeStartY);
  if (dx > 60 && dy < 80) {
    if (state.mobileView === "editor") {
      saveNoteNow();
      state.note = null;
      setMobileView("notes");
      renderNotesList();
      showEditorEmpty();
    } else if (state.mobileView === "notes") {
      setMobileView("sidebar");
    }
  }
}, { passive: true });

// ── Search (runs on Enter; clear button resets) ────────────────────────────────

function updateSearchClear() {
  $("search-clear").classList.toggle("hidden", !searchInput.value);
}

function runSearch() {
  const q = searchInput.value.trim();
  state.searchQuery = q;
  if (!q) { clearSearch(); return; }
  state.context = { type: "search", id: null, label: "Search" };
  setActiveNav(null);
  renderSidebar();
  setMobileView("notes");
  notesList.scrollTop = 0;
  loadNotes().then(() => {
    const n = state.notes.length;
    paneTitle.textContent = `${n} result${n === 1 ? "" : "s"}`;
  });
}

function clearSearch() {
  searchInput.value = "";
  state.searchQuery = "";
  updateSearchClear();
  state.context = { type: "all", id: null, label: "All Notes" };
  paneTitle.textContent = "All Notes";
  setActiveNav(navAllNotes);
  renderSidebar();
  loadNotes();
  notesList.scrollTop = 0;
}

searchInput.addEventListener("input", updateSearchClear);
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); runSearch(); }
});
$("search-clear").addEventListener("click", () => { clearSearch(); searchInput.focus(); });

// ── Folder tree ───────────────────────────────────────────────────────────────

function buildTree(folders, parentId = null) {
  return folders
    .filter(f => (f.parent_id || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => ({ ...f, children: buildTree(folders, f.id) }));
}

function getDescendantIds(folderId) {
  const ids = new Set([folderId]);
  const queue = [folderId];
  while (queue.length) {
    const pid = queue.shift();
    state.folders.filter(f => f.parent_id === pid).forEach(f => {
      ids.add(f.id);
      queue.push(f.id);
    });
  }
  return ids;
}

let activeFolderCtxMenu = null;

function openFolderCtxMenu(node, anchor) {
  if (activeFolderCtxMenu) { activeFolderCtxMenu.remove(); activeFolderCtxMenu = null; return; }
  const menu = document.createElement("div");
  menu.className = "folder-ctx-menu";
  menu.innerHTML = `
    <button data-action="new">New subfolder</button>
    <button data-action="rename">Rename</button>
    <button data-action="move">Move to…</button>
    <button data-action="delete" class="danger">Delete folder</button>
  `;
  const rect = anchor.getBoundingClientRect();
  menu.style.top  = (rect.bottom + 6) + "px";
  menu.style.right = (window.innerWidth - rect.right + 4) + "px";
  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    menu.remove(); activeFolderCtxMenu = null;
    const a = btn.dataset.action;
    if (a === "new")    openFolderModal(null, node.id);
    if (a === "rename") openFolderModal(node);
    if (a === "move")   openFolderMoveModal(node);
    if (a === "delete") deleteFolder(node);
  });
  document.body.appendChild(menu);
  activeFolderCtxMenu = menu;
  setTimeout(() => document.addEventListener("click", () => {
    menu.remove(); activeFolderCtxMenu = null;
  }, { once: true }), 10);
}

const FOLDER_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
const CHEV_SVG  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

function renderFolderNode(node, depth = 0) {
  const isOpen    = state.expandedFolders.has(node.id);
  const isActive  = state.context.type === "folder" && state.context.id === node.id;
  const hasChildren = node.children.length > 0;

  const row = document.createElement("div");
  row.className = "folder-row" + (isActive ? " active" : "");
  row.dataset.folderId = node.id;
  row.style.paddingLeft = (depth * 12) + "px";

  if (hasChildren) {
    const toggle = document.createElement("button");
    toggle.className = "folder-toggle" + (isOpen ? " open" : "");
    toggle.innerHTML = CHEV_SVG;
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      if (state.expandedFolders.has(node.id)) {
        state.expandedFolders.delete(node.id);
      } else {
        state.expandedFolders.add(node.id);
      }
      localStorage.setItem("expandedFolders", JSON.stringify([...state.expandedFolders]));
      renderFolderTree();
    });
    row.appendChild(toggle);
  } else {
    const spacer = document.createElement("div");
    spacer.className = "folder-toggle-spacer";
    row.appendChild(spacer);
  }

  const btn = document.createElement("button");
  btn.className = "folder-btn";
  btn.innerHTML = FOLDER_SVG + `<span class="folder-name">${esc(node.name)}</span>`;
  btn.addEventListener("click", () => navigateToFolder(node));
  row.appendChild(btn);

  const kebab = document.createElement("button");
  kebab.className = "folder-kebab";
  kebab.title = "Folder options";
  kebab.innerHTML = `<svg width="3" height="13" viewBox="0 0 3 13" fill="currentColor"><circle cx="1.5" cy="1.5" r="1.5"/><circle cx="1.5" cy="6.5" r="1.5"/><circle cx="1.5" cy="11.5" r="1.5"/></svg>`;
  kebab.addEventListener("click", e => { e.stopPropagation(); openFolderCtxMenu(node, kebab); });
  row.appendChild(kebab);

  const wrapper = document.createElement("div");
  wrapper.appendChild(row);

  if (hasChildren && isOpen) {
    const children = document.createElement("div");
    children.className = "folder-children";
    node.children.forEach(child => children.appendChild(renderFolderNode(child, depth)));
    wrapper.appendChild(children);
  }

  return wrapper;
}

function renderFolderTree() {
  const tree = buildTree(state.folders);
  folderTree.innerHTML = "";
  tree.forEach(node => folderTree.appendChild(renderFolderNode(node)));
}

// ── Navigation ────────────────────────────────────────────────────────────────

function setActiveNav(el) {
  document.querySelectorAll(".nav-item.active").forEach(e => e.classList.remove("active"));
  if (el) el.classList.add("active");
}

function navigateToFolder(folder, pushHistory = false) {
  if (pushHistory) {
    state.navHistory.push({ ...state.context });
  } else {
    state.navHistory = [];
  }
  state.context = { type: "folder", id: folder.id, label: folder.name };
  paneTitle.textContent = folder.name;
  state.expandedFolders.add(folder.id);
  localStorage.setItem("expandedFolders", JSON.stringify([...state.expandedFolders]));
  setActiveNav(null);
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
}

function navigateToTag(tagName) {
  state.navHistory = [];
  state.context = { type: "tag", id: tagName, label: "#" + tagName };
  paneTitle.textContent = "#" + tagName;
  setActiveNav(null);
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
}

function navigateToYear(year) {
  state.navHistory = [];
  state.context = { type: "year", id: year, label: String(year) };
  paneTitle.textContent = String(year);
  setActiveNav(null);
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
}

function navigateToTrash() {
  if (state.dirty) saveNoteNow();
  if (state.selectMode) exitSelectMode();
  state.navHistory = [];
  state.context = { type: "trash", id: null, label: "Trash" };
  paneTitle.textContent = "Trash";
  setActiveNav($("nav-trash"));
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
}

navAllNotes.addEventListener("click", () => {
  state.navHistory = [];
  state.context = { type: "all", id: null, label: "All Notes" };
  state.searchQuery = "";
  searchInput.value = "";
  updateSearchClear();
  paneTitle.textContent = "All Notes";
  setActiveNav(navAllNotes);
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
});

const RECENTS_RANGE_LABEL = { day: "Past day", week: "Past week", month: "Past month" };
function recentsPaneTitle() {
  return `Recents · ${RECENTS_RANGE_LABEL[state.recentsRange] || RECENTS_RANGE_LABEL.week}`;
}

navRecents.addEventListener("click", () => {
  state.navHistory = [];
  state.context = { type: "recents", id: null, label: "Recents" };
  state.searchQuery = "";
  searchInput.value = "";
  updateSearchClear();
  paneTitle.textContent = recentsPaneTitle();
  setActiveNav(navRecents);
  renderSidebar();
  loadNotes();
  setMobileView("notes");
  notesList.scrollTop = 0;
});

$("nav-trash").addEventListener("click", navigateToTrash);

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadAll() {
  const [folders, tags, all, trash, pinnedTagsSetting, themeSetting] = await Promise.all([
    api("GET", "/api/folders"),
    api("GET", "/api/tags"),
    api("GET", "/api/notes"),
    api("GET", "/api/trash"),
    api("GET", "/api/settings/pinnedTags"),
    api("GET", "/api/settings/activeTheme"),
  ]);
  if (pinnedTagsSetting.value != null) {
    state.pinnedTags = JSON.parse(pinnedTagsSetting.value);
    localStorage.setItem("pinnedTags", JSON.stringify(state.pinnedTags));
  } else if (state.pinnedTags.length) {
    // Server has no record yet — bootstrap from this device's localStorage
    await savePinnedTags();
  }
  if (themeSetting.value) {
    try {
      const theme = JSON.parse(themeSetting.value);
      applyTheme(theme);
      localStorage.setItem("activeTheme", JSON.stringify(theme));
    } catch {}
  } else {
    const local = localStorage.getItem("activeTheme");
    if (local) { try { applyTheme(JSON.parse(local)); } catch {} }
  }
  state.folders = folders;
  state.tags = tags;
  allNotesCount.textContent = all.length || "";

  state.trashCount = trash.length;
  const trashCountEl = $("trash-count");
  if (trashCountEl) trashCountEl.textContent = trash.length || "";

  // Compute years + counts from all notes
  const yearCounts = {};
  all.forEach(n => {
    const y = new Date(n.created_at).getFullYear();
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  });
  state.noteYears = Object.entries(yearCounts)
    .sort((a, b) => b[0] - a[0])
    .map(([year, count]) => ({ year: parseInt(year), count }));

  renderSidebar();
  await loadNotes();
}

async function loadNotes() {
  if (state.context.type === "trash") {
    state.notes = await api("GET", "/api/trash");
    state.tagTrashedNotes = [];
    renderNotesList();
    return;
  }
  const params = new URLSearchParams();
  if (state.context.type === "folder") params.set("folder_id", state.context.id);
  if (state.context.type === "tag")    params.set("tag", state.context.id);
  if (state.context.type === "year")   params.set("year", state.context.id);
  if (state.searchQuery)               params.set("q", state.searchQuery);

  if (state.context.type === "tag") {
    const [liveNotes, trashedNotes] = await Promise.all([
      api("GET", `/api/notes?${params}`),
      api("GET", `/api/trash?tag=${encodeURIComponent(state.context.id)}`),
    ]);
    state.notes = liveNotes;
    state.tagTrashedNotes = trashedNotes;
  } else {
    state.tagTrashedNotes = [];
    state.notes = await api("GET", `/api/notes?${params}`);
  }
  renderNotesList();
}

// ── Sort ──────────────────────────────────────────────────────────────────────

const RECENTS_RANGE_MS = { day: 86400000, week: 7 * 86400000, month: 30 * 86400000 };

function sortedNotes() {
  const notes = [...state.notes];
  if (state.context.type === "recents") {
    const cutoff = Date.now() - (RECENTS_RANGE_MS[state.recentsRange] || RECENTS_RANGE_MS.week);
    return notes
      .filter(n => new Date(n.updated_at).getTime() >= cutoff)
      .sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  }
  switch (state.sortBy) {
    case "updated_asc":  return notes.sort((a,b) => a.updated_at.localeCompare(b.updated_at));
    case "created_desc": return notes.sort((a,b) => b.created_at.localeCompare(a.created_at));
    case "created_asc":  return notes.sort((a,b) => a.created_at.localeCompare(b.created_at));
    default:             return notes.sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  }
}

const sortMenu    = $("sort-menu");
const newItemMenu = $("new-item-menu");

$("sort-btn").addEventListener("click", e => {
  e.stopPropagation();
  newItemMenu.classList.add("hidden");
  sortMenu.classList.toggle("hidden");
});

sortMenu.querySelectorAll("[data-sort]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sortBy = btn.dataset.sort;
    localStorage.setItem("sortBy", state.sortBy);
    sortMenu.classList.add("hidden");
    updateSortUI();
    renderNotesList();
  });
});

function updateSortUI() {
  sortMenu.querySelectorAll("[data-sort]").forEach(btn => {
    btn.classList.toggle("active-sort", btn.dataset.sort === state.sortBy);
  });
}

// ── New item dropdown ─────────────────────────────────────────────────────────

$("new-note-btn").addEventListener("click", e => {
  e.stopPropagation();
  if (state.context.type === "folder") {
    sortMenu.classList.add("hidden");
    newItemMenu.classList.toggle("hidden");
  } else {
    newNote();
  }
});

$("new-note-option").addEventListener("click", () => { newItemMenu.classList.add("hidden"); newNote(); });
$("new-subfolder-option").addEventListener("click", () => {
  newItemMenu.classList.add("hidden");
  openFolderModal(null, state.context.type === "folder" ? state.context.id : null);
});

document.addEventListener("click", () => {
  sortMenu.classList.add("hidden");
  newItemMenu.classList.add("hidden");
});
sortMenu.addEventListener("click", e => e.stopPropagation());
newItemMenu.addEventListener("click", e => e.stopPropagation());

// ── Pane search ───────────────────────────────────────────────────────────────

let paneSearchTimer;
$("pane-search-input").addEventListener("input", e => {
  clearTimeout(paneSearchTimer);
  paneSearchTimer = setTimeout(() => {
    state.paneSearchQuery = e.target.value.trim();
    renderNotesList();
  }, 200);
});

// ── Notes list ────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const date = new Date(iso);
  const diff = (Date.now() - date) / 1000;
  if (diff < 60)   return "just now";
  const m = Math.floor(diff / 60);
  if (m < 60)      return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24)      return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7)       return d + "d ago";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

const CHEV_RIGHT_SVG = `<svg class="folder-list-item-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

function renderNotesList() {
  // Toggle pane context class for trash-specific UI hiding
  notesPaneEl.dataset.ctx = state.context.type === "trash" ? "trash" : "";

  // ── Trash context ──────────────────────────────────────────────────────
  if (state.context.type === "trash") {
    const trash = state.notes;
    if (!trash.length) {
      notesList.innerHTML = `<div class="notes-empty">Trash is empty.</div>`;
      return;
    }
    const now = Date.now();
    notesList.innerHTML = trash.map(n => {
      const deletedAt = new Date(n.deleted_at);
      const daysGone = Math.floor((now - deletedAt) / 86400000);
      const daysLeft = Math.max(0, 30 - daysGone);
      const deletedStr = daysGone === 0 ? "Deleted today" : `Deleted ${daysGone}d ago`;
      const leftStr = daysLeft === 0 ? "expires soon" : `${daysLeft}d left`;
      const preview = (n.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
      const isActive = state.note && state.note.id === n.id;
      return `
        <div class="note-item trash-note-item${isActive ? " active" : ""}" data-note-id="${n.id}">
          <div class="note-item-title${n.title ? "" : " untitled"}">${n.title ? esc(n.title) : "Untitled"}</div>
          ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ""}
          <div class="trash-note-footer">
            <span class="trash-note-time">${deletedStr} · ${leftStr}</span>
            <div class="trash-note-actions">
              <button class="trash-restore-btn" data-id="${n.id}">Restore</button>
              <button class="trash-delete-btn" data-id="${n.id}">Delete</button>
            </div>
          </div>
        </div>`;
    }).join("");

    notesList.querySelectorAll(".trash-note-item").forEach(el => {
      el.addEventListener("click", e => {
        if (e.target.closest(".trash-note-actions")) return;
        const n = state.notes.find(n => n.id === el.dataset.noteId);
        if (n) openNote(n);
      });
    });
    notesList.querySelectorAll(".trash-restore-btn").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); restoreNote(btn.dataset.id); });
    });
    notesList.querySelectorAll(".trash-delete-btn").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); permanentDeleteNote(btn.dataset.id); });
    });
    return;
  }

  const subfolders = state.context.type === "folder"
    ? state.folders.filter(f => f.parent_id === state.context.id).sort((a,b) => a.name.localeCompare(b.name))
    : [];

  let notes = sortedNotes();
  if (state.paneSearchQuery) {
    const q = state.paneSearchQuery.toLowerCase();
    notes = notes.filter(n =>
      (n.title || "").toLowerCase().includes(q) ||
      (n.body  || "").toLowerCase().includes(q)
    );
  }

  if (!subfolders.length && !notes.length && !state.tagTrashedNotes.length) {
    notesList.innerHTML = state.context.type === "search"
      ? `<div class="notes-empty">No results for &ldquo;${esc(state.searchQuery)}&rdquo;.</div>`
      : `<div class="notes-empty">No notes yet.<br>Tap <strong>+</strong> to create one.</div>`;
    return;
  }

  let html = "";

  if (subfolders.length) {
    const isExp = state.subfoldersExpanded;
    html += `<button class="subfolder-section-toggle" id="subfolder-toggle">
      <svg class="subfolder-toggle-chev${isExp ? " open" : ""}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      Subfolders
      <span class="subfolder-section-count">${subfolders.length}</span>
    </button>`;
    if (isExp) {
      html += subfolders.map(f => `
        <div class="folder-list-item" data-folder-id="${f.id}">
          ${FOLDER_SVG}
          <span class="folder-list-item-name">${esc(f.name)}</span>
          ${CHEV_RIGHT_SVG}
        </div>`).join("");
    }
    if (notes.length) html += `<div class="notes-section-label">Notes</div>`;
  }

  html += notes.map(n => {
    const isActive   = !state.selectMode && state.note && state.note.id === n.id;
    const isSelected = state.selectMode && state.selectedNoteIds.has(n.id);
    const preview  = (n.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    const chips    = n.tags.map(t => `<span class="note-tag-chip">#${esc(t)}</span>`).join("");
    const dateStr = timeAgo(state.dateDisplay === "updated" ? n.updated_at : n.created_at);
    return `
      <div class="note-item${isActive ? " active" : ""}${isSelected ? " selected" : ""}" data-note-id="${n.id}">
        ${state.selectMode ? `<input type="checkbox" class="note-checkbox"${isSelected ? " checked" : ""}>` : ""}
        <div class="note-item-title${n.title ? "" : " untitled"}">${n.title ? esc(n.title) : "Untitled"}</div>
        ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ""}
        ${chips ? `<div class="note-item-tags">${chips}</div>` : ""}
        <div class="note-item-meta">${dateStr}</div>
      </div>`;
  }).join("");

  if (state.tagTrashedNotes.length) {
    html += `<div class="notes-section-label notes-trash-divider">In Trash</div>`;
    html += state.tagTrashedNotes.map(n => {
      const preview = (n.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
      return `
        <div class="note-item note-item-trashed" data-note-id="${n.id}">
          <div class="note-item-title${n.title ? "" : " untitled"}">${n.title ? esc(n.title) : "Untitled"}</div>
          ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ""}
          <div class="note-item-meta note-item-meta-trash">
            <span>In Trash</span>
            <button class="tag-trash-restore-btn" data-id="${n.id}">Restore</button>
          </div>
        </div>`;
    }).join("");
  }

  notesList.innerHTML = html;

  const subfToggle = $("subfolder-toggle");
  if (subfToggle) {
    subfToggle.addEventListener("click", () => {
      state.subfoldersExpanded = !state.subfoldersExpanded;
      localStorage.setItem("subfoldersExpanded", state.subfoldersExpanded);
      renderNotesList();
    });
  }

  notesList.querySelectorAll(".folder-list-item").forEach(el => {
    el.addEventListener("click", () => {
      const f = state.folders.find(f => f.id === el.dataset.folderId);
      if (f) navigateToFolder(f, true);
    });
  });

  notesList.querySelectorAll(".note-item").forEach(el => {
    el.addEventListener("contextmenu", e => {
      e.preventDefault();
      const n = state.notes.find(n => n.id === el.dataset.noteId);
      if (n) showNoteCtxMenu(n, e.clientX, e.clientY);
    });
    el.addEventListener("click", () => {
      const n = state.notes.find(n => n.id === el.dataset.noteId);
      if (!n) return;
      if (state.selectMode) {
        if (state.selectedNoteIds.has(n.id)) {
          state.selectedNoteIds.delete(n.id);
          el.classList.remove("selected");
        } else {
          state.selectedNoteIds.add(n.id);
          el.classList.add("selected");
        }
        const cb = el.querySelector(".note-checkbox");
        if (cb) cb.checked = state.selectedNoteIds.has(n.id);
        updateBulkCount();
      } else {
        openNote(n);
      }
    });
  });

  notesList.querySelectorAll(".note-item-trashed").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".tag-trash-restore-btn")) return;
      const n = state.tagTrashedNotes.find(n => n.id === el.dataset.noteId);
      if (n) openNote(n);
    });
  });
  notesList.querySelectorAll(".tag-trash-restore-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); restoreNote(btn.dataset.id); });
  });
}

// ── Editor ────────────────────────────────────────────────────────────────────

const toolbarBtns = [$("editor-back-btn"), $("editor-save-btn"), $("editor-menu-btn")];

function formatDateFull(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function renderNoteDates(note) {
  const el = $("note-dates");
  if (!note || !note.id || !state.showNoteDates) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const editedDiff = new Date(note.updated_at) - new Date(note.created_at);
  const showEdited = editedDiff > 60000;
  el.innerHTML = `
    <div class="note-date-item">
      <span class="note-date-label">Created</span>
      <span>${formatDateFull(note.created_at)}</span>
    </div>
    ${showEdited ? `<div class="note-date-item">
      <span class="note-date-label">Edited</span>
      <span>${formatDateFull(note.updated_at)}</span>
    </div>` : ""}
  `;
}

function showEditorEmpty() {
  editorBody.classList.add("hidden");
  editorEmpty.classList.remove("hidden");
  toolbarBtns.forEach(b => b.style.visibility = "hidden");
}

function showEditorBody() {
  editorBody.classList.remove("hidden");
  editorEmpty.classList.add("hidden");
  toolbarBtns.forEach(b => b.style.visibility = "");
}

const isMobile = () => window.innerWidth <= 768;

async function openNote(note) {
  if (state.dirty) await saveNoteNow();
  state.note = note;
  noteTitle.value = note.title || "";
  noteBody.innerHTML = "";
  bodyPlaceholder.classList.remove("hidden");
  renderTagChips(note.tags || []);
  renderNoteDates(note);
  setAutosave("");
  state.dirty = false;

  const inTrash = !!note.deleted_at;
  $("trash-banner").classList.toggle("hidden", !inTrash);
  noteTitle.readOnly = inTrash;
  noteBody.contentEditable = inTrash ? "false" : "true";
  tagInput.disabled = inTrash;

  showEditorBody();
  renderNotesList();
  requestAnimationFrame(() => {
    noteBody.innerHTML = bodyToHtml(note.body || "");
    decorateLinks();
    bodyPlaceholder.classList.toggle("hidden", (note.body || "").trim().length > 0);
    setMobileView("editor");
    autosizeTitle();
    if (!isMobile() && !inTrash) {
      noteBody.focus();
      const sel = window.getSelection();
      if (sel && noteBody.firstChild) {
        const range = document.createRange();
        range.setStart(noteBody, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    editorBody.scrollTop = 0;
  });
}

function renderTagChips(tags) {
  tagsChips.innerHTML = tags.map(t => `
    <span class="editor-tag-chip">
      #${esc(t)}
      <button data-tag="${esc(t)}" title="Remove tag">×</button>
    </span>`).join("");
  tagsChips.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => removeTag(btn.dataset.tag));
  });
}

function currentTags() {
  return [...tagsChips.querySelectorAll(".editor-tag-chip")].map(el => {
    return el.textContent.trim().replace(/^#/, "").replace("×", "").trim();
  });
}

function removeTag(tagName) {
  const tags = currentTags().filter(t => t !== tagName);
  renderTagChips(tags);
  scheduleSave();
}

const tagSuggestionsEl = $("tag-suggestions");
let tagSuggestionIndex = -1;

function hideSuggestions() {
  tagSuggestionsEl.classList.add("hidden");
  tagSuggestionsEl.innerHTML = "";
  tagSuggestionIndex = -1;
}

function highlightTagSuggestion(items) {
  items.forEach((btn, i) => btn.classList.toggle("active", i === tagSuggestionIndex));
  if (tagSuggestionIndex >= 0) items[tagSuggestionIndex].scrollIntoView({ block: "nearest" });
}

function addTag(val) {
  val = val.replace(/[,#]/g, "").trim().toLowerCase();
  if (val && !currentTags().includes(val)) {
    renderTagChips([...currentTags(), val]);
    scheduleSave();
  }
  tagInput.value = "";
  hideSuggestions();
}

tagInput.addEventListener("input", () => {
  tagSuggestionIndex = -1;
  const val = tagInput.value.trim().toLowerCase();
  if (!val) { hideSuggestions(); return; }

  const already = new Set(currentTags());
  const matches = state.tags
    .map(t => t.name)
    .filter(name => name.includes(val) && !already.has(name))
    .slice(0, 8);

  if (!matches.length) { hideSuggestions(); return; }

  tagSuggestionsEl.innerHTML = matches.map(name =>
    `<button class="tag-suggestion-item" data-tag="${esc(name)}">#${esc(name)}</button>`
  ).join("");
  tagSuggestionsEl.classList.remove("hidden");

  tagSuggestionsEl.querySelectorAll(".tag-suggestion-item").forEach((btn, i) => {
    btn.addEventListener("mousedown", e => {
      e.preventDefault();
      addTag(btn.dataset.tag);
    });
    btn.addEventListener("mouseenter", () => {
      tagSuggestionIndex = i;
      highlightTagSuggestion([...tagSuggestionsEl.querySelectorAll(".tag-suggestion-item")]);
    });
  });
});

tagInput.addEventListener("keydown", e => {
  const items = [...tagSuggestionsEl.querySelectorAll(".tag-suggestion-item")];

  if (items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    tagSuggestionIndex = e.key === "ArrowDown"
      ? (tagSuggestionIndex + 1) % items.length
      : (tagSuggestionIndex - 1 + items.length) % items.length;
    highlightTagSuggestion(items);
    return;
  }

  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    if (items.length && tagSuggestionIndex >= 0) {
      addTag(items[tagSuggestionIndex].dataset.tag);
    } else {
      const val = tagInput.value.replace(/,/g, "").trim().toLowerCase();
      addTag(val);
    }
    return;
  }
  if (e.key === "Escape") { hideSuggestions(); tagInput.value = ""; }
  if (e.key === "Backspace" && !tagInput.value) {
    hideSuggestions();
    const tags = currentTags();
    if (tags.length) {
      renderTagChips(tags.slice(0, -1));
      scheduleSave();
    }
  }
});

tagInput.addEventListener("blur", () => {
  setTimeout(hideSuggestions, 150);
});

// ── Rich text helpers ─────────────────────────────────────────────────────────

function bodyToHtml(text) {
  if (!text) return '';
  if (/<(p|ul|ol|li|div|b|i|u|s|br|strong|em|h1|h2|h3|a|code|blockquote|pre)\b/i.test(text)) return text;
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function updateNoteBodyPlaceholder() {
  const isEmpty = !noteBody.textContent.trim() && !noteBody.querySelector('ul,ol,img');
  bodyPlaceholder.classList.toggle("hidden", !isEmpty);
}

// ── Auto-save ─────────────────────────────────────────────────────────────────

let saveTimer;

function setAutosave(msg) { autosaveEl.textContent = msg; }

function scheduleSave() {
  if (!state.note || state.note.deleted_at) return;
  state.dirty = true;
  setAutosave("Editing…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNoteNow, 2000);
}

async function saveNoteNow() {
  if (!state.note || !state.dirty) return;
  clearTimeout(saveTimer);

  // Snapshot which note this save is for. A save can be in flight when the
  // user switches to a different note before it resolves — when it finally
  // resolves, it must not reclaim state.note/the editor out from under
  // whatever note is now active, or it silently splices the new note's
  // content onto this one's id on the next autosave tick.
  const savingNote = state.note;

  const hasContent = noteTitle.value.trim() || noteBody.innerText.trim() || currentTags().length > 0;
  if (!hasContent) {
    if (state.note === savingNote && state.note.id === null) state.note = null;
    state.dirty = false;
    return;
  }

  state.saving = true;
  setAutosave("Saving…");
  try {
    let updated;
    if (savingNote.id === null) {
      updated = await api("POST", "/api/notes", {
        title: noteTitle.value,
        body: noteBody.innerHTML,
        folder_id: savingNote.folder_id,
        tags: currentTags(),
      });
      state.notes.unshift(updated);
      showToast("Note created");
    } else {
      updated = await api("PUT", `/api/notes/${savingNote.id}`, {
        title: noteTitle.value,
        body:  noteBody.innerHTML,
        tags:  currentTags(),
      });
      const idx = state.notes.findIndex(n => n.id === updated.id);
      if (idx !== -1) state.notes[idx] = updated;
    }
    if (state.note === savingNote) {
      state.dirty = false;
      state.note = updated;
      renderNoteDates(updated);
      setAutosave("Saved");
      setTimeout(() => { if (autosaveEl.textContent === "Saved") setAutosave(""); }, 2000);
    }
    renderNotesList();
  } catch(e) {
    if (state.note === savingNote) setAutosave("Save failed");
  }
  state.saving = false;
}

function autosizeTitle() {
  noteTitle.style.height = "auto";
  noteTitle.style.height = noteTitle.scrollHeight + "px";
}
noteTitle.addEventListener("input", () => { autosizeTitle(); scheduleSave(); });
noteTitle.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); noteBody.focus(); }
});
window.addEventListener("resize", () => { if (state.note) autosizeTitle(); });
function mdActiveBlock() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let b = range.startContainer;
  if (b.nodeType === Node.TEXT_NODE) b = b.parentNode;
  while (b !== noteBody && b.parentNode !== noteBody) b = b.parentNode;
  return b;
}

function mdBlockText(block) {
  return block === noteBody ? (noteBody.textContent || '') : (block.textContent || '');
}

function mdInsertDivider(block) {
  const hr   = document.createElement('hr');
  const next = document.createElement('div');
  next.appendChild(document.createElement('br'));
  if (block !== noteBody) {
    block.replaceWith(hr);
    hr.insertAdjacentElement('afterend', next);
  } else {
    noteBody.innerHTML = '';
    noteBody.appendChild(hr);
    noteBody.appendChild(next);
  }
  const r = document.createRange();
  r.setStart(next, 0); r.collapse(true);
  const s = window.getSelection();
  if (s) { s.removeAllRanges(); s.addRange(r); }
  scheduleSave();
}

function mdInsertList(block, tag) {
  const list = document.createElement(tag);
  const li   = document.createElement('li');
  list.appendChild(li);
  if (block !== noteBody) {
    block.replaceWith(list);
  } else {
    noteBody.innerHTML = '';
    noteBody.appendChild(list);
  }
  const r = document.createRange();
  r.setStart(li, 0); r.collapse(true);
  const s = window.getSelection();
  if (s) { s.removeAllRanges(); s.addRange(r); }
  updateNoteBodyPlaceholder();
  scheduleSave();
}

// Convert the current line to a list when a markdown marker was just typed at
// its start. Delete the marker from the caret's text node (deleteData keeps the
// node even if it empties), then hand off to the browser's native list command
// — the exact path the formatting bar uses, so it correctly handles existing
// text on the line, the unwrapped first line, and continuation/backspace.
function mdMakeList(markerLen, tag) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      const off  = r.startOffset;
      const from = Math.max(0, off - markerLen);
      node.deleteData(from, off - from);
      sel.removeAllRanges();
      const c = document.createRange();
      c.setStart(node, Math.min(from, node.length)); c.collapse(true);
      sel.addRange(c);
    }
  }
  // The first line of a note is often a bare text node directly under the editor
  // (not wrapped in a <div>). Native insertUnorderedList can't wrap a bare text
  // node — it makes an empty bullet and orphans the text. Wrap the line in a
  // block first so the list command has a real line to convert.
  if (mdActiveBlock() === noteBody) document.execCommand('formatBlock', false, 'div');
  document.execCommand(tag === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
  updateNoteBodyPlaceholder();
  scheduleSave();
}

// beforeinput fires BEFORE the character lands in the DOM.
// e.data is the exact character the user is typing — reliable on iOS virtual keyboard.
noteBody.addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertText') return;
  const char  = e.data || '';
  const block = mdActiveBlock();
  if (!block) return;

  if (char === ' ') {
    // Look at the text from the START OF THE LINE to the caret — so a marker
    // typed in FRONT of existing text triggers the list too, not only an empty
    // line. (The old check compared the whole trimmed block, so "* existing
    // line" never matched.)
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(block);
    try { pre.setEnd(range.startContainer, range.startOffset); } catch (_) { return; }
    const before = pre.toString();
    if (before === '*' || before === '-') { e.preventDefault(); mdMakeList(1, 'ul'); return; }
    if (/^\d+\.$/.test(before))            { e.preventDefault(); mdMakeList(before.length, 'ol'); return; }
    return;
  }
  // Third dash → divider (catches "--" + "-", and "–" + "-" after iOS autocorrect)
  if (char === '-') {
    const cur = mdBlockText(block).trim();
    if (cur === '--' || cur === '–') { e.preventDefault(); mdInsertDivider(block); }
  }
});

// WebKit inserts a character typed at the very start of the first block OUTSIDE
// that block — as a loose text node directly under the editor — which visually
// splits the line ("*" on its own line, the text pushed below). Heal it: fold any
// non-empty top-level bare text node into the adjacent block so the structure
// stays all-blocks. Runs before the markdown checks so they see a clean line.
function normalizeTopLevel() {
  let hasStray = false;
  for (let n = noteBody.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "") { hasStray = true; break; }
  }
  if (!hasStray) return;
  const sel = window.getSelection();
  const saved = sel && sel.rangeCount
    ? { c: sel.getRangeAt(0).startContainer, o: sel.getRangeAt(0).startOffset } : null;
  let n = noteBody.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== "") {
      if (next && next.nodeName === "DIV") next.insertBefore(n, next.firstChild);  // node persists → caret ok
      else { const div = document.createElement("div"); n.replaceWith(div); div.appendChild(n); }
    }
    n = next;
  }
  if (saved) {
    try {
      const r = document.createRange();
      r.setStart(saved.c, saved.o); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    } catch (_) {}
  }
}

// input fallback: catches autocorrect-triggered replacements and non-beforeinput browsers
noteBody.addEventListener("input", () => {
  normalizeTopLevel();
  updateNoteBodyPlaceholder();
  const block = mdActiveBlock();
  if (block) {
    const raw  = mdBlockText(block);
    const trim = raw.trim();
    if (['---', '—', '–', '—-', '–-'].includes(trim)) {
      mdInsertDivider(block);
    } else if (raw === '* ' || raw === '- ') {
      mdInsertList(block, 'ul');
    } else if (/^\d+\. $/.test(raw)) {
      mdInsertList(block, 'ol');
    }
  }
  scheduleSave();
});

noteBody.addEventListener("paste", e => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text);
});

// ── Editor keyboard shortcuts ─────────────────────────────────────────────────

// The <li> the caret is currently in (innermost), or null if not in a list.
function currentLi() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.getRangeAt(0).commonAncestorContainer;
  n = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
  const li = n?.closest?.('li');
  return li && noteBody.contains(li) ? li : null;
}

// Nest a list item under the item above it. WebKit's execCommand('indent')
// can't be trusted for this — it wraps the item in a <blockquote> instead of a
// nested list in many cases, which then renders as a stray accent bar. So do
// the move by hand: append the <li> to a sublist (of the same list type)
// hanging off the previous sibling, creating that sublist if needed.
function indentLi(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== 'LI') return; // first item has nothing to nest under
  const parentList = li.parentElement;
  const listTag = parentList.tagName;         // UL or OL — keep the list type
  let sub = prev.lastElementChild;
  if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
    sub = document.createElement(listTag);
    if (parentList.classList.contains('task-list')) sub.classList.add('task-list');
    prev.appendChild(sub);
  }
  sub.appendChild(li);
}

// Un-nest one level. If the item lives in a nested sublist, lift it to be a
// sibling of the <li> that hosts that sublist (carrying any items below it into
// a new sublist under itself, so their relative nesting is preserved). At the
// top level, drop out of the list entirely into a plain <div>.
function outdentLi(li) {
  const list = li.parentElement;          // the ul/ol directly containing li
  const host = list.parentElement;        // the <li> hosting it (nested) or a block
  const after = [];
  for (let s = li.nextElementSibling; s; s = s.nextElementSibling) after.push(s);
  if (host && host.tagName === 'LI') {
    host.after(li);
    if (after.length) {
      const sub = document.createElement(list.tagName);
      after.forEach(x => sub.appendChild(x));
      li.appendChild(sub);
    }
    if (!list.children.length) list.remove();
    return li;                    // lifted item — caret goes here
  } else {
    const div = document.createElement('div');
    while (li.firstChild) div.appendChild(li.firstChild);
    if (!div.hasChildNodes()) div.appendChild(document.createElement('br'));
    list.after(div);
    if (after.length) {
      const newList = document.createElement(list.tagName);
      after.forEach(x => newList.appendChild(x));
      div.after(newList);
    }
    li.remove();
    if (!list.children.length) list.remove();
    return div;                   // dropped out of the list — caret goes here
  }
}

// An <li> with no text of its own and no nested sublist — a leaf empty bullet.
function liIsEmpty(li) {
  if (li.querySelector('ul, ol')) return false;
  return li.textContent.replace(/[\u200B\uFEFF\u00A0]/g, '').trim() === '';
}

function placeCaretIn(el) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// True when the caret sits at the very start of the note (nothing before it),
// where native Backspace has no previous line to merge into.
function caretAtStartOfNote() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const test = document.createRange();
  test.selectNodeContents(noteBody);
  try { test.setEnd(r.startContainer, r.startOffset); } catch (_) { return false; }
  return test.toString() === '';
}

noteBody.addEventListener("keydown", e => {
  if (e.key === "Tab") {
    e.preventDefault();
    // In a list, Tab/Shift+Tab nest/un-nest the item (like every other editor).
    // Outside a list, Tab inserts a soft 2-space indent; Shift+Tab is a no-op.
    const li = currentLi();
    if (li) {
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      const sc = r && r.startContainer, so = r ? r.startOffset : 0;
      if (e.shiftKey) outdentLi(li); else indentLi(li);
      // Manual DOM edits don't fire `input`, and moving nodes drops the
      // selection — restore the caret to the same text node/offset (which
      // moved intact) and save explicitly.
      if (sc) {
        try {
          const nr = document.createRange();
          nr.setStart(sc, so); nr.collapse(true);
          sel.removeAllRanges(); sel.addRange(nr);
        } catch (_) {}
      }
      updateNoteBodyPlaceholder();
      scheduleSave();
    } else if (!e.shiftKey) {
      document.execCommand('insertText', false, '  ');
    }
    return;
  }

  // Backspace at the very START of the note, inside a list item: native does
  // nothing (no previous line to merge into), so the first bullet feels
  // un-deletable. Convert it out of the list — outdentLi turns a top-level item
  // back into a plain line. Only fires at note-start, so bullets elsewhere keep
  // their normal native backspace/merge behavior.
  if (e.key === "Backspace" && !e.shiftKey) {
    const li = currentLi();
    if (li && caretAtStartOfNote()) {
      e.preventDefault();
      const target = outdentLi(li);
      if (target) placeCaretIn(target);
      updateNoteBodyPlaceholder();
      scheduleSave();
      return;
    }
  }

  // Enter on an EMPTY bullet steps out one nesting level (and off the list
  // entirely at the top level) instead of spawning another empty bullet —
  // the standard "Enter twice to leave the list" behavior. On a bullet with
  // text, Enter falls through to the browser's native new-item-at-same-level.
  if (e.key === "Enter" && !e.shiftKey) {
    const li = currentLi();
    if (li && liIsEmpty(li)) {
      e.preventDefault();
      const target = outdentLi(li);   // moved <li> (nested) or new <div> (top level)
      if (target) placeCaretIn(target);
      updateNoteBodyPlaceholder();
      scheduleSave();
      return;
    }
  }

  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (!e.shiftKey) {
      if (k === "b") { e.preventDefault(); applyFormat("bold"); return; }
      if (k === "i") { e.preventDefault(); applyFormat("italic"); return; }
      if (k === "u") { e.preventDefault(); applyFormat("underline"); return; }
      if (k === "k") { e.preventDefault(); applyFormat("link"); return; }
    }
    if (e.shiftKey && k === "x") { e.preventDefault(); applyFormat("strike"); return; }
    if (e.shiftKey && k === "c") { e.preventDefault(); applyFormat("code"); return; }
  }

  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    saveNoteNow();
  }
});

// ── Floating format bar ───────────────────────────────────────────────────────

function hideFormatBar() {
  formatBar.classList.add("hidden");
}

function selectionInEditor() {
  const sel = window.getSelection();
  return sel && !sel.isCollapsed && sel.rangeCount > 0 &&
    noteBody.contains(sel.getRangeAt(0).commonAncestorContainer);
}

// On touch devices iOS draws its own Cut/Copy/Paste callout right over a
// selection, so floating our own bar there just stacks two menus on top
// of each other. Several attempts at a bar/FAB tied to the keyboard's
// position all ran into the same wall: iOS scrolls the document by an
// unpredictable amount (observed up to 180px) to bring the tapped line
// into view, dragging any position:fixed/absolute element along for the
// ride and making anything anchored to visualViewport/keyboard height
// inherently racy. The touch formatting bar is instead position:sticky
// inside .editor-body (its scroll container) — it just stays at the top
// of whatever's currently scrolled into view, like any other sticky
// header, and doesn't need to know the keyboard or viewport exist at all.
const isTouch = matchMedia("(hover: none)").matches;

// The touch formatting bar is off by default (noise while writing) and revealed
// on demand via the header's Formatting toggle. Its open/closed state is a
// remembered preference so it stays where the user left it.
let formatBarOpen = localStorage.getItem("formatBarOpen") === "true";

function applyFormatBar() {
  if (!isTouch) return;
  stickyFormatBar.classList.toggle("open", formatBarOpen);
  formatToggleBtn.classList.toggle("active", formatBarOpen);
}

let lastFmtToggleAt = 0;
function toggleFormatBar() {
  const now = Date.now();
  if (now - lastFmtToggleAt < 350) return;   // dedupe touch + its synthetic mouse event
  lastFmtToggleAt = now;
  formatBarOpen = !formatBarOpen;
  localStorage.setItem("formatBarOpen", formatBarOpen);
  applyFormatBar();
}

// Toggle on pointer-DOWN + preventDefault so tapping it never blurs the note —
// the keyboard and selection stay put while the bar drops in/out.
formatToggleBtn.addEventListener("mousedown", e => { e.preventDefault(); toggleFormatBar(); });
formatToggleBtn.addEventListener("touchstart", e => { e.preventDefault(); toggleFormatBar(); }, { passive: false });

// The shell is sized to the space above the keyboard (see syncAppViewport), so
// iOS no longer window-scrolls to reveal the caret — which also means it no
// longer scrolls *anything* to reveal it. When the keyboard opens or the caret
// moves, the caret can land below the fold; nudge .editor-body's own scroll so
// it sits comfortably above the keyboard. Only ever scrolls when the caret is
// actually out of view, so it can't interrupt a manual scroll (which doesn't
// move the selection) or fight the user.
function scrollCaretIntoView() {
  if (!isTouch) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !noteBody.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rects = range.getClientRects();
  const rect  = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.bottom === 0)) return; // no measurable caret
  const vp   = window.visualViewport;
  const vh   = vp ? vp.height : window.innerHeight;
  const barH = stickyFormatBar.classList.contains("hidden") ? 0 : stickyFormatBar.offsetHeight;
  const topLimit    = editorBody.getBoundingClientRect().top + barH + 8;
  const bottomLimit = vh - 24;
  if (rect.bottom > bottomLimit) {
    editorBody.scrollTop += rect.bottom - bottomLimit;
  } else if (rect.top < topLimit) {
    editorBody.scrollTop -= topLimit - rect.top;
  }
}

// Each format bar binds both a mousedown handler and a touch handler to the
// same buttons (needed because plain "click" fires too late — the selection
// is already gone by then on iOS). Calling preventDefault() on the touch
// event is supposed to suppress the browser's synthetic mouse events that
// follow a real tap, but that suppression isn't watertight in every WebKit
// context (PWA vs Safari tab), so a single tap can occasionally invoke
// applyFormat twice — once from touch, once from the synthetic mouse event.
// For toggle commands like bold/italic that's invisible (on-then-off nets no
// visible change), but for 'code' (which manually wraps/unwraps a DOM
// element rather than using execCommand's own toggle) it's very visible: the
// box appears and then immediately vanishes. Guard every tap through here so
// a duplicate invocation within the ghost-click window is ignored outright.
let lastFormatTapAt = 0;
function tapFormat(fmt) {
  const now = Date.now();
  if (now - lastFormatTapAt < 350) return;
  lastFormatTapAt = now;
  applyFormat(fmt);
}

stickyFormatBar.addEventListener("mousedown", e => {
  const btn = e.target.closest("[data-fmt]");
  if (!btn) return;
  e.preventDefault();
  tapFormat(btn.dataset.fmt);
});
// The bar scrolls horizontally, and most of its width is buttons, so a
// touchstart can't just preventDefault + apply immediately — that cancels
// the native scroll gesture the instant a finger lands on a button, even
// when the intent was to drag across it to scroll. Instead wait for
// touchend and only treat it as a tap (preventDefault + apply) if the
// finger didn't move beyond a small threshold; a real drag is left
// completely alone so native scrolling/momentum still works.
let fmtTouchStartX = 0, fmtTouchStartY = 0, fmtTouchMoved = false;
stickyFormatBar.addEventListener("touchstart", e => {
  fmtTouchMoved = false;
  fmtTouchStartX = e.touches[0].clientX;
  fmtTouchStartY = e.touches[0].clientY;
}, { passive: true });
stickyFormatBar.addEventListener("touchmove", e => {
  const dx = Math.abs(e.touches[0].clientX - fmtTouchStartX);
  const dy = Math.abs(e.touches[0].clientY - fmtTouchStartY);
  if (dx > 6 || dy > 6) fmtTouchMoved = true;
}, { passive: true });
stickyFormatBar.addEventListener("touchend", e => {
  const btn = e.target.closest("[data-fmt]");
  if (!btn || fmtTouchMoved) return;
  e.preventDefault();
  tapFormat(btn.dataset.fmt);
});

function showFormatBar() {
  if (isTouch) return; // touch uses the sticky bar instead — see applyFormatBar / toggleFormatBar
  if (!state.note || !selectionInEditor()) { hideFormatBar(); return; }

  const sel  = window.getSelection();
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || rect.width === 0) { hideFormatBar(); return; }

  formatBar.classList.remove("hidden");
  const selCX = rect.left + rect.width / 2;
  const barW  = formatBar.offsetWidth;
  const barH  = formatBar.offsetHeight + 8;
  const GAP   = 7;

  let top   = rect.top - barH - GAP;
  let below = false;
  if (top < 60) { top = rect.bottom + GAP; below = true; }

  const half    = barW / 2;
  const centerX = Math.max(half + 8, Math.min(window.innerWidth - half - 8, selCX));
  const arrowX  = Math.max(8, Math.min(barW - 8, selCX - (centerX - half)));

  formatBar.style.left = centerX + "px";
  formatBar.style.top  = Math.max(8, top) + "px";
  formatBar.style.setProperty("--arrow-x", arrowX + "px");
  formatBar.classList.toggle("below", below);
}

noteBody.addEventListener("mouseup",  () => requestAnimationFrame(showFormatBar));
noteBody.addEventListener("touchend", () => requestAnimationFrame(showFormatBar));
noteBody.addEventListener("keyup",   () => requestAnimationFrame(showFormatBar));
// The sticky bar only makes sense while there's a cursor/keyboard active
// in the note — not persistently whenever a note happens to be open.
// The sticky bar is now preference-driven (header toggle), not focus-driven, so
// focus/blur no longer show or hide it — it persists per the user's choice.
noteBody.addEventListener("blur", () => {
  if (isTouch) return;
  setTimeout(() => { if (!formatBar.contains(document.activeElement)) hideFormatBar(); }, 180);
});
document.addEventListener("selectionchange", () => {
  // Touch bar is focus-triggered, not selection-triggered. But the caret moving
  // (tapping a new spot, typing) can put it under the keyboard, and the locked
  // shell means nothing scrolls it back on its own — so keep it in view here.
  if (isTouch) { requestAnimationFrame(scrollCaretIntoView); return; }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) { hideFormatBar(); return; }
  // Drag-selecting via the iOS selection handles only fires selectionchange,
  // not mouseup/touchend, so this is what keeps the bar tracking the selection.
  if (selectionInEditor()) requestAnimationFrame(showFormatBar);
});

function applyFormat(fmt) {
  noteBody.focus();
  if (fmt === 'p' || fmt === 'h1' || fmt === 'h2' || fmt === 'h3' || fmt === 'quote') {
    // 'p' always drops back to plain body text — the explicit way out of
    // a heading, rather than relying on re-clicking the same heading to
    // toggle it off (still supported below, but easy to forget which
    // level you're on). Toggle: re-applying the same heading to a block
    // that's already that heading reverts it to a plain paragraph (div),
    // matching how bullet/numbered lists already toggle off via execCommand.
    // 'quote' maps to the native blockquote element — same toggle behavior.
    const current = document.queryCommandValue('formatBlock').toLowerCase();
    const block = fmt === 'p' ? 'div' : fmt === 'quote' ? 'blockquote' : fmt;
    document.execCommand('formatBlock', false, current === block ? 'div' : block);
    scheduleSave();
    if (!isTouch) requestAnimationFrame(showFormatBar);
    return;
  }
  if (fmt === 'code') {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const el = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
    const preEl  = el?.closest?.('pre');
    const codeEl = el?.closest?.('code');

    // ── Toggle off ── (works with a collapsed caret too, not just a selection)
    if (preEl && noteBody.contains(preEl)) {
      // Multi-line block → unwrap into one plain div per line, matching the
      // editor's one-top-level-div-per-line convention so the result reads the
      // same as if it had never been code-formatted.
      const frag = document.createDocumentFragment();
      let lastDiv = null;
      preEl.textContent.replace(/\n$/, '').split('\n').forEach(line => {
        const div = document.createElement('div');
        if (line === '') div.appendChild(document.createElement('br'));
        else div.textContent = line;
        frag.appendChild(div);
        lastDiv = div;
      });
      preEl.replaceWith(frag);
      if (lastDiv) {
        const r = document.createRange();
        r.selectNodeContents(lastDiv);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      scheduleSave();
      if (!isTouch) requestAnimationFrame(showFormatBar);
      return;
    }
    if (codeEl && noteBody.contains(codeEl)) {
      const text = document.createTextNode(codeEl.textContent);
      codeEl.replaceWith(text);
      noteBody.normalize();
      scheduleSave();
      if (!isTouch) requestAnimationFrame(showFormatBar);
      return;
    }

    // ── Apply ── (needs a real selection)
    if (sel.isCollapsed) return;
    // Detect multi-line via the SELECTED TEXT, not the DOM shape: the browser
    // serializes <br> and block boundaries as \n regardless of whether the
    // lines are separate <div>s or <br>-separated inside one div, and
    // regardless of where the range boundaries land (they're often on noteBody
    // itself for "select all"). Inline <code> has white-space:normal and would
    // collapse those newlines into spaces, so anything with a newline becomes a
    // real <pre><code> block instead. insertHTML replaces the selection across
    // blocks cleanly (manual node surgery broke on the single-div/<br> case).
    const selectedText = sel.toString();
    const esc = selectedText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (selectedText.includes('\n')) {
      document.execCommand('insertHTML', false, `<pre><code>${esc}</code></pre>`);
    } else {
      document.execCommand('insertHTML', false, `<code>${esc}</code>`);
    }
    scheduleSave();
    if (!isTouch) requestAnimationFrame(showFormatBar);
    return;
  }
  if (fmt === 'link') {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const linkEl = (anc.nodeType === Node.TEXT_NODE ? anc.parentElement : anc)?.closest?.('a');
    if (linkEl && noteBody.contains(linkEl)) {
      // Caret/selection sits inside an existing link → unwrap it (toggle off),
      // mirroring how re-applying code/heading reverts it.
      linkEl.replaceWith(document.createTextNode(linkEl.textContent));
      noteBody.normalize();
      scheduleSave();
      if (!isTouch) requestAnimationFrame(showFormatBar);
      return;
    }
    if (sel.isCollapsed) { showToast("Select text to add a link"); return; }
    // The URL input steals focus and collapses the live selection, so stash a
    // clone of the range now and restore it before wrapping the link.
    openLinkModal(range.cloneRange());
    return;
  }
  if (fmt === 'checklist') {
    // A checklist is a <ul class="task-list">: the checkbox is drawn as the
    // list marker (CSS ::before), so native Enter continuation and Tab nesting
    // keep working and each new line gets its own checkbox for free.
    const li = currentLi();
    const list = li && li.parentElement;
    if (list && list.classList.contains('task-list')) {
      document.execCommand('insertUnorderedList');           // toggle off → plain lines
    } else if (list && list.tagName === 'UL') {
      list.classList.add('task-list');                       // bullet list → checklist, in place
    } else {
      document.execCommand('insertUnorderedList');           // plain/ordered → make a list…
      const ul = currentLi()?.parentElement;
      if (ul && ul.tagName === 'UL') ul.classList.add('task-list');  // …then tag it
    }
    scheduleSave();
    if (!isTouch) requestAnimationFrame(showFormatBar);
    return;
  }
  const execCmds = {
    bold:      'bold',
    italic:    'italic',
    underline: 'underline',
    strike:    'strikeThrough',
    bullet:    'insertUnorderedList',
    numbered:  'insertOrderedList',
    indent:    'indent',
    outdent:   'outdent',
  };
  if (execCmds[fmt]) document.execCommand(execCmds[fmt]);
  scheduleSave();
  // The sticky bar doesn't move, nothing to re-track — only the desktop
  // bar re-positions after each format, since it floats relative to the
  // selection.
  if (!isTouch) requestAnimationFrame(showFormatBar);
}

formatBar.addEventListener("mousedown", e => {
  const btn = e.target.closest("[data-fmt]");
  if (!btn) return;
  e.preventDefault();
  tapFormat(btn.dataset.fmt);
});
// touchstart (not click) so preventDefault fires before iOS collapses the
// selection for touching outside the editor.
formatBar.addEventListener("touchstart", e => {
  const btn = e.target.closest("[data-fmt]");
  if (!btn) return;
  e.preventDefault();
  tapFormat(btn.dataset.fmt);
}, { passive: false });

// ── Links ─────────────────────────────────────────────────────────────────────
// Give every anchor safe defaults (new tab, no opener leak). Runs after a note
// loads and after a link is created, so stored and freshly-made links behave
// the same. Idempotent.
function decorateLinks() {
  noteBody.querySelectorAll("a").forEach(a => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

let savedLinkRange = null;
const linkModal    = $("link-modal");
const linkUrlInput = $("link-url-input");

function openLinkModal(range) {
  savedLinkRange = range;
  linkUrlInput.value = "";
  linkModal.classList.remove("hidden");
  setTimeout(() => linkUrlInput.focus(), 50);
}

function closeLinkModal() {
  linkModal.classList.add("hidden");
  savedLinkRange = null;
}

function confirmLink() {
  let url = linkUrlInput.value.trim();
  const range = savedLinkRange;
  linkModal.classList.add("hidden");
  savedLinkRange = null;
  if (!url || !range) return;
  // A bare domain ("example.com") gets https://; anything already carrying a
  // scheme (https:, mailto:, tel:) is left untouched.
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(url)) url = "https://" + url;
  // The URL input collapsed the live selection — restore the stashed range,
  // then wrap it.
  noteBody.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("createLink", false, url);
  decorateLinks();
  sel.collapseToEnd();
  scheduleSave();
  if (!isTouch) hideFormatBar();
}

$("link-confirm-btn").addEventListener("click", confirmLink);
$("link-cancel-btn").addEventListener("click", closeLinkModal);
$("link-modal-close").addEventListener("click", closeLinkModal);
linkModal.addEventListener("click", e => { if (e.target === linkModal) closeLinkModal(); });
linkUrlInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  { e.preventDefault(); confirmLink(); }
  if (e.key === "Escape") { e.preventDefault(); closeLinkModal(); }
});

// Follow links from inside the editor: Cmd/Ctrl-click on desktop, a plain tap
// on touch. A tap that's part of a selection (non-collapsed) is left alone, so
// link text can still be selected to edit or unlink it.
noteBody.addEventListener("click", e => {
  const a = e.target.closest("a");
  if (!a || !noteBody.contains(a)) return;
  if (!(isTouch || e.metaKey || e.ctrlKey)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  e.preventDefault();
  const href = a.getAttribute("href");
  if (href) window.open(href, "_blank", "noopener,noreferrer");
});

// Tick/untick a checklist item by tapping its checkbox — the marker drawn in
// the gutter just left of the text. Handled on pointer-DOWN (not click) and
// preventDefault'd so the tap never focuses the editor: otherwise iOS raises
// the keyboard first and only then registers the tick. Tapping the text itself
// (outside the gutter) is left alone, so editing still focuses normally.
let lastCheckToggleAt = 0;
function tryToggleCheckbox(e, clientX) {
  const li = e.target.closest?.("li");
  if (!li || !noteBody.contains(li)) return;
  if (!li.parentElement?.classList.contains("task-list")) return;
  const rect = li.getBoundingClientRect();
  const em = parseFloat(getComputedStyle(li).fontSize) || 16;
  if (clientX >= rect.left || clientX < rect.left - em * 2) return; // not in the checkbox gutter
  e.preventDefault();                       // stop focus → keyboard stays as-is
  const now = Date.now();
  if (now - lastCheckToggleAt < 350) return; // ignore the synthetic-mouse duplicate after touch
  lastCheckToggleAt = now;
  li.classList.toggle("done");
  scheduleSave();
}
noteBody.addEventListener("mousedown", e => tryToggleCheckbox(e, e.clientX));
noteBody.addEventListener("touchstart", e => {
  if (e.touches[0]) tryToggleCheckbox(e, e.touches[0].clientX);
}, { passive: false });

// ── Copy note ─────────────────────────────────────────────────────────────────

$("copy-note-btn").addEventListener("click", () => {
  overflowMenu.classList.add("hidden");
  const parts = [noteTitle.value.trim(), noteBody.innerText.trim()].filter(Boolean);
  navigator.clipboard.writeText(parts.join("\n\n"))
    .then(() => showToast("Copied to clipboard"))
    .catch(() => showToast("Copy failed"));
});

// ── Save button ────────────────────────────────────────────────────────────────

$("editor-save-btn").addEventListener("click", async () => {
  await saveNoteNow();
  // "Save and go back" — same as the back button, the note shouldn't stay
  // marked active in the list once we've left the editor.
  state.note = null;
  setMobileView("notes");
  showEditorEmpty();
  await loadNotes();
  state.tags = await api("GET", "/api/tags");
  renderSidebar();
});

// ── New note ──────────────────────────────────────────────────────────────────

async function newNote() {
  if (state.dirty) await saveNoteNow();
  const folderId = state.context.type === "folder" ? state.context.id : null;
  const initialTags = state.context.type === "tag" ? [state.context.id] : [];
  state.note = { id: null, title: "", body: "", folder_id: folderId, tags: initialTags };
  state.dirty = false;
  noteTitle.value = "";
  noteBody.innerHTML = "";
  updateNoteBodyPlaceholder();
  renderTagChips(initialTags);
  renderNoteDates(null);
  setAutosave("");
  showEditorBody();
  renderNotesList();
  setMobileView("editor");
  autosizeTitle();
  // Must run synchronously in the same tick as the triggering tap/click —
  // iOS Safari refuses to raise the on-screen keyboard for a focus() call
  // made from inside requestAnimationFrame/setTimeout/a promise callback.
  // preventScroll stops Safari's own "scroll focused element into view" —
  // at this instant .editor-pane is still mid-transform off to the right,
  // so without it Safari's auto-scroll and our slide-in transition both
  // animate the pane into place, showing as two slides back to back.
  noteTitle.focus({ preventScroll: true });
}

// ── Trash helpers ─────────────────────────────────────────────────────────────

async function restoreNote(noteId) {
  const restored = await api("POST", `/api/notes/${noteId}/restore`);
  state.notes = state.notes.filter(n => n.id !== noteId);
  if (state.note && state.note.id === noteId) {
    state.note = null;
    showEditorEmpty();
  }
  renderNotesList();
  state.trashCount = Math.max(0, state.trashCount - 1);
  $("trash-count").textContent = state.trashCount || "";
  const all = await api("GET", "/api/notes");
  allNotesCount.textContent = all.length || "";
  const yearCounts = {};
  all.forEach(n => { const y = new Date(n.created_at).getFullYear(); yearCounts[y] = (yearCounts[y] || 0) + 1; });
  state.noteYears = Object.entries(yearCounts).sort((a,b) => b[0]-a[0]).map(([year,count]) => ({ year: parseInt(year), count }));
  renderTimeline();
  showToast("Note restored");
}

async function permanentDeleteNote(noteId, skipConfirm = false) {
  const note = state.notes.find(n => n.id === noteId);
  const title = note?.title || "Untitled";
  if (!skipConfirm && !confirm(`Permanently delete "${title}"? This cannot be undone.`)) return;
  await api("DELETE", `/api/trash/${noteId}`);
  state.notes = state.notes.filter(n => n.id !== noteId);
  if (state.note && state.note.id === noteId) {
    state.note = null;
    showEditorEmpty();
  }
  renderNotesList();
  state.trashCount = Math.max(0, state.trashCount - 1);
  $("trash-count").textContent = state.trashCount || "";
  showToast("Permanently deleted");
}

$("trash-restore-editor-btn").addEventListener("click", () => {
  if (state.note) restoreNote(state.note.id);
});

$("trash-perm-delete-editor-btn").addEventListener("click", () => {
  if (state.note) permanentDeleteNote(state.note.id);
});

$("empty-trash-btn").addEventListener("click", async () => {
  if (!state.notes.length) return;
  if (!confirm(`Permanently delete all ${state.notes.length} notes in Trash? This cannot be undone.`)) return;
  const ids = state.notes.map(n => n.id);
  await Promise.all(ids.map(id => api("DELETE", `/api/trash/${id}`)));
  state.notes = [];
  state.note = null;
  state.trashCount = 0;
  $("trash-count").textContent = "";
  renderNotesList();
  showEditorEmpty();
  showToast("Trash emptied");
});

// ── Delete note ───────────────────────────────────────────────────────────────

$("delete-note-btn").addEventListener("click", async () => {
  if (!state.note) return;
  if (state.note.id === null) {
    overflowMenu.classList.add("hidden");
    state.note = null; state.dirty = false; clearTimeout(saveTimer);
    renderNotesList(); showEditorEmpty(); setMobileView("notes");
    return;
  }
  if (!confirm(`Move "${state.note.title || "Untitled"}" to Trash?`)) return;
  overflowMenu.classList.add("hidden");
  await api("DELETE", `/api/notes/${state.note.id}`);
  state.notes = state.notes.filter(n => n.id !== state.note.id);
  state.note = null;
  state.dirty = false;
  clearTimeout(saveTimer);
  renderNotesList();
  showEditorEmpty();
  setMobileView("notes");
  state.tags = await api("GET", "/api/tags");
  state.trashCount++;
  $("trash-count").textContent = state.trashCount || "";
  renderSidebar();
  const all = await api("GET", "/api/notes");
  allNotesCount.textContent = all.length || "";
  const yearCounts = {};
  all.forEach(n => { const y = new Date(n.created_at).getFullYear(); yearCounts[y] = (yearCounts[y] || 0) + 1; });
  state.noteYears = Object.entries(yearCounts).sort((a,b) => b[0]-a[0]).map(([year,count]) => ({ year: parseInt(year), count }));
  renderTimeline();
  showToast("Moved to Trash");
});

// ── Multi-select ──────────────────────────────────────────────────────────────

function updateBulkCount() {
  const n = state.selectedNoteIds.size;
  bulkCountEl.textContent = n === 0 ? "Select notes" : `${n} selected`;
}

function enterSelectMode() {
  state.selectMode = true;
  state.selectedNoteIds = new Set();
  notesPaneEl.classList.add("select-mode");
  bulkActionBar.classList.remove("hidden");
  updateBulkCount();
  renderNotesList();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedNoteIds = new Set();
  notesPaneEl.classList.remove("select-mode");
  bulkActionBar.classList.add("hidden");
  renderNotesList();
}

async function bulkDelete() {
  const ids = [...state.selectedNoteIds];
  if (!ids.length) return;
  if (!confirm(`Move ${ids.length} note${ids.length !== 1 ? "s" : ""} to Trash?`)) return;
  await Promise.all(ids.map(id => api("DELETE", `/api/notes/${id}`)));
  if (state.note && ids.includes(state.note.id)) {
    state.note = null;
    showEditorEmpty();
  }
  state.trashCount += ids.length;
  $("trash-count").textContent = state.trashCount || "";
  exitSelectMode();
  await loadNotes();
  showToast(`Moved ${ids.length} note${ids.length !== 1 ? "s" : ""} to Trash`);
}

async function bulkMove(folderId) {
  const ids = [...state.selectedNoteIds];
  await Promise.all(ids.map(id => api("PUT", `/api/notes/${id}`, { folder_id: folderId })));
  if (state.note && ids.includes(state.note.id)) {
    state.note = { ...state.note, folder_id: folderId };
  }
  exitSelectMode();
  await loadNotes();
  const destName = folderId ? (state.folders.find(f => f.id === folderId)?.name || "folder") : "root";
  showToast(`Moved ${ids.length} note${ids.length !== 1 ? "s" : ""} to "${destName}"`);
}

$("select-mode-btn").addEventListener("click", enterSelectMode);
$("select-done-btn").addEventListener("click", exitSelectMode);
$("bulk-move-btn").addEventListener("click", () => { if (state.selectedNoteIds.size) openMoveModal(); });
$("bulk-delete-btn").addEventListener("click", bulkDelete);

// Bulk tag panel
let bulkTagList = [];

function renderBulkTagChips() {
  const wrap = $("bulk-tag-input-wrap");
  wrap.querySelectorAll(".bulk-tag-chip").forEach(el => el.remove());
  const input = $("bulk-tag-input");
  bulkTagList.forEach(tag => {
    const chip = document.createElement("span");
    chip.className = "bulk-tag-chip";
    chip.innerHTML = `#${esc(tag)}<button data-tag="${esc(tag)}" aria-label="Remove">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      bulkTagList = bulkTagList.filter(t => t !== tag);
      renderBulkTagChips();
    });
    wrap.insertBefore(chip, input);
  });
}

function addBulkTag(val) {
  val = val.replace(/[,#]/g, "").trim().toLowerCase();
  if (val && !bulkTagList.includes(val)) {
    bulkTagList.push(val);
    renderBulkTagChips();
  }
  $("bulk-tag-input").value = "";
  hideBulkSuggestions();
}

function hideBulkSuggestions() {
  const el = $("bulk-tag-suggestions");
  el.classList.add("hidden");
  el.innerHTML = "";
}

function showBulkTagPanel() {
  bulkTagList = [];
  $("bulk-main").classList.add("hidden");
  $("bulk-tag-panel").classList.remove("hidden");
  renderBulkTagChips();
  setTimeout(() => $("bulk-tag-input").focus(), 50);
}

function hideBulkTagPanel() {
  $("bulk-tag-panel").classList.add("hidden");
  $("bulk-main").classList.remove("hidden");
  hideBulkSuggestions();
  bulkTagList = [];
}

async function applyBulkTags() {
  const inputVal = $("bulk-tag-input").value.replace(/[,#]/g, "").trim().toLowerCase();
  if (inputVal) addBulkTag(inputVal);
  if (!bulkTagList.length) { hideBulkTagPanel(); return; }
  const ids = [...state.selectedNoteIds];
  const tags = [...bulkTagList];
  await Promise.all(ids.map(id => {
    const note = state.notes.find(n => n.id === id);
    const merged = [...new Set([...(note?.tags || []), ...tags])];
    return api("PUT", `/api/notes/${id}`, { tags: merged });
  }));
  exitSelectMode();
  await loadNotes();
  showToast(`Tagged ${ids.length} note${ids.length !== 1 ? "s" : ""}`);
}

$("bulk-tag-btn").addEventListener("click", showBulkTagPanel);
$("bulk-tag-cancel").addEventListener("click", hideBulkTagPanel);
$("bulk-tag-apply").addEventListener("click", applyBulkTags);

const bulkTagInputEl = $("bulk-tag-input");

bulkTagInputEl.addEventListener("input", () => {
  const val = bulkTagInputEl.value.trim().toLowerCase();
  const sugEl = $("bulk-tag-suggestions");
  if (!val) { hideBulkSuggestions(); return; }
  const already = new Set(bulkTagList);
  const matches = state.tags.map(t => t.name).filter(n => n.includes(val) && !already.has(n)).slice(0, 8);
  if (!matches.length) { hideBulkSuggestions(); return; }
  sugEl.innerHTML = matches.map(n => `<button class="bulk-tag-suggestion-item" data-tag="${esc(n)}">#${esc(n)}</button>`).join("");
  sugEl.classList.remove("hidden");
  sugEl.querySelectorAll(".bulk-tag-suggestion-item").forEach(btn => {
    btn.addEventListener("mousedown", e => { e.preventDefault(); addBulkTag(btn.dataset.tag); });
  });
});

bulkTagInputEl.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addBulkTag(bulkTagInputEl.value.replace(/,/g, "").trim().toLowerCase());
  }
  if (e.key === "Escape") { hideBulkSuggestions(); bulkTagInputEl.value = ""; }
  if (e.key === "Backspace" && !bulkTagInputEl.value && bulkTagList.length) {
    bulkTagList = bulkTagList.slice(0, -1);
    renderBulkTagChips();
    hideBulkSuggestions();
  }
});

bulkTagInputEl.addEventListener("blur", () => setTimeout(hideBulkSuggestions, 150));

// ── Move note ──────────────────────────────────────────────────────────────────

$("move-note-btn").addEventListener("click", () => {
  overflowMenu.classList.add("hidden");
  openMoveModal();
});

// Resolve the picker's labels/current-selection/exclusions for whichever move
// is in progress (moving a folder vs. moving a note or bulk selection).
function moveFolderConfig() {
  if (movingFolderNode) {
    const node = movingFolderNode;
    return {
      rootLabel: "Top level (no parent)",
      isCurrentRoot: node.parent_id === null,
      isCurrent: n => n.id === node.parent_id,
      excluded: getDescendantIds(node.id),   // can't move a folder into its own subtree
    };
  }
  const moveTarget = contextMenuNote || state.note;
  return {
    rootLabel: "No folder (root)",
    isCurrentRoot: !state.selectMode && moveTarget?.folder_id === null,
    isCurrent: n => !state.selectMode && moveTarget?.folder_id === n.id,
    excluded: null,
  };
}

// Render the picker respecting collapse state — only descend into a folder's
// children when it's in `moveExpanded`. Folders start collapsed, so the list
// opens short and scrollable instead of dumping the whole tree.
function renderMoveFolderList() {
  const list = $("move-folder-list");
  const cfg  = moveFolderConfig();
  list.innerHTML = "";
  list.appendChild(makeNewFolderControl());
  list.appendChild(makeMoveFolderOption(null, cfg.rootLabel, cfg.isCurrentRoot, 0, false, false));

  const walk = (node, depth) => {
    if (cfg.excluded && cfg.excluded.has(node.id)) return;
    const kids = node.children.filter(c => !cfg.excluded || !cfg.excluded.has(c.id));
    const hasKids = kids.length > 0;
    const expanded = moveExpanded.has(node.id);
    list.appendChild(makeMoveFolderOption(node.id, node.name, cfg.isCurrent(node), depth, hasKids, expanded));
    if (hasKids && expanded) kids.forEach(c => walk(c, depth + 1));
  };
  buildTree(state.folders).forEach(n => walk(n, 0));
}

function openMoveModal() {
  movingFolderNode = null;
  moveExpanded = new Set();                       // collapsed to begin with
  $("move-modal-title").textContent = "Move to folder";
  renderMoveFolderList();
  $("move-modal").classList.remove("hidden");
}

function openFolderMoveModal(node) {
  movingFolderNode = node;
  moveExpanded = new Set();
  $("move-modal-title").textContent = `Move "${node.name}" to…`;
  renderMoveFolderList();
  $("move-modal").classList.remove("hidden");
}

function makeMoveFolderOption(folderId, name, isCurrent, depth = 0, hasKids = false, expanded = false) {
  const btn = document.createElement("button");
  btn.className = "move-folder-option" + (isCurrent ? " current" : "");
  btn.style.paddingLeft = (8 + depth * 16) + "px";
  const chev = hasKids
    ? `<span class="move-folder-chev${expanded ? " open" : ""}" role="button" aria-label="Expand">${CHEV_SVG}</span>`
    : `<span class="move-folder-chev-spacer"></span>`;
  btn.innerHTML = `${chev}${FOLDER_SVG}<span class="move-folder-name">${esc(name)}</span>${isCurrent ? "<small>(current)</small>" : ""}`;
  if (hasKids) {
    // Chevron toggles expansion without selecting the folder as the target.
    btn.querySelector(".move-folder-chev").addEventListener("click", e => {
      e.stopPropagation();
      if (moveExpanded.has(folderId)) moveExpanded.delete(folderId);
      else moveExpanded.add(folderId);
      renderMoveFolderList();
    });
  }
  if (!isCurrent) {
    btn.addEventListener("click", () => moveIntoFolder(folderId));
  }
  return btn;
}

// Perform the move into `folderId` (null = root) for whatever's being moved —
// a folder, a bulk selection, or a single note. Shared by the folder rows and
// the inline "New folder" control (create-then-move).
async function moveIntoFolder(folderId) {
  $("move-modal").classList.add("hidden");
  if (movingFolderNode) {
    const node = movingFolderNode;
    movingFolderNode = null;
    const updated = await api("PUT", `/api/folders/${node.id}`, { parent_id: folderId });
    const idx = state.folders.findIndex(f => f.id === updated.id);
    if (idx !== -1) state.folders[idx] = updated;
    const destName = folderId ? (state.folders.find(f => f.id === folderId)?.name || "folder") : "root";
    renderFolderTree();
    showToast(`"${node.name}" moved to "${destName}"`);
  } else if (state.selectMode) {
    await bulkMove(folderId);
  } else {
    const targetNote = contextMenuNote || state.note;
    contextMenuNote = null;
    if (!targetNote) return;
    const updated = await api("PUT", `/api/notes/${targetNote.id}`, { folder_id: folderId });
    if (state.note && state.note.id === updated.id) state.note = updated;
    state.notes = state.notes.filter(n => n.id !== updated.id);
    renderNotesList();
    const destName = folderId ? (state.folders.find(f => f.id === folderId)?.name || "folder") : "root";
    showToast(`Moved to "${destName}"`);
  }
}

// Inline "New folder" row for the move picker: create a folder and move straight
// into it, without closing the modal to make the folder separately.
function makeNewFolderControl() {
  const wrap = document.createElement("div");
  wrap.className = "move-folder-new";
  wrap.innerHTML = `
    <button class="move-folder-newbtn" type="button">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>New folder…</span>
    </button>
    <div class="move-folder-newform hidden">
      <input type="text" class="move-folder-newinput" placeholder="Folder name" autocomplete="off">
      <button class="move-folder-newcreate btn-primary" type="button">Create &amp; move</button>
    </div>`;
  const btn = wrap.querySelector(".move-folder-newbtn");
  const form = wrap.querySelector(".move-folder-newform");
  const input = wrap.querySelector(".move-folder-newinput");
  const createBtn = wrap.querySelector(".move-folder-newcreate");

  btn.addEventListener("click", () => {
    btn.classList.add("hidden");
    form.classList.remove("hidden");
    setTimeout(() => input.focus(), 30);
  });
  const doCreate = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    createBtn.disabled = true;
    const folder = await api("POST", "/api/folders", { name, parent_id: null });
    state.folders.push(folder);
    await moveIntoFolder(folder.id);   // create + move in one step
  };
  createBtn.addEventListener("click", doCreate);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter")  { e.preventDefault(); doCreate(); }
    if (e.key === "Escape") { form.classList.add("hidden"); btn.classList.remove("hidden"); }
  });
  return wrap;
}

$("move-modal-close").addEventListener("click", () => { movingFolderNode = null; contextMenuNote = null; $("move-modal").classList.add("hidden"); });
$("move-modal").addEventListener("click", e => {
  if (e.target === $("move-modal")) { movingFolderNode = null; contextMenuNote = null; $("move-modal").classList.add("hidden"); }
});

// ── Note context menu (right-click) ───────────────────────────────────────────

const noteCtxMenu = $("note-ctx-menu");

function showNoteCtxMenu(note, x, y) {
  contextMenuNote = note;
  noteCtxMenu.style.left = x + "px";
  noteCtxMenu.style.top  = y + "px";
  noteCtxMenu.classList.remove("hidden");

  // Clamp to viewport after paint so we know the menu's size
  requestAnimationFrame(() => {
    const rect = noteCtxMenu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  noteCtxMenu.style.left = (window.innerWidth  - rect.width  - 8) + "px";
    if (rect.bottom > window.innerHeight) noteCtxMenu.style.top  = (window.innerHeight - rect.height - 8) + "px";
  });
}

function hideNoteCtxMenu() {
  if (noteCtxMenu) noteCtxMenu.classList.add("hidden");
  contextMenuNote = null;
}

document.addEventListener("click", hideNoteCtxMenu);
document.addEventListener("keydown", e => { if (e.key === "Escape") hideNoteCtxMenu(); });
noteCtxMenu.addEventListener("click", e => e.stopPropagation());

$("ctx-copy-btn").addEventListener("click", () => {
  const n = contextMenuNote;
  hideNoteCtxMenu();
  if (!n) return;
  const text = [n.title?.trim(), (n.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()]
    .filter(Boolean).join("\n\n");
  navigator.clipboard.writeText(text)
    .then(() => showToast("Copied to clipboard"))
    .catch(() => showToast("Copy failed"));
});

$("ctx-move-btn").addEventListener("click", () => {
  const n = contextMenuNote;
  noteCtxMenu.classList.add("hidden");
  // contextMenuNote stays set so openMoveModal picks it up
  if (!n) return;
  openMoveModal();
});

$("ctx-delete-btn").addEventListener("click", async () => {
  const n = contextMenuNote;
  hideNoteCtxMenu();
  if (!n) return;
  if (!confirm(`Move "${n.title || "Untitled"}" to Trash?`)) return;
  await api("DELETE", `/api/notes/${n.id}`);
  state.notes = state.notes.filter(x => x.id !== n.id);
  if (state.note && state.note.id === n.id) {
    state.note = null;
    state.dirty = false;
    clearTimeout(saveTimer);
    showEditorEmpty();
    setMobileView("notes");
  }
  renderNotesList();
  state.tags = await api("GET", "/api/tags");
  state.trashCount++;
  $("trash-count").textContent = state.trashCount || "";
  renderSidebar();
  const all = await api("GET", "/api/notes");
  allNotesCount.textContent = all.length || "";
  const yearCounts = {};
  all.forEach(x => { const y = new Date(x.created_at).getFullYear(); yearCounts[y] = (yearCounts[y] || 0) + 1; });
  state.noteYears = Object.entries(yearCounts).sort((a,b) => b[0]-a[0]).map(([year,count]) => ({ year: parseInt(year), count }));
  renderTimeline();
  showToast("Moved to Trash");
});

// ── Overflow menu ─────────────────────────────────────────────────────────────

$("editor-menu-btn").addEventListener("click", e => {
  e.stopPropagation();
  overflowMenu.classList.toggle("hidden");
});
document.addEventListener("click", () => overflowMenu.classList.add("hidden"));
overflowMenu.addEventListener("click", e => e.stopPropagation());

// ── Folder modal ──────────────────────────────────────────────────────────────

let folderModalMode = null;

function openFolderModal(folder = null, parentId = null) {
  folderModalMode = folder ? { action: "rename", folder } : { action: "new", parentId };
  $("folder-modal-title").textContent = folder ? "Rename folder" : "New folder";
  $("folder-confirm-btn").textContent = folder ? "Rename" : "Create";
  $("folder-name-input").value = folder ? folder.name : "";
  $("folder-modal").classList.remove("hidden");
  setTimeout(() => $("folder-name-input").focus(), 50);
}

$("compose-btn").addEventListener("click", () => {
  state.navHistory = [];
  state.context = { type: "all", id: null, label: "All Notes" };
  paneTitle.textContent = "All Notes";
  setActiveNav(navAllNotes);
  renderSidebar();
  loadNotes().then(() => newNote());
});
$("new-folder-btn").addEventListener("click", () => openFolderModal());
$("folder-modal-close").addEventListener("click", () => $("folder-modal").classList.add("hidden"));
$("folder-cancel-btn").addEventListener("click", () => $("folder-modal").classList.add("hidden"));
$("folder-modal").addEventListener("click", e => {
  if (e.target === $("folder-modal")) $("folder-modal").classList.add("hidden");
});

$("folder-name-input").addEventListener("keydown", e => {
  if (e.key === "Enter") $("folder-confirm-btn").click();
  if (e.key === "Escape") $("folder-modal").classList.add("hidden");
});

$("folder-confirm-btn").addEventListener("click", async () => {
  const name = $("folder-name-input").value.trim();
  if (!name) return;
  $("folder-modal").classList.add("hidden");

  if (folderModalMode.action === "new") {
    const folder = await api("POST", "/api/folders", {
      name,
      parent_id: folderModalMode.parentId || null,
    });
    state.folders.push(folder);
    if (folderModalMode.parentId) {
      state.expandedFolders.add(folderModalMode.parentId);
      localStorage.setItem("expandedFolders", JSON.stringify([...state.expandedFolders]));
    }
    showToast(`Folder "${name}" created`);
  } else {
    const updated = await api("PUT", `/api/folders/${folderModalMode.folder.id}`, { name });
    const idx = state.folders.findIndex(f => f.id === updated.id);
    if (idx !== -1) state.folders[idx] = updated;
    if (state.context.type === "folder" && state.context.id === updated.id) {
      state.context.label = updated.name;
      paneTitle.textContent = updated.name;
    }
    showToast("Folder renamed");
  }
  renderFolderTree();
  renderNotesList();
});

// ── Delete folder ──────────────────────────────────────────────────────────────

async function deleteFolder(folder) {
  if (!confirm(`Delete folder "${folder.name}"? Notes inside will be moved to root.`)) return;
  await api("DELETE", `/api/folders/${folder.id}`);
  state.folders = state.folders.filter(f => f.id !== folder.id);
  if (state.context.type === "folder" && state.context.id === folder.id) {
    state.navHistory = [];
    state.context = { type: "all", id: null, label: "All Notes" };
    paneTitle.textContent = "All Notes";
    setActiveNav(navAllNotes);
  }
  renderFolderTree();
  await loadNotes();
  showToast(`"${folder.name}" deleted`);
}

// ── Sync polling ──────────────────────────────────────────────────────────────

setInterval(async () => {
  try {
    const { version } = await api("GET", "/api/sync");
    if (version && version !== state.syncVersion) {
      state.syncVersion = version;
      // Don't reload while actively editing or saving
      if (!state.dirty && !state.saving) {
        await loadNotes();
        state.tags = await api("GET", "/api/tags");
        renderSidebar();
        const all = await api("GET", "/api/notes");
        allNotesCount.textContent = all.length || "";
        const yearCounts = {};
        all.forEach(n => { const y = new Date(n.created_at).getFullYear(); yearCounts[y] = (yearCounts[y] || 0) + 1; });
        state.noteYears = Object.entries(yearCounts).sort((a,b) => b[0]-a[0]).map(([year,count]) => ({ year: parseInt(year), count }));
        renderTimeline();
      }
    }
  } catch(_) {}
}, 2000);

// ── Resize handles ────────────────────────────────────────────────────────────

let sidebarW = parseInt(localStorage.getItem("sidebarW") || "220");
let notesW   = parseInt(localStorage.getItem("notesW")   || "260");

function applyPaneWidths() {
  document.documentElement.style.setProperty("--sidebar-w", sidebarW + "px");
  document.documentElement.style.setProperty("--notes-w",   notesW   + "px");
}

function setupResizeHandle(handle, which) {
  let startX, startW;
  handle.addEventListener("mousedown", e => {
    startX = e.clientX;
    startW = which === "sidebar" ? sidebarW : notesW;
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    function onMove(ev) {
      const delta = ev.clientX - startX;
      if (which === "sidebar") {
        sidebarW = Math.max(160, Math.min(380, startW + delta));
        localStorage.setItem("sidebarW", sidebarW);
      } else {
        notesW = Math.max(180, Math.min(500, startW + delta));
        localStorage.setItem("notesW", notesW);
      }
      applyPaneWidths();
    }

    function onUp() {
      handle.classList.remove("dragging");
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener("beforeunload", e => {
  if (state.dirty || state.saving) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ── Visual-viewport sync ──────────────────────────────────────────────────────
// Size the app shell to the space *above* the on-screen keyboard. When the
// keyboard opens iOS shrinks visualViewport.height (and may shift offsetTop);
// mirroring those onto the shell (via the --app-h / --app-top CSS vars the
// mobile .app rule consumes) means the editor always fits the visible area.
// The caret is then reachable through .editor-body's own scroll, so iOS never
// window-scrolls to reveal it — which is what used to drag the fixed header
// and formatting bar off the top of the screen. Replaces every prior
// keyboard-tracking hack.
const vvp = window.visualViewport;
function syncAppViewport() {
  if (!vvp) return;
  const root = document.documentElement;
  root.style.setProperty("--app-h", vvp.height + "px");
  root.style.setProperty("--app-top", vvp.offsetTop + "px");
}
if (vvp) {
  vvp.addEventListener("resize", () => {
    syncAppViewport();
    // The keyboard just opened/closed and resized the shell — the caret may now
    // be hidden under the keyboard. Bring it back into view, once on the next
    // frame and once after the keyboard's open animation settles.
    requestAnimationFrame(scrollCaretIntoView);
    setTimeout(scrollCaretIntoView, 250);
  });
  vvp.addEventListener("scroll", syncAppViewport);
  syncAppViewport();
}
// The locked shell must never let the outer window scroll. If iOS nudges it
// (e.g. mid keyboard-transition), snap straight back. Unlike the old
// selectionchange hack this no longer fights caret visibility, because the
// shell above already fits the visual viewport — there's nothing to reveal by
// scrolling the window, so this only ever undoes an unwanted nudge.
window.addEventListener("scroll", () => {
  if (window.scrollY !== 0) window.scrollTo(0, 0);
}, { passive: true });

applyDark(state.darkMode);
applyPaneWidths();
setupResizeHandle($("resize-sidebar-handle"), "sidebar");
setupResizeHandle($("resize-notes-handle"), "notes");
updateSortUI();
updateFoldersVisibility();
navAllNotes.classList.add("active");
showEditorEmpty();
setMobileView("sidebar");
// The Formatting toggle only drives the touch sticky bar; on desktop the
// floating-on-selection bar is used instead, so hide the header toggle AND its
// Settings row there (they'd be no-ops).
if (!isTouch) {
  formatToggleBtn.style.display = "none";
  $("settings-formatbar-row").style.display = "none";
}
applyFormatBar();

// ── Offline (Phase 1) ─────────────────────────────────────────────────────────
// Register the service worker so the app shell + last-synced notes load offline
// (read-only for now). Failure is non-fatal — the app just runs online-only.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
// Show an "Offline" pill so it's clear edits won't save yet. navigator.onLine
// catches airplane-mode / no-network; a save that fails while "online" (e.g. the
// server is unreachable) still surfaces as "Save failed" in the editor.
function updateOfflinePill() {
  offlinePill.classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", updateOfflinePill);
window.addEventListener("offline", updateOfflinePill);
updateOfflinePill();

loadAll();
