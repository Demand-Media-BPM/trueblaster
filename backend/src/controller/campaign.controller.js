const Campaign = require("../models/campaign.model");
const CampaignRecipient = require("../models/campaignRecipient.model");
const ContactList = require("../models/contactList.model");
const CampaignEvent = require("../models/campaignEvent.model");
const Suppression = require("../models/suppression.model");
const { handlers, HttpError, normalizeEmail, required } = require("../middleware/request");
const { Parser } = require("json2csv");
const mongoose = require("mongoose");
const ListMembership = require("../models/listMembership.model");
const Contact = require("../models/contact.model");
const { checkMailConfig } = require("./mail.controller");

// Campaign endpoints, recipient reports, and CSV exports.
async function sendCampaign(req, res) {
  const campaign = await createCampaign(req);
  res.json({
    message:
      campaign.status === "scheduled"
        ? `Campaign scheduled for ${campaign.scheduleTime.toISOString()}`
        : `Campaign ${campaign.name} queued for sending`,
    campaignId: campaign._id,
    status: campaign.status,
  });
}

async function listCampaignIds(req, res) {
  res.json(
    (
      await Campaign.find({ workspaceId: req.auth.workspaceId })
        .sort({ createdAt: 1 })
        .select("name")
        .lean()
    ).map((c) => c.name)
  );
}

async function listContactLists(req, res) {
  res.json(
    (await ContactList.find({ workspaceId: req.auth.workspaceId }).select("name").lean()).map(
      (l) => l.name
    )
  );
}

async function getCampaignAnalytics(req, res) {
  res.json(await summary(await findCampaign(req.auth.workspaceId, req.query.emailId)));
}

async function getCampaignDetails(req, res) {
  res.json(await details(await findCampaign(req.auth.workspaceId, req.query.emailId)));
}

async function getCampaignProgress(req, res) {
  let campaign = await findCampaign(req.auth.workspaceId, req.query.emailId);
  if (!req.get("accept")?.includes("text/event-stream"))
    return res.json(await progress(campaign));
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  let busy = false,
    closed = false;
  const send = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      campaign = await findCampaign(req.auth.workspaceId, req.query.emailId);
      const data = await progress(campaign);
      if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      if (!closed) res.end();
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(send, 2000);
  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
  send();
}

async function markBounce(req, res) {
  if (req.auth.role !== "owner") throw new HttpError(403, "Workspace owner access required");
  const campaign = await findCampaign(req.auth.workspaceId, req.body.emailId);
  const email = normalizeEmail(req.body.recipientId || req.body.email || req.body.recipient);
  const status = req.body.bounceStatus || req.body.status || "hard";
  if (!["hard", "soft", "no"].includes(status)) throw new HttpError(400, "Invalid bounce status");
  const recipient = await CampaignRecipient.findOneAndUpdate(
    { workspaceId: req.auth.workspaceId, campaignId: campaign._id, email },
    { $set: { bounceStatus: status, status: status === "no" ? "delivered" : "bounced" } },
    { new: true }
  );
  if (!recipient) throw new HttpError(404, "Recipient not found");
  if (status === "hard")
    await Suppression.updateOne(
      { workspaceId: req.auth.workspaceId, email, reason: "hard_bounce" },
      {
        $setOnInsert: {
          workspaceId: req.auth.workspaceId,
          email,
          reason: "hard_bounce",
          campaignId: campaign._id,
        },
      },
      { upsert: true }
    );
  await CampaignEvent.create({
    workspaceId: req.auth.workspaceId,
    campaignId: campaign._id,
    recipientId: recipient._id,
    type: status === "no" ? "delivery" : "bounce",
  });
  res.json({ success: true });
}

