# TrueBlaster SendGrid implementation and operations

**Current local-only readiness, safeguards, enrichment and startup instructions:** [LOCAL_TESTING.md](LOCAL_TESTING.md). No production deployment is authorized by that report.

Changes are local to `email-blasting-tool`. No production deployment, live send, DNS change,
SendGrid account setting change, or other project change was performed.
The existing SendGrid webhook names/URLs and account/domain verification were supplied by the
project owner; they could not be independently checked without access to that account.

## Audit: before these changes

| Feature | Original status | Relevant files | Implemented change |
| --- | --- | --- | --- |
| SendGrid API delivery | Missing (AWS SES sending existed) | `src/controller/mail.controller.js` | SendGrid v3 HTTPS Mail Send; backend-only key, one recipient per request, explicit HTTP 202 acceptance |
| Sender and replies | Partial (workspace/environment sender) | `mail.controller.js`, `auth.controller.js` | Sender allowlist, sender name and Reply-To; public Peter Parker defaults in `.env.example` |
| Campaign message correlation | Partial (SES tags and message ID) | `mail.controller.js`, `delivery.controller.js` | Project/workspace/campaign/recipient/persisted attempt custom arguments |
| Event receiver | Missing for SendGrid; historical SES SNS receiver existed | New `src/controller/sendgrid.controller.js`, new `src/routes/webhook.routes.js`, `server.js` | Signed raw-body receiver at `POST /api/webhooks/sendgrid` |
| Shared account isolation | Missing for SendGrid | `sendgrid.controller.js` | Check project, message kind, tenant, campaign, recipient, email and persisted attempt before writing |
| Deduplication/retries | Partial (existing event unique index) | `campaignEvent.model.js`, `sendgrid.controller.js` | Reuse unique workspace/dedupeKey; transactional event/state/suppression updates; retryable database failures |
| Campaign event storage | Partial (custom open/click/unsubscribe plus SNS events) | `src/models/campaignEvent.model.js` | Extend existing collection with provider event/message IDs, SMTP reason/response, URL and metadata |
| Delivery projection | Partial (SES-oriented recipient statuses) | `campaignRecipient.model.js`, `sendgrid.controller.js` | Processed, accepted, delivered, hard bounce, blocked, deferred, dropped and unclassified bounce; event-time projection |
| Campaign dashboard | Partial, real stored data (not mock) | `campaign.controller.js`, `frontend/src/pages/Campaigns.js`, `frontend/src/utilities/api.js` | Accepted/attempted/delivered, current/historical temporary failures, dropped, spam, privacy opens and detailed reasons |
| Open/click tracking | Implemented with custom signed pixel/redirect | `mail.controller.js`, `tracking.controller.js` | New campaigns use SendGrid tracking only; retain old signed endpoints for historical messages |
| Hard/soft bounce suppression | Partial (SNS and manual bounce handling) | Existing `suppressions` model, worker, new receiver | Hard-bounce/complaint/opt-out suppression; no suppression for one deferral or temporary block |
| Unsubscribe | Partial (GET immediately opted out) | `tracking.controller.js`, `campaign.routes.js`, `mail.controller.js`, `src/config/cors.js` | Non-mutating confirmation GET, confirmation POST, RFC8058 one-click POST and conditional outgoing-only footer |
| Configuration reporting | Partial | `auth.controller.js`, frontend campaign page | `/me` separates test-mail readiness and full campaign readiness, with actionable configuration message |
| Tests | Existing isolation/worker/SNS tests | New `test/sendgrid.test.js`, existing backend/frontend tests | Signature, shared project, duplicates, concurrency, bounce classification, retries, unsubscribe and reporting regression tests |

No collections were duplicated. Existing data and indexes remain in place. New fields are additive;
historical documents do not silently acquire SendGrid ownership. MongoDB transactions require Atlas
or another replica set. `model.init()` creates the added recipient correlation index at startup;
allow for index creation time and database index privileges during release preparation.

## Template compliance and central configuration

Company name and postal address are not campaign form fields. Company name is optional.
The frontend form is unchanged; the server ignores campaign-body company/address/compliance overrides.
Sender compliance is evaluated against the selected template, so transport readiness no longer requires
global company fields before a user can choose an already compliant template.

Administrators can use either application settings or a workspace-specific compliance block:

