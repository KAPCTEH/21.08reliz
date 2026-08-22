# JustFun audit ledger

Machine-readable audit state for JustFun. The project source belongs on the `main` branch; this ledger belongs on the orphan `audit-ledger` branch.

`github-config/` is the canonical review copy of the active repository governance files. Changes to `.github/` on `main` must be mirrored here and verified in the same audit cycle.

Current state: baseline preparation from a `NON_RELEASE_SNAPSHOT`. No `GO` or release claim is valid until schema, completeness, CI hash verification, GitHub merge, and annotated baseline tag are complete.

Latest verification: PR 12 head `9d093db1551b6239b4c4587eb697312e577af716`, stacked PR 13 head `6b7d16c07c4991fdeec255bfe35c69487432198a`, and stacked PR 14 head `c517545832ad41b20405cfb6376a6c3c0f4c1392` passed the complete Windows `build-and-accept` gate. Both Cloudflare Workers were deployed from exact commit `6b7d16c` with backup, canary, normalized bundle parity, and rollback targets. JF-AUDIT-0007, JF-AUDIT-0001, JF-AUDIT-0002, and JF-AUDIT-0004 remain `FIXED_PENDING_VERIFY` until their remaining merge or live acceptance contracts are complete.
