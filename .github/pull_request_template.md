## Summary

Describe the change and why it is needed.

## Linked Issue

Use `Fixes #...` or `Refs #...` when available.  
If no issue exists, include a short rationale/scope summary.

## OpenCode Validation

- Current production released OpenCode version tested:
- Why this version is relevant to the fix:

## Quality Checklist

- [ ] I ran `npm run typecheck`
- [ ] I ran `npm test`
- [ ] I ran `npm run build`
- [ ] This is the smallest safe root-cause fix (no unnecessary hook/output mutation logic)
- [ ] I preserved behavioral invariants and updated/added boundary tests as needed
- [ ] I updated docs for user-facing workflow/command/config changes (`README.md` and `CONTRIBUTING.md` when applicable)