- Application: optional `COMPANY_NAME` and real fallback `COMPANY_POSTAL_ADDRESS`.
  Optional JSON string arrays `COMPLIANCE_APPROVED_POSTAL_ADDRESSES` and
  `COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS` approve existing template content.
- Workspace: administrator-managed `workspaces.compliance` with optional `companyName`,
  `postalAddress`, `approvedPostalAddresses` and `approvedUnsubscribeUrls`.
  A workspace block overrides the application block completely, avoiding accidental mixing of organizations.
  Signup and campaign requests cannot write this configuration. No live workspace data was changed.
- New campaigns snapshot the chosen central configuration in `campaigns.compliance`;
  old flat company/address fields remain readable for compatibility. Old queued campaigns without a snapshot
  can use their workspace configuration at delivery. Changing central values does not rewrite existing snapshots.

An address is established only from administrator-supplied/approved content, not guessed from arbitrary HTML.
The administrator must verify that it is a real, current sender postal address. Obvious placeholders,
missing values, hidden text, script/style text and mismatched address-number boundaries do not establish it.
The checker is not an address-verification or browser-rendering service; image-only addresses and unusual
layouts may require an explicit text address. No invented address, geocoding fallback or placeholder is supplied.

For existing template addresses, add the exact real address to the approved array (or use it as the central
fallback). Formatting, case, line breaks and basic punctuation are normalized when matching visible text.
An approved-template-only setup may leave the fallback address empty; a different template lacking that
approved address is then rejected with a clear administrator configuration error.

TrueBlaster's signed unsubscribe URL is recognized only in a visible, labelled anchor and must match the
workspace, campaign, recipient and action. Use `<a href="{{unsubscribeUrl}}">Unsubscribe</a>` in templates.
External HTTPS or mailto links are reused only when their exact URL is centrally approved. Before approval,
verify the actual opt-out/confirmation flow and that it synchronizes TrueBlaster workspace suppressions.
The renderer does not follow arbitrary URLs, prove an external service works, or contact recipients' links.
Merely containing the word "unsubscribe", a # link, an empty anchor, a hidden link or another recipient's
signed token is insufficient. Unverified links remain intact and receive a separate known-working local link.

The original template and campaign HTML/CSS are never replaced with the rendered output. Inspection runs
on a copy. Personalization and the existing email CSS-inlining process operate only on the outgoing copy;
embedded styles/media queries remain and complete documents are not nested in a second html/body wrapper.
If both required elements are present, no footer is added. Otherwise only the missing elements are appended
before the outgoing body's closing tag in a small neutral footer. Existing content remains in place.
Native SendGrid group unsubscribe tags are also recognized when the campaign has a configured ASM group.
Literal full-link tags and raw URL anchors are preserved. Global account unsubscribe tags require explicit
central approval because they can affect other projects. Escaped examples and hidden tags never satisfy the check.
One-click unsubscribe headers, SendGrid tracking and signed webhook handling remain unchanged.

## Data flow and field definitions

1. An authenticated owner/member queues a campaign in their workspace. Content, sender, company
   address, project namespace, optional ASM group and recipients are snapshotted.
2. The opt-in worker claims only `provider=sendgrid` campaigns whose `sendgridProject` equals
   this backend's `SENDGRID_PROJECT_ID`. Historical SES queues are deliberately excluded.
3. Immediately before the provider request the worker saves a UUID `sendAttemptId`, then checks
   workspace suppressions again. Persisting the attempt first permits very early callbacks.
4. The request contains personalization `custom_args`: `tb_project`, `tb_message_kind=campaign`,
   `tb_workspace_id`, `tb_campaign_id`, `tb_recipient_id`, `tb_attempt_id`.
   Test previews use `tb_message_kind=test` and do not create campaign events.
5. SendGrid's callbacks flatten custom arguments onto each event. The receiver requires all
   identifiers and normalized email to match existing documents. It never maps events by email alone.
6. Within a MongoDB transaction, the receiver inserts an event, updates the recipient projection
   and inserts any suppression. A database failure returns 503. Already committed events are skipped
   on retry; no in-memory queue is used to acknowledge events before persistence.

Existing collections are extended as follows:

