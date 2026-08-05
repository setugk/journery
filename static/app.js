// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  folders: [],
  tags: [],
  notes: [],
  noteYears: [],        // [{ year, count }, …] sorted desc
  note: null,
  context: { type: "recents", id: null, label: "Recents" },   // Recents is the default view on load
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
  // Collapsed by default — a tag's trashed notes are noise most of the time.
  tagTrashExpanded: localStorage.getItem("tagTrashExpanded") === "true",
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
  {
    id: "vitesse-dark", name: "Vitesse Dark", dark: true,
    tokens: { "--bg":"#121212","--surface":"#181818","--surface-2":"#1E1E1E","--border":"#2B2B2B","--border-mid":"#3C3C3C","--divider":"#1C1C1C","--text":"#DBD7CA","--text-2":"#BFBCAE","--text-muted":"#6E6B64","--text-faint":"#4A4844","--accent":"#4D9375","--accent-fg":"#121212","--danger":"#CB7676","--danger-bg":"#2A1414" },
  },
  {
    id: "vitesse-light", name: "Vitesse Light", dark: false,
    tokens: { "--bg":"#FFFFFF","--surface":"#F7F7F7","--surface-2":"#EFEFEF","--border":"#E4E4E4","--border-mid":"#D0D0D0","--divider":"#ECECEC","--text":"#393A34","--text-2":"#5C5E57","--text-muted":"#999999","--text-faint":"#C4C4C4","--accent":"#1C6B48","--accent-fg":"#FFFFFF","--danger":"#AB5959","--danger-bg":"#FBE9E9" },
  },
  {
    id: "zenburn", name: "Zenburn", dark: true,
    tokens: { "--bg":"#3F3F3F","--surface":"#4A4A4A","--surface-2":"#464646","--border":"#5A5A5A","--border-mid":"#6A6A6A","--divider":"#4D4D4D","--text":"#DCDCCC","--text-2":"#C4C4BC","--text-muted":"#8A8A7A","--text-faint":"#6A6A5A","--accent":"#7F9F7F","--accent-fg":"#1A1A1A","--danger":"#CC9393","--danger-bg":"#2A1A1A" },
  },
  {
    id: "horizon-dark", name: "Horizon Dark", dark: true,
    tokens: { "--bg":"#1C1E26","--surface":"#232530","--surface-2":"#202230","--border":"#2E303E","--border-mid":"#3E4051","--divider":"#24252F","--text":"#CBCED0","--text-2":"#B3B8BD","--text-muted":"#6C6F93","--text-faint":"#454866","--accent":"#E95678","--accent-fg":"#1C1E26","--danger":"#E95678","--danger-bg":"#2D1520" },
  },
  {
    id: "synthwave-84", name: "Synthwave '84", dark: true,
    tokens: { "--bg":"#262335","--surface":"#2A2139","--surface-2":"#241F31","--border":"#3B3352","--border-mid":"#4A4368","--divider":"#2D2640","--text":"#F4EEE4","--text-2":"#DCD3E8","--text-muted":"#848BBD","--text-faint":"#4D4A6B","--accent":"#FF7EDB","--accent-fg":"#262335","--danger":"#FE4450","--danger-bg":"#2D1018" },
  },
  {
    id: "cobalt2", name: "Cobalt2", dark: true,
    tokens: { "--bg":"#193549","--surface":"#1F455E","--surface-2":"#15303F","--border":"#2C5570","--border-mid":"#3D6A86","--divider":"#1C3D52","--text":"#FFFFFF","--text-2":"#D6E3EA","--text-muted":"#7FA8BD","--text-faint":"#4D7385","--accent":"#FFC600","--accent-fg":"#193549","--danger":"#FF628C","--danger-bg":"#2D1420" },
  },
  {
    id: "material-ocean", name: "Material Ocean", dark: true,
    tokens: { "--bg":"#0F111A","--surface":"#14161F","--surface-2":"#10121A","--border":"#1F222D","--border-mid":"#2C2F3D","--divider":"#171923","--text":"#A6ACCD","--text-2":"#8F93A2","--text-muted":"#4B526D","--text-faint":"#33374A","--accent":"#82AAFF","--accent-fg":"#0F111A","--danger":"#FF5370","--danger-bg":"#2A1018" },
  },
  {
    id: "panda", name: "Panda", dark: true,
    tokens: { "--bg":"#292A2B","--surface":"#2F3031","--surface-2":"#2C2D2E","--border":"#3E4041","--border-mid":"#4E5052","--divider":"#313233","--text":"#E6E6E6","--text-2":"#CFCFCF","--text-muted":"#676B79","--text-faint":"#45484F","--accent":"#19F9D8","--accent-fg":"#292A2B","--danger":"#FF4B82","--danger-bg":"#2D1420" },
  },
  {
    id: "andromeda", name: "Andromeda", dark: true,
    tokens: { "--bg":"#23262E","--surface":"#282B35","--surface-2":"#24272F","--border":"#333644","--border-mid":"#454858","--divider":"#262933","--text":"#D5CED9","--text-2":"#C1B8C9","--text-muted":"#6B6D7C","--text-faint":"#46485A","--accent":"#C74DED","--accent-fg":"#23262E","--danger":"#EE5D43","--danger-bg":"#2A1310" },
  },
  {
    id: "iceberg-dark", name: "Iceberg Dark", dark: true,
    tokens: { "--bg":"#161821","--surface":"#1A1C25","--surface-2":"#191B24","--border":"#272932","--border-mid":"#363946","--divider":"#1C1E27","--text":"#C6C8D1","--text-2":"#B4B6BF","--text-muted":"#6B7089","--text-faint":"#444A63","--accent":"#84A0C6","--accent-fg":"#161821","--danger":"#E27878","--danger-bg":"#281515" },
  },
  {
    id: "iceberg-light", name: "Iceberg Light", dark: false,
    tokens: { "--bg":"#E8E9EC","--surface":"#F1F2F5","--surface-2":"#DCDEE3","--border":"#CDCFD7","--border-mid":"#B8BAC4","--divider":"#DCDEE3","--text":"#33374C","--text-2":"#4B5066","--text-muted":"#6B708A","--text-faint":"#9A9DB0","--accent":"#2D539E","--accent-fg":"#FFFFFF","--danger":"#CC517A","--danger-bg":"#F7E1EA" },
  },
  {
    id: "oceanic-next", name: "Oceanic Next", dark: true,
    tokens: { "--bg":"#1B2B34","--surface":"#22333C","--surface-2":"#1E2E37","--border":"#2C3E47","--border-mid":"#3D5058","--divider":"#22323B","--text":"#CDD3DE","--text-2":"#C0C5CE","--text-muted":"#65737E","--text-faint":"#4A5A63","--accent":"#6699CC","--accent-fg":"#1B2B34","--danger":"#EC5F67","--danger-bg":"#2A1416" },
  },
  {
    id: "base16-dark", name: "Base16 Dark", dark: true,
    tokens: { "--bg":"#181818","--surface":"#1E1E1E","--surface-2":"#1A1A1A","--border":"#282828","--border-mid":"#383838","--divider":"#1C1C1C","--text":"#D8D8D8","--text-2":"#C0C0C0","--text-muted":"#6A6A6A","--text-faint":"#454545","--accent":"#7CAFC2","--accent-fg":"#181818","--danger":"#AB4642","--danger-bg":"#2A1615" },
  },
  {
    id: "base16-light", name: "Base16 Light", dark: false,
    tokens: { "--bg":"#F8F8F8","--surface":"#FFFFFF","--surface-2":"#E8E8E8","--border":"#D8D8D8","--border-mid":"#C0C0C0","--divider":"#E8E8E8","--text":"#181818","--text-2":"#383838","--text-muted":"#6A6A6A","--text-faint":"#A0A0A0","--accent":"#7CAFC2","--accent-fg":"#FFFFFF","--danger":"#AB4642","--danger-bg":"#F6E5E4" },
  },
  {
    id: "spacemacs-dark", name: "Spacemacs Dark", dark: true,
    tokens: { "--bg":"#292B2E","--surface":"#2F3136","--surface-2":"#2B2D31","--border":"#3C3F44","--border-mid":"#4C5057","--divider":"#2E3034","--text":"#B2B2B2","--text-2":"#9CA0A4","--text-muted":"#5C5F61","--text-faint":"#404244","--accent":"#4F97D7","--accent-fg":"#292B2E","--danger":"#F2241F","--danger-bg":"#2A1210" },
  },
  {
    id: "moonlight", name: "Moonlight", dark: true,
    tokens: { "--bg":"#212337","--surface":"#272A41","--surface-2":"#23263A","--border":"#333652","--border-mid":"#444869","--divider":"#262940","--text":"#C8D3F5","--text-2":"#B4C2F0","--text-muted":"#636DA6","--text-faint":"#3F4573","--accent":"#82AAFF","--accent-fg":"#212337","--danger":"#FF757F","--danger-bg":"#2D151C" },
  },
  {
    id: "aura", name: "Aura", dark: true,
    tokens: { "--bg":"#15141B","--surface":"#1A1A23","--surface-2":"#17161E","--border":"#26242F","--border-mid":"#37343F","--divider":"#1C1B24","--text":"#EDECEE","--text-2":"#CDC5E0","--text-muted":"#6D6D7D","--text-faint":"#46424F","--accent":"#A277FF","--accent-fg":"#15141B","--danger":"#F96363","--danger-bg":"#2A1416" },
  },
  {
    id: "sonokai", name: "Sonokai", dark: true,
    tokens: { "--bg":"#2C2E34","--surface":"#33353B","--surface-2":"#2F3136","--border":"#3F4147","--border-mid":"#4F5157","--divider":"#313337","--text":"#E2E2E3","--text-2":"#C9C9CA","--text-muted":"#6D6F76","--text-faint":"#45474E","--accent":"#9ED072","--accent-fg":"#2C2E34","--danger":"#FC5D7C","--danger-bg":"#2D1420" },
  },
  {
    id: "rose-pine-moon", name: "Rosé Pine Moon", dark: true,
    tokens: { "--bg":"#232136","--surface":"#2A273F","--surface-2":"#26243A","--border":"#393552","--border-mid":"#44415A","--divider":"#2A283E","--text":"#E0DEF4","--text-2":"#C7C3E0","--text-muted":"#908CAA","--text-faint":"#6E6A86","--accent":"#EA9A97","--accent-fg":"#232136","--danger":"#EB6F92","--danger-bg":"#2D1A22" },
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
// showToast(msg) — plain text toast. showToast(msg, {label, fn}) — adds an
// action button (e.g. "Undo") and keeps the toast up longer so it's tappable.
function showToast(msg, action) {
  const t = $("toast");
  t.innerHTML = "";
  t.appendChild(document.createTextNode(msg));
  if (action && action.label && action.fn) {
    const btn = document.createElement("button");
    btn.className = "toast-action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      t.classList.add("hidden");
      clearTimeout(toastTimer);
      action.fn();
    });
    t.appendChild(btn);
  }
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), action ? 6000 : 2500);
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
  general: "General", changelog: "What's New", tags: "Tags", themes: "Themes", data: "Data",
  bug: "Report a bug", feedback: "Send feedback",
};

