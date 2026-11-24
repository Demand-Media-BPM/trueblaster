const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { testDatabase } = require("./helpers/database");
const keys = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
process.env.NODE_ENV = "test";
process.env.SENDGRID_TEST_MODE = "true";
process.env.SENDGRID_TEST_RUN_ID = "automated-tests";
process.env.SENDGRID_TEST_MAX_RECIPIENTS = "10";
process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST = "sender@example.com,replies@example.com,owner@example.com,other-project@example.com,wrong@example.com,test@example.com,central-compliance-fixture@example.com";
process.env.IPINFO_TOKEN = "";

process.env.AUTH_SECRET = "a".repeat(64);
process.env.TRACKING_SECRET = "t".repeat(64);
process.env.SENDGRID_API_KEY = "test-only-not-a-real-key";
process.env.SENDGRID_PROJECT_ID = "trueblaster-test";
process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
process.env.SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY = "";
process.env.SENDGRID_ALLOWED_SENDERS = "sender@example.com";
process.env.FROM_EMAIL = "sender@example.com";
process.env.FROM_NAME = "Test Sender";
process.env.REPLY_TO_EMAIL = "replies@example.com";
process.env.COMPLIANCE_APPROVED_POSTAL_ADDRESSES = "[]";
process.env.COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS = "[]";
process.env.COMPANY_NAME = "Test Organization";
process.env.COMPANY_POSTAL_ADDRESS = "123 Fixture Road, Sample City, 12345";
process.env.PUBLIC_API_URL = "http://localhost:5000";
process.env.ENABLE_CAMPAIGN_WORKER = "false";
process.env.CAMPAIGN_BATCH_DELAY_MS = "1";
process.env.SENDGRID_UNSUBSCRIBE_GROUP_ID = "";
const app = require("../server");
const { connectDatabase } = require("../src/config/database");
const Workspace = require("../src/models/workspace.model");
const User = require("../src/models/user.model");
const Campaign = require("../src/models/campaign.model");
const Recipient = require("../src/models/campaignRecipient.model");
const Event = require("../src/models/campaignEvent.model");
const Suppression = require("../src/models/suppression.model");
const mail = require("../src/controller/mail.controller");
const webhook = require("../src/controller/sendgrid.controller");
const { processCampaign } = require("../src/controller/delivery.controller");
const { sign } = require("../src/middleware/auth");
let replica, server, base, workspace, user;