- `campaigns`: `provider`, `sendgridProject`, `senderName`, `replyTo`, `companyName`,
  `postalAddress` (legacy), `compliance` (central snapshot), `unsubscribeGroupId`, plus existing workspace/content/list/schedule/lease fields.
- `campaign_recipients`: persisted `sendAttemptId`, `provider`, provider acceptance `messageId`,
  webhook `providerMessageId`, `deliveryStatus`, `deliveryReason`, `smtpStatus`,
  `lastDeliveryEventAt`, `deliveredAt`, `softBounceAt`, `deferredAt`, `complaint`,
  plus existing attempted/send timestamps, email snapshot, status and unsubscribe flag.
- `campaign_events`: existing event type/time/scope/dedupe/location fields plus `provider`,
  `providerEvent`, `providerEventId`, `messageId`, `sendAttemptId`, `reason`, `response`,
  `smtpStatus`, `classification`, `bounceClassification`, `url`, `userAgent`, `machineOpen`,
  `attempt`, `asmGroupId`. Only explicitly selected useful metadata is stored, not arbitrary payloads.
- `suppressions`: existing unique `(workspaceId,email,reason)` records, reused unchanged.

The unique `(workspaceId,dedupeKey)` index makes SendGrid event IDs idempotent. Missing IDs use
a SHA256 fingerprint of the canonical event. Identical ID-less events are intentionally coalesced;
without a provider event ID, two otherwise identical genuine events cannot be distinguished reliably.
Keep durable deduplication keys if events are archived; signature replay protection relies on these records.
`sg_message_id` can differ from the Mail Send response's `x-message-id`; correlation uses the attempt,
not fragile string equality between these IDs.

Delivery projection rebuilds from stored delivery events in event timestamp order. A delayed
processed/deferred/blocked event cannot undo a recorded terminal delivery or permanent bounce.
A permanent bounce remains sticky. Engagement, opt-out and complaint events do not invent delivery.
An open/click event can establish acceptance if the provider response was interrupted. A late matching callback
clears the uncertain-send note and resolves needs_review when no uncertain/pending recipients remain; it does not resend mail.
Manual bounce updates remain available only for historical campaigns; SendGrid outcomes come from signed events.

### Dashboard meanings

| Metric | Meaning |
| --- | --- |
| Attempted | Recipients with a saved attempt, excluding those skipped for suppression; includes ambiguous/interrupted attempts |
| Accepted (`totalSent`) | Provider response/message evidence or a signed matching event; not proof of inbox delivery |
| Delivered | Current delivered outcome confirmed by receiving-server acceptance |
| Unique/total opens and clicks | Distinct recipient count / distinct stored webhook event count |
| Hard bounce | Current confirmed permanent bounce |
| Soft bounce | Current temporary block with 4xx SMTP evidence; permanent message policy blocks and unknown blocks are separate, not automatically hard mailbox bounces |
| Deferred | Current delayed-delivery outcome |
| Ever deferred / ever soft bounced | Recipient history including messages later delivered |
| Dropped | Current message rejected/dropped by SendGrid; not automatically a hard bounce |
| Spam reports | Recipients with a matching complaint event or a known provider spam-suppression drop |
| Unsubscribed | Recipients opted out through TrueBlaster or matching provider unsubscribe events |
| Privacy proxy opens | Open events explicitly carrying SendGrid's `sg_machine_open=true` |

Rates use accepted messages as the denominator for compatibility. Opens and clicks can be inflated
by privacy proxies and scanners; the UI explains this. A campaign marked completed means worker
submissions finished, not final delivery of every message. Unknown sends need review, not blind retry.
CSV exports include delivery state, SMTP reason/status, provider message ID, last clicked URL and complaint flag.

## Environment configuration

Backend values belong only in `backend/.env` on EC2 or the backend process manager's protected
environment. Never put secrets in React variables, Netlify build settings, source control, logs or screenshots.
`.env.example` contains names/placeholders only. The local `.env` now has blank provider credentials,
public sender defaults and `ENABLE_CAMPAIGN_WORKER=false`; existing Mongo/auth/tracking/IPINFO values were preserved.

