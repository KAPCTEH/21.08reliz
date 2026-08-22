# JustFun audit ledger

Machine-readable audit state for JustFun. The project source belongs on the `main` branch; this ledger belongs on the orphan `audit-ledger` branch.

`github-config/` is the canonical review copy of the active repository governance files. Changes to `.github/` on `main` must be mirrored here and verified in the same audit cycle.

Current state: accepted audited source baseline `8fc993ea9ac84c511845279b796f4fbacdff6435`, tagged `audit-baseline-2026-08-22-8fc993e`. This is a source baseline, not a `RELEASE GO` claim.

Latest verification: PR 12 through PR 17 were consolidated with mandatory governance through PR 7 into protected `main`. Exact commit `8fc993ea9ac84c511845279b796f4fbacdff6435` passed `impact-and-tests` and the complete Windows `build-and-accept` gate. Findings JF-AUDIT-0001, 0002, 0003, 0005, 0006 and 0007 are closed. JF-AUDIT-0004 remains `FIXED_PENDING_VERIFY` until authenticated Cloudflare/Telegram live acceptance is complete. TZ 2 automatic update and final release proof are not complete, so governance remains `NO_GO`.