async function exportCampaignCsv(req, res) {
  const campaign = await findCampaign(req.auth.workspaceId, req.query.emailId);
  const rows = await details(campaign);
  const safe = (value) =>
    typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  const fields = [
    "Campaign",
    "Recipient",
    "Bounced",
    "IP",
    "City",
    "Region",
    "Country",
    "Device",
    "Browser",
    "OS",
    "TotalClick",
    "TotalOpen",
    "LastClick",
    "Unsubscribed",
  ];
  const records = rows.map((r) =>
    Object.fromEntries(
      Object.entries({
        Campaign: campaign.name,
        Recipient: r.recipient,
        Bounced: r.bounceStatus,
        IP: r.ip,
        City: r.city,
        Region: r.region,
        Country: r.country,
        Device: r.device,
        Browser: r.browser,
        OS: r.os,
        TotalClick: r.totalClick,
        TotalOpen: r.totalOpen,
        LastClick: r.lastClick,
        Unsubscribed: r.unsubscribe ? "Yes" : "No",
      }).map(([key, value]) => [key, safe(value)])
    )
  );
  res
    .type("text/csv")
    .attachment(`${campaign.name.replace(/[^a-z0-9_-]/gi, "_")}_data.csv`)
    .send(new Parser({ fields }).parse(records));
}

// Validate and snapshot a new queued or scheduled campaign.
// Campaign names are unique within a workspace, so every lookup includes its owner.
async function findCampaign(workspaceId, name) {
  const doc = await Campaign.findOne({ workspaceId, name: required(name, "emailId", 150) });
  if (!doc) throw new HttpError(404, "Campaign not found");
  return doc;
}

