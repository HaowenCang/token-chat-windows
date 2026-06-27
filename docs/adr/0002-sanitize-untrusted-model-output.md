---
status: accepted
---

# Keep an explicit safety layer for model output

Model output and Web Search evidence are untrusted even when parsed by a mature Markdown library. The Markdown rendering Module disables raw HTML, escapes code and fallback text, validates links against an allowlist, and only emits MathJax-generated SVG; future renderer changes must preserve this safety layer rather than treating parser output as trusted HTML.

## Consequences

Unsupported raw HTML is displayed as text or omitted, and new Markdown extensions must be reviewed for URL, attribute, and HTML injection behavior before being enabled.
