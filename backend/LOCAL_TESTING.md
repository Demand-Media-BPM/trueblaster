# Current sending configuration — 24 November 2026

Local and production now use normal campaign sending by default. No SENDGRID_TEST_* variables are required. The active .env and .env.ngrok omit them. Recipient allowlists, maximum test recipient counts and run IDs apply only if optional SENDGRID_TEST_MODE=true is explicitly enabled. The older controlled-test instructions below describe that optional mode, not the current default.

Keep NODE_ENV=development and SENDGRID_PROJECT_ID=trueblaster-local locally; use NODE_ENV=production and the existing production project ID on EC2. Both use the chosen trueblaster database. Keep the worker off until ready to process queues. Local and production workers claim only their own project's normal campaigns; old test campaigns remain excluded.

Configure a public HTTPS ngrok URL and the separate local webhook verification key before local campaign delivery. Sender compliance, authentication, signed webhook verification, suppression and unsubscribe checks remain enforced. Normal local campaigns send real email and have no test-recipient cap.

---

# TrueBlaster local testing readiness — 19 November 2026

**20 November preview update:** Send Test Mail accepts any valid receiver and does not require the bulk campaign allowlist. Bulk campaign restrictions remain unchanged. No live email was sent while implementing or testing this change.

**20 November update:** The developer explicitly chose to use the shared Atlas `trueblaster` database locally. `ALLOW_PRODUCTION_DATABASE_LOCAL=true` now permits that database only in development. The worker remains off; automatic index/collection creation and tracking-metadata cleanup are disabled for this shared connection. Local UI edits/imports/deletions affect real production data. The isolated-database instructions below remain available for a separate test setup, but do not describe the current chosen connection. Automated tests still use owned disposable databases.

This report applies to `C:\Projects Folder\Email Tool\email-blasting-tool`.
No deployment, Git push, AWS/Netlify change, SendGrid setting change, production database access,
production webhook enablement or live email send was performed.

## Decision

**NO-GO for live email sending right now. GO for manual local setup and offline/simulated testing.**

The code path is tested with a real disposable MongoDB replica set, local Express requests, generated
ECDSA signatures and fake provider transports. Actual inbox delivery and Gmail/Outlook/mobile rendering
remain unverified until the developer manually performs the controlled test below.

Resolve these setup gates before enabling delivery:

1. Start/initialize the separate local MongoDB replica set on port 27018.
2. Set `SENDGRID_TEST_RECIPIENT_ALLOWLIST` to the exact authorized inboxes (no wildcards).
3. Start ngrok and set `PUBLIC_API_URL` to its HTTPS origin; restart the backend.
4. Create a separate local SendGrid webhook and configure its matching signed-verification public key.
   The existing key parses correctly, but its webhook association cannot be established from local files.
5. Have the account owner verify that existing receivers safely ignore TrueBlaster project/message IDs.
   This code isolates TrueBlaster; it cannot prove how another project's receiver behaves.

6. Establish sender postal compliance: the current application fallback does not pass template compliance validation. Configure a real non-placeholder sender address centrally, or approve the actual address in the selected template. No address was invented or substituted.

The API key cannot read the account webhook inventory (read-only request returned HTTP 403), so the
disabled production webhook, available webhook slots and existing receiver configurations need owner review.
Do not broaden the runtime API key's permissions merely to perform this review; use the account UI.

## Feature readiness

