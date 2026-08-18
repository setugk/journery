# Building a `contenteditable` editor from scratch — lessons

Journery's note editor is a plain `contenteditable` div with no framework and no
editor library (no ProseMirror, Lexical, Slate, or Draft.js). Just vanilla JS,
one `<div contenteditable>`, and a lot of hard-won handling for the places the
browser fights you.

This is the reference we wish we'd had starting out: the traps, why they happen,
and the pattern that actually works — grouped by problem, not by version. Code is
illustrative (real function names from the codebase, trimmed for clarity).

If you take one thing away: **`contenteditable` is not an editor, it's a canvas
with opinions.** Every feature past "type text and it stays" is you overriding the
browser, and the browser disagrees differently in every engine.

---

## 0. The one rule everything else follows

**Don't trust `execCommand`, and don't trust the browser's own edit stack.**

`document.execCommand('insertUnorderedList' | 'indent' | 'insertHTML' | 'undo' …)`
is convenient and *lies to you across engines*:

- `execCommand('indent')` wraps a list item in a `<blockquote>` in WebKit (renders
  as a stray accent bar), not a nested list.
- `execCommand('insertUnorderedList')` leaves the caret **outside** the new `<li>`
  in WebKit — so the next character you type lands below the bullet.
- `execCommand('insertHTML')` auto-wraps orphaned top-level *text* nodes in a
  `<div>` but leaves `<a>` elements unwrapped — an asymmetric, undocumented
  normalization that fragments a pasted line into stray divs.

