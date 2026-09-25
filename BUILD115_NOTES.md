# RebataTrack Website Build 115

## Changes
- Corrected the portal naming model after Website Build 114: tester/customer-facing surfaces now consistently say **Beta Portal**.
- The private staff/admin experience remains **Admin Portal** on `admin-login.html`, `admin.html`, and the administrative runtime.
- Kept technical route/file names such as `beta-portal.html` unchanged for compatibility.
- Preserved the current iOS Build 341 screenshots and standardized RebataTrack/RebataTrack+ imagery introduced in Website Build 114.
- Preserved the current **Multi-Order Refund** terminology.
- Preserved Production Admin read-reduction behavior, Firebase configuration, portal workflows, legal/support content, and security behavior.

## Naming standard
- Staff/owner administrative pages: **Admin Portal**
- Approved beta tester/customer pages, sign-in, emails, tasks, Help & Feedback, and beta communications: **Beta Portal**
- Internal filenames/routes are not renamed solely for branding.

## Screenshot set retained from Build 114
- Home dashboard
- Orders
- Order detail / overdue state
- Order information / notes
- Record refund / partial refund
- Reports / Financial Intelligence
- More / settings
- Shared Profiles
- Help / walkthrough / RebataTrack+ card
- RebataTrack+ plan picker
- Trial ended / subscription choices

## Intentional compatibility identifiers
Do not rename Firebase project IDs, Firestore paths, Android package IDs, iOS bundle IDs, Play product IDs, deployed Worker names, or existing website routes solely for branding.