// User-facing changelog. Curated highlights only — major features per release,
// with smaller stuff rolled up as "Bug fixes & improvements". Newest first.
const CHANGELOG = [
  { version: "1.30", date: "Aug 4, 2026", changes: [
    "New bottom bar on phones — a floating glass island with Search, New note, and Profile Settings, always in thumb reach. Search and the new-note button moved down into it, so the top of the screen is just your notes.",
    "Profile & Settings tidied up — tap the person icon (bottom-right on desktop, in the island on phones) to open Profile Settings, with “Report a bug” and “Send feedback” now as their own sections in there instead of a separate menu.",
    "Tapping outside an open menu now just closes it, rather than also opening whatever happened to be underneath.",
    "Dark mode: selected text stays readable — completed checklist items and other muted text no longer wash out under the selection highlight.",
    "New checklist items always start unchecked — pressing Enter on a checked item no longer creates a pre-checked one.",
    "The formatting toolbar (the “T” in the editor header) is now on desktop too, not just phones/tablets — turn it on to keep a toolbar open for inserting checklists, bullet and numbered lists, headings and more at your cursor, without having to select text first. Off by default. In focus mode it lines up with your writing column.",
    "Sidebar tidy-up — Recents moved to the top (above Pinned), the focus-mode toggle moved up to the header, and “New folder” now lives right in the Folders section where it belongs.",
    "More control over shared links — pick a custom expiry date (not just 1/7/30 days), and optionally protect a link with a password so only people you give it to can open it. Works for both single-note and whole-tag shares.",
    "Drag and drop to move things (on desktop) — drag a folder onto another folder to nest it, or drag a note onto a folder to move it or onto a tag to add that tag. Each move shows an Undo. (On phones/tablets, the move picker is unchanged.)",
    "Your display settings now follow you across devices — theme, folder & date visibility, date display, sort order, and Recents range are saved to your account, so a new device or sign-in keeps them instead of resetting.",
    "Tidier Settings — the one-item “Sidebar” tab is folded into General, and the categories are ordered more sensibly.",
    "Right-click a folder or a tag in the sidebar for quick options — rename, move, delete, pin, share — the same way you can right-click a note.",
    "Bug fixes & improvements",
  ]},
  { version: "1.29", date: "Jul 25, 2026", changes: [
    "Share a whole tag — open a tag, tap the share icon, and get one public link to every note with that tag (a read-only index anyone can browse). Add the tag to a note to publish it, remove it to un-publish. Expiry + revoke work just like note links.",
    "Cleaner, more balanced Share dialog",
    "Tidier tag view — Share, Sort, and Select now live in a single ⋯ menu, with “+” always at hand",
    "Cleaner sidebar — the top row is now just Journery + New note / New folder, and your profile at the bottom now opens Settings (the app version is in Settings → General)",
    "A back chevron next to a nested folder's name jumps you up one level, instead of hunting for the parent in the sidebar tree",
    "Report a bug or send feedback right from the app — tap your profile at the bottom of the sidebar. Optionally leave your name/email if you'd like a reply",
    "A chevron next to your name at the bottom of the sidebar makes it clearer that it opens Settings and Feedback",
    "A tag's trashed notes now collapse under an “In Trash” section instead of always showing — tap to expand",
    "Fixed: creating a new note right after viewing a trashed one no longer left the editor stuck read-only",
    "Settings no longer stretches edge-to-edge on wide screens, and Themes now shows a proper grid of wider cards instead of a single narrow column",
    "19 new themes — Vitesse, Synthwave '84, Cobalt2, Iceberg, Andromeda, Sonokai, Rosé Pine Moon, and more",
    "Pasting a URL into a note now makes it a real, clickable link automatically",
    "The sidebar now clearly highlights whatever you have open — a tag, folder, year, All Notes, or Trash — in your theme's accent color",
    "Fixed: Cmd/Ctrl+Z in a note could remove nothing, or several words at once, instead of just the last thing you typed — undo/redo now behaves predictably (word by word, and Cmd/Ctrl+Shift+Z to redo)",
    "Cleaner indent/outdent, bullet, and numbered list icons in the formatting toolbar",
    "Fixed: adding a divider (---) in some notes could delete nearby content — it now always splits just the current line, even in notes with pasted or nested structure",
    "Numbered lists now start from the number you type — write “3.” to continue a list at 3 after a break of notes, instead of always resetting to 1",
    "Shift+Enter now adds a soft line break inside a list item (or any line) — a new line aligned with the text, without starting a new bullet or number",
    "You can now pin as many tags as you like — the 5-tag limit is gone",
    "Struck-through text now dims so it's easy to tell apart from normal text at a glance",
    "An expanded sidebar section (Pinned, Tags, Timeline) now reads a touch stronger, so it's clearer which one is open",
    "Bug fixes & improvements",
  ]},
  { version: "1.28", date: "Jul 25, 2026", changes: [
    "Share any note with a public link — “Share…” in the ⋯ menu. Anyone with the link can read it (no sign-in), it opens as a clean standalone page, and you can set it to auto-expire (1/7/30 days) or turn it off any time",
    "Bug fixes & improvements",
  ]},
  { version: "1.27", date: "Jul 17, 2026", changes: [
    "Search as you type — results appear right under the search bar, no separate page",
    "Notes save faster after you stop typing, and save right away when you leave the app",
    "A note you have open now updates live when you edit it on another device",
    "Markdown shortcuts — lists (“* ”, “- ”, “1. ”) and the “---” divider — now work on any line, including pasted or imported notes, not just freshly typed ones",
    "Bug fixes & improvements",
  ]},
  { version: "1.26", date: "Jul 17, 2026", changes: [
    "The formatting bar now highlights the styles active where your cursor is (bold, heading, list, etc.)",
    "Recents is now the default view when you open the app",
    "Refreshed logo",
    "Bug fixes & improvements",
  ]},
  { version: "1.25", date: "Jul 16, 2026", changes: [
    "New Journery logo — in the app, on the tab favicon, and as the home-screen / PWA icon",
    "Create a subfolder right from the Move-to-folder dialog — expand any folder to add one",
    "Bug fixes & improvements",
  ]},
  { version: "1.24", date: "Jul 16, 2026", changes: [
    "Focus mode on the web — hide both sidebars for distraction-free writing (⌘\\ or the toolbar button)",
    "Bug fixes & improvements",
  ]},
  { version: "1.23", date: "Jul 16, 2026", changes: [
    "Turn an existing line into a list by typing “* ” or “1. ” in front of it",
    "Create a new folder right from the Move-to-folder dialog",
    "Bug fixes & improvements",
  ]},
  { version: "1.22", date: "Jul 16, 2026", changes: [
    "Works offline — opens and shows your latest notes without a connection (read-only for now)",
    "Bug fixes & improvements",
  ]},
  { version: "1.20", date: "Jul 15, 2026", changes: [
    "Export your notes as Markdown files — take them anywhere, no lock-in",
    "Larger, clearer note titles",
    "Bug fixes & improvements",
  ]},
  { version: "1.19", date: "Jul 15, 2026", changes: [
    "Show or hide the created & edited dates on a note (Settings → General)",
    "Bug fixes & improvements",
  ]},
  { version: "1.18", date: "Jul 14, 2026", changes: [
    "Show or hide the formatting bar with the new toolbar button — a cleaner writing space",
    "Tick off checklist items without the keyboard popping up",
    "This What's New page in Settings",
    "Bug fixes & improvements",
  ]},
  { version: "1.16", date: "Jul 8, 2026", changes: [
    "Checklists — tap the box to tick things off",
    "Nested lists: Tab to indent, with bullets that change shape by depth",
    "Bug fixes & improvements",
  ]},
  { version: "1.15", date: "Jul 8, 2026", changes: [
    "Pull quotes and code blocks in the editor",
    "Bug fixes & improvements",
  ]},
  { version: "1.14", date: "Jul 7, 2026", changes: [
    "Add links to your text",
    "Smoother typing and scrolling on iPhone",
    "Bug fixes & improvements",
  ]},
  { version: "1.10", date: "Jul 6, 2026", changes: [
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
  // "bug" and "feedback" are two separate menu items that share one form panel —
  // the item you pick just presets the report type (no Type dropdown to choose).
  const panelSection = (section === "bug") ? "feedback" : section;
  document.querySelectorAll(".settings-panel").forEach(panel => {
    panel.classList.toggle("hidden", panel.id !== `settings-panel-${panelSection}`);
  });
  if (section === "changelog") renderChangelog();
  if (section === "tags") renderSettingsTags();
  if (section === "themes") renderThemeGrid();
  if (section === "bug" || section === "feedback") prepareFeedbackForm(section);
  if (isMobile()) {
    $("settings-view").dataset.pane = "detail";
    $("settings-topbar-back").querySelector("span").textContent = "Back";
    $("settings-topbar-title").textContent = SETTINGS_SECTION_LABELS[section] || section;
  }
}

function settingsBackToList() {
  $("settings-view").dataset.pane = "list";
  $("settings-topbar-back").querySelector("span").textContent = "Back";
  $("settings-topbar-title").textContent = "Profile Settings";
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
  $("settings-topbar-title").textContent = "Profile Settings";
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
  saveSyncedSetting("dateDisplay", state.dateDisplay);
  updateDatePicker();
  renderNotesList();
});

$("recents-range-picker").addEventListener("click", e => {
  const btn = e.target.closest("[data-value]");
  if (!btn) return;
  state.recentsRange = btn.dataset.value;
  saveSyncedSetting("recentsRange", state.recentsRange);
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

// Rename a tag everywhere it's used (API + open context + pinned list). Shared
// by the Settings inline editor and the sidebar right-click menu. Normalizes and
// no-ops on an empty/unchanged name.
async function applyTagRename(oldName, rawNewName) {
  const newName = (rawNewName || "").replace(/[,#]/g, "").trim().toLowerCase();
  if (!newName || newName === oldName) return;
  await api("PUT", `/api/tags/${encodeURIComponent(oldName)}`, { name: newName });
  if (state.context.type === "tag" && state.context.id === oldName) {
    state.context.id = newName;
    state.context.label = "#" + newName;
    paneTitle.textContent = "#" + newName;
  }
  const pinIdx = state.pinnedTags.indexOf(oldName);
  if (pinIdx !== -1) { state.pinnedTags[pinIdx] = newName; await savePinnedTags(); }
  state.tags = await api("GET", "/api/tags");
  renderSidebar();
  await loadNotes();
  showToast(`Tag renamed to "#${newName}"`);
}

// Delete a tag from all notes. Shared by Settings and the right-click menu.
async function deleteTagFlow(tagName) {
  if (!confirm(`Delete "#${tagName}" from all notes?`)) return;
  await api("DELETE", `/api/tags/${encodeURIComponent(tagName)}`);
  state.pinnedTags = state.pinnedTags.filter(t => t !== tagName);
  await savePinnedTags();
  state.tags = await api("GET", "/api/tags");
  renderSidebar();
  await loadNotes();
  showToast(`Tag "#${tagName}" deleted`);
}

// Right-click "Rename": prompt for the new name (the Settings panel uses an
// inline input instead; both funnel through applyTagRename).
async function renameTagFlow(oldName) {
  const input = prompt(`Rename #${oldName} to:`, oldName);
  if (input == null) return;
  await applyTagRename(oldName, input);
}

async function doRenameTag(oldName) {
  const input = $("settings-tags-list").querySelector(".settings-tag-rename-input");
  if (!input) return;
  const value = input.value;
  editingTag = null;
  await applyTagRename(oldName, value);
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
      await deleteTagFlow(btn.dataset.tag);
      renderSettingsTags();
    });
  });
}

// ── Settings entry points ────────────────────────────────────────────────────
// The old profile dropdown (Settings / Feedback) is gone: Profile Settings opens
// directly from a person icon (right end of the desktop profile chip; third slot
// of the mobile island), and Feedback is now a section inside it.
$("settings-btn-desktop")?.addEventListener("click", openSettings);
$("island-profile-btn")?.addEventListener("click", e => { e.stopPropagation(); openSettings(); });

// ── Outside-click dismissal (swallow the click) ───────────────────────────────
// When any floating menu (a dropdown / context menu — the ones WITHOUT a
// full-screen backdrop; modals already catch their own outside clicks) is open,
// the first click outside it should ONLY dismiss the menu, not also activate
// whatever was under the cursor (open a note, navigate a folder, focus search…).
// This runs in the CAPTURE phase, before the target's own handlers, and stops the
// event there. Clicks INSIDE a menu (its items) and clicks on a menu TRIGGER (so
// toggling / switching between menus still works in one tap) are let through
// untouched — the triggers' own stopPropagation keeps them behaving as before.
const OPEN_MENU_SELECTOR =
  "#sort-menu:not(.hidden), #new-item-menu:not(.hidden), " +
  "#notes-overflow-menu:not(.hidden), #overflow-menu:not(.hidden), #note-ctx-menu:not(.hidden), " +
  ".folder-ctx-menu";
const MENU_CONTENT_SELECTOR =
  "#sort-menu, #new-item-menu, #notes-overflow-menu, #overflow-menu, " +
  "#note-ctx-menu, .folder-ctx-menu";
const MENU_TRIGGER_SELECTOR =
  "#sort-btn, #new-note-btn, #notes-overflow-btn, " +
  "#editor-menu-btn, .folder-kebab";

function closeAllFloatingMenus() {
  closeHeaderMenus();
  closeCtxMenus();
  hideNoteCtxMenu();
  overflowMenu.classList.add("hidden");
}

document.addEventListener("click", e => {
  if (!document.querySelector(OPEN_MENU_SELECTOR)) return;     // nothing open → normal behaviour
  if (e.target.closest(MENU_CONTENT_SELECTOR)) return;         // clicked a menu item → let it act
  if (e.target.closest(MENU_TRIGGER_SELECTOR)) return;         // clicked a trigger → let it toggle/switch
  // Genuine outside click → dismiss only; swallow so the element beneath isn't activated.
  e.stopPropagation();
  e.preventDefault();
  closeAllFloatingMenus();
}, true);   // capture phase — must beat the target's handlers

// Mobile floating island (Search · New note) — reuses the top search field and the
// notes-pane "+" handlers.
$("island-search-btn")?.addEventListener("click", e => {
  e.stopPropagation();
  appEl.classList.add("search-open");   // mobile: reveal the search field (inert class on desktop)
  searchInput.focus();
});
$("island-newnote-btn")?.addEventListener("click", e => {
  e.stopPropagation();
  newNote();
});

// ── Report bug / feedback modal ───────────────────────────────────────────────
// Always goes to the real collector, even in demo mode — this is a separate,
// deliberately cross-origin call, not part of the app's own data (api()/demoApi
// would wrongly route it through the demo's local-storage shim).
const FEEDBACK_ENDPOINT = "https://feedback.setugk.com/api/feedback";

// Feedback lives as two Settings sections that share one form panel — "Report a
// bug" (section "bug") and "Send feedback" (section "feedback"). The section sets
// the report type (no Type dropdown), the panel title, and the message prompt.
let feedbackType = "bug";
function prepareFeedbackForm(section) {
  feedbackType = (section === "feedback") ? "feedback" : "bug";
  const isBug = feedbackType === "bug";
  $("feedback-panel-title").textContent = isBug ? "Report a bug" : "Send feedback";
  $("feedback-message").placeholder = isBug
    ? "What's broken? What did you expect to happen?"
    : "What's your idea or suggestion?";
  $("feedback-message").value = "";
  // Remember name/email across submissions (localStorage) so a repeat reporter
  // isn't retyping contact info every time — still fully optional either way.
  $("feedback-name").value = localStorage.getItem("feedbackName") || "";
  $("feedback-email").value = localStorage.getItem("feedbackEmail") || "";
}

$("feedback-send-btn").addEventListener("click", async () => {
  const message = $("feedback-message").value.trim();
  const type = feedbackType;
  const name = $("feedback-name").value.trim();
  const email = $("feedback-email").value.trim();
  if (!message) return;
  localStorage.setItem("feedbackName", name);
  localStorage.setItem("feedbackEmail", email);
  $("feedback-message").value = "";   // clear after sending; the section stays open
  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, type, name, email, app: "journery", version: window.APP_VERSION, instance: window.JOURNERY_NAME }),
    });
    if (!res.ok) throw new Error("bad response");
    showToast("Thanks — feedback sent!");
  } catch {
    showToast("Couldn't send feedback — check your connection");
  }
});
$("settings-folders-toggle").addEventListener("click", () => {
  state.showFolders = !state.showFolders;
  saveSyncedSetting("showFolders", state.showFolders);
  $("settings-folders-toggle").classList.toggle("on", state.showFolders);
  updateFoldersVisibility();
});
$("settings-dates-toggle").addEventListener("click", () => {
  state.showNoteDates = !state.showNoteDates;
  saveSyncedSetting("showNoteDates", state.showNoteDates);
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
  if (chev) {
    chev.classList.toggle("open", state.timelineExpanded);
    chev.closest(".nav-item")?.classList.toggle("expanded", state.timelineExpanded);
  }
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
  if (chev) {
    chev.classList.toggle("open", state.pinnedTagsExpanded);
    chev.closest(".nav-item")?.classList.toggle("expanded", state.pinnedTagsExpanded);
  }
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
    btn.dataset.tag = name;   // drop target: dragging a note here adds this tag
    btn.innerHTML = `<button class="tag-pin-btn pinned tag-pin-left" title="Unpin">${PIN_SVG}</button><span class="tag-label"><span class="tag-hash">#</span>${esc(name)}</span><span class="tag-right"><span class="tag-count">${tag.count}</span></span>`;
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
  if (chev) {
    chev.classList.toggle("open", state.allTagsExpanded);
    chev.closest(".nav-item")?.classList.toggle("expanded", state.allTagsExpanded);
  }
  list.innerHTML = "";
  const section = $("all-tags-section");
  if (section) section.style.display = !state.tags.length ? "none" : "";
  if (!state.allTagsExpanded || !state.tags.length) return;
  state.tags.forEach(tag => {
    const isPinned = state.pinnedTags.includes(tag.name);
    const isActive = state.context.type === "tag" && state.context.id === tag.name;
    const btn = document.createElement("button");
    btn.className = "tag-nav-item" + (isActive ? " active" : "");
    btn.dataset.tag = tag.name;   // drop target: dragging a note here adds this tag
    // Pin sits to the left, same as the Pinned section, for a consistent look.
    const pinBtn = isPinned
      ? `<button class="tag-pin-btn pinned tag-pin-left" title="Unpin">${PIN_SVG}</button>`
      : `<button class="tag-pin-btn tag-pin-left" title="Pin">${PIN_OUTLINE_SVG}</button>`;
    btn.innerHTML = `${pinBtn}<span class="tag-label"><span class="tag-hash">#</span>${esc(tag.name)}</span><span class="tag-right"><span class="tag-count">${tag.count}</span></span>`;
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
  // A note opened from search lives in the sidebar's results, not the notes
  // pane — so back should return there, keeping the query and results intact.
  setMobileView(searchActive ? "sidebar" : "notes");
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

// ── Search: live results shown under the search bar, inside the sidebar ─────────
// As you type, the nav is replaced by a results list in the same (root) view —
// no separate page, on desktop or mobile. Clearing the box restores the nav.
const searchResultsBox = $("search-results");
const sidebarNav = $("sidebar-nav");
let searchActive = false;
let searchSeq = 0;            // guards against out-of-order async responses
let searchDebounce = null;
let searchResultsData = [];

function updateSearchClear() {
  $("search-clear").classList.toggle("hidden", !searchInput.value);
}

function setSearchMode(on) {
  searchActive = on;
  sidebarNav.classList.toggle("hidden", on);
  searchResultsBox.classList.toggle("hidden", !on);
}

// Leave search mode and return to the default sidebar view.
function exitSearch() {
  clearTimeout(searchDebounce);
  searchSeq++;                // cancel any in-flight query
  searchInput.value = "";
  state.searchQuery = "";
  searchResultsData = [];
  searchResultsBox.innerHTML = "";
  updateSearchClear();
  setSearchMode(false);
}

function renderSearchResults(notes, q) {
  searchResultsData = notes;
  if (!notes.length) {
    searchResultsBox.innerHTML = `<div class="search-empty">No results for &ldquo;${esc(q)}&rdquo;</div>`;
    return;
  }
  searchResultsBox.innerHTML = notes.map(n => {
    const preview = (n.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
    return `<button class="search-result-item" type="button" data-note-id="${n.id}">
      <div class="search-result-title${n.title ? "" : " untitled"}">${n.title ? esc(n.title) : "Untitled"}</div>
      ${preview ? `<div class="search-result-preview">${esc(preview)}</div>` : ""}
    </button>`;
  }).join("");
  searchResultsBox.querySelectorAll(".search-result-item").forEach(el => {
    el.addEventListener("click", () => openSearchResult(el.dataset.noteId));
  });
}

function openSearchResult(id) {
  const n = searchResultsData.find(x => x.id === id);
  if (n) openNote(n);   // opens in the editor (mobile navigates there; back returns to the sidebar search)
}

async function runLiveSearch() {
  const q = searchInput.value.trim();
  state.searchQuery = q;
  if (!q) { exitSearch(); return; }
  setSearchMode(true);
  const seq = ++searchSeq;
  try {
    const notes = await api("GET", `/api/notes?q=${encodeURIComponent(q)}`);
    if (seq !== searchSeq) return;   // a newer keystroke superseded this response
    renderSearchResults(notes, q);
  } catch {
    if (seq === searchSeq) searchResultsBox.innerHTML = `<div class="search-empty">Search failed</div>`;
  }
}

searchInput.addEventListener("input", () => {
  updateSearchClear();
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) { exitSearch(); return; }      // removing the text returns to the default view immediately
  setSearchMode(true);                    // show the panel right away; results fill in after the debounce
  if (!searchResultsBox.innerHTML) searchResultsBox.innerHTML = `<div class="search-empty">Searching…</div>`;
  searchDebounce = setTimeout(runLiveSearch, 160);
});
searchInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  { e.preventDefault(); clearTimeout(searchDebounce); runLiveSearch(); }
  if (e.key === "Escape") { e.preventDefault(); closeSearchPanel(); }
});
// ✕: on mobile it closes the whole revealed field (the island brings it back); on
// desktop the field is always there, so just clear it and keep it focused to retype.
$("search-clear").addEventListener("click", () => {
  if (window.innerWidth <= 768) closeSearchPanel();
  else { exitSearch(); searchInput.focus(); }
});

// Fully dismiss the on-demand mobile search field: clear results, hide the field
// (via .search-open), drop the keyboard, and let the island return. `exitSearch`
// alone only returns to the nav — it intentionally leaves the field open so that
// deleting all the text lets you keep typing; this is the explicit close.
function closeSearchPanel() {
  exitSearch();
  appEl.classList.remove("search-open");
  searchInput.blur();
}

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
let activeTagCtxMenu = null;

function closeCtxMenus() {
  if (activeFolderCtxMenu) { activeFolderCtxMenu.remove(); activeFolderCtxMenu = null; }
  if (activeTagCtxMenu)    { activeTagCtxMenu.remove();    activeTagCtxMenu = null; }
}

// Keep a cursor-positioned menu on-screen (nudge left/up if it would overflow).
function clampCtxMenu(menu) {
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 8) + "px";
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 8) + "px";
  });
}

