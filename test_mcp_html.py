"""Tests for the MCP HTML-vocabulary contract (htmlschema + the MCP write tools).

Run: python3 -m unittest test_mcp_html   (stdlib only, no pytest needed)

Covers the acceptance criteria: an agent can learn the contract from the tool
surface, is told precisely when it violates it, and can repair its own output.
"""
import os
import re
import tempfile
import unittest

# Point the app/db at a throwaway DB *before* importing app (db reads the path at
# import, and importing app runs init_db()).
os.environ["JOURNERY_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

import htmlschema          # noqa: E402
import app                 # noqa: E402  (triggers db.init_db against the temp DB)

HERE = os.path.dirname(os.path.abspath(__file__))


def _sample(tag):
    """A minimal valid HTML fragment exercising `tag` (validation is tag-only, so
    nesting need only be plausible)."""
    if tag in ("br", "hr"):
        return f"<{tag}>"
    if tag in ("ul", "ol"):
        return f"<{tag}><li>x</li></{tag}>"
    if tag == "li":
        return "<ul><li>x</li></ul>"
    if tag == "a":
        return '<a href="https://example.com">x</a>'
    if tag == "pre":
        return "<pre><code>x = 1</code></pre>"
    return f"<{tag}>x</{tag}>"


class TestValidatorContract(unittest.TestCase):

    def test_every_supported_tag_validates(self):
        for tag in htmlschema.SUPPORTED_TAGS:
            htmlschema.validate_html(_sample(tag))  # must not raise

    def test_each_unsupported_tag_is_rejected_and_named(self):
        # NOTE: div / strong / em / strike are NOT here — they're part of the
        # editor's own vocabulary (it emits <div> on Enter etc.), so they must be
        # ACCEPTED, else the editor's own notes can't be updated. See
        # TestEditorContentRoundTrips.
        for tag in ("table", "tr", "td", "img", "span", "font", "h4", "h6",
                    "script", "iframe", "section", "article"):
            with self.assertRaises(htmlschema.UnsupportedHtmlError) as cm:
                htmlschema.validate_html(f"<{tag}>x</{tag}>")
            self.assertIn(f"'{tag}'", cm.exception.message,
                          f"error for <{tag}> must name the tag")

    def test_editor_synonyms_are_accepted(self):
        # These render fine and the editor emits them, so they must NOT be rejected.
        for tag in ("div", "strong", "em", "strike"):
            htmlschema.validate_html(f"<{tag}>x</{tag}>")  # must not raise

    def test_error_lists_the_full_supported_set(self):
        # Assert by PARSING the message, not string equality.
        with self.assertRaises(htmlschema.UnsupportedHtmlError) as cm:
            htmlschema.validate_html("<table><tr><td>a</td></tr></table>")
        msg = cm.exception.message
        m = re.search(r"Supported tags: ([^.]+)\.", msg)
        self.assertIsNotNone(m, "message must list supported tags")
        listed = {t.strip() for t in m.group(1).split(",")}
        self.assertEqual(listed, set(htmlschema.SUPPORTED_TAGS))

    def test_common_offenders_carry_a_substitution(self):
        for tag, needle in [("table", "<ul>"), ("img", "<a href>"), ("h4", "<h3>"),
                            ("span", "<b>")]:
            with self.assertRaises(htmlschema.UnsupportedHtmlError) as cm:
                htmlschema.validate_html(f"<{tag}>x</{tag}>")
            self.assertIn("Suggestion:", cm.exception.message)
            self.assertIn(needle, cm.exception.message)

    def test_unsafe_link_and_event_handlers_rejected(self):
        for bad in ('<a href="javascript:alert(1)">x</a>',
                    '<p onclick="steal()">x</p>'):
            with self.assertRaises(htmlschema.UnsupportedHtmlError):
                htmlschema.validate_html(bad)

    def test_safe_links_and_checklist_classes_pass(self):
        htmlschema.validate_html('<a href="https://x.com">x</a>')
        htmlschema.validate_html('<a href="mailto:a@b.co">x</a>')
        htmlschema.validate_html('<ul class="task-list"><li class="done">x</li></ul>')


class TestNoSchemaDrift(unittest.TestCase):
    """THE anti-drift guard: the editor's canonical vocabulary lives in
    static/app.js (PASTE_ALLOWED_TAGS — "the structure Journery itself uses").
    Adding a block to the editor without updating htmlschema.SUPPORTED_TAGS (which
    generates the tool description) fails here."""

    def test_paste_whitelist_matches_supported_tags(self):
        with open(os.path.join(HERE, "static", "app.js"), encoding="utf-8") as f:
            src = f.read()
        m = re.search(r"PASTE_ALLOWED_TAGS\s*=\s*new Set\(\[(.*?)\]\)", src, re.S)
        self.assertIsNotNone(m, "PASTE_ALLOWED_TAGS not found in static/app.js")
        paste = {t.lower() for t in re.findall(r"'([A-Za-z0-9]+)'", m.group(1))}
        # TRUE 1:1 binding — the validator's accepted set IS the editor's vocabulary,
        # exactly (no synonym-folding). If they differ, either the editor gained a
        # tag the validator would reject (breaking round-trips) or vice-versa.
        self.assertEqual(
            paste, set(htmlschema.SUPPORTED_TAGS),
            "editor schema (app.js PASTE_ALLOWED_TAGS) and htmlschema.SUPPORTED_TAGS "
            "differ — they must be identical so the validator never rejects markup "
            "the editor itself produces, and so the tool description stays accurate.")

    def test_description_is_generated_from_the_constant(self):
        desc = htmlschema.body_param_description()
        for tag in htmlschema.SUPPORTED_TAGS:
            self.assertIn(tag, desc)


class TestWriteToolsAndRepairLoop(unittest.TestCase):
    """The MCP write path end-to-end: supported HTML round-trips, unsupported HTML
    comes back as a JSON-RPC -32602 error, and an agent can repair its own note."""

    def test_supported_tags_roundtrip_through_create_and_get(self):
        for tag in htmlschema.SUPPORTED_TAGS:
            body = _sample(tag)
            created = app._tool_create_note({"title": "t", "body": body})
            got = app._tool_get_note({"note_id": created["note"]["id"]})
            self.assertEqual(got["body"], body, f"{tag} did not round-trip")

    def test_create_with_unsupported_html_is_a_jsonrpc_32602(self):
        resp = app._mcp_dispatch(
            "tools/call",
            {"name": "create_note",
             "arguments": {"title": "trip", "body": "<table><tr><td>a</td></tr></table>"}},
            42)
        self.assertIn("error", resp, "should be a JSON-RPC error, not a success")
        self.assertEqual(resp["error"]["code"], -32602)
        self.assertIn("'table'", resp["error"]["message"])
        self.assertIn("Supported tags:", resp["error"]["message"])

    def test_append_validates_only_new_html(self):
        note = app._tool_create_note({"title": "t", "body": "<p>ok</p>"})["note"]
        with self.assertRaises(htmlschema.UnsupportedHtmlError):
            app._tool_append_to_note({"note_id": note["id"], "body": "<table></table>"})
        # the existing (valid) body is untouched by the failed append
        self.assertEqual(app._tool_get_note({"note_id": note["id"]})["body"], "<p>ok</p>")

    def test_agent_can_repair_its_own_mistake_via_update_note(self):
        # Simulate the incident: an agent creates a note, then discovers a
        # formatting mistake and repairs it WITHOUT a human — read, fix, update.
        note = app._tool_create_note(
            {"title": "Japan", "body": "<h2>Day 1</h2><p>Tokyo</p>"})["note"]
        current = app._tool_get_note({"note_id": note["id"]})["body"]
        fixed = current + "<ul><li>Shibuya · 9am</li><li>Senso-ji · 2pm</li></ul>"
        result = app._tool_update_note({"note_id": note["id"], "body": fixed})
        self.assertTrue(result["updated"])
        self.assertEqual(app._tool_get_note({"note_id": note["id"]})["body"], fixed)

    def test_update_note_rejects_unsupported_html(self):
        note = app._tool_create_note({"title": "t", "body": "<p>x</p>"})["note"]
        with self.assertRaises(htmlschema.UnsupportedHtmlError):
            app._tool_update_note({"note_id": note["id"], "body": "<table>oops</table>"})

    def test_update_note_is_registered_as_a_tool(self):
        names = {t["name"] for t in app.MCP_TOOLS}
        self.assertIn("update_note", names)
        self.assertIn("update_note", app.MCP_HANDLERS)

    def test_real_editor_authored_body_survives_the_repair_loop(self):
        # The body a contenteditable editor actually emits: <div> lines, &nbsp;,
        # <b>/<strong>. Acceptance criterion 3 — an agent must be able to repair
        # such a note (get_note → edit → update_note) with NO human. This regressed
        # once when div/strong were rejected; guard it.
        editor_body = ('<div>Trip to <b>Japan</b>&nbsp;— day one</div>'
                       '<div><strong>Morning:</strong> Shibuya</div>'
                       '<div><br></div>')
        note = app._tool_create_note({"title": "Japan", "body": editor_body})["note"]
        fetched = app._tool_get_note({"note_id": note["id"]})["body"]
        self.assertEqual(fetched, editor_body, "editor body must round-trip through create/get")
        # agent appends a fix and rewrites the whole body — must NOT be rejected
        repaired = fetched + '<ul><li>Senso-ji · 2pm</li></ul>'
        result = app._tool_update_note({"note_id": note["id"], "body": repaired})
        self.assertTrue(result["updated"])
        self.assertEqual(app._tool_get_note({"note_id": note["id"]})["body"], repaired)


if __name__ == "__main__":
    unittest.main(verbosity=2)
