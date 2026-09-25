# RebataTrack Website Build 113

- Public site, Beta Program, tester portal, admin portal, support/legal/account pages, metadata, and runtime customer-facing wording migrated from Rebatify/Rebatify+ to RebataTrack/RebataTrack+.
- Canonical tagline is exactly: **Never lose track of what's coming back.** The old `Order. Track. Complete. Get Refunded.` wording and former `Simplify with ...` secondary badge/signoff were removed.
- New RebataTrack app icon applied to website icon/favicon slots.
- Existing app-preview screenshots are intentionally retained until fresh RebataTrack screenshots are supplied.
- Production Admin startup now loads Overview first and lazy-loads Users/Devices/Linked Accounts/Access/Audit only when the corresponding view is opened.
- Production Admin manual refresh refreshes Overview plus only the active production view, reducing redundant Firestore reads.
- Existing domains, Firebase IDs, email addresses, Firestore paths, and deployed endpoints remain unchanged until replacement infrastructure is provisioned and tested.
