# Rebatify Website Build 60

- Started from the exact Rebatify Website Build 59 baseline.
- Added `reset-password.html` for the main Rebatify Firebase project (`rebatify-eefb8`).
- The page verifies Firebase password-reset OOB codes and applies the user's new password through the Firebase Authentication REST API.
- Uses existing Rebatify website styling, icon, support address, and links.
- The reset page is `noindex` and does not expose any admin credentials or SMTP secrets.
- No existing Beta Program, admin, portal, public-site, privacy, terms, or support behavior was changed.