before(async () => {
  replica = await testDatabase("sendgrid_tests");
  process.env.MONGO_URI = replica.getUri("sendgrid_tests");
  await connectDatabase();
  workspace = await Workspace.create({ name: "SendGrid tests", slug: "sendgrid-tests" });
  user = await User.create({ workspaceId: workspace._id, email: "owner@example.com", firstName: "Test", lastName: "Owner", passwordHash: "test-only", role: "owner" });
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

async function fixture() {
  const campaign = await Campaign.create({ workspaceId: workspace._id, createdBy: user._id,
    testMode: true, testRunId: process.env.SENDGRID_TEST_RUN_ID, name: crypto.randomUUID(), subject: "Test", html: '<p>Hello {{firstName}}</p><a href="https://example.com">Read more</a>',
    listId: new mongoose.Types.ObjectId(), listName: "test", senderEmail: "sender@example.com",
    provider: "sendgrid", sendgridProject: process.env.SENDGRID_PROJECT_ID, senderName: "Test Sender",
    companyName: "Test Organization", postalAddress: "123 Fixture Road, Sample City, 12345", scheduleTime: new Date(), totalRecipients: 1 });
  const recipient = await Recipient.create({ workspaceId: workspace._id, campaignId: campaign._id,
    contactId: new mongoose.Types.ObjectId(), email: `${crypto.randomUUID()}@example.com`,
    firstName: "<Test>", status: "sending", attemptedAt: new Date(), sendAttemptId: crypto.randomUUID() });
  process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST += "," + recipient.email;
  return { campaign, recipient };
}
function eventFor(f, event, extra = {}) {
  return { email: f.recipient.email, timestamp: Math.floor(Date.now() / 1000), event,
    sg_event_id: crypto.randomUUID(), sg_message_id: "provider.message.filter-suffix",
    tb_project: process.env.SENDGRID_PROJECT_ID, tb_message_kind: "campaign",
    tb_workspace_id: String(f.campaign.workspaceId), tb_campaign_id: String(f.campaign._id),
    tb_recipient_id: String(f.recipient._id), tb_attempt_id: f.recipient.sendAttemptId, ...extra };
}
function signedHeaders(body, timestamp = String(Math.floor(Date.now() / 1000))) {
  return { "Content-Type": "application/json", "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
    "X-Twilio-Email-Event-Webhook-Signature": crypto.sign("sha256", Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), keys.privateKey).toString("base64") };
}
async function post(events, changes = {}) {
  const body = typeof events === "string" ? events : JSON.stringify(events);
  const response = await fetch(base + "/api/webhooks/sendgrid", { method: "POST", headers: { ...signedHeaders(body), ...changes }, body });
  return { status: response.status, data: await response.json() };
}
async function stats(f, kind = "analytics") {
  const token = sign({ userId: String(user._id), workspaceId: String(workspace._id), version: user.tokenVersion }, "auth", 60);
  const response = await fetch(`${base}/api/campaign/campaign-${kind}?emailId=${f.campaign.name}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  return response.json();
}

test("Mail Send payload has per-message tracking, isolation identifiers, sender and one-click headers", async () => {
  const f = await fixture();
  f.campaign.html += '<img src="{{ trackingPixelUrl }}"><span>{{ unsubscribeUrl }}</span>';
  const payload = mail.buildPayload(f.campaign, f.recipient);
  assert.equal(payload.from.email, "sender@example.com");
  assert.equal(payload.reply_to.email, "replies@example.com");
  assert.equal(payload.personalizations[0].custom_args.tb_attempt_id, f.recipient.sendAttemptId);
  assert.equal(payload.personalizations[0].custom_args.tb_workspace_id, String(workspace._id));
  assert.equal(payload.tracking_settings.open_tracking.enable, true);
  assert.equal(payload.tracking_settings.subscription_tracking.enable, false);
  assert(!payload.mail_settings);
  assert(!payload.content[0].value.includes("track-pixel"));
  assert(!payload.content[0].value.includes('src=""'));
  assert(payload.content[0].value.includes("&lt;Test&gt;"));
  assert(payload.content[0].value.includes('clicktracking="off"'));
  assert.equal(payload.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const testPayload = mail.buildPayload(f.campaign, f.recipient, true);
  assert.equal(testPayload.personalizations[0].custom_args.tb_message_kind, "test");
  assert.equal(testPayload.personalizations[0].custom_args.tb_campaign_id, undefined);
  assert.throws(() => mail.resolveSender({ senderEmail: "other-project@example.com" }));
});

test("HTTP 202 is acceptance; explicit rejection and network ambiguity never expose secrets", async () => {
  const f = await fixture();
  let calls = 0;
  assert.equal(await mail.sendEmail(f.campaign, f.recipient, false, { post: async (url, body, options) => {
    calls++; assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
    assert.equal(options.maxRedirects, 0); return { status: 202, headers: { "x-message-id": "accepted-id" } };
  } }), "accepted-id");
  await assert.rejects(mail.sendEmail(f.campaign, f.recipient, false, { post: async () => ({ status: 429, data: { apiKey: process.env.SENDGRID_API_KEY } }) }), error => error.definiteRejection === true && !error.message.includes(process.env.SENDGRID_API_KEY));
  await assert.rejects(mail.sendEmail(f.campaign, f.recipient, false, { post: async () => { throw new Error(process.env.SENDGRID_API_KEY); } }), error => error.name === "SendGridUncertainError" && !error.message.includes(process.env.SENDGRID_API_KEY));
  assert.equal(calls, 1);
});

test("signed raw bytes accepted, tampering/unsigned rejected and malformed batches fail safely", async () => {
  assert.equal((await post([])).status, 200);
  const body = JSON.stringify([]);
  const headers = signedHeaders(body);
  const tampered = await fetch(base + "/api/webhooks/sendgrid", { method: "POST", headers, body: "[{}]" });
  assert.equal(tampered.status, 401);
  assert.equal((await post([], { "X-Twilio-Email-Event-Webhook-Signature": "" })).status, 401);
  assert.equal((await post("not-json")).status, 400);
  assert.equal((await post({ event: "open" })).status, 400);
  const key = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  try { process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = ""; assert.equal((await post([])).status, 503); }
  finally { process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = key; }
  const oldTimestamp = "1500000000";
  assert.doesNotThrow(() => webhook.verifySignature(Buffer.from(body), signedHeaders(body, oldTimestamp)["X-Twilio-Email-Event-Webhook-Signature"], oldTimestamp));
});

test("shared-account and mismatched tenant/campaign/recipient/attempt/email events are ignored", async () => {
  const f = await fixture();
  const events = [
    eventFor(f, "open", { tb_project: "truesendr" }), eventFor(f, "open", { tb_workspace_id: String(new mongoose.Types.ObjectId()) }),
    eventFor(f, "open", { tb_campaign_id: String(new mongoose.Types.ObjectId()) }),
    eventFor(f, "open", { tb_recipient_id: String(new mongoose.Types.ObjectId()) }),
    eventFor(f, "open", { tb_attempt_id: crypto.randomUUID() }), eventFor(f, "open", { email: "wrong@example.com" }),
    eventFor(f, "open", { tb_message_kind: "test" }), { email: f.recipient.email, event: "open" },
    eventFor(f, "constructor"), eventFor(f, "bounce", { timestamp: null }),
  ];
  assert.deepEqual((await post(events)).data, { success: true, processed: 0, duplicate: 0, ignored: events.length });
  assert.equal(await Event.countDocuments({ campaignId: f.campaign._id }), 0);
});

test("batches/retries/concurrent duplicates store one event and accurate unique/total engagement", async () => {
  const f = await fixture();
  const delivered = eventFor(f, "delivered", { response: "250 OK" });
  const open = eventFor(f, "open", { sg_machine_open: true });
  const click = eventFor(f, "click", { url: "https://example.com/product", ip: "192.0.2.1", useragent: "Mozilla/5.0" });
  const events = [eventFor(f, "processed"), delivered, open, eventFor(f, "open"), click, eventFor(f, "click")];
  assert.equal((await post(events)).data.processed, 6);
  assert.equal((await post(events)).data.duplicate, 6);
  await Promise.all([webhook.applyEvent(open), webhook.applyEvent(open)]);
  assert.equal(await Event.countDocuments({ campaignId: f.campaign._id }), 6);
  const summary = await stats(f);
  assert.equal(summary.totalSent, 1); assert.equal(summary.deliveredCount, 1);
  assert.equal(summary.uniqueOpens, 1); assert.equal(summary.totalOpens, 2);
  assert.equal(summary.uniqueClicks, 1); assert.equal(summary.totalClicks, 2);
  assert.equal(summary.machineOpenCount, 1);
  const details = await stats(f, "details");
  assert.equal(details[0].clickedUrl, "https://example.com/product");
  assert.equal(details[0].providerMessageId, delivered.sg_message_id);
  assert.equal(details[0].deliveryReason, "250 OK");
});

test("concurrent first deliveries of the same event remain idempotent", async () => {
  const f = await fixture();
  const event = eventFor(f, "open");
  const outcomes = await Promise.all([webhook.applyEvent(event), webhook.applyEvent(event), webhook.applyEvent(event)]);
  assert.equal(outcomes.filter(x => x === "processed").length, 1);
  assert.equal(await Event.countDocuments({ campaignId: f.campaign._id }), 1);
});

test("missing optional event IDs are deduplicated with a canonical fingerprint", async () => {
  const f = await fixture();
  const e = eventFor(f, "open"); delete e.sg_event_id; delete e.sg_message_id;
  assert.equal(await webhook.applyEvent(e), "processed");
  assert.equal(await webhook.applyEvent(Object.fromEntries(Object.entries(e).reverse())), "duplicate");
});

test("blocked bounces and deferrals are temporary; delivery recovery doesn't lose event history", async () => {
  const f = await fixture();
  const time = Math.floor(Date.now() / 1000);
  assert.equal(webhook.classify({ event: "bounce", type: "blocked", status: "4.2.0" }), "soft");
  await webhook.applyEvent(eventFor(f, "bounce", { type: "blocked", reason: "Server temporarily blocked", status: "4.2.0", timestamp: time - 20 }));
  assert.equal((await Recipient.findById(f.recipient._id)).deliveryStatus, "blocked");
  assert.equal(await Suppression.countDocuments({ email: f.recipient.email }), 0);
  await webhook.applyEvent(eventFor(f, "deferred", { response: "421 try later", attempt: 2, timestamp: time - 10 }));
  assert.equal((await stats(f)).deferredCount, 1);
  await webhook.applyEvent(eventFor(f, "delivered", { timestamp: time }));
  // Late/out-of-order events cannot regress a terminal delivery.
  await webhook.applyEvent(eventFor(f, "processed", { timestamp: time - 30 }));
  await webhook.applyEvent(eventFor(f, "deferred", { timestamp: time + 1 }));
  const summary = await stats(f);
  assert.equal(summary.deliveredCount, 1); assert.equal(summary.deferredCount, 0);
  assert.equal(summary.everDeferredCount, 1); assert.equal(summary.everSoftBounceCount, 1);
  assert.equal(summary.hardBounceCount, 0);
  assert.equal(await Suppression.countDocuments({ email: f.recipient.email }), 0);
});

test("hard bounces permanently suppress only the matching workspace; later processed events can't undo them", async () => {
  const f = await fixture();
  await webhook.applyEvent(eventFor(f, "bounce", { type: "bounce", status: "5.1.1", reason: "Unknown mailbox" }));
  await webhook.applyEvent(eventFor(f, "delivered"));
  await webhook.applyEvent(eventFor(f, "processed"));
  assert.equal((await Recipient.findById(f.recipient._id)).deliveryStatus, "hard_bounce");
  assert.equal(await Suppression.countDocuments({ workspaceId: workspace._id, email: f.recipient.email, reason: "hard_bounce" }), 1);
  assert.equal(await Suppression.countDocuments({ workspaceId: { $ne: workspace._id }, email: f.recipient.email }), 0);
  assert.equal((await stats(f)).hardBounceCount, 1);
  assert.equal(webhook.classify({ event: "bounce", reason: "Unspecified" }), "unclassified");
  assert.equal(webhook.classify({ event: "bounce", status: "5.7.1", reason: "Policy block", type: undefined }), "unclassified");
});

test("drops remain distinct from bounces and respect known SendGrid suppression reasons", async () => {
  for (const [reason, suppression] of [["Invalid SMTPAPI header", null], ["Bounced Address", "hard_bounce"], ["Unsubscribed Address", "unsubscribed"], ["Spam Reporting Address", "complaint"]]) {
    const f = await fixture();
    await webhook.applyEvent(eventFor(f, "dropped", { reason }));
    assert.equal((await Recipient.findById(f.recipient._id)).deliveryStatus, "dropped");
    assert.equal((await stats(f)).droppedCount, 1);
    const found = await Suppression.findOne({ email: f.recipient.email });
    assert.equal(found?.reason || null, suppression);
  }
});

test("spam reports/unsubscribe events suppress future sends; group resubscribe doesn't silently erase opt-out", async () => {
  const f = await fixture();
  await webhook.applyEvent(eventFor(f, "spamreport"));
  await webhook.applyEvent(eventFor(f, "group_unsubscribe", { asm_group_id: 123 }));
  await webhook.applyEvent(eventFor(f, "unsubscribe"));
  await webhook.applyEvent(eventFor(f, "group_resubscribe", { asm_group_id: 123 }));
  assert.equal((await stats(f)).spamReportCount, 1);
  assert.equal((await stats(f)).unsubscribeCount, 1);
  assert.equal(await Suppression.countDocuments({ email: f.recipient.email }), 2);
  f.campaign.status = "running"; f.campaign.leaseOwner = "test"; f.campaign.leaseUntil = new Date(Date.now() + 120000); await f.campaign.save();
  await Recipient.updateOne({ _id: f.recipient._id }, { $set: { status: "pending" } });
  let sends = 0;
  await processCampaign(f.campaign, "test", async () => { sends++; return "must-not-send"; });
  assert.equal(sends, 0);
  assert.equal((await Recipient.findById(f.recipient._id)).status, "skipped");
});

test("confirmation GET has no side effects; form and RFC8058 one-click POST are idempotent", async () => {
  const f = await fixture();
  const url = new URL(mail.trackingUrl(f.campaign, f.recipient, "unsubscribe"));
  const endpoint = base + url.pathname + url.search;
  const page = await fetch(endpoint);
  assert.equal(page.status, 200); assert((await page.text()).includes("Confirm unsubscribe"));
  assert.equal(await Suppression.countDocuments({ email: f.recipient.email }), 0);
  for (const body of ["confirm=unsubscribe", "List-Unsubscribe=One-Click"]) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://api.demandmediaglobal.com" }, body });
    assert.equal(response.status, 200);
  }
  assert.equal(await Suppression.countDocuments({ email: f.recipient.email, reason: "unsubscribed" }), 1);
  assert.equal(await Event.countDocuments({ recipientId: f.recipient._id, type: "unsubscribe" }), 1);
});

test("legacy custom tracking routes don't double-count new SendGrid opens and clicks", async () => {
  const f = await fixture();
  for (const action of ["pixel", "click"]) {
    const url = new URL(mail.trackingUrl(f.campaign, f.recipient, action));
    assert.equal((await fetch(base + url.pathname + url.search)).status, 200);
  }
  assert.equal(await Event.countDocuments({ recipientId: f.recipient._id }), 0);
});

test("webhook arriving before HTTP acceptance persistence preserves delivery and attempt mapping", async () => {
  const f = await fixture();
  f.campaign.status = "running"; f.campaign.leaseOwner = "test"; f.campaign.leaseUntil = new Date(Date.now() + 120000); await f.campaign.save();
  await Recipient.updateOne({ _id: f.recipient._id }, { $set: { status: "pending" } });
  await processCampaign(f.campaign, "test", async (campaign, recipient) => {
    await webhook.applyEvent(eventFor({ campaign, recipient }, "delivered"));
    return "http-acceptance-id";
  });
  assert.equal((await Recipient.findById(f.recipient._id)).status, "delivered");
  assert.equal((await stats(f)).totalSent, 1);
  assert.equal((await stats(f)).deliveredCount, 1);
});

test("partial database failure returns retryable 503; replay commits remaining events once", async () => {
  const f = await fixture();
  const events = [eventFor(f, "processed"), eventFor(f, "delivered")];
  const original = Event.create;
  let calls = 0;
  Event.create = function (...args) { if (++calls === 2) throw new Error("Simulated storage outage"); return original.apply(this, args); };
  try { assert.equal((await post(events)).status, 503); } finally { Event.create = original; }
  assert.equal(await Event.countDocuments({ campaignId: f.campaign._id }), 1);
  const replay = await post(events);
  assert.equal(replay.status, 200); assert.equal(replay.data.duplicate, 1); assert.equal(replay.data.processed, 1);
  assert.equal(await Event.countDocuments({ campaignId: f.campaign._id }), 2);
});

test("processed callbacks do not regress an existing temporary failure", async () => {
  const f = await fixture();
  const timestamp = Math.floor(Date.now() / 1000);
  await webhook.applyEvent(eventFor(f, "deferred", { timestamp, response: "421 delayed" }));
  await webhook.applyEvent(eventFor(f, "processed", { timestamp: timestamp + 1 }));
  assert.equal((await Recipient.findById(f.recipient._id)).deliveryStatus, "deferred");
});

test("verification key rotation accepts the previous key while invalid config fails closed", async () => {
  const configured = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
  const replacement = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  try {
    process.env.SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY = configured;
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = replacement.publicKey.export({ format: "pem", type: "spki" }).toString();
    assert.equal((await post([])).status, 200);
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = "invalid-key";
    assert.equal((await post([])).status, 503);
  } finally {
    process.env.SENDGRID_WEBHOOK_PUBLIC_KEY = configured;
    process.env.SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY = "";
  }
});

test("transport readiness does not require per-campaign company fields; missing address blocks rendering", () => {
  const postal = process.env.COMPANY_POSTAL_ADDRESS;
  try {
    process.env.COMPANY_POSTAL_ADDRESS = "";
    assert.doesNotThrow(() => mail.checkCampaignConfig(workspace));
    assert.throws(() => mail.render({ html: "<p>Campaign</p>", provider: "sendgrid" }, { email: "test@example.com" }), /Sender postal address cannot be established/);
  } finally { process.env.COMPANY_POSTAL_ADDRESS = postal; }
  assert.doesNotThrow(() => mail.checkCampaignConfig(workspace));
});

test("preview mail cannot bypass workspace unsubscribes, complaints or hard-bounce suppressions", async () => {
  for (const reason of ["unsubscribed", "complaint", "hard_bounce"]) {
    const f = await fixture();
    await Suppression.create({ workspaceId: workspace._id, email: f.recipient.email, reason });
    const token = sign({ userId: String(user._id), workspaceId: String(workspace._id), version: user.tokenVersion }, "auth", 60);
    const response = await fetch(base + "/api/campaign/send-test-mail", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ receiver: f.recipient.email, subject: "Preview", body: "Test" }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Recipient is suppressed in this workspace");
  }
});

test("late signed delivery resolves an unknown send and campaign review without retrying mail", async () => {
  const f = await fixture();
  f.campaign.status = "running"; f.campaign.leaseOwner = "test"; f.campaign.leaseUntil = new Date(Date.now() + 120000); await f.campaign.save();
  await Recipient.updateOne({ _id: f.recipient._id }, { $set: { status: "pending" } });
  let sends = 0;
  await processCampaign(f.campaign, "test", async () => { sends++; throw new Error("Ambiguous timeout"); });
  assert.equal((await Campaign.findById(f.campaign._id)).status, "needs_review");
  const recipient = await Recipient.findById(f.recipient._id);
  assert.equal(recipient.status, "unknown");
  await webhook.applyEvent(eventFor({ campaign: f.campaign, recipient }, "delivered"));
  assert.equal((await Recipient.findById(recipient._id)).status, "delivered");
  assert.equal((await Recipient.findById(recipient._id)).error, "");
  assert.equal((await Campaign.findById(f.campaign._id)).status, "completed");
  assert.equal(sends, 1);
});

test("campaign creation uses central compliance and stores original HTML/CSS without campaign company fields", async () => {
  const ContactList = require("../src/models/contactList.model");
  const Contact = require("../src/models/contact.model");
  const Membership = require("../src/models/listMembership.model");
  const Template = require("../src/models/template.model");
  const originalName = process.env.COMPANY_NAME;
  const originalAddress = process.env.COMPANY_POSTAL_ADDRESS;
  const html = '\n<!doctype html><html><head><style>.message{color:teal}</style></head><body><p class="message">Hello {{firstName}}</p></body></html>\n';
  const css = ".message { font-weight: bold; }";
  const address = "789 Workspace Fixture Road, Sample City, 12345";
  try {
    process.env.COMPANY_NAME = "";
    process.env.COMPANY_POSTAL_ADDRESS = "";
    workspace.compliance = { postalAddress: address };
    await workspace.save();
    const list = await ContactList.create({ workspaceId: workspace._id, name: crypto.randomUUID() });
    const contact = await Contact.create({ workspaceId: workspace._id, email: "central-compliance-fixture@example.com" });
    await Membership.create({ workspaceId: workspace._id, listId: list._id, contactId: contact._id });
    const template = await Template.create({ workspaceId: workspace._id, name: "Original compliance fixture", html, css });
    const token = sign({ userId: String(user._id), workspaceId: String(workspace._id), version: user.tokenVersion }, "auth", 60);
    const response = await fetch(base + "/api/campaign/send-campaign", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: crypto.randomUUID(), subject: "Fixture campaign", body: html, style: css, listName: list.name }) });
    assert.equal(response.status, 200);
    const campaign = await Campaign.findById((await response.json()).campaignId);
    assert.equal(campaign.html, html); assert.equal(campaign.css, css);
    assert.equal(campaign.companyName, undefined); assert.equal(campaign.postalAddress, undefined);
    assert.equal(campaign.compliance.postalAddress, address);
    campaign.status = "running"; campaign.leaseOwner = "test"; campaign.leaseUntil = new Date(Date.now() + 120000); await campaign.save();
    let sentCopy;
    await processCampaign(campaign, "test", async (snapshot, recipient) => {
      sentCopy = mail.buildPayload(snapshot, recipient).content[0].value;
      return "fixture-accepted-id";
    });
    assert(sentCopy.includes(address)); assert(sentCopy.includes("track-unsubscribe"));
    assert.equal((await Campaign.findById(campaign._id)).html, html);
    assert.equal((await Campaign.findById(campaign._id)).css, css);
    assert.equal((await Template.findById(template._id)).html, html);
    assert.equal((await Template.findById(template._id)).css, css);
    // A campaign body cannot approve an unknown sender address or bypass central configuration.
    workspace.compliance = undefined; await workspace.save();
    const rejected = await fetch(base + "/api/campaign/send-campaign", { method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: crypto.randomUUID(), subject: "Must reject", body: html,
        listName: list.name, companyName: "Request override", postalAddress: address,
        compliance: { postalAddress: address } }) });
    assert.equal(rejected.status, 503);
    assert.match((await rejected.json()).error, /Sender postal address cannot be established/);
  } finally {
    process.env.COMPANY_NAME = originalName;
    process.env.COMPANY_POSTAL_ADDRESS = originalAddress;
    workspace.compliance = undefined;
    await workspace.save();
  }
});

test("permanent message blocks stay separate from invalid-recipient hard bounces", async () => {
  const f = await fixture();
  await webhook.applyEvent(eventFor(f,"bounce",{type:"blocked",status:"5.7.1",reason:"Policy block"}));
  await webhook.applyEvent(eventFor(f,"deferred",{timestamp:Math.floor(Date.now()/1000)+1,response:"421 delayed"}));
  assert.equal((await Recipient.findById(f.recipient._id)).deliveryStatus,"blocked_permanent");
  assert.equal(await Suppression.countDocuments({email:f.recipient.email}),0);
  const summary = await stats(f);
  assert.equal(summary.permanentBlockCount,1);assert.equal(summary.softBounceCount,0);assert.equal(summary.hardBounceCount,0);
  const hard = await fixture();
  await webhook.applyEvent(eventFor(hard,"bounce",{type:"blocked",status:"5.1.1",reason:"Unknown recipient"}));
  assert.equal(await Suppression.countDocuments({email:hard.recipient.email,reason:"hard_bounce"}),1);
});