| Name | Required/configuration |
| --- | --- |
| `MONGO_URI` | Existing protected Mongo URI with `/trueblaster`; replica set/Atlas, correct cluster and network access |
| `AUTH_SECRET` | Existing stable random authentication secret, at least 32 characters |
| `TRACKING_SECRET` | Existing stable independent tracking secret, at least 32 characters; preserve to keep past unsubscribe links valid |
| `SENDGRID_API_KEY` | Restricted key with Mail Send permission; create a TrueBlaster-specific key if possible; never reuse/revoke another project's key without coordination |
| `SENDGRID_PROJECT_ID` | `trueblaster-production` on production; use a distinct namespace such as `trueblaster-local` for test environments |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | ECDSA verification key for the NEW TrueBlaster webhook; base64 DER/SPKI as shown by SendGrid (PEM also accepted) |
| `SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY` | Optional previous verification key during coordinated key rotation; remove after retry overlap |
| `FROM_EMAIL` | `Peter.P@demandmediaglobal.com` |
| `FROM_NAME` | `Peter Parker` |
| `REPLY_TO_EMAIL` | `Peter.P@demandmediaglobal.com`; replies go to Microsoft 365 |
| `SENDGRID_ALLOWED_SENDERS` | Comma-separated allowed authenticated sender emails; default is `FROM_EMAIL`; use Peter's address for this setup |
| `COMPANY_NAME` | Optional central organization name; never a campaign form requirement |
| `COMPANY_POSTAL_ADDRESS` | Optional central fallback containing the actual sender address; otherwise the template must visibly contain a centrally approved address |
| `COMPLIANCE_APPROVED_POSTAL_ADDRESSES` | Optional JSON array of actual sender addresses approved for existing template text |
| `COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS` | Optional JSON array of exact externally verified unsubscribe URLs, including suppression synchronization |
| `SENDGRID_UNSUBSCRIBE_GROUP_ID` | Optional dedicated TrueBlaster ASM group ID; do not enter a TrueSendr group ID |
| `PUBLIC_API_URL` | Production: `https://api.demandmediaglobal.com`; local API-only tests: `http://localhost:5000` |
| `PORT` | Existing internal Node port, normally `5000`; TLS terminates at the existing reverse proxy |
| `NODE_ENV` | `production` on EC2; production public email URLs must use HTTPS |
| `ENABLE_CAMPAIGN_WORKER` | Keep `false` until new webhook, sender, data scope and controlled send checks are ready; enable explicitly with `true` |
| `CAMPAIGN_BATCH_SIZE` | Optional, default 4; maximum 100 |
| `CAMPAIGN_CONCURRENCY` | Optional, default 2; maximum 10 |
| `CAMPAIGN_BATCH_DELAY_MS` | Optional, default 30000; maximum 300000 |
| `IPINFO_TOKEN` | Backend-only shared cached enrichment for owned SendGrid open/click events and historical tracking; see local report for cache, plan fields and retention |
| `TRUST_PROXY` | Optional trusted proxy configuration, e.g. `loopback` for local Nginx; don't blindly trust public forwarded headers |
| `SES_SNS_TOPIC_ARNS` | Historical SNS callbacks only, if already used; no new AWS sending credentials are needed |

Frontend/Netlify: only public `REACT_APP_API_URL=https://api.demandmediaglobal.com` is needed for this
integration. Existing local frontend `.env` already contains only public API URL and local `HTTPS` flag.
Keep local React development HTTP (`HTTPS=false` if specified); Netlify handles production TLS.

Existing workspace `senderEmail` overrides the default. If it contains an old SES address, the sender
allowlist will reject it. Review the intended TrueBlaster workspace and explicitly clear its sender to
inherit `FROM_EMAIL`, or set it to Peter's address. Do not bulk-update workspaces or another database.
This implementation deliberately performs no live MongoDB credential/account/workspace migration.

## Manual SendGrid configuration

1. Sign into the correct existing organization account. Inspect, without editing, the two current
   webhooks: `Webhook test` and `App.truesendr`. Record their exact current URLs. The typed
   TrueSendr URL supplied in the request is unverified; do not use it as a replacement value.
2. Check whether the current plan permits a third webhook. If not, retain both existing webhooks;
   arrange additional capacity or an explicitly approved separate account/subuser instead of replacing one.
3. Confirm that the existing authenticated domain and link branding belong to the same account/subuser
   as the chosen API key. No changes to existing tracking settings, DNS, MX, SPF or DMARC are needed here.
