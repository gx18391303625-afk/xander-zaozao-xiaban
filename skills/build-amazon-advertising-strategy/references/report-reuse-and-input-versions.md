# Report reuse and input versions

Use when collecting or refreshing report-backed analysis. Read the project's current data SOP and the actual report adapter contract; reuse is not a reason to skip freshness, attribution or coverage checks.

- Before creating a report, look for a compatible stored result or in-flight request. Match account/profile, region/application, dates, report type, columns, grouping, filters and attribution definitions. A similar filename or overlapping date window alone does not establish compatibility.
- Set the acceptable retrieval age for the decision. Reuse sufficiently fresh completed rows; resume a compatible pending report rather than creating another. If the account's attribution backfill or a correction matters, deliberately refresh and preserve both snapshots. A cached result still carries its actual capture and coverage times; reading it today does not make it today's data.
- Use the adapter's cross-process request registry when available. Request creation and result reading are separate stages. Uncertain submission is not a reason to retry POST blindly; inspect the recorded request outcome or report identity first. Do not delete a lock whose owner may still be running.
- Force refresh is for an inadequate completed snapshot, not for bypassing an unknown submission. Failures, empty results, missing rows and zero metrics remain different states. Do not mix half-complete report batches to appear complete.
- Identify what was reused, resumed or newly requested in the compact acquisition receipt; report only meaningful progress rather than repeated unchanged polling. Never store access tokens or signed download URLs in reusable manifests.

When a project provides a shared-data registry, bind the exact input versions and hashes in the downstream calculation. Check product/account/date/currency/timezone and evidence state. Superseded, revoked or out-of-scope records require reviewed replacement and explicit rebinding, not silent substitution. A successfully replayed historical calculation is not proof that its inputs remain valid today. Use the project's bound profit/review entrypoints instead of copying old figures into a new script.

This changes acquisition and local validation only. It does not authorize advertising writes, subscription changes, background schedules or repeated paid calls.
