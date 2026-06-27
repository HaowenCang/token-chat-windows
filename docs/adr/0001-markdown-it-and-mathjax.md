---
status: accepted
---

# Use markdown-it and MathJax for message rendering

Token Chat renders untrusted, streaming model text through the single `renderMarkdown(content)` Interface. We use `markdown-it` for Markdown and MathJax for TeX-to-SVG because both handle substantially more syntax and edge cases than the previous handwritten parser while keeping library details behind one rendering Module; incomplete streaming syntax must degrade to text instead of throwing.

## Consequences

The renderer carries a larger frontend bundle, but parsing behavior, math support, accessibility metadata, and security fixes gain locality. Callers must not invoke either library directly.