| Feature | Status | Evidence / remaining work |
| --- | --- | --- |
| SendGrid request construction / sender / Reply-To | READY | Fake transports verify v3 Mail Send, intended recipient, sender allowlist, reply address and correlation arguments; no SES sending imports remain in the active sender |
| Actual SendGrid connectivity | PARTIALLY READY | Authenticated read-only `/v3/scopes` returned 200; does not prove Mail Send permission or actual delivery |
| Local worker protection | READY | Default/local test mode, exact recipient allowlist, max 1–10 per campaign (default 3), namespace and persisted run marker checks before sending; worker remains disabled |
| Local runtime MongoDB | BLOCKED | Config now selects `trueblaster_local`; localhost:27018 was not running during read-only ping |
| HTML file upload and preservation | READY | Templates page now has Upload HTML; raw text goes to the existing template API without automatic editor import; backend snapshots preserve HTML/CSS and whitespace |
| CSV/Excel importing | READY | CSV normalization, invalid-row rejection, deduplication, contacts/memberships and scoped history exercised against MongoDB |
| Campaign queue / schedule / restart recovery | READY | Persisted snapshots, due-time worker claims, leases, suppression rechecks and ambiguous-send recovery tested; local marker prevents claiming old production queues |
| Campaign pause/resume buttons/API | NOT IMPLEMENTED | No per-campaign pause/resume endpoint exists; do not present stopping/restarting the worker as that feature |
| Actual inbox delivery | PARTIALLY READY | No live send performed; requires authorized controlled inbox test |
| Existing / fallback unsubscribe | READY | Stored templates unchanged; visible approved mechanism reused, otherwise a minimal outgoing-only footer; signed confirmation GET/POST and one-click POST persist scoped opt-outs |
| Gmail/Outlook/mobile footer behavior | PARTIALLY READY | Simple inline HTML link/footer and preserved CSS tested structurally, not in actual mail clients |
| Signed SendGrid webhook | READY | Raw bytes, tampering rejection, all supported event types, unknown project filtering, tenant/message ownership and duplicate/retry handling tested |
| Public local webhook | BLOCKED | No tunnel or local webhook was created by the agent; public key must match the dedicated local receiver |
| Shared-account outbound isolation | BLOCKED | Other receivers may receive these sends too; their ownership filtering is outside this repository and requires confirmation |
| Bounce/failure classification | READY | Explicit SMTP destination failures vs permanent message-policy blocks vs temporary blocks/deferrals; policy blocks do not automatically suppress mailbox addresses |
| IPinfo | READY | Real read-only lookup of public diagnostic IP 8.8.8.8 returned country, region, city, organization and ASN; only field availability was reported |
| IPinfo cache/failure/privacy behavior | READY | Reused implementation now serves SendGrid and legacy tracking; bounded cache, in-flight deduplication, negative caching and 2-second timeout; errors do not invent location |
| Device/browser/OS reporting | READY | Existing ua-parser-js reused; available UA parsed, absent data remains N/A; proxy/scanner indications are labelled as inferences |
| Mongo event storage / idempotence | READY | Existing collections extended, compound event dedupe index retained, transactional suppression/state updates, metadata fields and retention index tested |
| Dashboard and CSV | READY | Real event counts, unique recipient engagement, processed and delivery outcomes, URLs/times, IPinfo organization/ASN and available UA fields connected to reports |
| Physical sender compliance | BLOCKED | Current central fallback fails validation for a plain template. Configure a real non-placeholder central address or approve a valid visible address in the selected template; actual ownership remains administrator-confirmed |

## Bugs and actual files changed for this readiness pass

Earlier SendGrid/compliance edits are already uncommitted in this checkout. This table identifies the
additional readiness work, not an assertion that every Git diff was newly introduced in this pass.