So most real features here are **hand-rolled DOM surgery**: build the nodes, move
them, place the caret yourself. That buys correctness and cross-engine
consistency — but it's invisible to the browser's native undo stack, which forces
[a custom undo system](#5-undoredo-you-will-end-up-owning-it). These two decisions
are linked: the moment you stop using `execCommand`, you own undo too.

The rare exception: `execCommand('insertLineBreak')` and
`execCommand('insertParagraph')` *are* consistent across engines for what they do,
so we use those two deliberately (see [§2](#2-enter-is-a-beforeinput-problem-not-a-keydown-one)).
Everything else, we do by hand.

---

## 1. `keydown` is a lie on mobile — listen to `beforeinput`

The single biggest mobile bug source: **virtual keyboards don't fire useful
`keydown` events.** During autocorrect/prediction, iOS and Android fire `keydown`
with `keyCode 229` and `key: "Unidentified"`. Any logic keyed off
`keydown` + `e.key === "Enter"` (or any specific key) silently dies on phones
while working perfectly on your desktop test.

The fix is to move intent-detection to **`beforeinput`**, which fires reliably on
every engine *and* tells you the semantic intent via `inputType`:

| `inputType`             | what the user did                    |
| ----------------------- | ------------------------------------ |
| `insertParagraph`       | Enter / Return (hard new block)      |
| `insertLineBreak`       | Shift+Enter (soft break)             |
| `insertText` + `e.data` | a character (incl. the one autocorrect is about to drop) |
| `deleteContentBackward` | Backspace                            |

`beforeinput` fires *before* the change lands, so you can `preventDefault()` and
do the right thing yourself.

Keep `keydown` only for things it's reliable for — desktop keyboard shortcuts
(⌘B, Tab), where a physical keyboard is a given.

> **Gotcha:** iOS mislabels a plain Return inside some contexts as
> `insertLineBreak`, and touch keyboards have no Shift key at all. So on touch we
> treat *every* Return as a hard new block and only honor Shift+Enter as a soft
> break on non-touch. One code path, device-aware.

---

## 2. Enter is a `beforeinput` problem, not a `keydown` one

Enter is where lists, checklists, headings, and quotes all collide. We route
**all** of it through a single `beforeinput` listener. The shape:

```js
noteBody.addEventListener("beforeinput", (e) => {
  if (e.inputType !== "insertParagraph" && e.inputType !== "insertLineBreak") return;
  if (enterBusy) return;            // guard: our own execCommand re-fires beforeinput
  e.preventDefault();               // we always do it ourselves

  // Shift+Enter on a real keyboard → soft line break, in-item
  if (!isTouch && e.inputType === "insertLineBreak") {
    enterBusy = true; document.execCommand("insertLineBreak"); enterBusy = false;
    return;
  }

  const li = currentLi();
  if (li && liIsEmpty(li))          { /* empty item → step OUT of the list */ }
  else if (li && caretAtStartOfLi(li)) { /* start of item → new line above */ }
  else { enterBusy = true; document.execCommand("insertParagraph"); enterBusy = false; }
});
```

Three lessons baked into that:

- **One listener, not two.** An earlier version split Enter between `keydown`
  (primary) and `beforeinput` (fallback, gated by a keydown-timestamp). The
  split-brain was the actual source of fragility: the empty-bullet case fell
  between the two handlers. Collapsing everything into `beforeinput` fixed a whole
  class of bugs at once.
- **Guard your own `execCommand`.** When you call `execCommand('insertParagraph')`
  from inside a `beforeinput` handler, it fires *another* `beforeinput`. A simple
  reentrancy flag (`enterBusy`) stops the infinite bounce.
- **`insertParagraph` is the browser's real Enter** — headings, quotes, and
  numbered-list continuation all keep working because you're deferring to the same
  primitive the browser uses, just at a moment you control.

### List Enter/Backspace semantics that feel right

These are the behaviors users expect from Notion/Docs — none are the browser
default:

- **Enter on an *empty* list item** → step out one nesting level (leave the list
  entirely at the top level). "Enter twice to leave."
- **Enter at the *start* of a non-empty item** → insert an empty item *above* and
  keep the caret on it (existing text moves down a line).
- **Backspace at the *start* of an item** → pull the item out of the list (nested:
  un-nest one level; top-level: drop to a plain line). Items below renumber.

All three are small DOM moves plus manual caret placement — never `execCommand`.

---

## 3. Lists are the hardest structural feature

### Hand-roll indent/outdent

Because `execCommand('indent')` is broken in WebKit, nesting is manual: move the
`<li>` into a sublist hanging off the previous sibling, carrying the list type
(and any `task-list` class) with it.

```js
function indentLi(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== 'LI') return;   // first item has nothing to nest under
  let sub = prev.lastElementChild;
  if (!sub || (sub.tagName !== 'UL' && sub.tagName !== 'OL')) {
    sub = document.createElement(li.parentElement.tagName);  // keep UL vs OL
    if (li.parentElement.classList.contains('task-list')) sub.classList.add('task-list');
    prev.appendChild(sub);
  }
  sub.appendChild(li);
}
```

Outdent is the mirror: lift the item to be a sibling of its host `<li>` (carrying
the items *below* it into a new sublist so their relative nesting survives), or —
at the top level — drop it out into a plain block.

Wire **both** Tab and the toolbar indent/outdent buttons through the *same*
`applyListIndent()` helper, so a keyboard nest and a button nest behave
identically. (The toolbar button originally used `execCommand('indent')` and
silently turned checklists back into plain bullets — a classic "two code paths,
one is wrong" bug.)

### Ordered lists renumber per `<ol>` — so merge adjacent ones

Numbered lists use native CSS `list-style: decimal`. That means **each `<ol>`
numbers its own children starting from 1** (or its `start` attribute). The failure
mode: editing fragments one logical list into two adjacent `<ol>` siblings, and
you see `1, 2, 3` then `1, 2` instead of `1…5`.

Fix: after edits, merge directly-adjacent same-kind lists into one.

```js
function mergeAdjacentLists(root) {
  let child = (root || noteBody).firstElementChild;
  while (child) {
    const next = child.nextElementSibling;
    const isList = child.tagName === 'UL' || child.tagName === 'OL';
    if (isList && next && next.tagName === child.tagName &&
        next.classList.contains('task-list') === child.classList.contains('task-list')) {
      while (next.firstChild) child.appendChild(next.firstChild);  // MOVE nodes (caret survives)
      next.remove();
      continue;                    // re-check the merged list against its new sibling
    }
    if (isList || child.tagName === 'LI') mergeAdjacentLists(child);  // recurse for nested lists
    child = child.nextElementSibling;
  }
}
```

Two subtleties: only merge lists of the **same kind** (a bullet list and a
checklist that happen to touch must stay separate — gate on tag *and* task-list
class), and **move nodes rather than clone** them so a caret inside a moved `<li>`
stays valid. Run it on the `input` event so numbering self-heals no matter which
edit caused the fragmentation.

### Honor a typed starting number

If you support the `3. ` markdown shortcut, capture the number and set
`<ol start="3">` (skip the attribute when it's 1, to keep clean HTML for the
common case). Native `<ol>` numbering continues correctly from any `start`.

---

## 4. The caret is the actual boss fight

More editor bugs trace to caret/selection than to structure. Things that will bite
you:

**`Range.toString()` silently drops `<br>`.** If you serialize a caret position or
selection by string offset using `Range.toString()`, every soft line break
vanishes and your offsets drift. Serialize the caret as a **character offset via a
manual DOM tree-walk** instead, so it survives an `innerHTML` swap on undo/restore:

```js
// offset = number of text characters before the caret, counting <br> as one char,
// computed by walking the tree — NOT range.toString().
function undoTextOffset(container, offset) { /* tree-walk, count text + <br> */ }
function undoPositionAtOffset(target)      { /* inverse: offset → {node, offset} */ }
```

**WebKit and Chromium place the caret differently after the same operation.**
After `execCommand('insertUnorderedList')`, Chromium puts the caret *inside* the
new `<li>`; WebKit leaves it *outside* as a sibling after the `<ul>`. If you built
the list yourself, place the caret yourself too — don't inherit the engine's
choice.

**Manual DOM edits don't fire `input`.** When you insert nodes with
`Range.insertNode()` instead of `execCommand`, no `input` event fires — so
anything you hang off `input` (placeholder show/hide, autosave, link decoration)
silently won't run. Call those explicitly at the end of every hand-rolled
mutation:

```js
range.deleteContents();
range.insertNode(fragment);
// input didn't fire — do its work by hand:
updateNoteBodyPlaceholder();
decorateLinks();
scheduleSave();
```

This one bug (placeholder overlapping pasted text) shows up repeatedly until you
internalize the rule.

---

## 5. Undo/redo: you will end up owning it

Native `contenteditable` undo (`Ctrl/⌘+Z`) only tracks edits **the browser
itself** performed. Every hand-rolled feature from §0 — list creation, indent,
dividers, checklist toggles, paste-linkify — is invisible to it. Symptom: undo
works character-by-character, then hits a manual edit and either does nothing or
jumps backward past several words at once.

This is *why* every serious browser editor ships its own undo stack. Ours:

- **Snapshots**, not diffs: `undoStack` / `redoStack` are arrays of
  `{ html, selectionOffset }`, capped (~100 entries).
- **Drive checkpoints from a `MutationObserver`**, not from per-feature wiring. A
  shared observer on the editor (`childList`, `subtree`, `characterData`, and
  `attributes` filtered to `class` — needed to catch checkbox toggles) can't be
  *forgotten* for a future feature the way a scattered "checkpoint before mutating"
  call at 8 sites can.
- **Group by word boundary, not just idle time.** An idle debounce alone (e.g.
  "checkpoint after 600ms of no typing") fails on continuous typing — a whole
  sentence typed with sub-600ms gaps never hits an idle moment, so it all undoes
  in one step. Add a `beforeinput` check: if the character about to land is a
  space/newline/tab/punctuation, finalize the current checkpoint *first*. Now each
  word is its own undo step regardless of typing speed. Keep the idle debounce as a
  fallback for the last word before a pause.
- **The `MutationObserver` microtask trap.** You'll want a `suppressTracking` flag
  around your own content loads (opening a note, restoring a snapshot) so they
  aren't recorded as user edits. But observer callbacks are **microtasks queued at
  mutation time** — if you set the flag `true`, mutate, then set it `false`
  synchronously, the flag is already `false` by the time the queued callback runs.
  It sees your restore as a fresh edit and (worst case) wipes the redo stack right
  after an undo. Clear the flag with `queueMicrotask()` so it runs *after* the
  observer's already-queued callback (microtasks are strict FIFO):

  ```js
  suppressTracking = true;
  noteBody.innerHTML = snapshot.html;         // queues the observer callback now
  queueMicrotask(() => { suppressTracking = false; });  // runs AFTER that callback
  ```

- **Reset history per note.** Wire `undoResetForNote()` into every path that
  wholesale-replaces the editor content — open note, new note, and the live
  cross-device sync refresh — so undo can never walk back into a *different* note's
  text.

---

## 6. Markdown shortcuts: operate on the visual *line*, not the block

Shortcuts like `* `, `- `, `1. `, and `---` are easy to get working on notes typed
from scratch and mysteriously broken on pasted or imported notes. The reason: a
note typed line-by-line is one `<div>` per line, but pasted/imported content is
often **one block joined by `<br>`s**. If your detection reads "the whole block's
text and checks it equals `*`", it only matches when the marker is the entire
block — so it silently no-ops on any `<br>`-joined line.

Detect against the **current visual line** (`mdLineBeforeCaret()` — text from the
line's start to the caret), never the whole block. And when you *act*, split the
block at the caret's line rather than `block.replaceWith(...)`, which would wipe
the neighboring lines.

**Don't fire shortcuts when the caret is already inside a list item.** Typing `* `
at the start of an existing bullet should insert a literal `* `, not try to build
a list-inside-a-list (which produces malformed `<li><li>…</li></li>` and corrupts
backspace behavior). One guard — `if (currentLi()) return;` — before the shortcut
logic.

---

## 7. Dividers and block boundaries

A `---` divider needs to know where "the current line" starts and ends. If you
only treat `<br>` as a line boundary, a note whose lines are *block-level
children* (`<h3>`, `<ol>`, `<div><br></div>`) with no `<br>` between them will make
your boundary-walk grab the entire wrapper as one line — and inserting the divider
**deletes whole sections**. (This was a real data-loss bug.)

Treat **block-level element siblings as boundaries too**, not just `<br>`:

```js
const MD_BLOCK_TAGS = new Set(['DIV','P','H1','H2','H3','H4','H5','H6',
                               'OL','UL','LI','HR','BLOCKQUOTE','PRE','TABLE','FIGURE']);
```

Include `HR` so an existing divider is never crossed. And when the content that
follows the new divider isn't `<br>`-separated, re-home it into a new block below
the `<hr>` rather than leaving it in place or losing it.

Watch the mobile smart-punctuation angle too: iOS collapses `--` into a single
em-dash `—`, so a naive "two dashes = divider" check fires a dash early. Only
trigger on genuine three-dash equivalents.

---

## 8. Paste and the clipboard are their own swamp

Getting a checklist to survive copy-paste took peeling four layered causes, each
hiding the next. The general lessons:

1. **Read `text/html`, don't rebuild from `text/plain`.** Prefer sanitized
   clipboard HTML through a **tag allowlist** (keep lists/headings/bold/links/
   checklists; strip scripts, styles, foreign classes, `javascript:` URLs). Rebuilding
   from plain text throws away all structure.
2. **`range.cloneContents()` omits the common-ancestor list wrapper** for a partial
   (drag) selection across `<li>`s. This is spec-correct, not a bug — a partial
   selection's fragment contains the content *between* the boundaries, not the
   enclosing `<ul>`/`<ol>`. So a copied checklist comes back as classless `<li>`s
   and renders as plain bullets. Fix: after `cloneContents()`, **re-wrap orphaned
   `<li>` in the source list's tag + class**.
3. **Some engines/extensions won't let you write the clipboard at all.** Firefox
   (and privacy extensions) can silently ignore your `setData`/`preventDefault`.
   For in-app copy-paste, keep an **in-memory copy buffer** — stash a clean clone
   of the selection in a JS variable on copy, and use it on paste when the pasted
   text matches. Also write markdown (`- [ ] `) into `text/plain` so external
   pastes still reconstruct.
4. **The single source of truth for "what tags are allowed"** should be one list,
   shared by the paste sanitizer *and* any server-side validation (Journery's MCP
   API reuses the editor's `PASTE_ALLOWED_TAGS` so the two can never drift). A
   validator that rejects markup the editor itself emits is worse than no
   validator.

Auto-linking pasted URLs: match conservatively (`http(s)://` and `www.` only — not
bare `word.tld`, which false-positives on "e.g." and version numbers), trim
trailing sentence punctuation and unbalanced brackets from the greedy match, and
insert **real DOM nodes** via `Range.insertNode`, not an `insertHTML` string (which
fragments the line, per §0).

---

## 9. Testing an editor: the discipline that actually catches bugs

- **Test in WebKit, not just Chromium**, for anything iOS-bound. Half the bugs
  here (caret outside the new `<li>`, Shift+Enter splitting the item, autocorrect
  em-dashes) only reproduce in WebKit. A Chromium-only pass gives false
  confidence. Playwright's `webkit` engine + an iPhone device descriptor
  reproduced multiple bugs on the first try that Chromium never showed.
- **Test the *real* interaction, not a convenient proxy.** `selectNode(ul)`
  (whole element) and a drag text-selection across `<li>`s produce **different**
  `cloneContents()` output — testing the former hid a paste bug for four
  iterations. Drive real keystrokes and real selections.
- **Know what can't be reproduced locally, and say so.** The iOS-autocorrect
  trigger (`keyCode 229`) can't be reproduced in *any* local engine, WebKit
  included — there's no real autocorrect. Firefox's OS clipboard can't be driven
  by automation either. For those, verify each piece that *is* reachable (the DOM
  transform headless, the event shape via a synthetic event, the match logic in
  the real browser console) and be honest that final confirmation is on-device.
- **Assert on the resulting DOM**, not screenshots, for structural behavior.
  These bugs are about *what the HTML became* (`<ol><li>…` vs two `<ol>`s), so read
  back `innerHTML` and assert on structure. Screenshots are for the pixel bugs.

---

## The short version

1. `contenteditable` is a canvas, not an editor. Every feature is you overriding
   the browser.
2. Don't trust `execCommand` (except `insertParagraph`/`insertLineBreak`). Hand-roll
   DOM changes and place the caret yourself.
3. Listen to `beforeinput`, not `keydown` — mobile keyboards fire `keyCode 229`.
4. The moment you hand-roll DOM edits, you own undo. Drive it from a
   `MutationObserver`, checkpoint on word boundaries, and mind the microtask trap.
5. Serialize the caret as a tree-walk offset — `Range.toString()` drops `<br>`.
6. Markdown/divider detection operates on the visual *line*, not the block, or it
   breaks on pasted/imported HTML.
7. Manual DOM edits don't fire `input` — call placeholder/save/decorate by hand.
8. Paste is four bugs deep: read HTML, re-wrap `cloneContents()` orphans, keep an
   in-memory buffer, share one tag allowlist.
9. Test in WebKit for iOS, test the real interaction, and be honest about what only
   a real device can confirm.

---

*Drawn from building [Journery](https://github.com/setugk/journery)'s editor —
a vanilla-JS, no-library `contenteditable`. The commit history and `docs/build-log.md`
have the blow-by-blow if you want the receipts.*