4. In Settings → API Keys, create a restricted key named `TrueBlaster production` with Mail Send access.
   Save it directly to protected backend configuration. The runtime key needs no webhook-management,
   domain-management or account-settings permissions.
5. Deploy the reviewed receiver with the campaign worker OFF, following the deployment sequence below.
   The route can start before the public verification key is configured; it fails closed with 503 until ready.
6. In Settings → Mail Settings → Event Webhook, **add** a new webhook:
   - Friendly name: `TrueBlaster production`.
   - HTTP POST URL: `https://api.demandmediaglobal.com/api/webhooks/sendgrid`.
   - Events: Processed, Delivered, Opened, Clicked, Bounced, Deferred, Dropped, Spam Reports,
     Unsubscribed, Group Unsubscribe and Group Resubscribe (where the UI offers group events).
     A block arrives as a Bounce event with `type=blocked`; there is no need for a made-up `blocked` event name.
   - Enable Signed Event Webhook verification for this new webhook. Copy its public verification key
     into `SENDGRID_WEBHOOK_PUBLIC_KEY` on the backend. Keep signature verification enabled.
   - Save and enable the new webhook; restart/reload only TrueBlaster after adding the key.
7. Use the new webhook's Test Integration action. A correctly signed example batch without TrueBlaster
   IDs should return 200 with ignored events and create no customer campaign records. This proves transport
   and verification, not live campaign correlation. If the console's test request is unsigned, it should be
   rejected; do not add an unsigned bypass. Check a signed provider delivery instead.
8. Leave account Open/Click tracking ON and Subscription/GA tracking OFF. Each TrueBlaster Mail Send
   request specifies its own tracking settings and does not write account settings.
9. Optional: create a dedicated TrueBlaster unsubscribe group and supply its numeric ASM group ID.
   Local unsubscribe works without an ASM group. Never reuse another project's group or bypass suppressions.

Account isolation has two directions. TrueBlaster safely ignores unrelated callbacks. A separate URL/API key
does not stop existing account webhooks from receiving TrueBlaster sends. Before enabling sending, have the
existing integrations' owner confirm read-only that those receivers ignore unknown campaign/project IDs.
No existing receiver was modified here. If they do not isolate their own events, a separately approved
provider account/subuser arrangement is needed to guarantee that new sends cannot affect their data.
The shared account also shares provider quotas, reputation and some suppressions; code cannot isolate those.

## Suppression and unsubscribe behavior

- `bounce` with `type=bounce` is permanent. For `type=blocked`, use SMTP evidence: 4xx is temporary; explicit 5.1.1/5.1.3 destination failures are hard; other 5xx blocks are permanent for that message without suppressing the mailbox; missing evidence remains unclassified.
  For missing-type payloads, a 4xx SMTP status can establish a temporary failure. A 5xx response alone
  can be a policy block, so it remains unclassified without automatic permanent suppression.
- Deferrals are separate temporary events. A later delivery can recover; a single deferral never creates a suppression.
- Dropped messages stay separate. Known `Bounced Address`, `Unsubscribed Address` and
  `Spam Reporting Address` provider drops create matching local suppressions. Other drop reasons are recorded,
  not guessed to be permanent mailbox failures.
- Existing SendGrid suppressions are respected: the request never enables bypass options. There is no
  bulk import of account-wide suppressions into every tenant, which would mix other projects' data.
- Opt-out is global **within the originating TrueBlaster workspace**, across future lists/campaigns. It is
  not only this campaign, not another workspace and not an account-wide SendGrid subscription-setting change.
- Every marketing campaign must have an established visible sender address and working unsubscribe link. Existing approved template content is reused; only missing elements receive an outgoing-only footer. Local links use a signed, action-specific unsubscribe URL.
  Normal GET shows a confirmation form; form POST applies the opt-out. `List-Unsubscribe` plus
  `List-Unsubscribe-Post` support authenticated-by-token RFC8058 POST with `List-Unsubscribe=One-Click`.
  The backend accepts form-encoded one-click requests without a browser login or CSRF cookie requirement.
- Local opt-outs are stored directly in MongoDB; they do not require or generate a SendGrid unsubscribe webhook.
  Provider global/group unsubscribe callbacks, when correlated, also suppress locally.
  Group resubscribe is recorded for audit and does not silently remove an existing local opt-out.