| Actual relative path | Change / reason |
| --- | --- |
| `.gitignore` | Ignore local Mongo data and implementation staging |
| `backend/.env` (ignored) | Preserve credentials; replace unsafe local production DB/namespace with local values, add strict test settings, keep worker off |
| `frontend/.env` (ignored) | Local API `http://localhost:5000`, local HTTP development |
| `backend/.env.example` | Document safe local database, recipient gates, cache and retention names |
| `backend/package.json` | Owned-replica test runner, local replica initializer and read-only diagnostic scripts |
| `backend/server.js` | Start/stop bounded tracking-metadata retention with application lifecycle |
| `backend/src/config/database.js` | Reject production/default database names in local development before connection/index creation |
| `backend/src/config/local-safety.js` (new) | Local test-mode, allowlist, max count, namespace/run and isolated database checks |
| `backend/src/controller/mail.controller.js` | Enforce controlled-send policy for both campaign and preview sends |
| `backend/src/controller/delivery.controller.js` | Fence actual worker claim and send; local guard failures are definite failures, not ambiguous network sends |
| `backend/src/controller/campaign.controller.js` | Validate authorized test audience, snapshot test markers, add processed/permanent-block counts and complete engagement metadata/CSV |
| `backend/src/controller/tracking.controller.js` | Reuse/extend existing IPinfo lookup; cache and deduplicate, parse available UA, minimize/anonymize old metadata |
| `backend/src/controller/sendgrid.controller.js` | Enrich only owned engagement events; preserve signed/raw batching security; classify blocked failures using SMTP evidence |
| `backend/src/models/campaign.model.js` | Test mode/run marker snapshot |
| `backend/src/models/campaignRecipient.model.js` | Provider-processed timestamp |
| `backend/src/models/campaignEvent.model.js` | Organization, ASN, geo/traffic indicators, enrichment/anonymization timestamps and retention query index |
| `backend/scripts/run-tests.js` (new) | One newly owned replica set per test run, isolated per-file DBs, stop before bounded Windows cleanup retries |
| `backend/scripts/init-local-mongo.js` (new) | Initialize only the loopback local replica set; never clear databases |
| `backend/scripts/check-local-readiness.js` (new) | Read-only configuration, Mongo ping, SendGrid/IPinfo connectivity and public-link diagnostics; never calls Mail Send |
| `backend/test/helpers/database.js` (new) | Use only the owned shared local fixture server or a newly created standalone fixture server |
| `backend/test/startup.test.js` | Share owned test Mongo and force test/worker-off child configuration |
| `backend/test/workspaces.test.js` | Share owned fixture server and explicitly allow fake test recipients |
| `backend/test/sendgrid.test.js` | New policy-block checks, shared fixture server, explicit fake local-send settings |
| `backend/test/safetyEngagement.test.js` (new) | Local DB/sending gates, bounce evidence, IPinfo cache/errors and UA parsing |
| `backend/test/lifecycle.test.js` (new) | Simulated complete CSV/template/campaign/worker/webhook/report/opt-out/retention workflow, live network POSTs forbidden |
| `frontend/src/pages/Campaigns.js` | Event-backed metrics, metadata columns, clicked URL/campaign/timestamp details and inference/privacy notes |
| `frontend/src/utilities/api.js` | Distinguish permanent message-policy block from a temporarily blocked recipient |
| `frontend/src/tests/Campaigns.test.js` | Assert actual metadata fields and approximate-location wording |
| `frontend/src/pages/MailPreview.js` | Add missing raw HTML upload path without automatically opening/saving the visual editor |
| `frontend/src/utilities/templateContent.js` | Read uploaded source without normalization; remove placeholder postal text from new starters (existing stored templates untouched) |
| `frontend/src/tests/MailPreview.test.js` | Source-preserving file upload test |
| `frontend/src/tests/templateContent.test.js` | Reject empty, wrong-type and oversized HTML uploads |
| `backend/README.md`, `backend/SENDGRID.md`, `backend/LOCAL_TESTING.md` | Current local setup, behavior, evidence and remaining manual gates |

## Safety and reporting definitions

Local configuration is now separate from the production database and project. Do not restore the old
production URI/namespace into local `.env`. The existing production data was not connected to, migrated,
deleted or modified. A fresh local database has no production accounts: create a local test account via signup.

Local sending requires `SENDGRID_TEST_MODE=true`, an exact recipient allowlist, a small count and a current
`SENDGRID_TEST_RUN_ID`. New campaigns snapshot `testMode` and `testRunId`. The worker only claims the current
project/run's campaigns and rechecks policy and suppressions immediately before the provider request.
Actual marketing provider requests also require a public HTTPS origin; localhost/private email-link origins are blocked before the external API call. Offline fake transports remain usable by automated tests. Manually requested preview emails accept any valid receiver without a campaign allowlist; authentication, approved sender and workspace suppression checks still apply. There is no wildcard/domain allowlist. Maximum applies
per campaign; review all due campaigns in the current run before enabling the worker.

