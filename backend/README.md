# Trueblaster backend

## Structure

```text
backend/
  server.js
  src/
    config/
    controller/
    middleware/
    models/
    routes/
  scripts/
  test/
  uploads/
```

- `server.js` configures Express, connects MongoDB, starts HTTP and the delivery worker, and handles shutdown.
- `src/config/` contains database and CORS settings.
- `src/controller/` contains request handling and application logic, including campaign delivery, mail rendering, tracking, and SNS notifications.
- `src/middleware/` contains authentication, password/token helpers, request validation/error handling, and uploads.
- `src/models/` has one schema per file, with explicit imports and no model index file.
- `src/routes/` only registers endpoints and their middleware/controllers.
- `scripts/` contains explicit workspace provisioning and account index migration commands.
- `test/` exercises the backend against a temporary MongoDB replica set.

## Setup

Start the backend directly with `node server.js`, or use `npm start` (the same command).

Use Node.js 22 or later. From backend run npm ci, then configure .env using .env.example. MONGO_URI includes the database name (trueblaster). AUTH_SECRET and TRACKING_SECRET must be independent random values of at least 32 characters. Never commit .env.

Run npm run workspace:create to create a workspace and its owner. Email is globally unique for email/password login. Signup requires firstName, lastName, email, and password; each signup creates an isolated workspace and owner. Each owner belongs to one workspace. Passwords are scrypt hashes in users. Owner names/email, workspace names/slugs, and sender email are entered interactively; the password is not echoed on a terminal.

Legacy FULL_USERS/LIMITED_USERS entries remain pending and are not imported or accepted for login. The old bootstrap command is disabled because usernames do not establish an email identity. Use signup or workspace:create for new accounts.

When upgrading an earlier username schema, run npm run db:migrate-email before creating additional users. It refuses to remove the old username index if there are accounts without an explicit email mapping.

Run npm start. The database-backed worker restores queued/scheduled campaigns after restart. Without AWS configuration it leaves the queue untouched. No emails are sent by database setup or bootstrap commands.

## Database

One database has workspaces, users, contacts, contact_lists, list_memberships, templates, campaigns, campaign_recipients, campaign_events, and suppressions.

Every business document has workspaceId; every management query derives it from the authenticated account. Email/name uniqueness is scoped to the workspace, except globally unique login emails and workspace slugs. Fixed collections replace list/campaign-named collections. A compound unique key prevents duplicate campaign recipients and list memberships. Suppression uniqueness includes reason so removing a manual block does not remove an unsubscribe or hard-bounce suppression.

Imports and campaign snapshots use MongoDB transactions and require a replica set (Atlas supports this). Imports accept up to 20,000 rows / 10 MB per request. Repeat imports merge contacts by normalized email and add membership without duplicating it. Deleting a list removes membership links, preserving contacts and campaign history.

Campaign content and recipient personalization are snapshots. Accepted by SES is distinct from delivered. Recipient outcomes and immutable events feed analytics; no duplicated per-campaign event collections or separate message-map collection is needed.

## API compatibility and authentication

Existing contact, template, campaign, blocklist, and unsubscribe endpoint names and legacy response field names are retained. POST /login accepts email/password and returns success/message, a signed token, the user profile, and workspace. POST /signup accepts firstName/lastName/email/password and returns the same session shape with status 201. Management requests must include Authorization: Bearer TOKEN. The included frontend changes attach this token to Axios, progress polling, and CSV downloads. POST /logout revokes that user's current sessions. The UI layout is unchanged.

Campaign sending now responds when queued, rather than holding a request open for the full blast. The progress endpoint returns JSON by default; authenticated SSE is still available with Accept: text/event-stream. Tracking endpoints are public but require signed, action-specific recipient tokens. Old unsigned links are intentionally not accepted because they cannot establish safe workspace ownership.

## Sending configuration

AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, FORCE_SES_REGION, and a verified FROM_EMAIL are required to send. A workspace can have its own verified senderEmail; otherwise it uses the platform default. Clients cannot override the configured sender. All workspaces currently share platform SES credentials and configured batch limits. Per-customer SES credentials, quotas, and billing are separate features.

PUBLIC_API_URL is the externally reachable backend origin used in email links. localhost is suitable for local API development only; recipients need a public HTTPS URL for working email tracking/unsubscribe links. IPINFO_TOKEN retains location analytics. TRUST_PROXY is optional and should describe only your trusted reverse proxy, e.g. loopback; the default does not trust forwarded headers.

Set SES_SNS_TOPIC_ARNS to a comma-separated allowlist of your SES notification topic ARNs and point SNS at /api/campaign/ses-webhook. Signatures and certificate URLs are verified before subscription confirmation or notification processing. Deliveries, bounces, and complaints use SES message IDs to find the correct workspace. Notifications arriving before message persistence return 503 for SNS retry.

The worker leases campaigns in MongoDB and rechecks suppressions immediately before each send. Sending has no automatic SES retries: network timeouts or interrupted sends become unknown/needs_review, preventing blind duplicate sends. Review those recipients against SES before any manual retry. Exactly-once email delivery cannot be guaranteed across SES and MongoDB. Database failures do not trigger automatic resends of a recipient already attempted.

## Tests

npm test starts an isolated temporary MongoDB replica set, exercises real transactions, duplicate imports, two-workspace isolation, object-ID ownership, signed tracking, suppressions, analytics/CSV/progress, logout revocation, and interrupted worker recovery. SES is stubbed; no live email is sent. mongodb-memory-server may download a MongoDB binary on its first run.

## Existing data

This is a new schema. No old collections are deleted or automatically copied. Existing list/campaign collections do not encode a trustworthy workspace owner; assign owners explicitly in a reviewed migration before importing that data. Old unsigned tracking links require a separate deliberate transition plan if there are live campaigns.

## Dependency sources

The Excel dependency is installed from the maintained official SheetJS distribution: https://docs.sheetjs.com/docs/getting-started/installation/nodejs/. Multer uses its current 2.x upload API: https://github.com/expressjs/multer. SNS verification follows the documented field order and certificate URL checks: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html.

## Frontend synchronization

GET /me validates the current session and returns the user profile and workspace metadata, including senderEmail and mailConfigured. It never returns SES credentials or password hashes. Frontend reloads verify this endpoint before displaying workspace screens. The sender shown in test-email UI is read-only; sending remains disabled until backend mail configuration is ready. Existing business API formats are retained. Recipient detail error includes a skip reason when applicable.

## Template images and editor saves

PUT /api/preview/:id accepts optional name along with html/css and saves them atomically within the authenticated workspace. Existing clients that only send html/css remain supported.

POST /api/preview/images accepts one authenticated multipart file (field: file), up to 5 MB. The controller detects PNG/JPEG/GIF/WebP signatures and stores accepted images with generated UUID filenames under uploads/template-images. SVG and non-image files are rejected. GET /api/template-images/:filename serves those public email assets without authentication, with a fixed image content type, nosniff, and immutable caching. URLs use PUBLIC_API_URL.

Image bytes live on disk, not MongoDB. Persist and back up uploads/template-images alongside the database when deploying. Template deletion does not delete images because other templates and already-sent messages can reference them. Image URLs are public and should not contain confidential content.