- There is no new campaign-only preferences UI. The confirmation page explains workspace-wide scope.
  Review existing unsubscribe-management permissions before allowing staff to manually undo recipient opt-outs.
- The app supplies these technical mechanisms; review your audience permissions, organization address,
  privacy notice, data retention and actual message content before using it for marketing.

## Local automated verification

```bash
cd backend
npm ci
npm test
cd ../frontend
npm ci
CI=true npm test -- --watchAll=false --runInBand
npm run build
```

Windows PowerShell uses `$env:CI='true'` before the frontend test command. The backend tests launch
disposable local MongoDB replica sets; they never use the `.env` database for test data or send live mail.
The first run may download the MongoDB test binary. Tests cover provider payload construction and
responses using a fake transport, not a real SendGrid key. ECDSA signatures use generated test key pairs.

## Controlled end-to-end testing after manual configuration

1. Keep the worker disabled. Confirm production `PUBLIC_API_URL`, project namespace, sender allowlist,
   stable tracking secret, correct TrueBlaster database and new webhook key. Confirm the production
   frontend points at the production API. Log in; `/me` should report `campaignConfigured=true`.
2. Review queued campaigns **before** enabling the worker. It will resume every due campaign in this
   project, not only a new test. Historical SES queues are excluded; do not bulk relabel them as SendGrid.
3. Use **Send Test Mail** with an inbox you own. Confirm Peter Parker / Peter.P sender and Reply-To in raw
   headers and verify that replying reaches Microsoft 365. Inspect both List-Unsubscribe headers on the
   real campaign message and verify their DKIM signature coverage; the mailbox controls whether it displays an unsubscribe button. Preview sending also respects existing workspace suppressions. Test previews do not populate campaign analytics
   and intentionally do not contain a working campaign unsubscribe token.
4. Create a fresh list with exactly one controlled mailbox and a template containing a normal HTTPS link.
   Create a uniquely named campaign. Inspect its saved workspace/project/sender/address snapshot.
   Once the above gates are ready, explicitly enable the worker and restart only TrueBlaster.
5. Verify Mail Send acceptance and receiving-server delivery separately. `campaign_recipients` should have a
   persisted attempt UUID and a provider message ID; `campaign_events` should contain processed/delivery events
   with the same campaign/recipient/attempt and SendGrid event/message IDs. No synthetic inbox check is used.
6. Open the email with images enabled; inspect one matching `open` event and dashboard count. Multiple real
   opens can create multiple events but one unique opener. Privacy features may add opens or suppress images.
7. Click the ordinary link. Confirm the intended destination, a `click` event with URL, total/unique click
   metrics, and recipient detail/CSV. Unsubscribe footer link uses `clicktracking=off`.
8. Open the unsubscribe link without submitting: confirm no suppression was created. Submit the confirmation:
   confirm one workspace `unsubscribed` suppression and one local unsubscribe event. Repeat the POST and
   verify no duplicate event. Use the raw email's List-Unsubscribe HTTPS link with a form POST containing
   `List-Unsubscribe=One-Click` to check the mailbox-provider path; keep its signed URL private.
9. Put that same address in another list in the same workspace and queue a fresh campaign; it must be skipped.
   The same address in a different workspace must not inherit a local TrueBlaster suppression automatically.
   A SendGrid account-wide suppression can still block it at the provider, and must not be bypassed.
10. Exercise permanent bounce, soft block (`event=bounce,type=blocked`), deferred, dropped, complaint,
    unsubscribe and group events with `npm test` against generated fixtures first. Verify stored reason,
    SMTP status/response, event timestamp and deduplication. To validate real provider callbacks for delivery
    failure, use a controlled SMTP test mailbox/server you own that returns a chosen 550 or 421 response;
    ordinary nonexistent public addresses are not a deterministic test method. Only use an authorized
    disposable test inbox for a real complaint test; marking mail as spam affects the shared account's reputation.
11. A generic SendGrid console sample has no matching custom arguments and must be ignored. Synthetic HTTP
    payloads signed with your own private key cannot pass the production SendGrid public-key check. Keep
    fixture/signed-development testing separate from production; no unsigned test backdoor exists.
12. Repeat a signed development batch twice: verify one event per ID. Include unrelated project/tenant IDs
    and verify no writes. Simulate persistence failure and retry: earlier events deduplicate, later ones commit.