Accepted means SendGrid accepted a request, not inbox delivery. Attempted includes interrupted attempts.
Processed is an observed provider processed event. Delivered means recipient-server acceptance. Current
delivered/hard/soft/deferred/dropped/permanent-policy/unclassified outcomes are mutually exclusive; prior
deferrals/soft blocks remain available as historical counts. Complaints and opt-outs are independent flags
and can overlap delivery. Opens/clicks are stored event totals with distinct recipients counted once for
unique metrics. Open/click rates use accepted messages; no new definition of exact human engagement is claimed.

Blocks are not all automatically soft. A block with 4xx evidence is temporary; explicit 5.1.1/5.1.3 destination
evidence is a hard recipient failure; other 5xx policy responses are permanent for the message, without guessing
that the mailbox itself is permanently invalid. Missing/conflicting evidence remains reviewable. Deferral and
drop remain distinct. No automatic blind resend occurs after a timeout or interrupted provider acceptance.

IPinfo enriches open/click IPs only. Delivery SMTP server addresses are not presented as recipient locations.
Private/reserved/missing IPs are not looked up. Only plan-provided fields are stored; absent fields show N/A.
Network location is approximate and may be a proxy, privacy relay or security scanner. UA identifies only
available/inferred software/device information; it cannot reliably establish a specific email client or person.
Apple machine-open indications and scanner-like UA strings are labelled; no privacy protection is bypassed.

Default raw IP/location/organization/ASN/UA retention is 30 days. An hourly job anonymizes those fields in
old events, including old events arriving late, while preserving event IDs, times, type and deduplication.
Do not add a TTL index deleting event/dedupe records: that would allow duplicate replay and damage reporting.
The IPinfo cache is process-local, max 1000 entries, with a default one-hour success TTL and short negative caching.

## Required local environment

These are backend-only settings. Do not display or commit `.env` and do not put secrets in React variables.

| Variable | Current local requirement |
| --- | --- |
| `MONGO_URI` | `mongodb://127.0.0.1:27018/trueblaster_local?replicaSet=trueblaster-local&directConnection=true` |
| `LOCAL_TEST_DATABASE_NAME` | `trueblaster_local` |
| `NODE_ENV` | `development` |
| `PORT` | `5000` |
| `AUTH_SECRET`, `TRACKING_SECRET` | Existing values preserved; keep tracking secret stable for unsubscribe links |
| `SENDGRID_API_KEY` | Already configured; Mail Send permission still requires manual verification/controlled-send evidence |
| `SENDGRID_PROJECT_ID` | `trueblaster-local`, distinct from production |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | Already configured and parses; confirm/replace with the new LOCAL webhook's key |
| `SENDGRID_TEST_MODE` | `true` |
| `SENDGRID_TEST_RECIPIENT_ALLOWLIST` | Intentionally empty; developer must provide exact authorized email addresses, comma-separated |
| `SENDGRID_TEST_MAX_RECIPIENTS` | `3` default, valid 1–10 |
| `SENDGRID_TEST_RUN_ID` | Fresh local marker already configured; generate a new one before a separate testing run if old due queues must be excluded |
| `ENABLE_CAMPAIGN_WORKER` | `false` until explicitly enabled by the developer |
| `PUBLIC_API_URL` | Replace localhost with the current ngrok HTTPS origin before real email testing |
| `FROM_EMAIL`, `FROM_NAME`, `REPLY_TO_EMAIL` | Peter's configured sender/reply address and name preserved; workspace override must be centrally allowed |
| `SENDGRID_ALLOWED_SENDERS` | Approved senders only; retained |
| `IPINFO_TOKEN` | Already configured; real read-only connectivity verified |
| `IPINFO_CACHE_TTL_SECONDS` | `3600` default |
| `TRACKING_METADATA_RETENTION_DAYS` | `30`, valid 1–365 |
| Central compliance settings | Existing values preserved; real sender address must be centrally configured/approved, never guessed; no campaign company/address inputs |

