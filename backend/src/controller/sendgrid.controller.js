const crypto = require("crypto");
const mongoose = require("mongoose");
const { engagementMetadata } = require("./tracking.controller");
const Campaign = require("../models/campaign.model");
const Recipient = require("../models/campaignRecipient.model");
const Event = require("../models/campaignEvent.model");
const Suppression = require("../models/suppression.model");
const { HttpError, asyncHandler } = require("../middleware/request");

const TYPES = { processed: "processed", delivered: "delivery", open: "open", click: "click",
  bounce: "bounce", deferred: "deferred", dropped: "dropped", spamreport: "complaint",
  unsubscribe: "unsubscribe", group_unsubscribe: "unsubscribe", group_resubscribe: "resubscribe" };
const text = (value, max = 1000) => typeof value === "string" ? value.slice(0, max) : "";

function verificationKeys() {
  const values = [process.env.SENDGRID_WEBHOOK_PUBLIC_KEY, process.env.SENDGRID_WEBHOOK_PREVIOUS_PUBLIC_KEY].filter(Boolean);
  if (!values.length) throw new HttpError(503, "SendGrid webhook verification key is not configured");
  try {
    return values.map(value => {
      const key = value.includes("BEGIN PUBLIC KEY")
        ? crypto.createPublicKey(value.replace(/\\n/g, "\n"))
        : crypto.createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" });
      if (key.asymmetricKeyType !== "ec") throw new Error("Expected ECDSA key");
      return key;
    });
  } catch { throw new HttpError(503, "SendGrid webhook verification key is invalid"); }
}

function verifySignature(body, signature, timestamp) {
  const keys = verificationKeys();
  if (!Buffer.isBuffer(body) || !/^\d{1,12}$/.test(timestamp || "") ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(signature || "") || signature.length > 256)
    throw new HttpError(401, "Invalid SendGrid webhook signature");
  const signed = Buffer.concat([Buffer.from(timestamp), body]);
  if (!keys.some(key => crypto.verify("sha256", signed, key, Buffer.from(signature, "base64"))))
    throw new HttpError(401, "Invalid SendGrid webhook signature");
  // Durable event deduplication prevents replay; don't expire valid delayed provider retries.
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}

function classify(event) {
  if (event.event === "bounce") {
    if (event.type === "blocked") {
      const response = [event.status, event.response, event.reason].filter(v => typeof v === "string").join(" ");
      if (/\b5\.1\.[13]\b/.test(response)) return "hard";
      if (/\b5\.\d\.\d\b|(?:^|\s)5\d\d(?:\s|$)/.test(response)) return "blocked_permanent";
      if (/\b4\.\d\.\d\b|(?:^|\s)4\d\d(?:\s|$)/.test(response)) return "soft";
      return "unclassified";
    }
    if (event.type === "bounce") return "hard";
    // A missing type plus a 5xx policy response does not confirm an invalid address.
    if (/^4[.\d]/.test(event.status || "")) return "soft";
    return "unclassified";
  }
  return event.event === "deferred" ? "temporary" : "";
}

function suppressionReason(event, classification) {
  if (event.event === "bounce" && classification === "hard") return "hard_bounce";
  if (event.event === "spamreport") return "complaint";
  if (["unsubscribe", "group_unsubscribe"].includes(event.event)) return "unsubscribed";
  if (event.event === "dropped") {
    const reason = text(event.reason).toLowerCase().trim();
    if (reason === "bounced address") return "hard_bounce";
    if (reason === "unsubscribed address") return "unsubscribed";
    if (reason === "spam reporting address") return "complaint";
  }
  return null;
}

