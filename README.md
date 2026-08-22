# JustFun audit ledger

Machine-readable audit state for JustFun. The project source belongs on the `main` branch; this ledger belongs on the orphan `audit-ledger` branch.

`github-config/` is the canonical review copy of the active repository governance files. Changes to `.github/` on `main` must be mirrored here and verified in the same audit cycle.

Current state: baseline preparation from a `NON_RELEASE_SNAPSHOT`. No `GO` or release claim is valid until schema, completeness, CI hash verification, GitHub merge, and annotated baseline tag are complete.

Latest verification: PR 12 head `9d093db1551b6239b4c4587eb697312e577af716` and stacked PR 13/14/15/16/17 heads through `217d4b9587825d2f8d3617eb2f2c9f54cc117775` passed the complete Windows `build-and-accept` gate. PR 15 also passed storage v3 revision 14/14 and isolated non-superuser PostgreSQL integration 3/3. PR 16 produced an exact-commit source-only ZIP with 204 verified files; both formerly broken release tests passed without `.github`. PR 17 reduced canonical CSS literal debt by 259 occurrences and passed a complete 96-candidate runtime matrix, accessibility, security, and Windows verification. Both Cloudflare Workers were deployed from exact commit `6b7d16c` with backup, canary, normalized bundle parity, and rollback targets. All seven findings are now `FIXED_PENDING_VERIFY`; none is closed until its remaining merge or live acceptance contract is complete.