Frontend `.env` is now only `REACT_APP_API_URL=http://localhost:5000` and `HTTPS=false`.
Restart processes after changing environment values. Inherited shell/process-manager values override dotenv;
do not leave production overrides in your local terminal.

## Exact Windows startup commands

Do these manually after reviewing this report. Do not copy `.env.example` over your configured `.env`.
Node.js 22+, npm, MongoDB 8.2 and ngrok were found/used in this environment. ngrok version/configuration
checks succeeded outside the restricted tool shell. The commands below do not require Docker.

### Terminal 1 — separate local MongoDB (keep running)

```powershell
Set-Location 'C:\Projects Folder\Email Tool\email-blasting-tool\backend'
New-Item -ItemType Directory -Path '.\.local-mongo' -Force | Out-Null
& 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe' --dbpath "$PWD\.local-mongo" --replSet trueblaster-local --bind_ip 127.0.0.1 --port 27018
```

This directory is persistent local test data and is ignored by Git. Never delete it to reset a test without
reviewing its contents/ownership. Port 27018 is deliberately separate from a default MongoDB service.

### Terminal 2 — initialize once, then run backend with delivery OFF

```powershell
Set-Location 'C:\Projects Folder\Email Tool\email-blasting-tool\backend'
npm ci
npm run db:local:init
$env:NODE_ENV='development'
$env:ENABLE_CAMPAIGN_WORKER='false'
node server.js
```

The initializer only talks to 127.0.0.1:27018 and refuses a different replica-set identity. It does not clear
any database. Wait until MongoDB is primary before using the application.

### Terminal 3 — ngrok (keep running)

```powershell
ngrok version
ngrok config check
ngrok http http://localhost:5000
```

Copy its HTTPS forwarding origin into backend `PUBLIC_API_URL`, without adding `/api`. Restart backend
with delivery still OFF. Keep the same tunnel running while following emailed links and receiving delayed events.
If the free tunnel displays a browser warning, complete it during manual link testing; verify webhook POSTs
are forwarded directly without challenges, redirects or application login. Do not disable signed verification.

### Terminal 4 — frontend

```powershell
Set-Location 'C:\Projects Folder\Email Tool\email-blasting-tool\frontend'
npm ci
npm start
```

Open `http://localhost:3000`. Use a new local account via signup, preferably in a separate browser profile/private
window, rather than assuming production credentials/accounts have been copied. No production account migration was run.

### Read-only readiness check (another terminal)

```powershell
Set-Location 'C:\Projects Folder\Email Tool\email-blasting-tool\backend'
npm run check:local
```

It pings only the isolated configured database, makes read-only SendGrid/IPinfo checks, and reports missing
setup without displaying keys. It never calls `/v3/mail/send`, starts a worker, or creates indexes/records.

## Dedicated LOCAL SendGrid webhook

1. Have the shared account owner confirm existing receivers ignore unknown project/campaign IDs.
   A separate API key or URL alone does not prevent those receivers from seeing TrueBlaster sends.
2. Check there is capacity for another Event Webhook. If the plan is full, do not replace/delete/disable
   any existing webhook. Arrange explicitly approved additional capacity or provider isolation.
3. Add **TrueBlaster local development** with HTTP POST URL:
   `https://YOUR-NGROK-HOST/api/webhooks/sendgrid`.
4. Enable Processed, Delivered, Open, Click, Bounce, Deferred, Dropped, Spam Report, Unsubscribe and
   applicable Group Unsubscribe/Resubscribe events. A block is a `bounce` with `type=blocked`, not a new
   invented `blocked` event name. Some group notifications depend on account/group configuration;
   leave existing account Subscription Tracking settings unchanged and test only applicable group behavior.