// Project, tenant, campaign, recipient, email AND persisted attempt must all match.
async function applyEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event) ||
      !process.env.SENDGRID_PROJECT_ID || event.tb_project !== process.env.SENDGRID_PROJECT_ID ||
      event.tb_message_kind !== "campaign" || !Object.hasOwn(TYPES, event.event)) return "ignored";
  const ids = [event.tb_workspace_id, event.tb_campaign_id, event.tb_recipient_id];
  const timestamp = Number(event.timestamp);
  if (!ids.every(id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id)) ||
      typeof event.tb_attempt_id !== "string" || !/^[a-f\d-]{36}$/i.test(event.tb_attempt_id) ||
      typeof event.email !== "string" || !event.email.trim() || event.timestamp === null || event.timestamp === undefined ||
      !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() / 1000 + 86400) return "ignored";
  const scope = { workspaceId: event.tb_workspace_id, campaignId: event.tb_campaign_id, recipientId: event.tb_recipient_id };
  const dedupeKey = `sendgrid:${text(event.sg_event_id, 300) || crypto.createHash("sha256").update(JSON.stringify(canonical(event))).digest("hex")}`;
  const mapping = { _id: scope.recipientId, workspaceId: scope.workspaceId, campaignId: scope.campaignId,
    email: event.email.trim().toLowerCase(), sendAttemptId: event.tb_attempt_id };
  if (!(await Recipient.exists(mapping)) || !(await Campaign.exists({ _id: scope.campaignId,
    workspaceId: scope.workspaceId, provider: "sendgrid", sendgridProject: event.tb_project }))) return "ignored";
  if (await Event.exists({ workspaceId: scope.workspaceId, dedupeKey })) return "duplicate";
  const metadata = ["open", "click"].includes(event.event) ? await engagementMetadata(event) : {};
  let outcome = "ignored";
  try {
    await mongoose.connection.transaction(async session => {
      const campaign = await Campaign.findOne({ _id: scope.campaignId, workspaceId: scope.workspaceId,
        provider: "sendgrid", sendgridProject: event.tb_project }).session(session);
      if (!campaign) return;
      const recipient = await Recipient.findOne({ _id: scope.recipientId, workspaceId: scope.workspaceId,
        campaignId: scope.campaignId, email: event.email.trim().toLowerCase(),
        sendAttemptId: event.tb_attempt_id }).session(session);
      if (!recipient) return;
      if (await Event.exists({ workspaceId: scope.workspaceId, dedupeKey }).session(session)) { outcome = "duplicate"; return; }
      const classification = classify(event);
      const occurredAt = new Date(timestamp * 1000);
      await Event.create([{ ...scope, type: TYPES[event.event], occurredAt, dedupeKey,
        provider: "sendgrid", providerEvent: event.event, providerEventId: text(event.sg_event_id, 300),
        messageId: text(event.sg_message_id, 500), sendAttemptId: event.tb_attempt_id,
        reason: text(event.reason), response: text(event.response), smtpStatus: text(event.status, 80),
        classification, bounceClassification: text(event.bounce_classification, 120), url: text(event.url, 8192),
        ...metadata, machineOpen: event.sg_machine_open === true,
        attempt: text(String(event.attempt ?? ""), 40), asmGroupId: Number.isInteger(event.asm_group_id) ? event.asm_group_id : undefined,
      }], { session });

      // Update one recipient in this transaction to serialize concurrent event projections.
      if (event.event === "processed") recipient.processedAt = recipient.processedAt || occurredAt;
      recipient.provider = "sendgrid";
      recipient.providerMessageId = text(event.sg_message_id, 500) || recipient.providerMessageId;
      const reason = suppressionReason(event, classification);
      if (reason) {
        await Suppression.updateOne({ workspaceId: scope.workspaceId, email: recipient.email, reason },
          { $setOnInsert: { workspaceId: scope.workspaceId, email: recipient.email, reason,
            firstName: recipient.firstName, lastName: recipient.lastName, companyName: recipient.companyName,
            campaignId: campaign._id, campaignName: campaign.name } }, { upsert: true, session });
        if (reason === "unsubscribed") recipient.unsubscribe = true;
        if (reason === "complaint") recipient.complaint = true;
      }
      // Rebuild delivery projection in event time order. Engagement/complaint never invent delivery.
      const history = await Event.find({ ...scope, provider: "sendgrid", providerEvent: { $in: ["processed", "delivered", "bounce", "deferred", "dropped"] } })
        .sort({ occurredAt: 1, _id: 1 }).session(session).lean();
      let delivery = "accepted", terminal = false;
      let latest;
      for (const item of history) {
        if (item.providerEvent === "delivered") {
          recipient.deliveredAt = recipient.deliveredAt || item.occurredAt;
          if (delivery !== "hard_bounce" && delivery !== "dropped") { delivery = "delivered"; latest = item; terminal = true; }
        } else if (item.providerEvent === "bounce" && item.classification === "hard") {
          delivery = "hard_bounce"; latest = item; terminal = true;
        } else if (item.providerEvent === "dropped" && delivery !== "hard_bounce" && delivery !== "delivered") {
          delivery = "dropped"; latest = item; terminal = true;
        } else if (!terminal && !(item.providerEvent === "processed" && delivery !== "accepted" && delivery !== "processed")) {
          delivery = item.providerEvent === "bounce" ? (item.classification === "soft" ? "blocked" : item.classification === "blocked_permanent" ? "blocked_permanent" : "bounce_unclassified") : item.providerEvent;
          latest = item;
          if (delivery === "blocked_permanent") terminal = true;
        }
        if (item.providerEvent === "bounce" && item.classification === "soft") recipient.softBounceAt = recipient.softBounceAt || item.occurredAt;
        if (item.providerEvent === "deferred") recipient.deferredAt = recipient.deferredAt || item.occurredAt;
      }
      if (history.length) {
        recipient.deliveryStatus = delivery;
        recipient.deliveryReason = latest?.reason || latest?.response || "";
        recipient.smtpStatus = latest?.smtpStatus || "";
        recipient.lastDeliveryEventAt = latest?.occurredAt;
        recipient.status = delivery === "delivered" ? "delivered" : delivery === "hard_bounce" || delivery === "blocked" || delivery === "blocked_permanent" || delivery === "bounce_unclassified" ? "bounced" : delivery === "dropped" ? "failed" : "accepted";
        recipient.bounceStatus = delivery === "hard_bounce" ? "hard" : delivery === "blocked" ? "soft" : delivery === "delivered" ? "no" : "NA";
      } else if (["sending", "unknown"].includes(recipient.status)) {
        // A signed engagement event proves provider acceptance, even if the HTTP response was lost.
        recipient.status = "accepted";
      }
      recipient.sendAt = recipient.sendAt || recipient.attemptedAt || occurredAt;
      recipient.error = "";
      await recipient.save({ session });
      // A late signed callback can resolve an interrupted send without resending it.
      if (campaign.status === "needs_review" && !(await Recipient.exists({ workspaceId: scope.workspaceId,
        campaignId: scope.campaignId, status: { $in: ["unknown", "sending", "pending"] } }).session(session))) {
        const failed = await Recipient.exists({ workspaceId: scope.workspaceId, campaignId: scope.campaignId, status: "failed" }).session(session);
        await Campaign.updateOne({ _id: campaign._id, workspaceId: scope.workspaceId, status: "needs_review" },
          { $set: { status: failed ? "failed" : "completed", lastError: "" } }, { session });
      }
      outcome = "processed";
    });
  } catch (error) {
    if (error.code === 11000 && await Event.exists({ workspaceId: scope.workspaceId, dedupeKey })) return "duplicate";
    throw error;
  }
  return outcome;
}

async function receiveEvents(req, res) {
  verifySignature(req.body, req.get("X-Twilio-Email-Event-Webhook-Signature"), req.get("X-Twilio-Email-Event-Webhook-Timestamp"));
  let events;
  try { events = JSON.parse(req.body.toString("utf8")); } catch { throw new HttpError(400, "Invalid webhook JSON"); }
  if (!Array.isArray(events) || events.length > 5000) throw new HttpError(400, "Expected a webhook batch of at most 5000 events");
  const result = { processed: 0, duplicate: 0, ignored: 0 };
  try {
    for (const event of events) result[await applyEvent(event)]++;
  } catch {
    // Previously committed events are deduplicated when SendGrid retries the entire batch.
    throw new HttpError(503, "Webhook persistence unavailable; retry this batch");
  }
  res.json({ success: true, ...result });
}

module.exports = { verificationKeys, verifySignature, classify, suppressionReason, applyEvent, receiveEvents: asyncHandler(receiveEvents) };
