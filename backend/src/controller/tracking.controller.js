const mongoose = require("mongoose");
const axios = require("axios");
const uaParser = require("ua-parser-js");
const Campaign = require("../models/campaign.model");
const CampaignRecipient = require("../models/campaignRecipient.model");
const CampaignEvent = require("../models/campaignEvent.model");
const Suppression = require("../models/suppression.model");
const { verify } = require("../middleware/auth");
const { HttpError, handlers } = require("../middleware/request");

// Reuse one bounded, cached IPinfo implementation for provider and first-party engagement.
const geoCache = new Map();
const geoPending = new Map();
const { isIP } = require("net");
function publicIp(value) {
  let ip = String(value || "").replace(/^::ffff:/i, "");
  const family = isIP(ip);
  if (!family) return "";
  if (family === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)))) ||
      (a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) return "";
  } else if (/^(?:fc|fd|fe[89ab]|ff|2001:db8:)/i.test(ip) || /^::(?:1)?$/.test(ip)) return "";
  return ip;
}

function parseAgent(userAgent, machineOpen = false) {
  const ua = typeof userAgent === "string" ? userAgent.slice(0, 1000) : "";
  const parsed = uaParser(ua);
  return {
    userAgent: ua,
    device: parsed.device.type || (parsed.os.name && parsed.browser.name ? "desktop" : ""),
    browser: parsed.browser.name || "", os: parsed.os.name || "",
    trafficType: machineOpen ? "privacy_proxy" : /bot|crawler|scanner|safelinks|proofpoint|mimecast|barracuda/i.test(ua) ? "automated" : "unknown",
  };
}

async function enrichIp(rawIp, transport = axios) {
  if (!rawIp) return { geoStatus: "not_provided" };
  const ip = publicIp(rawIp);
  if (!ip) return { geoStatus: "non_public" };
  if (!process.env.IPINFO_TOKEN) return { geoStatus: "disabled" };
  const cached = geoCache.get(ip);
  if (cached?.until > Date.now()) return cached.value;
  if (geoPending.has(ip)) return geoPending.get(ip);
  const promise = (async () => {
    let value, ttl;
    const str = v => typeof v === "string" ? v.slice(0, 250) : "";
    try {
      const response = await transport.get(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
        headers: { Authorization: `Bearer ${process.env.IPINFO_TOKEN}` }, timeout: 2000, maxRedirects: 0,
      });
      const data = response.data || {};
      const organization = str(data.org || data.company?.name || data.asn?.name || data.as_name);
      value = { city: str(data.city), region: str(data.region), country: str(data.country || data.country_code),
        organization, asn: str(typeof data.asn === "string" ? data.asn : data.asn?.asn) || organization.match(/^AS\d+/)?.[0] || "",
        networkProxy: ["proxy", "vpn", "tor", "relay", "hosting"].some(key => data.privacy?.[key] === true),
        geoStatus: "available", geoEnrichedAt: new Date(),
      };
      ttl = Math.max(60, Math.min(Number(process.env.IPINFO_CACHE_TTL_SECONDS) || 3600, 86400)) * 1000;
    } catch (error) {
      value = { geoStatus: error.response?.status === 429 ? "rate_limited" : "unavailable" };
      ttl = 60000;
    }
    if (geoCache.size >= 1000) geoCache.delete(geoCache.keys().next().value);
    geoCache.set(ip, { until: Date.now() + ttl, value });
    return value;
  })();
  geoPending.set(ip, promise);
  try { return await promise; } finally { geoPending.delete(ip); }
}


async function engagementMetadata(event) {
  const timestamp = Number(event.timestamp) * 1000;
  const days = Number(process.env.TRACKING_METADATA_RETENTION_DAYS || 30);
  if (Number.isFinite(timestamp) && timestamp < Date.now() - days * 86400000)
    return { ip: "", userAgent: "", device: "", browser: "", os: "", geoStatus: "anonymized", metadataAnonymizedAt: new Date() };
  const raw = typeof event.ip === "string" ? event.ip.trim().replace(/^::ffff:/i, "") : "";
  const ip = isIP(raw) ? raw : "";
  const agent = parseAgent(event.useragent, event.sg_machine_open === true);
  const geo = await enrichIp(ip);
  return { ip, ...agent, ...geo, ...(geo.networkProxy && agent.trafficType === "unknown" ? { trafficType: "network_proxy" } : {}) };
}

async function anonymizeTrackingMetadata(now = new Date()) {
  const days = Number(process.env.TRACKING_METADATA_RETENTION_DAYS || 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("TRACKING_METADATA_RETENTION_DAYS must be 1–365");
  const cutoff = new Date(now.getTime() - days * 86400000);
  return CampaignEvent.updateMany({ occurredAt: { $lt: cutoff }, metadataAnonymizedAt: { $exists: false } }, {
    $set: { ip: "", city: "", region: "", country: "", organization: "", asn: "", userAgent: "",
      device: "", browser: "", os: "", networkProxy: false, geoStatus: "anonymized", metadataAnonymizedAt: now },
  });
}

function startMetadataRetention() {
  const run = () => anonymizeTrackingMetadata().catch(error => console.error("Tracking metadata retention failed:", error.name));
  run();
  const timer = setInterval(run, 3600000);
  timer.unref();
  return () => clearInterval(timer);
}

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
  if (campaign.provider === "sendgrid") return { campaign, recipient };
  const userAgent = req.get("user-agent") || "";
  if (/bot|crawler|preview|headless/i.test(userAgent)) return { campaign, recipient };
  const metadata = await engagementMetadata({ ip: req.ip, useragent: userAgent, timestamp: Date.now() / 1000 });
  // One tracked request per recipient/action per five-second window limits scanner refresh duplicates.
  const dedupeKey = `${type}:${recipient._id}:${Math.floor(Date.now() / 5000)}`;
  await CampaignEvent.updateOne(
    { workspaceId: campaign.workspaceId, dedupeKey },
    {
      $setOnInsert: {
        ...scope,
        type,
        occurredAt: new Date(),
        ...metadata,
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
  const { campaign } = await resolveTracking(req.query.token, "unsubscribe");
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" });
  if (req.method === "POST") {
    if (req.body?.confirm !== "unsubscribe" && req.body?.["List-Unsubscribe"] !== "One-Click")
      throw new HttpError(400, "Confirm unsubscribe or use the one-click unsubscribe form");
    await recordTracking(req, "unsubscribe");
    return res.type("html").send("<!doctype html><title>Unsubscribed</title><h1>You have been unsubscribed.</h1><p>You will no longer receive marketing emails from this workspace.</p>");
  }
  const { htmlEscape } = require("./mail.controller");
  const action = "/api/campaign/track-unsubscribe?token=" + encodeURIComponent(req.query.token);
  res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><h1>Unsubscribe from marketing emails</h1><p>Confirm that you want to stop receiving marketing emails from this workspace (campaign: ${htmlEscape(campaign.name)}).</p><form method="post" action="${htmlEscape(action)}"><button name="confirm" value="unsubscribe">Confirm unsubscribe</button></form>`);
}

module.exports = { publicIp, enrichIp, parseAgent, engagementMetadata, anonymizeTrackingMetadata, startMetadataRetention, ...handlers({ trackPixel, trackClick, trackUnsubscribe }), resolveTracking, recordTracking };