5. Enable signed Event Webhook verification on this new webhook. Copy its public verification key into
   backend `SENDGRID_WEBHOOK_PUBLIC_KEY`. Do not use another receiver's key. Restart only the local backend.
6. Leave the disabled production webhook and all TrueSendr webhooks unchanged. Do not enable production.
7. Use this new webhook's integration test. A signed generic example can return 200/ignored without writing
   a campaign record because it has no matching local campaign/recipient/attempt. That is expected isolation,
   not proof of real campaign correlation. Unsigned requests must fail (401 with a configured key).

For an unsigned negative test:

```powershell
Invoke-WebRequest -Uri 'http://localhost:5000/api/webhooks/sendgrid' -Method Post -ContentType 'application/json' -Body '[]'
```

PowerShell reports the expected HTTP error for 401; do not weaken security to make this return success.
Automated tests exercise valid signatures and tampering. Real signed delivery events prove the actual
local SendGrid key association after the manually authorized send. Inspect ngrok locally at `http://127.0.0.1:4040`;
its captured requests may contain recipient data, so do not share raw screenshots/batches containing personal data.

## Controlled live checklist — developer executes manually

1. Start local MongoDB, initialize it, start backend with worker OFF, then frontend. Confirm readiness ping.
2. Start ngrok, set public URL, create/configure the separate signed local webhook and restart backend.
3. Confirm shared-account receiver isolation with the owner. Do not proceed if that cannot be established.
4. Configure 1–3 authorized test inboxes in `SENDGRID_TEST_RECIPIENT_ALLOWLIST`; keep test mode true/max small.
5. If separating a new run from old local queues, generate a run marker with `[guid]::NewGuid().ToString()`
   and save it to `SENDGRID_TEST_RUN_ID` BEFORE creating the new campaign. Restart backend, still worker OFF.
6. Sign up locally, then Templates → **Upload HTML** → choose `.html`/`.htm` → confirm name/upload.
   The imported source stays intact; opening/saving in the visual editor later is an intentional content edit.
   Review the design and verify actual sender address/approved existing unsubscribe mechanism, or central fallback.
7. Import a small CSV/Excel list containing only those authorized addresses. CSV headers can be
   `Email,FirstName,LastName`. Verify normalization/count and no unexpected duplicates or suppressed recipients.
8. Create a uniquely named campaign using the saved template/list. Queue it with worker OFF. Review its
   exact recipients, sender/Reply-To, current test project/run markers and schedule. Review ALL due campaigns
   in this run: the maximum is per campaign, not a global per-run delivery quota.
9. Only when ready, stop the backend and explicitly enable delivery for that process:

```powershell
# Same backend terminal, after Ctrl+C and the above review:
$env:NODE_ENV='development'
$env:ENABLE_CAMPAIGN_WORKER='true'
node server.js
```

10. Confirm intended inboxes receive their personalized copies. Compare sender name/address, Reply-To,
    DKIM/SPF headers, actual body/CSS and one-click unsubscribe headers. Reply once and verify Microsoft 365 reception.
11. Open with images enabled and click an ordinary HTTPS link. Verify provider open/click events, unique vs
    total counts, clicked URL, available UA and IPinfo fields. Privacy proxies/scanners can inflate/suppress
    engagement; missing IP/UA/location is N/A, not a test failure requiring privacy bypasses.
12. Check Gmail, Outlook and mobile rendering/unsubscribe explicitly. GET should show confirmation without
    opting out. Confirm POST or mailbox one-click opt-out, Mongo suppression and skipped future campaign recipient.
    Scope is all future marketing campaigns in this local workspace, not other workspaces/projects.
13. Test failures with the automated signed fixtures first: invalid recipient 5.1.1, permanent policy 5.7.1,
    temporary 4xx, deferred, dropped, complaints and applicable group events. For actual SMTP failures use
    only a controlled mailbox/server you own. Do not guess third-party invalid addresses or create real spam
    complaints casually in the shared account; those can affect account reputation/suppression.
