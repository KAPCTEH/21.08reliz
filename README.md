# JustFun audit ledger

Machine-readable audit state for JustFun. The project source belongs on the `main` branch; this ledger belongs on the orphan `audit-ledger` branch.

`github-config/` is the canonical review copy of the active repository governance files. Changes to `.github/` on `main` must be mirrored here and verified in the same audit cycle.

Current state: baseline preparation from a `NON_RELEASE_SNAPSHOT`. No `GO` or release claim is valid until schema, completeness, CI hash verification, GitHub merge, and annotated baseline tag are complete.

Latest verification: PR 12 head `9d093db1551b6239b4c4587eb697312e577af716` and stacked PR 13 head `6b7d16c07c4991fdeec255bfe35c69487432198a` passed the complete Windows `build-and-accept` gate. JF-AUDIT-0007 and JF-AUDIT-0001 remain `FIXED_PENDING_VERIFY` until merge and protected-main recheck.