// Folder options — opened by the kebab (anchored) OR by right-click (at the
// cursor; pass coords). Same menu either way.
function openFolderCtxMenu(node, anchor, coords) {
  const wasOpen = activeFolderCtxMenu;
  closeCtxMenus();
  if (wasOpen && !coords) return;   // a second kebab click toggles it shut
  const menu = document.createElement("div");
  menu.className = "folder-ctx-menu";
  menu.innerHTML = `
    <button data-action="new">New subfolder</button>
    <button data-action="rename">Rename</button>
    <button data-action="move">Move to…</button>
    <button data-action="delete" class="danger">Delete folder</button>
  `;
  if (coords) { menu.style.left = coords.x + "px"; menu.style.top = coords.y + "px"; }
  else {
    const rect = anchor.getBoundingClientRect();
    menu.style.top   = (rect.bottom + 6) + "px";
    menu.style.right = (window.innerWidth - rect.right + 4) + "px";
  }
  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    closeCtxMenus();
    const a = btn.dataset.action;
    if (a === "new")    openFolderModal(null, node.id);
    if (a === "rename") openFolderModal(node);
    if (a === "move")   openFolderMoveModal(node);
    if (a === "delete") deleteFolder(node);
  });
  document.body.appendChild(menu);
  activeFolderCtxMenu = menu;
  if (coords) clampCtxMenu(menu);
  setTimeout(() => document.addEventListener("click", closeCtxMenus, { once: true }), 10);
}

// Tag options — right-click a sidebar tag. Same actions available elsewhere
// (pin/unpin in the sidebar, rename/delete in Settings → Tags, share in the
// tag view), gathered into one quick menu.
function openTagCtxMenu(tagName, coords) {
  closeCtxMenus();
  const isPinned = state.pinnedTags.includes(tagName);
  const menu = document.createElement("div");
  menu.className = "folder-ctx-menu";   // reuse the same context-menu styling
  menu.innerHTML = `
    <button data-action="pin">${isPinned ? "Unpin" : "Pin"}</button>
    <button data-action="rename">Rename</button>
    <button data-action="share">Share tag</button>
    <button data-action="delete" class="danger">Delete tag</button>
  `;
  menu.style.left = coords.x + "px";
  menu.style.top  = coords.y + "px";
  menu.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    closeCtxMenus();
    const a = btn.dataset.action;
    if (a === "pin")    isPinned ? unpinTag(tagName) : pinTag(tagName);
    if (a === "rename") renameTagFlow(tagName);
    if (a === "share")  openShareSheet({ kind: "tag", tag: tagName });
    if (a === "delete") deleteTagFlow(tagName);
  });
  document.body.appendChild(menu);
  activeTagCtxMenu = menu;
  clampCtxMenu(menu);
  setTimeout(() => document.addEventListener("click", closeCtxMenus, { once: true }), 10);
}

// Right-click a folder row or a sidebar tag → its options menu (same actions as
// the folder kebab / Settings→Tags, just faster). Delegated on the sidebar so
// it survives every re-render. Folder actions only need id/name, so the flat
// folder object from state.folders works (no tree node required).
document.querySelector(".sidebar")?.addEventListener("contextmenu", e => {
  const folderRow = e.target.closest(".folder-row");
  const tagItem   = e.target.closest(".tag-nav-item");
  if (folderRow && folderRow.dataset.folderId) {
    e.preventDefault();
    const folder = state.folders.find(f => f.id === folderRow.dataset.folderId);
    if (folder) openFolderCtxMenu(folder, null, { x: e.clientX, y: e.clientY });
  } else if (tagItem && tagItem.dataset.tag) {
    e.preventDefault();
    openTagCtxMenu(tagItem.dataset.tag, { x: e.clientX, y: e.clientY });
  }
});

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
  if (!isTouch) row.draggable = true;   // desktop drag-and-drop (see setupDragAndDrop)

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

// ── Drag & drop (desktop only) ─────────────────────────────────────────────
// Native HTML5 drag-and-drop as a faster alternative to the move picker: drag a
// folder onto another folder to nest it, or drag a note onto a folder (reassign
// its folder) or a tag (add that tag). Gated to non-touch — iOS has no reliable
// native DnD and the mobile drill-down layout shows source/target panes one at a
// time, so mobile keeps the modal picker (see setupDragAndDrop's isTouch guard).
// Handlers are delegated off a stable root, so they survive every re-render.
let dndItem = null;        // { type: 'folder'|'note', id } for the in-flight drag
let dndHighlight = null;   // the drop-target element currently highlighted

function dndClearHighlight() {
  if (dndHighlight) { dndHighlight.classList.remove("drop-target"); dndHighlight = null; }
}

// The valid drop-target element under the pointer for the current drag, or null.
function dndTargetFor(e) {
  if (!dndItem) return null;
  const folderRow = e.target.closest?.(".folder-row");
  const tagItem   = e.target.closest?.(".tag-nav-item");
  if (dndItem.type === "folder") {
    // folder → folder: reparent, but never into itself or its own subtree
    // (getDescendantIds includes the folder itself), which would orphan a cycle.
    if (folderRow && folderRow.dataset.folderId && !getDescendantIds(dndItem.id).has(folderRow.dataset.folderId)) {
      return folderRow;
    }
    // folder → the Folders section (its header/empty area, NOT a folder row):
    // move to the top level (parent_id = null), making it a sibling of the
    // root folders. Only offered when the folder is currently nested, so a
    // root folder dropped here isn't a confusing no-op. This is the only way to
    // UN-nest via DnD — dropping on a folder row always nests deeper.
    const foldersSection = e.target.closest?.("#folders-section");
    if (foldersSection && !folderRow) {
      const folder = state.folders.find(f => f.id === dndItem.id);
      if (folder && folder.parent_id) return foldersSection;
    }
    return null;
  }
  // note → folder (reassign) or note → tag (add the tag)
  if (folderRow && folderRow.dataset.folderId) return folderRow;
  if (tagItem && tagItem.dataset.tag) return tagItem;
  return null;
}