14. Compare read-only Mongo records, SendGrid activity and dashboard for this campaign. Expected fields are
    in `campaigns`, `campaign_recipients`, `campaign_events`, `suppressions`; no extra duplicate event collections.
    `sg_message_id` may differ from response `x-message-id`; ownership is tied to the persisted send attempt.
15. Disable delivery again after the controlled test while keeping receiver/tunnel available for delayed events:

```powershell
# After Ctrl+C:
$env:ENABLE_CAMPAIGN_WORKER='false'
node server.js
```

Read-only Mongo examples (if mongosh/Compass is installed):

```javascript
// Connect ONLY to the local URI above; use the IDs of your newly created local campaign/workspace.
use trueblaster_local
const campaignId = ObjectId("YOUR_LOCAL_CAMPAIGN_ID");
const workspaceId = ObjectId("YOUR_LOCAL_WORKSPACE_ID");
db.campaigns.find({ _id: campaignId, workspaceId }, { html: 0, css: 0 });
db.campaign_recipients.find({ campaignId, workspaceId });
db.campaign_events.find({ campaignId, workspaceId }).sort({ occurredAt: 1 });
db.suppressions.find({ workspaceId, campaignId });
```

## Automated checks and MongoDB lifecycle fix

```powershell
Set-Location 'C:\Projects Folder\Email Tool\email-blasting-tool\backend'
npm test
Set-Location '..\frontend'
$env:CI='true'
npm test -- --watchAll=false --runInBand
npm run build
```

Observed prior failures were repeated temporary mongod starts and Windows EBUSY during WiredTiger cleanup.
The new runner owns a freshly created temp directory and one replica set for the complete run, gives each
file a separate `_tests` database, stops Mongo before cleanup and retries only its own directory's deletion.
It never clears an existing local/production database or abandoned directories from previous runs.
The earlier 56-test suite and expanded 70- and 72-test suites all completed successfully under this runner.
This addresses the observed lifecycle pattern without hiding assertion failures or deleting deduplication data.

## References checked

- [SendGrid event payloads](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [SMTP failures and retries](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/smtp-errors-and-troubleshooting)
- [Multiple webhook configuration](https://www.twilio.com/docs/sendgrid/api-reference/webhooks/get-all-event-webhooks)
- [IPinfo authentication and API fields](https://ipinfo.io/developers)
- [ngrok getting started](https://ngrok.com/docs/start)

## Final verification evidence

- Backend: **73 passed, 0 failed**, including shared-replica startup/cleanup, local guards, simulated
  complete campaign lifecycle, CSV import, exact template storage, webhook security, enrichment and retention.
- Frontend: **12 suites / 47 passed, 0 failed**. This includes raw HTML file upload and report metadata.
  One preceding run hit the editor test's five-second timing limit while a build competed for resources;
  the complete rerun without a competing build passed. No unrelated editor behavior was rewritten.
- Final frontend build: **compiled successfully**. Main bundle is about 750.32 kB gzip and the tool reports
  its existing size recommendation. Source-map comparison confirms the uploaded-HTML and campaign-report
  modules match the final source files, rather than an earlier build.
- Backend syntax and Git whitespace checks passed.
- SendGrid read-only API: HTTP 200. Webhook inventory read: HTTP 403, so account owner inspection is required.
- IPinfo real read-only sample query: successful, with country/region/city/organization/ASN available.
- ngrok agent: version/configuration checks successful. No tunnel was started by the agent.
- Config verification: worker remains disabled, test mode enabled, namespace/database are local, recipient
  allowlist remains intentionally empty, all three existing credential values remain configured.
- Central sender fallback failed the non-placeholder/established-address check for a plain template; the
  value was not replaced or printed. Supply a real central address or approve valid existing template text.
- Persistent local MongoDB was not started; its diagnostic ping failed as expected. Only owned temporary
  fixture databases were used for tests, and no existing database/collection was cleared.
- No production deployment, Git push, account setting change, production webhook enablement or live email send occurred.
