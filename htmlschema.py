"""Single source of truth for the HTML vocabulary Journery's editor understands.

Journery has no formal editor schema — the editor is a hand-rolled contenteditable
surface, not TipTap/ProseMirror. Its canonical tag vocabulary is defined by the
paste sanitizer's whitelist (``PASTE_ALLOWED_TAGS`` in ``static/app.js`` —
"the structure Journery itself uses"). This module mirrors that vocabulary for the
MCP write surface: the SAME ``SUPPORTED_TAGS`` constant feeds BOTH the MCP tool
descriptions AND the write-path validator, so a description can never advertise a
tag the validator rejects (or vice-versa).

``test_mcp_html.py`` binds ``SUPPORTED_TAGS`` back to ``static/app.js`` so the
editor schema and this constant can't drift either: add a block to the editor
(→ its paste whitelist) without updating this constant (→ the tool description),
and the anti-drift test fails.
"""
from html.parser import HTMLParser

# Canonical, display-ordered — one tag per style (b not strong, i not em, s not
# strike/del), so the contract an agent reads is exact and minimal. Anything not
# in this set is rejected on write with an actionable message.
SUPPORTED_TAGS = (
    "h1", "h2", "h3", "p", "br",
    "b", "i", "u", "s", "code", "a",
    "ul", "ol", "li", "pre", "blockquote", "hr",
)
SUPPORTED_TAGS_SET = frozenset(SUPPORTED_TAGS)

# Renderable-but-non-canonical tags → the canonical tag to use instead. Two jobs:
# (1) drive the "use <b> instead" suggestions below; (2) let the anti-drift test
# reconcile SUPPORTED_TAGS with the editor's paste whitelist (which also accepts
# these synonyms + <div> because pasted content comes from other apps).
TAG_ALIASES = {
    "strong": "b", "em": "i", "strike": "s", "del": "s", "div": "p",
}

_TABULAR = ("table", "thead", "tbody", "tfoot", "tr", "td", "th",
            "caption", "colgroup", "col")
_IMAGE = ("img", "picture", "figure", "svg")
_INLINE_STYLING = ("span", "font", "mark", "small", "sub", "sup")

# Concrete substitution for the common offenders, written for a machine to act on.
SUGGESTIONS = {
    **{syn: f"use <{canon}> instead" for syn, canon in TAG_ALIASES.items()},
    "div": "use <p> for a paragraph, or <br> for a line break",
    **{t: "represent tabular data as a <ul> with one <li> per row, using a "
          "separator such as ' · ' between fields" for t in _TABULAR},
    **{t: "images aren't supported — describe it in text, or link to it "
          "with <a href>" for t in _IMAGE},
    **{f"h{n}": "use <h3>, the smallest heading Journery supports" for n in (4, 5, 6)},
    **{t: "apply inline formatting with <b>, <i>, <u>, <s>, or <code>"
       for t in _INLINE_STYLING},
}

# Link schemes the editor allows (mirrors pasteSafeHref in static/app.js). '#' and
# '/' cover in-page anchors and root-relative links.
_SAFE_HREF_PREFIXES = ("http:", "https:", "mailto:", "tel:", "#", "/")


class UnsupportedHtmlError(Exception):
    """A write-tool input used HTML outside Journery's vocabulary.

    Carries a JSON-RPC ``-32602`` code and a machine-actionable ``message`` (the
    exact offending item, the complete supported-tag list, and a concrete
    substitution when one exists). The MCP dispatcher turns this into a JSON-RPC
    error so the agent is told precisely what to fix and can retry unattended.
    """
    code = -32602

    def __init__(self, message):
        self.message = message
        super().__init__(message)


def supported_tags_csv():
    return ", ".join(SUPPORTED_TAGS)


def _unsupported_tag_message(tag):
    msg = f"Unsupported HTML tag '{tag}'. Supported tags: {supported_tags_csv()}."
    suggestion = SUGGESTIONS.get(tag)
    return msg + (f" Suggestion: {suggestion}." if suggestion else "")


def body_param_description():
    """Terse, generated body-parameter description for the write tools.

    Regenerated from SUPPORTED_TAGS, so it can never drift from the validator.
    Kept to a single line — tool descriptions are re-sent on every tools/list
    call and cost context tokens continuously.
    """
    return ("HTML. Use exactly these tags and no others: "
            f"{supported_tags_csv()}. Plain-text newlines do NOT render — use "
            "<br> or a block tag. Links: <a href> with an http(s)/mailto/tel URL. "
            "Unsupported tags are rejected with the allowed list and a substitution.")


class _Validator(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.error = None   # first problem found, in document order

    def _check(self, tag, attrs):
        if self.error:
            return
        tag = tag.lower()
        if tag not in SUPPORTED_TAGS_SET:
            self.error = _unsupported_tag_message(tag)
            return
        # The tag is allowed; guard the two attribute vectors the editor's own
        # paste path already blocks (kept minimal — this is not a full sanitizer).
        for name, value in attrs:
            name = (name or "").lower()
            if name.startswith("on"):
                self.error = (f"Unsupported attribute '{name}' on <{tag}>. "
                              "Event-handler attributes aren't allowed.")
                return
            if tag == "a" and name == "href":
                v = (value or "").strip().lower()
                if v and not v.startswith(_SAFE_HREF_PREFIXES):
                    self.error = (f"Unsupported link scheme in <a href>: {value!r}. "
                                  "Use an http(s):, mailto:, or tel: URL.")
                    return

    def handle_starttag(self, tag, attrs):
        self._check(tag, attrs)

    def handle_startendtag(self, tag, attrs):
        self._check(tag, attrs)


def validate_html(html):
    """Raise ``UnsupportedHtmlError`` on the first tag/attribute outside Journery's
    vocabulary; no-op for empty/whitespace input.

    Never silently strips or normalizes — a hard rejection is what teaches the
    agent the contract. A silent strip would return success while the write was
    wrong, and the agent would report success to the user who discovers the damage
    later.
    """
    if not html or not html.strip():
        return
    v = _Validator()
    v.feed(html)
    v.close()
    if v.error:
        raise UnsupportedHtmlError(v.error)
