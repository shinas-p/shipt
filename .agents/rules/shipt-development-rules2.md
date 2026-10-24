---
trigger: always_on
---

# Fast Implementation Rule

For every development request:

- Inspect the relevant code before editing.
- Identify the smallest complete solution.
- Reuse existing components, utilities, and Supabase patterns.
- Avoid unnecessary refactoring, dependencies, redesigns, and repeated repository-wide searches.
- Implement the requested feature end-to-end, including validation, permissions, error handling, and appropriate tests.
- Do not stop at a plan when the user has asked for implementation.
- Do not silently omit requirements. Report any requirement you could not implement.
- Run focused verification immediately after the changes, followed by broader checks when practical.
- Review the final diff and preserve unrelated user changes.
- Never invent test results or claim success without verification.
- Never commit, push, deploy, or change production without explicit approval.

Prioritize correctness, security, maintainability, and fast delivery—not merely fewer lines of code.