13. Watch dashboard current vs historical temporary failures, total/unique engagement, dropped, complaints and
    opt-outs. Inspect MongoDB read-only, scoped to the test campaign:

```javascript
use trueblaster
const campaignId = ObjectId("REPLACE_WITH_TEST_CAMPAIGN_ID");
const workspaceId = ObjectId("REPLACE_WITH_TEST_WORKSPACE_ID");
db.campaigns.find({ _id: campaignId, workspaceId }, { html: 0, css: 0 });
db.campaign_recipients.find({ campaignId, workspaceId });
db.campaign_events.find({ campaignId, workspaceId }).sort({ occurredAt: 1 });
db.suppressions.find({ workspaceId, campaignId });
```

No live end-to-end result is claimed until the real key, public receiver, sender and inbox are tested.

## AWS EC2 / Netlify release procedure — instructions only

No commands in this section were executed. Use a reviewed commit/artifact and the existing production
process manager; do not start a second `node server.js` alongside it. The examples assume a Git checkout at
`/var/www/trueblaster`; if deployment uses uploaded artifacts, use your existing release process instead.

1. Review and commit the local changes without `.env`, node_modules, builds or uploads. Run CI/test/build
   in a staging environment. Record the currently running commit and process-manager service name for rollback.
2. On EC2, set `ENABLE_CAMPAIGN_WORKER=false` in the authoritative existing service environment and restart
   only TrueBlaster so the worker stops cleanly before release. Avoid racing an active campaign during cutover.
   Securely back up the current `.env`, MongoDB data and uploads; never print secrets into deployment logs.

```bash
cd /var/www/trueblaster
git status --short
git rev-parse HEAD
# Proceed only with a clean/reviewed working tree; preserve any production-local changes first.
umask 077
BACKUP_DIR="$HOME/trueblaster-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp backend/.env "$BACKUP_DIR/backend.env"
tar --exclude=node_modules --exclude=.git -czf "$BACKUP_DIR/backend.tgz" backend
# Take an Atlas snapshot/database backup using your existing protected backup process too.
git fetch origin
REVIEWED_COMMIT='REPLACE_WITH_REVIEWED_COMMIT'
git show --stat "$REVIEWED_COMMIT"
git checkout --detach "$REVIEWED_COMMIT"
cd /var/www/trueblaster/backend
node --version
npm ci --omit=dev --no-audit --no-fund
node --check server.js
node --check src/controller/sendgrid.controller.js
chmod 600 .env
```

3. Edit the existing backend `.env` with protected access and manually supply the production values from
   the table. Preserve existing Mongo/auth/tracking secrets and the uploads directory. Use production
   namespace `trueblaster-production`; leave the worker false. Do not copy local `.env` over production.
   If PM2/systemd defines the same names, update the authoritative service environment too: dotenv does
   not override process-manager variables by default. Full tests run in CI/staging with devDependencies;
   production `--omit=dev` intentionally does not install the MongoDB test runner.
4. Restart the existing process using **one** existing manager, substituting its actual service name:

```bash
# PM2 example ONLY if PM2 is the existing manager:
pm2 restart ACTUAL_TRUEBLASTER_PROCESS_NAME --update-env
pm2 status
# OR systemd example ONLY if systemd is the existing manager:
sudo systemctl restart ACTUAL_TRUEBLASTER_SERVICE_NAME
sudo systemctl status ACTUAL_TRUEBLASTER_SERVICE_NAME --no-pager
```

5. Keep existing TLS termination and proxy routing. Node remains internal HTTP. Ensure the proxy/WAF
   permits public POST to `/api/webhooks/sendgrid` and the signed unsubscribe route; it must preserve the
   raw request body and the two `X-Twilio-Email-Event-Webhook-*` headers, without browser challenges or
   login redirects. Ensure API request limits allow the app's 2 MB webhook limit, and monitor 413s.
   Existing general `/` proxying to Node may already cover this; do not replace working routing blindly.
   Example additions to the **existing API server block**, only if missing:

```nginx
location = /api/webhooks/sendgrid {
    client_max_body_size 2m;
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

```bash
# Only after editing an existing Nginx configuration:
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://api.demandmediaglobal.com/
# Missing signature should be rejected (401 once key is configured; 503 until then).
curl -i -X POST https://api.demandmediaglobal.com/api/webhooks/sendgrid \
  -H 'Content-Type: application/json' --data '[]'
