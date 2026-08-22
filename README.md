# JustFun audit ledger

Machine-readable audit state for JustFun. The project source belongs on the `main` branch; this ledger belongs on the orphan `audit-ledger` branch.

`github-config/` is the canonical review copy of the active repository governance files. Changes to `.github/` on `main` must be mirrored here and verified in the same audit cycle.

Current state: baseline preparation from a `NON_RELEASE_SNAPSHOT`. No `GO` or release claim is valid until schema, completeness, CI hash verification, GitHub merge, and annotated baseline tag are complete.

Latest verification: PR 12 head `9d093db1551b6239b4c4587eb697312e577af716` and stacked PR 13/14/15 heads through `dce5f976b701722d3ef6770a7c93d7e4075a4175` passed the complete Windows `build-and-accept` gate. PR 15 also passed storage v3 revision 14/14 and isolated non-superuser PostgreSQL integration 3/3. Both Cloudflare Workers were deployed from exact commit `6b7d16c` with backup, canary, normalized bundle parity, and rollback targets. JF-AUDIT-0007, JF-AUDIT-0001, JF-AUDIT-0002, JF-AUDIT-0003, and JF-AUDIT-0004 remain `FIXED_PENDING_VERIFY` until their remaining merge or live acceptance contracts are complete.
