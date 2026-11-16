const mongoose = require("mongoose");
const axios = require("axios");
const uaParser = require("ua-parser-js");
const Campaign = require("../models/campaign.model");
const CampaignRecipient = require("../models/campaignRecipient.model");
const CampaignEvent = require("../models/campaignEvent.model");
const Suppression = require("../models/suppression.model");
const { verify } = require("../middleware/auth");
const { HttpError, handlers } = require("../middleware/request");

// Bind each public tracking token to its action, workspace, campaign, and recipient.
async function resolveTracking(token, action) {
  let data;
  try {
    data = verify(token, "tracking");
    if (
      data.action !== action ||
      ![data.workspaceId, data.campaignId, data.recipientId].every((id) =>
        mongoose.isValidObjectId(id)
      )
    )
      throw new Error();
  } catch {
    throw new HttpError(400, "Invalid tracking link");
  }
  const recipient = await CampaignRecipient.findOne({
    _id: data.recipientId,
    workspaceId: data.workspaceId,
    campaignId: data.campaignId,
  });
  const campaign =
    recipient && (await Campaign.findOne({ _id: data.campaignId, workspaceId: data.workspaceId }));
  if (!recipient || !campaign) throw new HttpError(404, "Tracking link not found");
  return { recipient, campaign };
}

async function recordTracking(req, action) {
  const { recipient, campaign } = await resolveTracking(req.query.token, action);
  const scope = {
    workspaceId: campaign.workspaceId,
    campaignId: campaign._id,
    recipientId: recipient._id,
  };
  const type = action === "pixel" ? "open" : action;
  if (type === "unsubscribe") {
    await mongoose.connection.transaction(async (session) => {
      await Suppression.updateOne(
        { workspaceId: campaign.workspaceId, email: recipient.email, reason: "unsubscribed" },
        {
          $setOnInsert: {
            workspaceId: campaign.workspaceId,
            email: recipient.email,
            firstName: recipient.firstName,
            lastName: recipient.lastName,
            companyName: recipient.companyName,
            reason: "unsubscribed",
            campaignId: campaign._id,
            campaignName: campaign.name,
          },
        },
        { upsert: true, session }
      );
      await CampaignRecipient.updateOne(
        { _id: recipient._id, workspaceId: campaign.workspaceId, campaignId: campaign._id },
        { $set: { unsubscribe: true } },
        { session }
      );
      await CampaignEvent.updateOne(
        { workspaceId: campaign.workspaceId, dedupeKey: `unsubscribe:${recipient._id}` },
        { $setOnInsert: { ...scope, type, occurredAt: new Date() } },
        { upsert: true, session }
      );
    });
    return { campaign, recipient };
  }
  const userAgent = req.get("user-agent") || "";
  if (/bot|crawler|preview|headless/i.test(userAgent)) return { campaign, recipient };
  const ip = req.ip || "";
  let geo = {};
  if (process.env.IPINFO_TOKEN && ip && !/^(127\.|::1$|::ffff:127\.|10\.|192\.168\.)/.test(ip)) {
    try {
      geo = (
        await axios.get(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
          params: { token: process.env.IPINFO_TOKEN },
          timeout: 2000,
          maxRedirects: 0,
        })
      ).data;
    } catch { }
  }
  const { device, browser, os } = uaParser(userAgent);
  // One tracked request per recipient/action per five-second window limits scanner refresh duplicates.
  const dedupeKey = `${type}:${recipient._id}:${Math.floor(Date.now() / 5000)}`;
  await CampaignEvent.updateOne(
    { workspaceId: campaign.workspaceId, dedupeKey },
    {
      $setOnInsert: {
        ...scope,
        type,
        occurredAt: new Date(),
        ip,
        city: geo.city || "",
        region: geo.region || "",
        country: geo.country || "",
        device: device.type || "desktop",
        browser: browser.name || "",
        os: os.name || "",
      },
    },
    { upsert: true }
  );
  return { campaign, recipient };
}

// Public endpoints require signed recipient links.
async function trackPixel(req, res) {
  await recordTracking(req, "pixel");
  const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  res
    .set({ "Content-Type": "image/gif", "Cache-Control": "no-cache, no-store, must-revalidate" })
    .send(pixel);
}

async function trackClick(req, res) {
  const { campaign } = await recordTracking(req, "click");
  if (campaign.redirectUrl) res.redirect(campaign.redirectUrl);
  else res.send("Thank you for your interest.");
}

async function trackUnsubscribe(req, res) {
  await recordTracking(req, "unsubscribe");
  res.send("You have been unsubscribed.");
}

module.exports = { ...handlers({ trackPixel, trackClick, trackUnsubscribe }), resolveTracking, recordTracking };