async function createCampaign(req) {
  checkMailConfig();
  const workspaceId = req.auth.workspaceId;
  const name = required(req.body.emailId, "Campaign name", 150);
  const subject = required(req.body.subject, "Subject", 998);
  const html = required(req.body.body, "Email body", 1000000);
  const listName = required(req.body.listName, "List name", 150);
  const senderEmail = normalizeEmail(req.workspace.senderEmail || process.env.FROM_EMAIL);
  let redirectUrl = "";
  if (req.body.redirectUrl) {
    let url;
    try {
      url = new URL(req.body.redirectUrl);
    } catch {
      throw new HttpError(400, "Invalid redirect URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new HttpError(400, "Redirect URL must use HTTP(S)");
    redirectUrl = url.toString();
  }
  let scheduleTime = new Date();
  if (req.body.scheduleTime) {
    scheduleTime = new Date(req.body.scheduleTime);
    if (!Number.isFinite(scheduleTime.getTime())) throw new HttpError(400, "Invalid schedule time");
  }
  let campaign;
  // Snapshot content and recipients atomically; later list edits must not change this campaign.
  await mongoose.connection.transaction(async (session) => {
    const list = await ContactList.findOne({ workspaceId, name: listName }).session(session);
    if (!list) throw new HttpError(404, "Contact list not found");
    const links = await ListMembership.find({ workspaceId, listId: list._id })
      .session(session)
      .lean();
    const contacts = await Contact.find({
      workspaceId,
      _id: { $in: links.map((link) => link.contactId) },
    })
      .session(session)
      .lean();
    if (!contacts.length) throw new HttpError(400, "Contact list is empty");
    if (contacts.length > 20000)
      throw new HttpError(400, "Use a list of at most 20,000 contacts per campaign");
    [campaign] = await Campaign.create(
      [
        {
          workspaceId,
          createdBy: req.auth.userId,
          name,
          subject,
          html,
          css: String(req.body.style || ""),
          listId: list._id,
          listName,
          senderEmail,
          redirectUrl,
          scheduleTime,
          status: scheduleTime > new Date() ? "scheduled" : "queued",
          totalRecipients: contacts.length,
        },
      ],
      { session }
    );
    const suppressions = await Suppression.find({
      workspaceId,
      email: { $in: contacts.map((c) => c.email) },
    })
      .session(session)
      .lean();
    const blocked = new Map(suppressions.map((s) => [s.email, s.reason]));
    await CampaignRecipient.insertMany(
      contacts.map((c) => ({
        workspaceId,
        campaignId: campaign._id,
        contactId: c._id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        companyName: c.companyName,
        contactNo: c.contactNo,
        jobTitle: c.jobTitle,
        linkedin: c.linkedin,
        customFields: c.customFields,
        status: blocked.has(c.email) ? "skipped" : "pending",
        skipReason: blocked.get(c.email) || "",
        bounceStatus: blocked.has(c.email) ? "dnd" : "NA",
        unsubscribe: blocked.get(c.email) === "unsubscribed",
      })),
      { session }
    );
  });
  return campaign;
}

// Aggregate campaign statistics and recipient delivery outcomes.
// Derive dashboard totals from the stored recipients belonging to this campaign.
async function summary(campaign) {
  const scope = { workspaceId: campaign.workspaceId, campaignId: campaign._id };
  const [totalSent, hardBounceCount, softBounceCount, events, unsubscribed] = await Promise.all([
    CampaignRecipient.countDocuments({ ...scope, messageId: { $exists: true } }),
    CampaignRecipient.countDocuments({ ...scope, bounceStatus: "hard" }),
    CampaignRecipient.countDocuments({ ...scope, bounceStatus: "soft" }),
    CampaignEvent.aggregate([
      { $match: { ...scope, type: { $in: ["open", "click"] } } },
      { $group: { _id: { type: "$type", recipient: "$recipientId" }, count: { $sum: 1 } } },
      { $group: { _id: "$_id.type", unique: { $sum: 1 }, total: { $sum: "$count" } } },
    ]),
    CampaignRecipient.countDocuments({ ...scope, unsubscribe: true }),
  ]);
  const open = events.find((e) => e._id === "open") || {},
    click = events.find((e) => e._id === "click") || {};
  const rate = (n) => (totalSent ? (n / totalSent) * 100 : 0);
  return {
    emailId: campaign.name,
    totalSent,
    uniqueOpens: open.unique || 0,
    totalOpens: open.total || 0,
    uniqueClicks: click.unique || 0,
    totalClicks: click.total || 0,
    openRate: rate(open.unique || 0),
    clickRate: rate(click.unique || 0),
    bounceRate: rate(hardBounceCount + softBounceCount),
    hardBounceCount,
    softBounceCount,
    unsubscribeCount: unsubscribed,
    lastActivity: campaign.createdAt,
    status: campaign.status,
    totalRecipients: campaign.totalRecipients,
  };
}

async function details(campaign) {
  const scope = { workspaceId: campaign.workspaceId, campaignId: campaign._id };
  const [recipients, counts, clicks] = await Promise.all([
    CampaignRecipient.find(scope).sort({ _id: 1 }).lean(),
    CampaignEvent.aggregate([
      { $match: { ...scope, type: { $in: ["open", "click"] } } },
      { $group: { _id: { recipient: "$recipientId", type: "$type" }, count: { $sum: 1 } } },
    ]),
    CampaignEvent.aggregate([
      { $match: { ...scope, type: "click" } },
      { $sort: { occurredAt: -1 } },
      { $group: { _id: "$recipientId", last: { $first: "$$ROOT" } } },
    ]),
  ]);
  const byRecipient = new Map(),
    lastClick = new Map(clicks.map((c) => [String(c._id), c.last]));
  for (const item of counts) {
    const key = String(item._id.recipient);
    if (!byRecipient.has(key)) byRecipient.set(key, {});
    byRecipient.get(key)[item._id.type] = item.count;
  }
  return recipients.map((r) => {
    const counts = byRecipient.get(String(r._id)) || {},
      click = lastClick.get(String(r._id)) || {};
    return {
      emailId: campaign.name,
      recipient: r.email,
      ip: click.ip || "NA",
      city: click.city || "NA",
      region: click.region || "NA",
      country: click.country || "NA",
      device: click.device || "NA",
      browser: click.browser || "NA",
      os: click.os || "NA",
      totalOpen: counts.open || 0,
      totalClick: counts.click || 0,
      lastClick: click.occurredAt || "NA",
      sendAt: r.sendAt || "NA",
      bounceStatus: r.bounceStatus,
      unsubscribe: r.unsubscribe,
      status: r.status,
      error: r.error || r.skipReason || "",
    };
  });
}

async function progress(campaign) {
  const scope = { workspaceId: campaign.workspaceId, campaignId: campaign._id };
  const [sent, processed] = await Promise.all([
    CampaignRecipient.countDocuments({ ...scope, messageId: { $exists: true } }),
    CampaignRecipient.countDocuments({ ...scope, status: { $nin: ["pending", "sending"] } }),
  ]);
  return { sent, processed, total: campaign.totalRecipients, status: campaign.status };
}

module.exports = handlers({ sendCampaign, listCampaignIds, listContactLists, getCampaignAnalytics, getCampaignDetails, getCampaignProgress, markBounce, exportCampaignCsv });