function setupDragAndDrop() {
  if (isTouch) return;   // desktop only; mobile keeps the modal picker
  const root = document.querySelector(".app") || document.body;

  root.addEventListener("dragstart", e => {
    const folderRow = e.target.closest?.(".folder-row");
    const noteItem  = e.target.closest?.(".note-item");
    let sourceEl = null;
    // Don't allow dragging trashed notes (they live in the Trash view).
    if (folderRow && folderRow.dataset.folderId) {
      dndItem = { type: "folder", id: folderRow.dataset.folderId };
      folderRow.classList.add("dragging");
      sourceEl = folderRow;
    } else if (noteItem && noteItem.dataset.noteId &&
               !noteItem.classList.contains("trash-note-item") &&
               !noteItem.classList.contains("note-item-trashed")) {
      dndItem = { type: "note", id: noteItem.dataset.noteId };
      noteItem.classList.add("dragging");
      sourceEl = noteItem;
    } else {
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag unless some data is set.
    try { e.dataTransfer.setData("text/plain", dndItem.id); } catch (_) {}
    // Custom drag image = a solid, opaque CLONE of the actual card/row being
    // dragged. The browser's DEFAULT drag image is a snapshot the engine forces
    // translucent and CSS can't reach (which is why bumping .dragging opacity did
    // nothing to the thing under the cursor). We hand it our own clone instead —
    // same card, just fully opaque with a lifted shadow — so what follows the
    // cursor looks like the card you grabbed. Rendered off-screen only long
    // enough for the browser to snapshot it synchronously, then removed.
    try {
      const rect  = sourceEl.getBoundingClientRect();
      const clone = sourceEl.cloneNode(true);
      clone.classList.remove("dragging", "active", "selected");
      clone.querySelectorAll(".note-checkbox").forEach(c => c.remove());
      clone.classList.add("drag-image");
      clone.style.width = rect.width + "px";
      document.body.appendChild(clone);
      // Offset keeps the card under the cursor at the exact point it was grabbed.
      e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
      requestAnimationFrame(() => clone.remove());
    } catch (_) {}
  });

  root.addEventListener("dragend", () => {
    root.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
    dndClearHighlight();
    dndItem = null;
  });

  root.addEventListener("dragover", e => {
    const target = dndTargetFor(e);
    if (!target) { dndClearHighlight(); return; }
    e.preventDefault();                       // required to allow a drop here
    e.dataTransfer.dropEffect = "move";
    if (target !== dndHighlight) {
      dndClearHighlight();
      target.classList.add("drop-target");
      dndHighlight = target;
    }
  });

  root.addEventListener("drop", e => {
    const target = dndTargetFor(e);
    dndClearHighlight();
    if (!target || !dndItem) return;
    e.preventDefault();
    const item = dndItem;
    dndItem = null;
    performDrop(item, target);
  });
}

async function performDrop(item, targetEl) {
  try {
    if (item.type === "folder") {
      // No dataset.folderId → the Folders-section (root) target: move to top level.
      const targetId = targetEl.dataset.folderId || null;
      const folder = state.folders.find(f => f.id === item.id);
      if (!folder || (folder.parent_id || null) === targetId) return;   // no-op (already there)
      const prevParent = folder.parent_id || null;
      await api("PUT", `/api/folders/${item.id}`, { parent_id: targetId });
      folder.parent_id = targetId;
      if (targetId) {
        state.expandedFolders.add(targetId);
        localStorage.setItem("expandedFolders", JSON.stringify([...state.expandedFolders]));
      }
      renderSidebar();
      const movedMsg = targetId
        ? `Moved “${folder.name}” into “${state.folders.find(f => f.id === targetId)?.name || "folder"}”`
        : `Moved “${folder.name}” to the top level`;
      showToast(movedMsg, { label: "Undo", fn: async () => {
        await api("PUT", `/api/folders/${item.id}`, { parent_id: prevParent });
        folder.parent_id = prevParent;
        renderSidebar();
      }});
      return;
    }

    // note drop — look it up in the current list, fall back to a fetch
    const noteId = item.id;
    const note = state.notes.find(n => n.id === noteId) || await api("GET", `/api/notes/${noteId}`);
    if (!note) return;

    if (targetEl.classList.contains("folder-row")) {
      const folderId = targetEl.dataset.folderId;
      if (note.folder_id === folderId) return;   // already in this folder
      const prevFolder = note.folder_id || null;
      const targetName = state.folders.find(f => f.id === folderId)?.name || "folder";
      await api("PUT", `/api/notes/${noteId}`, { folder_id: folderId });
      await loadNotes();
      showToast(`Moved to “${targetName}”`, { label: "Undo", fn: async () => {
        await api("PUT", `/api/notes/${noteId}`, { folder_id: prevFolder });
        await loadNotes();
      }});
    } else {
      const tagName = targetEl.dataset.tag;
      const prevTags = note.tags || [];
      if (prevTags.includes(tagName)) { showToast(`Already tagged #${tagName}`); return; }
      await api("PUT", `/api/notes/${noteId}`, { tags: [...prevTags, tagName] });
      state.tags = await api("GET", "/api/tags");
      renderSidebar();
      await loadNotes();
      showToast(`Added #${tagName}`, { label: "Undo", fn: async () => {
        await api("PUT", `/api/notes/${noteId}`, { tags: prevTags });
        state.tags = await api("GET", "/api/tags");
        renderSidebar();
        await loadNotes();
      }});
    }
  } catch (_) {
    showToast("Move failed");
  }
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

// Shows a "go to parent folder" chevron next to the pane title — only for a
// nested folder (has a parent_id) and only on desktop (mobile's drill-down
// back-btn already covers stepping back out of the notes pane).
function updateFolderUpBtn() {
  const btn = $("folder-up-btn");
  const folder = state.context.type === "folder" ? state.folders.find(f => f.id === state.context.id) : null;
  btn.classList.toggle("hidden", isMobile() || !folder || !folder.parent_id);
}

$("folder-up-btn").addEventListener("click", () => {
  const folder = state.folders.find(f => f.id === state.context.id);
  const parent = folder && folder.parent_id && state.folders.find(f => f.id === folder.parent_id);
  if (parent) navigateToFolder(parent);
});

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

// ── Cross-device settings sync ──────────────────────────────────────────────
// Display/content preferences that should follow the user across devices/sign-
// ins — persisted to BOTH localStorage (instant + offline) and the server
// key/value store (cross-device). Deliberately NOT synced: device-specific
// prefs (pane widths, dark-mode toggle) and ephemeral UI state (expand/collapse
// sections, focus mode) — those are meant to stay per-device.
const SYNCED_SETTINGS = ["showFolders", "showNoteDates", "dateDisplay", "sortBy", "recentsRange"];

// Write a synced setting locally (instant) and push to the server (best-effort).
function saveSyncedSetting(key, value) {
  localStorage.setItem(key, value);
  api("PUT", `/api/settings/${key}`, { value: String(value) }).catch(() => {});
}

// Apply a server value onto state + localStorage, parsing to each key's type.
function applySyncedSetting(key, value) {
  localStorage.setItem(key, value);
  if (key === "showFolders")        state.showFolders   = value === "true";
  else if (key === "showNoteDates") state.showNoteDates = value !== "false";
  else if (key === "dateDisplay")   state.dateDisplay   = value;
  else if (key === "sortBy")        state.sortBy        = value;
  else if (key === "recentsRange")  state.recentsRange  = value;
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadAll() {
  const [folders, tags, all, trash, pinnedTagsSetting, themeSetting, ...syncedResults] = await Promise.all([
    api("GET", "/api/folders"),
    api("GET", "/api/tags"),
    api("GET", "/api/notes"),
    api("GET", "/api/trash"),
    api("GET", "/api/settings/pinnedTags"),
    api("GET", "/api/settings/activeTheme"),
    ...SYNCED_SETTINGS.map(k => api("GET", `/api/settings/${k}`)),
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
    if (local) {
      try { applyTheme(JSON.parse(local)); } catch {}
      // Bootstrap: server has no theme yet but this device does — push it up so
      // other devices pick it up (mirrors pinnedTags). Fixes a theme that was
      // set before cross-device sync existed and so never reached the server.
      api("PUT", "/api/settings/activeTheme", { value: local }).catch(() => {});
    }
  }

  // Synced display prefs: the server value wins if present; otherwise bootstrap
  // this device's local value up to the server (self-heals prefs set before
  // sync). Then refresh the affected UI (renderSidebar/loadNotes below cover the
  // folder tree + notes list; these cover the sort/date/recents indicators).
  SYNCED_SETTINGS.forEach((key, i) => {
    const v = syncedResults[i] && syncedResults[i].value;
    if (v != null) applySyncedSetting(key, v);
    else {
      const local = localStorage.getItem(key);
      if (local != null) api("PUT", `/api/settings/${key}`, { value: String(local) }).catch(() => {});
    }
  });
  updateSortUI();
  updateDatePicker();
  updateRecentsRangePicker();
  if (state.context.type === "recents") paneTitle.textContent = recentsPaneTitle();
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

const sortMenu     = $("sort-menu");
const newItemMenu  = $("new-item-menu");
const notesOverflowMenu = $("notes-overflow-menu");

function closeHeaderMenus() {
  sortMenu.classList.add("hidden");
  newItemMenu.classList.add("hidden");
  notesOverflowMenu.classList.add("hidden");
}

$("sort-btn").addEventListener("click", e => {
  e.stopPropagation();
  newItemMenu.classList.add("hidden");
  notesOverflowMenu.classList.add("hidden");
  sortMenu.classList.toggle("hidden");
});

// Sort options live in two menus (inline sort + tag-view overflow) — bind both.
document.querySelectorAll("#sort-menu [data-sort], #notes-overflow-menu [data-sort]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sortBy = btn.dataset.sort;
    saveSyncedSetting("sortBy", state.sortBy);
    closeHeaderMenus();
    updateSortUI();
    renderNotesList();
  });
});

function updateSortUI() {
  document.querySelectorAll("#sort-menu [data-sort], #notes-overflow-menu [data-sort]").forEach(btn => {
    btn.classList.toggle("active-sort", btn.dataset.sort === state.sortBy);
  });
}

// ── Tag-view overflow menu ────────────────────────────────────────────────────

$("notes-overflow-btn").addEventListener("click", e => {
  e.stopPropagation();
  sortMenu.classList.add("hidden");
  newItemMenu.classList.add("hidden");
  notesOverflowMenu.classList.toggle("hidden");
});
$("share-tag-option").addEventListener("click", () => {
  notesOverflowMenu.classList.add("hidden");
  if (state.context.type === "tag") openShareSheet({ kind: "tag", tag: state.context.id });
});
$("select-notes-option").addEventListener("click", () => {
  notesOverflowMenu.classList.add("hidden");
  enterSelectMode();
});

// ── New item dropdown ─────────────────────────────────────────────────────────

$("new-note-btn").addEventListener("click", e => {
  e.stopPropagation();
  if (state.context.type === "folder") {
    sortMenu.classList.add("hidden");
    notesOverflowMenu.classList.add("hidden");
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

document.addEventListener("click", closeHeaderMenus);
sortMenu.addEventListener("click", e => e.stopPropagation());
newItemMenu.addEventListener("click", e => e.stopPropagation());
notesOverflowMenu.addEventListener("click", e => e.stopPropagation());

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
  // Tag view collapses sort/select/share into the overflow menu.
  notesPaneEl.classList.toggle("tag-view", state.context.type === "tag");
  updateFolderUpBtn();

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
      <div class="note-item${isActive ? " active" : ""}${isSelected ? " selected" : ""}" data-note-id="${n.id}"${!isTouch && !state.selectMode ? ' draggable="true"' : ''}>
        ${state.selectMode ? `<input type="checkbox" class="note-checkbox"${isSelected ? " checked" : ""}>` : ""}
        <div class="note-item-title${n.title ? "" : " untitled"}">${n.title ? esc(n.title) : "Untitled"}</div>
        ${preview ? `<div class="note-item-preview">${esc(preview)}</div>` : ""}
        ${chips ? `<div class="note-item-tags">${chips}</div>` : ""}
        <div class="note-item-meta">${dateStr}</div>
      </div>`;
  }).join("");

  if (state.tagTrashedNotes.length) {
    const isTrashExp = state.tagTrashExpanded;
    html += `<button class="subfolder-section-toggle" id="tag-trash-toggle">
      <svg class="subfolder-toggle-chev${isTrashExp ? " open" : ""}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      In Trash
      <span class="subfolder-section-count">${state.tagTrashedNotes.length}</span>
    </button>`;
    if (isTrashExp) {
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
  }

  notesList.innerHTML = html;

  const tagTrashToggle = $("tag-trash-toggle");
  if (tagTrashToggle) {
    tagTrashToggle.addEventListener("click", () => {
      state.tagTrashExpanded = !state.tagTrashExpanded;
      localStorage.setItem("tagTrashExpanded", state.tagTrashExpanded);
      renderNotesList();
    });
  }

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

const toolbarBtns = [$("editor-back-btn"), $("editor-save-btn"), $("editor-menu-btn"), $("format-toggle-btn")];

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
  // Loading a note's content is not a user edit — suppress the undo/redo
  // MutationObserver across both this synchronous clear and the deferred
  // rAF load below, then reset history once the real content has landed.
  suppressUndoTracking = true;
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
    // Deferred to a microtask so it runs AFTER the undo MutationObserver's own
    // queued callback for this note's content load — that callback is queued
    // at the moment of the innerHTML write above, so a microtask queued here
    // (after) always runs later (strict FIFO), guaranteeing the observer still
    // sees suppressUndoTracking===true and ignores the load.
    queueMicrotask(() => {
      suppressUndoTracking = false;
      undoResetForNote();
    });
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
// Debounce after the last keystroke before autosaving. Short enough to feel
// near-instant; still batches a burst of typing into one write. SQLite writes
// are cheap for a single user, so the extra requests from a shorter window are
// a non-issue. (Was 2000ms.)
const SAVE_DEBOUNCE_MS = 700;

function setAutosave(msg) { autosaveEl.textContent = msg; }

function scheduleSave() {
  if (!state.note || state.note.deleted_at) return;
  state.dirty = true;
  setAutosave("Editing…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNoteNow, SAVE_DEBOUNCE_MS);
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
noteTitle.addEventListener("input", () => { autosizeTitle(); applyHeaderTitle(); scheduleSave(); });
noteTitle.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); noteBody.focus(); }
});
window.addEventListener("resize", () => { if (state.note) autosizeTitle(); });

// ── Header title: mirror the note title next to the back chevron once the real
// title scrolls up out of the editor body, cross-fading with the autosave text.
const editorHeaderTitle = $("editor-header-title");
const editorToolbar     = document.querySelector(".editor-toolbar");
let titleOutOfView = false;
function applyHeaderTitle() {
  const val = noteTitle.value.trim();
  const show = titleOutOfView && val.length > 0;
  editorHeaderTitle.textContent = val;
  editorHeaderTitle.classList.toggle("visible", show);
  editorToolbar.classList.toggle("title-pinned", show);
}
// Tap the pinned title to jump back to the top of the note.
editorHeaderTitle.addEventListener("click", () => {
  editorBody.scrollTo({ top: 0, behavior: "smooth" });
});
new IntersectionObserver((entries) => {
  titleOutOfView = !entries[0].isIntersecting;
  applyHeaderTitle();
}, { root: editorBody, threshold: 0 }).observe(noteTitle);
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

// Text on the CURRENT VISUAL LINE, from its start to the caret. The line starts
// at the nearest preceding <br> (or the block start if none). Needed because a
// note's lines aren't always their own block: pasted/imported content puts
// several lines inside one block joined by <br>, and reading from the block
// start would prepend the earlier lines' text — so "* " on line 3 came out as
// "line1line2*" and the marker check never matched. Note: Range.toString() drops
// <br> entirely (no "\n"), so we must walk the nodes and reset at each <br>.
function mdLineBeforeCaret(block, range) {
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch (_) { return null; }
  const frag = pre.cloneContents();
  let line = '';
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR') line = '';
      else if (child.nodeType === Node.TEXT_NODE) line += child.textContent;
      else walk(child);
    }
  })(frag);
  return line;
}

// Block-level tag names that act as a "line" boundary inside an editor block —
// used by mdInsertDivider so a block containing nested block children (not just
// <br>-joined inline runs) still splits at the right line instead of the whole
// block. HR is included so an existing divider is never crossed.
const MD_BLOCK_TAGS = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','OL','UL','LI','HR','BLOCKQUOTE','PRE','TABLE','FIGURE']);

function mdInsertDivider(block, range) {
  const hr    = document.createElement('hr');
  const after = document.createElement('div');
  after.appendChild(document.createElement('br'));
  const placeCaret = (el) => {
    const r = document.createRange(); r.setStart(el, 0); r.collapse(true);
    const s = window.getSelection(); if (s) { s.removeAllRanges(); s.addRange(r); }
  };
  // Caret at the START of an existing following block (into its first <li> if a list).
  const placeCaretStart = (el) => {
    let target = el;
    if (el.nodeName === 'UL' || el.nodeName === 'OL') target = el.querySelector('li') || el;
    const r = document.createRange(); r.selectNodeContents(target); r.collapse(true);
    const s = window.getSelection(); if (s) { s.removeAllRanges(); s.addRange(r); }
  };

  // No caret info, or the whole editor is the block → original whole-block behavior.
  if (block === noteBody || !range) {
    if (block === noteBody) { noteBody.innerHTML = ''; noteBody.appendChild(hr); noteBody.appendChild(after); }
    else { block.replaceWith(hr); hr.insertAdjacentElement('afterend', after); }
    placeCaret(after);
    scheduleSave();
    return;
  }

  // Split the block at the caret's current LINE so a divider replaces ONLY that
  // line and keeps its siblings. A "line" is bounded by a <br> OR by a
  // block-level element sibling — because a block can itself contain nested
  // block children (h3/ol/div, e.g. from a paste or a contentEditable artifact),
  // not only <br>-joined inline runs. The old code treated ONLY <br> as a
  // boundary, so in a block whose children are block elements with no <br>
  // between them the walk spanned the ENTIRE block and the divider wiped every
  // line in it — reported as "adding a divider deleted two whole sections."
  let node = range.startContainer;
  if (node === block) node = block.childNodes[Math.max(0, range.startOffset - 1)] || block.firstChild;
  while (node && node.parentNode && node.parentNode !== block) node = node.parentNode; // climb to block's direct child
  if (!node) { block.replaceWith(hr); hr.insertAdjacentElement('afterend', after); placeCaret(after); scheduleSave(); return; }

  const isLineBoundary = (n) => n && (n.nodeName === 'BR' || MD_BLOCK_TAGS.has(n.nodeName));
  let first, last;
  if (MD_BLOCK_TAGS.has(node.nodeName)) {
    first = last = node;  // the caret's line is itself a whole block-level element
  } else {
    first = node; while (first.previousSibling && !isLineBoundary(first.previousSibling)) first = first.previousSibling;
    last  = node; while (last.nextSibling  && !isLineBoundary(last.nextSibling))  last  = last.nextSibling;
  }
  const brBefore = first.previousSibling && first.previousSibling.nodeName === 'BR' ? first.previousSibling : null;
  const brAfter  = last.nextSibling  && last.nextSibling.nodeName  === 'BR' ? last.nextSibling  : null;

  // Everything AFTER the current line moves into a new block below the divider.
  // Start after the trailing <br> separator if there is one, else right after
  // `last` (the block-child case has no separating <br>).
  const afterBlock = document.createElement('div');
  { let n = brAfter ? brAfter.nextSibling : last.nextSibling;
    while (n) { const nx = n.nextSibling; afterBlock.appendChild(n); n = nx; } }

  // Drop the current line (the "--" marker) and its bounding <br>s.
  let n = first;
  while (n) { const nx = n.nextSibling; const stop = (n === last); n.remove(); if (stop) break; n = nx; }
  if (brBefore) brBefore.remove();
  if (brAfter)  brAfter.remove();

  // `block` now holds the lines ABOVE the divider (may be empty).
  const blockEmpty = !block.textContent.trim() && !block.querySelector('img,hr,li');
  if (blockEmpty) block.replaceWith(hr);
  else            block.insertAdjacentElement('afterend', hr);

  if (afterBlock.childNodes.length) {
    hr.insertAdjacentElement('afterend', afterBlock);
    placeCaret(afterBlock);
  } else if (hr.nextSibling) {
    // Content already follows the divider — don't add a phantom empty line
    // (it can't be deleted without also removing the <hr>). Caret into it.
    placeCaretStart(hr.nextSibling);
  } else {
    // Divider is last — a trailing editable line is needed to type after it.
    hr.insertAdjacentElement('afterend', after);
    placeCaret(after);
  }
  scheduleSave();
}

function mdInsertList(block, tag, startNum) {
  const list = document.createElement(tag);
  if (tag === 'ol' && Number.isInteger(startNum) && startNum !== 1) list.setAttribute('start', String(startNum));
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
// its start. Built manually (not via execCommand): WebKit/iOS leaves the caret
// OUTSIDE the new <li> after insertUnorderedList, so typed text lands on the next
// line. We move the current visual line's nodes into a fresh <li>, strip the
// marker, preserve <br>-joined siblings (split the block), and place the caret in
// the <li> ourselves — deterministic across engines.
function mdMakeList(markerLen, tag, startNum) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const block = mdActiveBlock();
  if (!block) return;

  const list = document.createElement(tag === 'ol' ? 'ol' : 'ul');
  // Honor the number the user actually typed: "3." starts the list at 3, not 1,
  // so a numbered list can pick up where it left off after a break of notes or
  // other blocks. start=1 is the HTML default, so no attribute is needed there.
  if (tag === 'ol' && Number.isInteger(startNum) && startNum !== 1) list.setAttribute('start', String(startNum));
  const li   = document.createElement('li');
  list.appendChild(li);

  // Caret into the <li>: at the end of its content (start when empty).
  const caretInLi = () => {
    const r = document.createRange();
    r.selectNodeContents(li); r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  };
  const fillIfEmpty = () => {
    if (!li.textContent && !li.querySelector('br,img')) li.appendChild(document.createElement('br'));
  };

  // Whole editor is the block (empty/first line): just drop an empty bullet in.
  if (block === noteBody) {
    fillIfEmpty();
    noteBody.innerHTML = '';
    noteBody.appendChild(list);
    caretInLi();
    updateNoteBodyPlaceholder(); scheduleSave();
    return;
  }

  // Find the caret's visual line within the block (so <br>-joined siblings survive).
  let node = range.startContainer;
  if (node === block) node = block.childNodes[Math.max(0, range.startOffset - 1)] || block.firstChild;
  while (node && node.parentNode && node.parentNode !== block) node = node.parentNode;
  let first = node, last = node;
  if (node) {
    while (first.previousSibling && first.previousSibling.nodeName !== 'BR') first = first.previousSibling;
    while (last.nextSibling  && last.nextSibling.nodeName  !== 'BR') last  = last.nextSibling;
  }
  const brBefore = first && first.previousSibling && first.previousSibling.nodeName === 'BR' ? first.previousSibling : null;
  const brAfter  = last  && last.nextSibling  && last.nextSibling.nodeName  === 'BR' ? last.nextSibling  : null;

  // Move the line's nodes into the <li>.
  let n = first;
  while (n) { const nx = n.nextSibling; const stop = (n === last); li.appendChild(n); if (stop) break; n = nx; }

  // Strip the leading marker (markerLen chars) + one following space if present
  // (the space is the prevented trigger when typing, but can be literal in pasted
  // "* text" content) from the <li>'s first text.
  let t = li;
  while (t && t.nodeType !== Node.TEXT_NODE) t = t.firstChild;
  if (t && t.nodeType === Node.TEXT_NODE) {
    t.deleteData(0, Math.min(markerLen, t.length));
    if (t.data && t.data[0] === ' ') t.deleteData(0, 1);
  }
  fillIfEmpty();

  // Lines below move to a new block; drop the line's bounding <br>s.
  const afterBlock = document.createElement('div');
  if (brAfter) { let m = brAfter.nextSibling; while (m) { const nx = m.nextSibling; afterBlock.appendChild(m); m = nx; } }
  if (brBefore) brBefore.remove();
  if (brAfter)  brAfter.remove();

  const blockEmpty = !block.textContent.trim() && !block.querySelector('img,hr,li,ul,ol');
  if (blockEmpty) block.replaceWith(list);
  else            block.insertAdjacentElement('afterend', list);
  if (afterBlock.childNodes.length) list.insertAdjacentElement('afterend', afterBlock);

  caretInLi();
  updateNoteBodyPlaceholder(); scheduleSave();
}

// ── Undo / redo ────────────────────────────────────────────────────────────
// contenteditable's NATIVE undo (whatever Cmd+Z does by default) only tracks
// edits the browser itself performed. A lot of this editor's features —
// mdInsertList/mdInsertDivider, indentLi/outdentLi, the code/link unwrap
// paths in applyFormat, checklist toggling, and paste auto-linking — mutate
// the DOM directly via plain JS, invisible to that native stack. Once native
// undo has to step back through one of those edits, its bookkeeping no
// longer matches the real DOM and it goes erratic: a Cmd+Z that does
// nothing, then one that jumps back past several unrelated words at once.
// Confirmed by reproducing it directly (typed into a bullet list created by
// mdInsertList; undo went inert for two presses at the list-creation
// boundary, then jumped back into unrelated earlier text).
//
// Fix: Journery owns Cmd+Z/Cmd+Shift+Z entirely and never calls the native
// undo command. History is a plain array of {html, sel} snapshots. A
// MutationObserver — not per-feature wiring — drives checkpointing, so this
// automatically covers every mutation path above AND any future one without
// needing to remember to wire it in. Consecutive mutations within a short
// idle window collapse into one checkpoint (matches how mainstream editors
// group fast bursts of typing into one undo step); `forceCheckpointBoundary`
// is used at a few points (paste, Tab-indent) where merging with adjacent
// typing would be surprising even inside that window.
let undoStack = [];
let redoStack = [];
let lastQuietSnapshot = null;   // content as of the last idle moment — the checkpoint candidate for the NEXT burst
let pendingCheckpoint = null;   // checkpoint for the burst currently in progress, once one starts
let checkpointTimer = null;
let suppressUndoTracking = false; // true while loading a note or applying history — not a user edit
const UNDO_DEBOUNCE_MS = 600;
const UNDO_MAX_DEPTH = 100;

// Serialize the caret/selection as plain character offsets into noteBody's
// content, walking the DOM in document order (not Range.toString() — it
// silently drops <br>, a gotcha already hit elsewhere in this file). <br>
// and the boundary between top-level block "lines" each count as one
// implicit newline, matching how the rest of the editor already reasons
// about line structure. Offsets (not node references) are what let a
// snapshot be restored after innerHTML has been replaced wholesale.
function undoTextOffset(targetNode, targetOffset) {
  let count = 0, result = -1;
  (function visit(node) {
    if (result !== -1) return;
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) { result = count + targetOffset; return; }
      for (let i = 0; i < targetOffset && i < node.childNodes.length; i++) visit(node.childNodes[i]);
      if (result === -1) result = count;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += node.textContent.length;
    } else if (node.nodeName === 'BR') {
      count += 1;
    } else {
      for (const child of node.childNodes) { visit(child); if (result !== -1) return; }
      if (node.parentElement === noteBody && node.nextSibling) count += 1;
    }
  })(noteBody);
  return result === -1 ? count : result;
}

function undoCaretOffsets() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !noteBody.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  return {
    start: undoTextOffset(r.startContainer, r.startOffset),
    end:   undoTextOffset(r.endContainer, r.endOffset),
  };
}

// Inverse of undoTextOffset: walk the (freshly restored) DOM consuming the
// same implicit character count, and return the (node, offset) at which a
// Range should land for a given target offset.
function undoPositionAtOffset(targetOffset) {
  let count = 0, result = null;
  (function visit(node) {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (count + len >= targetOffset) { result = { node, offset: targetOffset - count }; return; }
      count += len;
    } else if (node.nodeName === 'BR') {
      if (count + 1 >= targetOffset) {
        const idx = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
        result = { node: node.parentNode, offset: idx + 1 };
        return;
      }
      count += 1;
    } else {
      for (const child of Array.from(node.childNodes)) { visit(child); if (result) return; }
      if (node.parentElement === noteBody && node.nextSibling) count += 1;
    }
  })(noteBody);
  return result || { node: noteBody, offset: noteBody.childNodes.length };
}

function undoRestoreCaret(offsets) {
  if (!offsets) return;
  try {
    const startPos = undoPositionAtOffset(offsets.start);
    const endPos = offsets.end === offsets.start ? startPos : undoPositionAtOffset(offsets.end);
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { /* fall back to no caret restore — better than throwing */ }
}

function undoCaptureSnapshot() {
  return { html: noteBody.innerHTML, sel: undoCaretOffsets() };
}

function undoFinalizeCheckpoint() {
  if (checkpointTimer) { clearTimeout(checkpointTimer); checkpointTimer = null; }
  if (!pendingCheckpoint) return;
  undoStack.push(pendingCheckpoint);
  if (undoStack.length > UNDO_MAX_DEPTH) undoStack.shift();
  pendingCheckpoint = null;
  lastQuietSnapshot = undoCaptureSnapshot();
}

// Explicit boundary for actions that should never merge with adjacent
// typing even if they land inside the debounce window — paste and
// Tab/Shift+Tab list indent are the clearest cases (undoing a paste should
// remove exactly and only what was pasted).
function forceCheckpointBoundary() {
  undoFinalizeCheckpoint();
  lastQuietSnapshot = undoCaptureSnapshot();
}

function undoResetForNote() {
  if (checkpointTimer) { clearTimeout(checkpointTimer); checkpointTimer = null; }
  undoStack = [];
  redoStack = [];
  pendingCheckpoint = null;
  lastQuietSnapshot = undoCaptureSnapshot();
}

function performUndo() {
  if (checkpointTimer) { clearTimeout(checkpointTimer); checkpointTimer = null; }
  if (pendingCheckpoint) { undoStack.push(pendingCheckpoint); pendingCheckpoint = null; }
  if (!undoStack.length) return;
  const checkpoint = undoStack.pop();
  redoStack.push(undoCaptureSnapshot());
  applyUndoSnapshot(checkpoint);
}

function performRedo() {
  if (!redoStack.length) return;
  const checkpoint = redoStack.pop();
  undoStack.push(undoCaptureSnapshot());
  applyUndoSnapshot(checkpoint);
}

function applyUndoSnapshot(snap) {
  suppressUndoTracking = true;
  noteBody.innerHTML = snap.html;
  undoRestoreCaret(snap.sel);
  updateNoteBodyPlaceholder();
  decorateLinks();
  lastQuietSnapshot = undoCaptureSnapshot();
  scheduleSave();
  // Deferred to a microtask — see the comment on the equivalent pattern in
  // openNote(). Clearing this synchronously would flip it back to false
  // BEFORE the MutationObserver's own queued callback for the innerHTML
  // write above actually runs, so it would wrongly treat our own undo/redo
  // restore as a fresh edit and wipe the other stack.
  queueMicrotask(() => { suppressUndoTracking = false; });
}

new MutationObserver(() => {
  if (suppressUndoTracking) return;
  if (!pendingCheckpoint) {
    pendingCheckpoint = lastQuietSnapshot || undoCaptureSnapshot();
    redoStack = [];
  }
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(undoFinalizeCheckpoint, UNDO_DEBOUNCE_MS);
}).observe(noteBody, {
  childList: true, subtree: true, characterData: true,
  attributes: true, attributeFilter: ['class'], // catches checklist checkbox toggles (li.classList.toggle('done'))
});

// Registered before the "Editor keyboard shortcuts" keydown listener further
// down, so it runs first (same-element listeners fire in registration
// order) — no other branch there reacts to Cmd/Ctrl+Z, but this keeps intent
// explicit regardless.
noteBody.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) performRedo(); else performUndo();
  }
});

// Word-boundary checkpointing. The 600ms idle debounce alone isn't enough:
// real continuous typing often has gaps well under 600ms between words, so a
// whole sentence typed at a normal pace would merge into one undo step and
// Cmd+Z would remove far more than "the last word" — reported directly after
// shipping the debounce-only version. Fix: whenever the character about to
// be inserted is a word/sentence boundary (space, newline, tab, or common
// punctuation), finalize whatever was typed so far as its own checkpoint
// BEFORE that character lands, so each word becomes its own undo step
// regardless of typing speed. The debounce timer remains as a fallback for
// the last word before a pause (which has no following boundary character).
const UNDO_BOUNDARY_CHARS = new Set([' ', '\n', '\t', '.', ',', '!', '?', ';', ':']);
noteBody.addEventListener('beforeinput', e => {
  if (e.inputType === 'insertText' && e.data && UNDO_BOUNDARY_CHARS.has(e.data)) {
    undoFinalizeCheckpoint();
  }
});

// beforeinput fires BEFORE the character lands in the DOM.
// e.data is the exact character the user is typing — reliable on iOS virtual keyboard.
noteBody.addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertText') return;
  const char  = e.data || '';
  const block = mdActiveBlock();
  if (!block) return;
  // Already inside a list item → markdown shortcuts don't apply (and mdActiveBlock
  // is the <ul>/<ol>, whose "line" logic would mangle it, e.g. "* " at the start of
  // a bullet built a nested <li><li>…</li></li>). Let the character land literally.
  if (currentLi()) return;

  if (char === ' ') {
    // Look at the text on the current VISUAL LINE up to the caret — so a marker
    // typed in FRONT of existing text triggers the list, AND it works whether the
    // line is its own <div> or a <br>-joined line inside a shared block (pasted /
    // imported notes). The old check read from the block start, which broke on
    // any line below the first in a <br>-joined block.
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const before = mdLineBeforeCaret(block, range);
    if (before == null) return;
    if (before === '*' || before === '-') { e.preventDefault(); mdMakeList(1, 'ul'); return; }
    if (/^\d+\.$/.test(before))            { e.preventDefault(); mdMakeList(before.length, 'ol', parseInt(before, 10)); return; }
    return;
  }
  // Third dash → divider (catches "--" + "-", and "–" + "-" after iOS autocorrect).
  // Line-aware (like the list check) so it fires on a <br>-joined line too, not
  // only a line that's its own block.
  if (char === '-') {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const cur = (mdLineBeforeCaret(block, range) || '').trim();
    // Third dash → divider. "--" (literal) OR a single en/em-dash (iOS smart
    // punctuation collapses two hyphens into one "–"/"—") both mean two dashes so
    // far, so a third makes three.
    if (cur === '--' || cur === '–' || cur === '—') { e.preventDefault(); mdInsertDivider(block, range); }
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
    const raw   = mdBlockText(block);
    const sel   = window.getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    // Divider check is line-aware (works on a <br>-joined line); the list
    // fallbacks stay whole-block (they only ever rescue a truly empty line).
    const line  = (range ? (mdLineBeforeCaret(block, range) || '') : raw).trim();
    // Only THREE-dash equivalents — NOT a bare "—"/"–", which is just two dashes
    // after iOS autocorrect (and also stops em-dashes in prose becoming dividers).
    if (['---', '—-', '–-', '——'].includes(line)) {
      mdInsertDivider(block, range);
    } else if (raw === '* ' || raw === '- ') {
      mdInsertList(block, 'ul');
    } else if (/^\d+\. $/.test(raw)) {
      mdInsertList(block, 'ol', parseInt(raw, 10));
    }
  }
  scheduleSave();
});

// Detect http(s)/www URLs in pasted plain text and turn them into real <a>
// links. Deliberately conservative: only http(s):// and www.-prefixed
// domains, not bare "word.tld" tokens (too many false positives — "e.g.",
// version numbers, etc.). Trims trailing sentence punctuation and unbalanced
// closing brackets picked up by the greedy match (e.g. "(see https://x.com)").
const PASTE_URL_PATTERN = /\b(?:https?:\/\/[^\s<>"'\)\]]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#][^\s<>"'\)\]]*)?)/gi;

function linkifyFragment(text) {
  const frag = document.createDocumentFragment();
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    if (i > 0) frag.appendChild(document.createElement("br"));
    let last = 0, m;
    PASTE_URL_PATTERN.lastIndex = 0;
    while ((m = PASTE_URL_PATTERN.exec(line))) {
      if (m.index > last) frag.appendChild(document.createTextNode(line.slice(last, m.index)));
      let url = m[0], trail = "";
      const punct = url.match(/[.,;:!?]+$/);
      if (punct) { trail = punct[0]; url = url.slice(0, -trail.length); }
      while (/[)\]]$/.test(url)) {
        const close = url.slice(-1), open = close === ")" ? "(" : "[";
        const opens  = (url.match(new RegExp("\\" + open, "g"))  || []).length;
        const closes = (url.match(new RegExp("\\" + close, "g")) || []).length;
        if (closes <= opens) break;
        trail = close + trail;
        url = url.slice(0, -1);
      }
      const a = document.createElement("a");
      a.href = /^https?:\/\//i.test(url) ? url : "https://" + url;
      a.textContent = url;
      frag.appendChild(a);
      if (trail) frag.appendChild(document.createTextNode(trail));
      last = m.index + m[0].length;
    }
    if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)));
  });
  return frag;
}

// Sanitize pasted HTML down to the structure Journery itself uses, so copy-paste
// keeps a checklist a checklist (and lists/headings/bold/links/etc. survive)
// while stripping everything unsafe or messy (scripts, styles, colours, spans,
// classes we don't own). Whitelist approach: allowed tags keep their tag but
// lose all attributes except a safe <a href> and the task-list / done classes;
// disallowed-but-harmless tags are unwrapped to their contents; script/style
// and other non-content tags are dropped whole (so their text can't leak).
const PASTE_ALLOWED_TAGS = new Set(['P','DIV','BR','UL','OL','LI','STRONG','B','EM','I','U','S','STRIKE','A','CODE','PRE','BLOCKQUOTE','H1','H2','H3','HR']);
const PASTE_DROP_TAGS = new Set(['SCRIPT','STYLE','HEAD','META','LINK','TITLE','NOSCRIPT','IFRAME','OBJECT','EMBED','SVG','MATH','TEMPLATE','IMG','VIDEO','AUDIO','CANVAS','FORM','INPUT','BUTTON','SELECT','TEXTAREA']);
function pasteSafeHref(el) {
  const h = (el.getAttribute('href') || '').trim();
  return /^(https?:|mailto:|tel:)/i.test(h) ? h : null;
}
function sanitizePastedHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (node) => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return; // keep text nodes as-is
      const el = child, tag = el.tagName;
      if (PASTE_DROP_TAGS.has(tag)) { el.remove(); return; }
      const isDeadLink = tag === 'A' && !pasteSafeHref(el);
      if (!PASTE_ALLOWED_TAGS.has(tag) || isDeadLink) {
        walk(el);                            // clean descendants, then unwrap this tag
        el.replaceWith(...el.childNodes);
        return;
      }
      const href = tag === 'A' ? pasteSafeHref(el) : null;
      const keepClass = [];
      if (tag === 'UL' && el.classList.contains('task-list')) keepClass.push('task-list');
      if (tag === 'LI' && el.classList.contains('done')) keepClass.push('done');
      while (el.attributes.length) el.removeAttribute(el.attributes[0].name);
      if (href) el.setAttribute('href', href);
      if (keepClass.length) el.className = keepClass.join(' ');
      walk(el);
    });
  };
  walk(tpl.content);
  return tpl.content;
}

// ── Markdown as the reliable clipboard channel for list structure ─────────────
// Firefox's clipboard mangles copied HTML badly: it drops the <ul>/<ol> wrapper
// AND every class, handing the paste handler bare `<li>text</li>` — so whether a
// list was a checklist, a bullet list, or numbered is simply GONE from the HTML,
// unrecoverable. text/plain, by contrast, is never sanitized by any browser. So
// on copy we also serialize lists to markdown (`- [ ] `, `- [x] `, `- `, `1. `)
// into text/plain, and on paste we rebuild lists from that whenever the HTML is
// degraded/missing. Bonus: pasting markdown checklists from anywhere now works.

function liOwnText(li) { // an <li>'s own text, excluding any nested sub-list
  let s = "";
  li.childNodes.forEach(n => {
    if (n.nodeType === Node.ELEMENT_NODE && (n.tagName === "UL" || n.tagName === "OL")) return;
    s += n.textContent;
  });
  return s.replace(/\s+/g, " ").trim();
}
function domToMarkdown(root) {
  const out = [];
  const walkList = (listEl, depth) => {
    const ordered = listEl.tagName === "OL";
    const task = listEl.classList.contains("task-list");
    let n = 1;
    [...listEl.children].forEach(li => {
      if (li.tagName !== "LI") return;
      const marker = task ? (li.classList.contains("done") ? "- [x] " : "- [ ] ")
                   : ordered ? `${n++}. ` : "- ";
      out.push("  ".repeat(depth) + marker + liOwnText(li));
      [...li.children].forEach(c => {
        if (c.tagName === "UL" || c.tagName === "OL") walkList(c, depth + 1);
      });
    });
  };
  [...root.childNodes].forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent.trim()) out.push(node.textContent); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.tagName === "UL" || node.tagName === "OL") walkList(node, 0);
    else if (node.tagName === "BR") out.push("");
    else out.push(node.textContent);
  });
  return out.join("\n");
}

const MD_LIST_LINE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(\[([ xX])\][ \t]+)?([\s\S]*)$/;
function parseMdLine(line) {
  const m = line.match(MD_LIST_LINE);
  if (!m) return null;
  return {
    indent: m[1].replace(/\t/g, "  ").length,
    ordered: /\d/.test(m[2]),
    checkbox: !!m[3],
    checked: !!m[3] && /x/i.test(m[4]),
    text: m[5],
  };
}
function markdownToFragment(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const frag = document.createDocumentFragment();
  const makeList = (it) => {
    const list = document.createElement(it.ordered ? "ol" : "ul");
    if (it.checkbox) list.className = "task-list";
    return list;
  };
  let i = 0;
  while (i < lines.length) {
    if (!parseMdLine(lines[i])) {                    // a non-list line
      const div = document.createElement("div");
      if (lines[i] === "") div.appendChild(document.createElement("br"));
      else div.appendChild(linkifyFragment(lines[i]));
      frag.appendChild(div);
      i++;
      continue;
    }
    const items = [];                                // gather a contiguous list block
    while (i < lines.length) {
      const it = parseMdLine(lines[i]);
      if (!it) break;
      items.push(it); i++;
    }
    const root = makeList(items[0]);
    const stack = [{ indent: items[0].indent, list: root, li: null }];
    for (const it of items) {
      let top = stack[stack.length - 1];
      if (it.indent > top.indent && top.li) {        // deeper → nest under previous <li>
        const sub = makeList(it);
        top.li.appendChild(sub);
        stack.push({ indent: it.indent, list: sub, li: null });
        top = stack[stack.length - 1];
      } else {
        while (stack.length > 1 && it.indent < top.indent) { stack.pop(); top = stack[stack.length - 1]; }
      }
      const li = document.createElement("li");
      if (it.checkbox && it.checked) li.className = "done";
      li.appendChild(linkifyFragment(it.text));
      top.list.appendChild(li);
      top.li = li;
    }
    frag.appendChild(root);
  }
  return frag;
}
// Firefox degrades a copied list to top-level <li> with no <ul>/<ol> wrapper.
function htmlFragmentIsWellFormed(frag) {
  for (const li of frag.querySelectorAll("li")) {
    const p = li.parentElement;
    if (!p || (p.tagName !== "UL" && p.tagName !== "OL")) return false;
  }
  return true;
}

noteBody.addEventListener("paste", e => {
  const html = e.clipboardData.getData("text/html");
  const text = e.clipboardData.getData("text/plain");
  if (!html.trim() && !text) return;      // nothing to paste — let the default no-op
  e.preventDefault();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  // Pasted content should undo as its own step, never merged with whatever
  // typing happened right before it.
  forceCheckpointBoundary();
  let frag = null;
  // 1. Intra-app copy-paste: if this paste matches what we last copied inside the
  //    editor, use our OWN stored clean HTML. Firefox (and some extensions) refuse
  //    to let a page override the clipboard on copy — so setData is ignored and the
  //    OS clipboard keeps Firefox's mangled, classless, wrapper-less <li> soup.
  //    Our in-memory buffer never touches the OS clipboard, so it's immune. Match
  //    on the plain text so an unrelated external paste never picks it up.
  const normClip = (s) => (s || "").replace(/\r\n/g, "\n").trim();
  if (internalClipboard && text && normClip(text) === normClip(internalClipboard.text)) {
    frag = sanitizePastedHtml(internalClipboard.html);
    if (frag && !frag.childNodes.length) frag = null;
  }
  // 2. Otherwise prefer the clipboard's structured HTML (sanitized). When that's
  //    degraded (Firefox → orphan <li>) or lost the checklist class but the text
  //    carries markdown list markers, rebuild from the text — never sanitized.
  if (!frag) {
    frag = html.trim() ? sanitizePastedHtml(html) : null;
    if (frag && !frag.childNodes.length) frag = null;
    // Only reconstruct from markdown when the text actually has list markers — so a
    // plain (non-list) paste still goes through the inline linkify path and isn't
    // wrapped in block <div>s.
    const textHasListMarkers = /(^|\n)[ \t]*([-*+]|\d+[.)])[ \t]+/.test(text);
    const textHasChecklist = /(^|\n)[ \t]*[-*+][ \t]+\[[ xX]\]/.test(text);
    const htmlHasTaskList = !!(frag && frag.querySelector("ul.task-list"));
    const preferMarkdown = textHasListMarkers && (!frag || !htmlFragmentIsWellFormed(frag) || (textHasChecklist && !htmlHasTaskList));
    if (preferMarkdown) frag = markdownToFragment(text);
  }
  // 3. Last resort: inline linkified plain text.
  if (!frag || !frag.childNodes.length) frag = linkifyFragment(text || "");
  // Manual Range insertion, not execCommand('insertHTML') — Chrome's insertHTML
  // auto-wraps orphaned top-level text-node siblings into separate <div>s while
  // leaving <a> tags unwrapped, fragmenting a single pasted line into multiple
  // blocks. Range.insertNode drops the fragment's nodes in place with no such
  // normalization, matching how mdInsertList/mdInsertDivider already do manual
  // DOM surgery elsewhere in this file.
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const lastNode = frag.lastChild;
  range.insertNode(frag);
  if (lastNode) {
    const after = document.createRange();
    after.setStartAfter(lastNode);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  decorateLinks();
  // Manual Range insertion doesn't fire `input`, so the placeholder-hide that
  // normally runs there is skipped — update it explicitly or the "Start
  // writing…" hint overlaps the pasted text until a reload.
  updateNoteBodyPlaceholder();
  scheduleSave();
});

// Own the copy/cut side too. We do TWO things:
//  (a) stash a clean clone of the selection in an in-memory buffer, and
//  (b) try to write clean HTML + markdown to the OS clipboard.
// (b) is best-effort: Firefox — and privacy extensions like the ones in Setu's
// profile — refuse to let a page override the clipboard on copy, so setData is
// silently ignored and the OS clipboard keeps Firefox's mangled classless <li>
// soup. (a) is the reliable path: the buffer never touches the OS clipboard, so
// the paste handler can recover the real structure for in-app copy-paste. The
// copy event still FIRES (it just can't override the clipboard), which is all we
// need to capture the buffer.
let internalClipboard = null;  // { text, html } from the last in-editor copy/cut
function writeSelectionToClipboard(e) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!noteBody.contains(range.commonAncestorContainer)) return false;
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  // cloneContents returns only the CONTENTS between the range boundaries and omits
  // the common-ancestor <ul>/<ol> wrapper for a partial text selection across list
  // items (spec-correct, happens in every engine) — leaving orphan <li> that would
  // paste as bullets and lose the checklist. Re-wrap them using the real source
  // list's tag + class (keeps ul.task-list / ol / li.done).
  if ([...holder.childNodes].some(n => n.nodeType === 1 && n.tagName === "LI")) {
    let n = range.commonAncestorContainer;
    n = n.nodeType === 1 ? n : n.parentElement;
    const srcList = n && n.closest ? n.closest("ul, ol") : null;
    if (srcList) {
      const wrap = document.createElement(srcList.tagName);
      if (srcList.className) wrap.className = srcList.className;
      while (holder.firstChild) wrap.appendChild(holder.firstChild);
      holder.appendChild(wrap);
    }
  }
  const cleanHtml = holder.innerHTML;
  internalClipboard = { text: sel.toString(), html: cleanHtml };
  try {
    e.clipboardData.setData('text/html', cleanHtml);
    e.clipboardData.setData('text/plain', domToMarkdown(holder) || sel.toString());
    e.preventDefault();
  } catch (_) { /* some browsers/extensions block the override — buffer still set */ }
  return true;
}
noteBody.addEventListener("copy", e => { writeSelectionToClipboard(e); });
noteBody.addEventListener("cut", e => {
  if (!writeSelectionToClipboard(e)) return;
  forceCheckpointBoundary();
  window.getSelection().getRangeAt(0).deleteContents();
  updateNoteBodyPlaceholder();
  scheduleSave();
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

// Every <li> the current selection touches (not just the caret's one) — so a
// format that acts on a whole multi-item selection (e.g. bullets → checklist)
// can reach all of them, not only the common-ancestor line.
function selectedLis() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  return [...noteBody.querySelectorAll('li')].filter(li => range.intersectsNode(li));
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

// Nest/un-nest the caret's list item, preserving the caret. Shared by the Tab
// key and the format-bar indent/outdent buttons, so both behave identically —
// and both go through indentLi/outdentLi, which carry the task-list class onto
// any new sublist (execCommand('indent') would drop it → a nested checkbox would
// become a plain bullet). Returns false when the caret isn't in a list.
function applyListIndent(shift) {
  const li = currentLi();
  if (!li) return false;
  const sel = window.getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const sc = r && r.startContainer, so = r ? r.startOffset : 0;
  forceCheckpointBoundary(); // indent/outdent should undo as its own step
  if (shift) outdentLi(li); else indentLi(li);
  if (sc) {
    try {
      const nr = document.createRange();
      nr.setStart(sc, so); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    } catch (_) {}
  }
  updateNoteBodyPlaceholder();
  scheduleSave();
  return true;
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

// True when the caret is collapsed at the very start of `li`'s own content.
function caretAtStartOfLi(li) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const test = document.createRange();
  test.selectNodeContents(li);
  try { test.setEnd(r.startContainer, r.startOffset); } catch (_) { return false; }
  return test.toString() === '';
}

noteBody.addEventListener("keydown", e => {
  if (e.key === "Tab") {
    e.preventDefault();
    // In a list, Tab/Shift+Tab nest/un-nest the item (like every other editor).
    // Outside a list, Tab inserts a soft 2-space indent; Shift+Tab is a no-op.
    // In a list, Tab/Shift+Tab nest/un-nest the item; outside, Tab is a soft indent.
    if (!applyListIndent(e.shiftKey) && !e.shiftKey) {
      document.execCommand('insertText', false, '  ');
    }
    return;
  }

  // Backspace at the start of the FIRST item of a top-level list, when native
  // would destroy adjacent structure: (a) at note-start there's no previous line
  // to merge into, so the first bullet feels un-deletable; (b) when the list sits
  // directly under a divider, native backspace eats BOTH the bullet and the <hr>.
  // In both cases, un-bullet the item into a plain line (outdentLi) and leave the
  // divider alone — a SECOND backspace on that plain line then removes the <hr>
  // natively. Bullets elsewhere keep their normal native backspace/merge.
  if (e.key === "Backspace" && !e.shiftKey) {
    const li = currentLi();
    if (li && caretAtStartOfLi(li)) {
      // Climb to the top-level list block (direct child of noteBody), so this
      // works whether the item's list is top-level, nested, or wrapped.
      let top = li.closest('ul,ol');
      while (top && top.parentElement && top.parentElement !== noteBody) top = top.parentElement;
      const atTopStart = top && caretAtStartOfLi(top);   // caret at the very start of the whole list
      const afterHr    = top && top.previousElementSibling && top.previousElementSibling.nodeName === 'HR';
      if (atTopStart && (caretAtStartOfNote() || afterHr)) {
        e.preventDefault();
        const target = outdentLi(li);
        if (target) placeCaretIn(target);
        updateNoteBodyPlaceholder();
        scheduleSave();
        return;
      }
    }
  }

  // Shift+Enter → a soft line break within the current line / list item: a new
  // line aligned with the text, NOT a new bullet/number (the standard editor
  // behavior). Chromium does this natively, but WebKit (Safari/iOS) instead
  // splits into a new <li> (or a new <div> in plain text), so we do it
  // ourselves. execCommand('insertLineBreak') is the one approach that's both
  // correct AND identical across engines here (verified in Chromium + WebKit) —
  // manual <br>-insertion mis-positions the caret after a trailing <br>.
  if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault();
    forceCheckpointBoundary();  // a soft break is its own undo step
    document.execCommand('insertLineBreak');
    return;
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
    // A brand-new checklist item must start UNCHECKED, even when split off a
    // checked one — the browser's native Enter copies the whole <li class="done">.
    // Let the split happen, then strip 'done' from the freshly-created item: the
    // empty one the caret moves into (Enter at end/middle) or the empty one left
    // above (Enter at the very start of the line).
    if (li && li.classList.contains('done') && li.parentElement?.classList.contains('task-list')) {
      const atStart = caretAtStartOfLi(li);
      requestAnimationFrame(() => {
        const fresh = atStart ? li.previousElementSibling : currentLi();
        if (fresh && fresh.tagName === 'LI' && fresh !== li) {
          fresh.classList.remove('done');
          scheduleSave();
        }
      });
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

// Highlight the formats active at the caret/selection in both bars, so it's
// clear what's on (bold shows a filled button, etc.). Works with a collapsed
// caret too — the mobile bar is always visible, not just during a selection.
function cmdState(c) { try { return document.queryCommandState(c); } catch { return false; } }
function updateActiveFormats() {
  const sel = window.getSelection();
  const anchor = sel && sel.anchorNode;
  const active = new Set();
  if (anchor && noteBody.contains(anchor)) {
    if (cmdState("bold"))          active.add("bold");
    if (cmdState("italic"))        active.add("italic");
    if (cmdState("underline"))     active.add("underline");
    if (cmdState("strikeThrough")) active.add("strike");
    const inUL = cmdState("insertUnorderedList");
    const inOL = cmdState("insertOrderedList");
    let el = anchor.nodeType === 3 ? anchor.parentElement : anchor;
    if (el && !noteBody.contains(el)) el = null;
    if (el && el.closest("ul.task-list")) active.add("checklist");  // a task-list is a <ul>, so check it before bullet
    else if (inUL)                        active.add("bullet");
    if (inOL)                             active.add("numbered");
    if (el && el.closest("code, pre"))    active.add("code");
    if (el && el.closest("a"))            active.add("link");
    if (!inUL && !inOL) {
      let block = ""; try { block = (document.queryCommandValue("formatBlock") || "").toLowerCase(); } catch {}
      if (block === "h1" || block === "h2" || block === "h3") active.add(block);
      else if (block === "blockquote")                        active.add("quote");
      // plain body (div/p) is intentionally not highlighted — it's the default, the absence of a block style
    }
  }
  document.querySelectorAll("#format-bar [data-fmt], #sticky-format-bar [data-fmt]")
    .forEach(btn => btn.classList.toggle("active", active.has(btn.dataset.fmt)));
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

// The formatting bar is off by default (noise while writing) and revealed on
// demand via the header's Formatting toggle. Its open/closed state is a
// remembered preference so it stays where the user left it. Available on both
// touch and desktop — on desktop it also gives a way to insert lists/checklists
// at the caret without first selecting text (the floating bar needs a selection).
let formatBarOpen = localStorage.getItem("formatBarOpen") === "true";

function applyFormatBar() {
  stickyFormatBar.classList.toggle("open", formatBarOpen);
  formatToggleBtn.classList.toggle("active", formatBarOpen);
  // On desktop the persistent bar replaces the floating-on-selection bar; drop
  // the floating one when the persistent bar is on so they don't stack.
  if (!isTouch && formatBarOpen) hideFormatBar();
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

// ── Focus writing mode (desktop) ───────────────────────────────────────
// Hides both left panes so the editor fills the window. Persisted across
// sessions. All the focus CSS is gated to desktop, so the class is inert on
// mobile (which is single-pane already) — no need to guard it here.
let focusMode = localStorage.getItem("focusMode") === "true";

function applyFocusMode() {
  $("app").classList.toggle("focus-mode", focusMode);
}
function toggleFocusMode() {
  focusMode = !focusMode;
  localStorage.setItem("focusMode", focusMode);
  applyFocusMode();
}
$("focus-toggle-btn").addEventListener("click", toggleFocusMode);  // enter (sidebar header)
$("focus-reveal-btn").addEventListener("click", toggleFocusMode);  // exit (editor toolbar)
applyFocusMode();

document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggleFocusMode(); }
});

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
  if (formatBarOpen) { hideFormatBar(); return; } // desktop persistent bar is on — no floating bar
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
  updateActiveFormats();
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
  updateActiveFormats();   // keep the active-style highlight in sync as the caret/selection moves
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
  // A deliberate format action (toolbar tap or shortcut) should always undo
  // as its own step, distinct from surrounding typing.
  forceCheckpointBoundary();
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
    // keep working and each new line gets its own checkbox for free. Operate on
    // the WHOLE selection (every touched <li>), so selecting several bullets and
    // hitting the checkbox converts them all — not just the caret's line.
    const lis = selectedLis();
    const inChecklist = lis.length > 0 && lis.every(li => li.parentElement?.classList.contains('task-list'));
    const allBullets  = lis.length > 0 && lis.every(li => {
      const p = li.parentElement;
      return p?.tagName === 'UL' && !p.classList.contains('task-list');
    });
    if (inChecklist) {
      document.execCommand('insertUnorderedList');           // checklist → plain lines
    } else if (allBullets) {
      // Convert the selected bullet list(s) to checklist(s) in place.
      [...new Set(lis.map(li => li.parentElement))].forEach(ul => ul.classList.add('task-list'));
    } else {
      document.execCommand('insertUnorderedList');           // plain/ordered/mixed → make a list…
      selectedLis().forEach(li => {                          // …then tag every UL it produced
        const ul = li.parentElement;
        if (ul?.tagName === 'UL') ul.classList.add('task-list');
      });
    }
    scheduleSave();
    if (!isTouch) requestAnimationFrame(showFormatBar);
    requestAnimationFrame(updateActiveFormats);
    return;
  }
  if (fmt === 'indent' || fmt === 'outdent') {
    // In a list, mirror Tab exactly (task-list-aware nesting). Outside a list,
    // fall through to the native soft-indent handled by execCmds below.
    if (applyListIndent(fmt === 'outdent')) {
      if (!isTouch) requestAnimationFrame(showFormatBar);
      requestAnimationFrame(updateActiveFormats);
      return;
    }
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
  requestAnimationFrame(updateActiveFormats);   // refresh the active-style highlight
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
let lastTouchToggleAt = 0;
function tryToggleCheckbox(e, clientX, clientY, isTouch) {
  // The checkbox is drawn as the li's ::before, pushed by negative margin into
  // the <ul>'s left padding — but that padding strip belongs to the <ul> for
  // hit-testing, not the <li>. So a tap even a hair off the tiny box lands on the
  // <ul>, e.target.closest("li") is null, and we'd bail → editor focuses → the
  // keyboard pops up. Instead of trusting the hit target, find the task-list row
  // by the pointer's Y position, making the whole left gutter of that row a
  // reliable target. Everything here stays LEFT of the text (x < rect.left), so
  // caret placement / text selection is never affected.
  let li = e.target.closest?.("li");
  if (!li || !li.parentElement?.classList.contains("task-list")) {
    li = null;
    if (clientY != null) {
      for (const cand of noteBody.querySelectorAll("ul.task-list > li")) {
        const r = cand.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) { li = cand; break; }
      }
    }
  }
  if (!li || !noteBody.contains(li)) return;
  if (!li.parentElement?.classList.contains("task-list")) return;
  const rect = li.getBoundingClientRect();
  const em = parseFloat(getComputedStyle(li).fontSize) || 16;
  // Gutter = the checkbox column just left of the text. Generous width (2.4em ≈
  // one comfortable touch target) so a near-miss still ticks instead of focusing.
  if (clientX >= rect.left || clientX < rect.left - em * 2.4) return;
  e.preventDefault();                       // stop focus → keyboard stays as-is
  // A tap on a touch device fires touchstart AND a synthetic mousedown echo a
  // moment later; suppress only that echo. A genuine SECOND touch is never
  // suppressed, so rapidly ticking several boxes all register (the old global
  // window swallowed fast successive taps). Real mouse clicks (desktop) never
  // follow a touch, so they're never affected.
  const now = Date.now();
  if (!isTouch && now - lastTouchToggleAt < 700) return;
  if (isTouch) lastTouchToggleAt = now;
  forceCheckpointBoundary(); // a checkbox tap is its own deliberate action, never merged with adjacent typing
  li.classList.toggle("done");
  scheduleSave();
}
noteBody.addEventListener("mousedown", e => tryToggleCheckbox(e, e.clientX, e.clientY, false));
noteBody.addEventListener("touchstart", e => {
  if (e.touches[0]) tryToggleCheckbox(e, e.touches[0].clientX, e.touches[0].clientY, true);
}, { passive: false });

// ── Copy note ─────────────────────────────────────────────────────────────────

$("copy-note-btn").addEventListener("click", () => {
  overflowMenu.classList.add("hidden");
  const parts = [noteTitle.value.trim(), noteBody.innerText.trim()].filter(Boolean);
  navigator.clipboard.writeText(parts.join("\n\n"))
    .then(() => showToast("Copied to clipboard"))
    .catch(() => showToast("Copy failed"));
});

// ── Share (public link) — works for a single note OR a whole tag ──────────────
let shareTarget = null;   // { kind:'note', id } | { kind:'tag', tag }
const shareUrl = (token) => `${location.origin}/shared/${token}`;
const shareApiPath = () => shareTarget.kind === "tag"
  ? `/api/tags/${encodeURIComponent(shareTarget.tag)}/share`
  : `/api/notes/${shareTarget.id}/share`;

function shareExpiryText(expires_at) {
  if (!expires_at) return "Never expires — turn it off to revoke.";
  const d = new Date(expires_at);
  const days = Math.ceil((d - Date.now()) / 86400000);
  const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return days <= 0 ? "Expired." : `Expires ${when} (${days} day${days === 1 ? "" : "s"}).`;
}

// Expiry controls → the payload piece the backend understands: a preset day
// count, or an absolute date for the "Custom date…" option.
function expiryPayload() {
  if ($("share-expiry").value === "custom") return { expires_at: $("share-expiry-date").value || null };
  return { expires_in_days: $("share-expiry").value || null };
}

// The custom date picker is only visible when "Custom date…" is chosen.
function syncExpiryControls() {
  $("share-expiry-date").classList.toggle("hidden", $("share-expiry").value !== "custom");
}

const shareActive = () => !$("share-active").classList.contains("hidden");

function renderShareSheet(s) {
  const shared = !!(s && s.shared);
  $("share-active").classList.toggle("hidden", !shared);
  $("share-create-btn").classList.toggle("hidden", shared);
  const note = $("share-expiry-note");
  note.classList.toggle("hidden", !shared);

  const hasPw = !!(s && s.has_password);
  $("share-password-note").classList.toggle("hidden", !hasPw);
  const pw = $("share-password");
  pw.value = "";
  pw.placeholder = hasPw ? "Change password" : (shared ? "Add a password" : "No password");

  if (shared) {
    $("share-url").value = shareUrl(s.token);
    note.textContent = shareExpiryText(s.expires_at);
    // Reflect the live expiry back into the controls. An absolute timestamp
    // shows as a custom date (honest about the real end date, even for presets).
    if (s.expires_at) {
      $("share-expiry").value = "custom";
      $("share-expiry-date").value = new Date(s.expires_at).toISOString().slice(0, 10);
    } else {
      $("share-expiry").value = "";
    }
    syncExpiryControls();
  }
}

async function saveShare(opts = {}) {
  const body = expiryPayload();
  if (opts.password) body.password = opts.password;
  if (opts.removePassword) body.remove_password = true;
  const s = await api("PUT", shareApiPath(), body);
  renderShareSheet(s);
  return s;
}

async function openShareSheet(target) {
  shareTarget = target;
  const isTag = target.kind === "tag";
  $("share-modal-title").textContent = isTag ? "Share tag" : "Share note";
  $("share-hint").textContent = isTag
    ? `Anyone with the link can read every note tagged #${target.tag} — no sign-in needed. Tagging a note adds it to the shared list; removing the tag takes it off.`
    : "Anyone with the link can read this note — no sign-in needed.";
  $("share-expiry").value = "";
  $("share-expiry-date").value = "";
  $("share-expiry-date").min = new Date().toISOString().slice(0, 10);
  $("share-password").value = "";
  syncExpiryControls();
  try { renderShareSheet(await api("GET", shareApiPath())); }
  catch { renderShareSheet({ shared: false }); }
  $("share-modal").classList.remove("hidden");
}

$("share-note-btn").addEventListener("click", async () => {
  overflowMenu.classList.add("hidden");
  if (state.dirty) await saveNoteNow();
  const note = state.note;
  if (!note || !note.id) { showToast("Type something first"); return; }
  openShareSheet({ kind: "note", id: note.id });
});

$("share-create-btn").addEventListener("click", async () => {
  const pw = $("share-password").value.trim();
  const s = await saveShare(pw ? { password: pw } : {});
  navigator.clipboard.writeText(shareUrl(s.token))
    .then(() => showToast(pw ? "Protected link created & copied" : "Link created & copied"))
    .catch(() => showToast("Link created"));
});

// Changing the expiry while already shared updates it in place (same link).
// For "Custom date…", wait until an actual date is picked before saving.
$("share-expiry").addEventListener("change", () => {
  syncExpiryControls();
  if (!shareActive()) return;
  if ($("share-expiry").value === "custom" && !$("share-expiry-date").value) return;
  saveShare().then(() => showToast("Expiry updated"));
});
$("share-expiry-date").addEventListener("change", () => {
  if (shareActive() && $("share-expiry-date").value) saveShare().then(() => showToast("Expiry updated"));
});

// Setting/changing a password on an already-shared link.
$("share-password").addEventListener("change", () => {
  const pw = $("share-password").value.trim();
  if (shareActive() && pw) saveShare({ password: pw }).then(() => showToast("Password set"));
});
$("share-password-remove").addEventListener("click", () => {
  saveShare({ removePassword: true }).then(() => showToast("Password removed"));
});

$("share-copy-btn").addEventListener("click", () => {
  navigator.clipboard.writeText($("share-url").value)
    .then(() => showToast("Link copied")).catch(() => showToast("Copy failed"));
});

$("share-revoke-btn").addEventListener("click", async () => {
  await api("DELETE", shareApiPath());
  renderShareSheet({ shared: false });
  showToast("Sharing stopped");
});

$("share-modal-close").addEventListener("click", () => $("share-modal").classList.add("hidden"));
$("share-modal").addEventListener("click", e => { if (e.target === $("share-modal")) $("share-modal").classList.add("hidden"); });

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

// Demo-only cap so it stays a place to try the app, not somewhere to build a
// real journal — checked before the editor opens, so no typed content is ever
// lost to a limit hit mid-save.
const DEMO_NOTE_LIMIT = 30;

async function newNote() {
  if (window.DEMO_MODE && window.demoNoteCount && window.demoNoteCount() >= DEMO_NOTE_LIMIT) {
    showToast(`Demo is capped at ${DEMO_NOTE_LIMIT} notes — export or self-host to keep writing`);
    return;
  }
  if (state.dirty) await saveNoteNow();
  const folderId = state.context.type === "folder" ? state.context.id : null;
  const initialTags = state.context.type === "tag" ? [state.context.id] : [];
  state.note = { id: null, title: "", body: "", folder_id: folderId, tags: initialTags };
  state.dirty = false;
  noteTitle.value = "";
  suppressUndoTracking = true;
  noteBody.innerHTML = "";
  // Deferred to a microtask — see the comment on the equivalent pattern in openNote().
  queueMicrotask(() => {
    suppressUndoTracking = false;
    undoResetForNote();
  });
  updateNoteBodyPlaceholder();
  renderTagChips(initialTags);
  renderNoteDates(null);
  setAutosave("");
  // A new note is never trashed — reset whatever openNote() may have left in
  // place if the previously-open note was in Trash (readOnly/contentEditable/
  // disabled tag input/trash banner), or a new note silently inherits them.
  $("trash-banner").classList.add("hidden");
  noteTitle.readOnly = false;
  noteBody.contentEditable = "true";
  tagInput.disabled = false;
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
    const expanded = moveExpanded.has(node.id);
    // Every folder is expandable (not just those with children) so the chevron
    // also reveals a "New subfolder…" row — that's how you nest a folder here.
    list.appendChild(makeMoveFolderOption(node.id, node.name, cfg.isCurrent(node), depth, true, expanded));
    if (expanded) {
      kids.forEach(c => walk(c, depth + 1));
      list.appendChild(makeNewFolderControl(node.id, "New subfolder…", depth + 1));
    }
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
  // Two separate buttons per row so "move here" and "expand" are distinct tap
  // targets (the old single-row-with-tiny-chevron made them easy to confuse on
  // touch — a near-miss on the chevron moved the note instead of expanding).
  const row = document.createElement("div");
  row.className = "move-folder-row" + (isCurrent ? " current" : "");

  const select = document.createElement("button");
  select.type = "button";
  select.className = "move-folder-select";
  select.style.paddingLeft = (8 + depth * 16) + "px";
  select.innerHTML = `${FOLDER_SVG}<span class="move-folder-name">${esc(name)}</span>${isCurrent ? "<small>(current)</small>" : ""}`;
  if (isCurrent) select.disabled = true;
  else select.addEventListener("click", () => moveIntoFolder(folderId));
  row.appendChild(select);

  if (hasKids) {
    const exp = document.createElement("button");
    exp.type = "button";
    exp.className = "move-folder-expand" + (expanded ? " open" : "");
    exp.setAttribute("aria-label", expanded ? "Hide subfolders" : "Show subfolders");
    exp.setAttribute("aria-expanded", expanded ? "true" : "false");
    exp.innerHTML = CHEV_SVG;
    exp.addEventListener("click", () => {
      if (moveExpanded.has(folderId)) moveExpanded.delete(folderId);
      else moveExpanded.add(folderId);
      renderMoveFolderList();
    });
    row.appendChild(exp);
  }
  return row;
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
// into it, without closing the modal to make the folder separately. Reused for
// both the top-level "New folder…" (parentId null) and the "New subfolder…" row
// shown under each expanded folder (parentId = that folder), so you can build a
// nested folder and move into it in one step.
function makeNewFolderControl(parentId = null, label = "New folder…", depth = 0) {
  const wrap = document.createElement("div");
  wrap.className = "move-folder-new" + (depth > 0 ? " nested" : "");
  if (depth > 0) wrap.style.paddingLeft = (depth * 16) + "px";
  wrap.innerHTML = `
    <button class="move-folder-newbtn" type="button">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>${esc(label)}</span>
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
    const folder = await api("POST", "/api/folders", { name, parent_id: parentId });
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

async function syncCheck() {
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
        await refreshOpenNoteFromServer();
      }
    }
  } catch(_) {}
}

// The poll above reloads the notes *list*; this also refreshes the note you have
// *open in the editor* when it changed on another device — otherwise the list
// preview updates but the note you're reading stays stale until a manual reload.
// Guarded by !state.dirty, so it never overwrites unsaved local edits: if you're
// mid-edit the reload is skipped entirely (your version wins, last-write on save).
// We don't skip on focus — on desktop the editor is focused just from opening a
// note, so that would defeat the whole thing; the !dirty guard is what keeps it
// safe. Scroll position is preserved so a long note doesn't jump.
async function refreshOpenNoteFromServer() {
  const cur = state.note;
  if (!cur || !cur.id || state.dirty || state.saving) return;
  let fresh;
  try { fresh = await api("GET", `/api/notes/${cur.id}`); } catch { return; }
  // Re-check after the await — the user may have switched notes or started editing.
  if (!fresh || !state.note || state.note.id !== cur.id || state.dirty || state.saving) return;
  if (fresh.updated_at === cur.updated_at) return;   // unchanged remotely
  const scrollTop = editorBody ? editorBody.scrollTop : 0;
  state.note = fresh;
  noteTitle.value = fresh.title || "";
  suppressUndoTracking = true;
  noteBody.innerHTML = bodyToHtml(fresh.body || "");
  decorateLinks();
  renderTagChips(fresh.tags || []);
  renderNoteDates(fresh);
  updateNoteBodyPlaceholder();
  autosizeTitle();
  if (editorBody) editorBody.scrollTop = scrollTop;
  // Deferred to a microtask — see the comment on the equivalent pattern in openNote().
  queueMicrotask(() => {
    suppressUndoTracking = false;
    undoResetForNote();
  });
  showToast("Updated from another device");
}

// A #note/<id> share link opens the standalone read view instead of the app —
// no sidebar, no nav, no sync polling.
const shareNoteId = decodeURIComponent((location.hash.match(/^#note\/(.+)$/) || [])[1] || "");

if (!shareNoteId) {
  setInterval(syncCheck, 2000);
  // Returning to a backgrounded tab: browsers throttle setInterval while hidden,
  // so sync right away on refocus instead of waiting out the throttled interval.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncCheck();
  });
}

// Render the standalone note view for a share link: Journery header + the note +
// a copy button. Read-only; behind the same access gate as the app.
async function renderNoteView(id) {
  const view = $("note-view");
  let note = null;
  try { note = await api("GET", `/api/notes/${id}`); } catch (_) {}
  if (note && !note.deleted_at) {
    $("note-view-title").textContent = note.title || "Untitled";
    const content = $("note-view-content");
    content.innerHTML = bodyToHtml(note.body || "");
    content.querySelectorAll("a").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    const tagsEl = $("note-view-tags");
    tagsEl.innerHTML = (note.tags || []).map(t => `<span class="nv-tag">#${esc(t)}</span>`).join("");
    tagsEl.classList.toggle("hidden", !(note.tags || []).length);
    $("note-view-copy").addEventListener("click", () => {
      const parts = [(note.title || "").trim(), content.innerText.trim()].filter(Boolean);
      navigator.clipboard.writeText(parts.join("\n\n"))
        .then(() => showToast("Copied to clipboard"))
        .catch(() => showToast("Copy failed"));
    });
  } else {
    $("note-view-title").textContent = "Note not found";
    $("note-view-content").innerHTML = "<div>This note may have been deleted, or the link is invalid.</div>";
    $("note-view-copy").style.display = "none";
  }
  view.classList.remove("hidden");
}

// ── Resize handles ────────────────────────────────────────────────────────────

const SIDEBAR_MIN = 292, SIDEBAR_MAX = 380;
const NOTES_MIN   = 292, NOTES_MAX   = 500;
// Clamp up front so any previously-stored width below the current minimum snaps to it.
let sidebarW = Math.max(SIDEBAR_MIN, parseInt(localStorage.getItem("sidebarW") || String(SIDEBAR_MIN)));
let notesW   = Math.max(NOTES_MIN,   parseInt(localStorage.getItem("notesW")   || String(NOTES_MIN)));

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
        sidebarW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + delta));
        localStorage.setItem("sidebarW", sidebarW);
      } else {
        notesW = Math.max(NOTES_MIN, Math.min(NOTES_MAX, startW + delta));
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

// Flush a pending edit the moment the app is backgrounded or closed, instead of
// waiting out the debounce timer — which may never fire if the OS freezes/kills
// the page (very common on mobile when you switch apps). visibilitychange→hidden
// is the reliable signal here (pagehide as a belt-and-suspenders for real
// navigations); the page usually stays alive long enough for the write.
function flushPendingSave() { if (state.dirty && !state.saving) saveNoteNow(); }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushPendingSave();
});
window.addEventListener("pagehide", flushPendingSave);

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
// The Formatting toggle drives the persistent sticky bar on both touch and
// desktop (desktop still also gets the floating-on-selection bar when the
// persistent one is off), so the header toggle and its Settings row show on both.
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

setupDragAndDrop();   // desktop drag-and-drop (self-gates on isTouch)

if (shareNoteId) {
  // Share link → standalone read view; skip the full app load. Apply the viewer's
  // saved custom theme (loadAll, which normally does this, is skipped; basic
  // dark/light already applied above via applyDark).
  document.body.classList.add("note-view-mode");
  const localTheme = localStorage.getItem("activeTheme");
  if (localTheme) { try { applyTheme(JSON.parse(localTheme)); } catch (_) {} }
  renderNoteView(shareNoteId);
} else {
  // Default the notes panel to Recents on load (matches state.context above).
  paneTitle.textContent = recentsPaneTitle();
  setActiveNav(navRecents);
  loadAll().then(() => {
    // Demo, desktop only: open the intro note instead of the blank "select a
    // note" state — that empty state only shows in the 3-pane desktop layout
    // (mobile starts on the sidebar view, so there's nothing blank to fill).
    // Falls back to the normal empty state if the note's been deleted/reset.
    if (window.DEMO_MODE && !isMobile()) {
      api("GET", "/api/notes/welcome").then(note => {
        if (note && !note.deleted_at) openNote(note);
      }).catch(() => {});
    }
  });
}