```

6. Add only the new SendGrid webhook, obtain/configure its verification key, restart TrueBlaster and run
   the signed integration test. Check database connectivity/index initialization. Review pending campaigns
   scoped to this project and any workspace sender overrides before enabling sends.
7. Build/release frontend on Netlify using the reviewed code, `REACT_APP_API_URL` production value,
   build command `npm run build` and publish directory `build` relative to the configured frontend base.
   Verify login, campaign setup, real reporting, CORS and CSV downloads. No provider secret belongs in Netlify.
8. Enable the worker only when receiver, sender, footer, account-isolation checks and one-recipient test are
   ready. Restart the existing backend process with updated environment. Do not enable every historical queue.
9. Monitor callback HTTP 2xx/4xx/5xx counts, processing latency, Mongo write/index errors, unknown sends,
   SendGrid API rejections and suppression growth. Logs should not include raw batches, tokens or keys.
   Large batches are applied sequentially with durable per-event commits; monitor timeout/retry load.

Rollback: first turn the worker OFF and restart to stop new submissions. Restore the previous reviewed
code/dependencies/environment through the same manager; preserve additive Mongo event data, suppressions,
stable tracking secret and uploads. Already accepted mail cannot be recalled. Keep this signed receiver
available for in-flight SendGrid callbacks where possible; a full rollback to SES-only code removes that route
and requires a deliberate event-retention/recovery plan. Never relabel sent recipients as pending or switch
the old SES worker on as an automatic retry strategy. Do not disable either pre-existing SendGrid webhook.

## Provider references checked

- [Event fields, custom arguments, and hard/blocked bounce examples](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event)
- [Raw-byte ECDSA webhook verification](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features)
- [Mail Send API and per-message settings](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [Multiple webhooks and retry behavior](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/twilio-sendgrid-event-webhook-overview)
- [List-Unsubscribe v3 headers](https://www.twilio.com/docs/sendgrid/ui/sending-email/list-unsubscribe)
- [Click tracking HTML practices](https://www.twilio.com/docs/sendgrid/ui/analytics-and-reporting/click-tracking-html-best-practices)

## Local verification results (2026-11-18)

- Backend full suite: 38 passed, 0 failed. The SendGrid suite was rerun after the final same-origin
  unsubscribe CORS fix: 20 passed, 0 failed.
- Frontend: 12 suites, 45 tests passed, 0 failed.
- Production frontend build: passed locally; no deployment performed.
- Git whitespace validation passed. Environment files remain ignored by Git.
- Initial backend startup smoke-test attempts timed out while the temporary MongoDB server started
  during dependency installation. The standalone startup test and later complete backend run passed.
- No real SendGrid transport, production webhook signature, domain authentication state, existing webhook
  URLs, inbox delivery or production dashboard was tested. Those require the manual setup and controlled
  end-to-end procedure above.

## Template compliance follow-up verification (2026-11-18)

- Final rendering/SendGrid run: 38 assertions/tests passed (17 compliance rendering tests and 21
  SendGrid integration tests). This includes exact stored HTML/CSS preservation, leading/trailing HTML
  whitespace, centrally configured workspace compliance, no campaign-level company/address inputs,
  conditional footer components, native SendGrid tags, visible-content checks, blocked unknown addresses,
  webhook signatures, isolation, deduplication, suppression, delivery projection and one-click unsubscribe.
- The startup smoke test passed independently. Workspace assertions also passed independently (17 tests),
  but that invocation failed its temporary-database cleanup hook with Windows EBUSY on a WiredTiger file.
- Combined runs intermittently failed while starting a subsequent temporary MongoDB instance. One earlier
  full run passed all 54 tests before the final two layout tests and whitespace-preservation assertion were
  added. A fully green final combined run is not claimed. Re-run the complete suite in CI/staging before release.
- No frontend source changes were needed for this follow-up, so its previous build/test results were not
  rerun. Campaign configuration errors use the existing frontend error display.
- Cheerio 1.0.0, already installed and locked through Juice, is now an explicit backend dependency for
  HTML inspection. No provider keys, real organization address, live database settings or account settings
  were changed. No deployment or live email send was performed.
