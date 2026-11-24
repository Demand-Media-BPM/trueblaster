const axios = require("axios");
const juice = require("juice");
const { sign, verify } = require("../middleware/auth");
const { HttpError, normalizeEmail, required, asyncHandler } = require("../middleware/request");

function checkMailConfig({ preview = false } = {}) {
  if (!preview) require("../config/local-safety").testSettings();
  if (!process.env.SENDGRID_API_KEY || !/^[\w-]{1,80}$/.test(process.env.SENDGRID_PROJECT_ID || ""))
    throw new HttpError(503, "Configure SENDGRID_API_KEY and SENDGRID_PROJECT_ID before sending");
  let url;
  try { url = new URL(process.env.PUBLIC_API_URL || ""); } catch {
    throw new HttpError(503, "PUBLIC_API_URL must be configured before sending");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HttpError(503, "PUBLIC_API_URL must be an HTTP(S) backend URL");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
    throw new HttpError(503, "PUBLIC_API_URL must use HTTPS in production");
  resolveSender();
}

// Only explicitly allowed, authenticated senders may use this integration.
function resolveSender(workspace = {}) {
  const configured = process.env.FROM_EMAIL || "";
  const email = normalizeEmail(workspace.senderEmail || configured);
  const allowed = (process.env.SENDGRID_ALLOWED_SENDERS || configured).split(",").map(v => v.trim().toLowerCase());
  if (!allowed.includes(email)) throw new HttpError(503, "Workspace sender is not allowed for this SendGrid integration");
  return configured.toLowerCase() === email ? configured : email;
}

function checkCampaignConfig(workspace) {
  checkMailConfig();
  if (workspace) resolveSender(workspace);
  require("./sendgrid.controller").verificationKeys();
  const group = process.env.SENDGRID_UNSUBSCRIBE_GROUP_ID;
  if (group && (!/^\d+$/.test(group) || Number(group) < 1 || !Number.isSafeInteger(Number(group))))
    throw new HttpError(503, "SENDGRID_UNSUBSCRIBE_GROUP_ID must be a positive integer");
  normalizeEmail(process.env.REPLY_TO_EMAIL || process.env.FROM_EMAIL);
}

function htmlEscape(value) {
  return String(value || "").replace(/[&<>"']/g,
    char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function trackingUrl(campaign, recipient, action) {
  const token = sign({ workspaceId: String(campaign.workspaceId), campaignId: String(campaign._id),
    recipientId: String(recipient._id), action }, "tracking");
  return `${process.env.PUBLIC_API_URL.replace(/\/$/, "")}/api/campaign/track-${action}?token=${encodeURIComponent(token)}`;
}

// These values are administrator-controlled. Campaign request fields cannot approve an address or URL.
function configuredList(value, name) {
  if (value === undefined || value === "") return [];
  let values = value;
  if (typeof value === "string") {
    try { values = JSON.parse(value); } catch {
      throw new HttpError(503, `${name} must be a JSON array of approved values`);
    }
  }
  if (!Array.isArray(values) || values.length > 100 || values.some(item => typeof item !== "string"))
    throw new HttpError(503, `${name} must contain at most 100 approved strings`);
  return values.map(item => item.trim()).filter(Boolean);
}

function usablePostalAddress(value) {
  return typeof value === "string" && value.trim().length >= 10 && value.length <= 2000 && /[\p{L}]/u.test(value) && !/[<>{}]/.test(value) &&
    !/{{|<%|\b(?:placeholder|tbd|todo)\b|your\s+(?:(?:company|postal|mailing|street)\s+)?address|address\s+here|(?:automated\s+)?test\s+address|^n\/?a$/i.test(value);
}

function complianceConfig(workspace = {}, campaign = {}) {
  let source;
  if (campaign.compliance) source = campaign.compliance;
  else if (workspace.compliance) source = workspace.compliance;
  else if (campaign.postalAddress) source = { companyName: campaign.companyName, postalAddress: campaign.postalAddress };
  else source = {
    companyName: process.env.COMPANY_NAME,
    postalAddress: process.env.COMPANY_POSTAL_ADDRESS,
    approvedPostalAddresses: process.env.COMPLIANCE_APPROVED_POSTAL_ADDRESSES,
    approvedUnsubscribeUrls: process.env.COMPLIANCE_APPROVED_UNSUBSCRIBE_URLS,
  };
  return {
    companyName: typeof source.companyName === "string" ? source.companyName.trim() : "",
    postalAddress: typeof source.postalAddress === "string" ? source.postalAddress.trim() : "",
    approvedPostalAddresses: configuredList(source.approvedPostalAddresses, "Approved postal addresses"),
    approvedUnsubscribeUrls: configuredList(source.approvedUnsubscribeUrls, "Approved unsubscribe URLs"),
  };
}

function emailDocument(source, css = "") {
  const head = `<meta charset="UTF-8">${css ? `<style>${css}</style>` : ""}`;
  if (/<html\b/i.test(source)) {
    if (!css) return source;
    if (/<\/head\s*>/i.test(source)) return source.replace(/<\/head\s*>/i, close => `<style>${css}</style>${close}`);
    return source.replace(/<html\b[^>]*>/i, open => `${open}<head>${head}</head>`);
  }
  if (/<body\b/i.test(source)) return `<!doctype html><html><head>${head}</head>${source}</html>`;
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`;
}

function appendToEmail(document, suffix) {
  if (!suffix) return document;
  if (/<\/body\s*>/i.test(document)) return document.replace(/<\/body\s*>/i, close => suffix + close);
  if (/<\/html\s*>/i.test(document)) return document.replace(/<\/html\s*>/i, close => suffix + close);
  return document + suffix;
}

function normalizedText(value) {
  return ` ${String(value).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") || ""} `;
}

function visibleDocument(document) {
  const $ = require("cheerio").load(document);
  const hidesSubtree = style => /(?:display\s*:\s*none|opacity\s*:\s*0(?:\.0+)?(?:\s|;|!|$))/i.test(style || "");
  $("html,body").each((_, element) => {
    if ($(element).attr("hidden") !== undefined || hidesSubtree($(element).attr("style")))
      throw new HttpError(422, "Email template hides its message body. Make the email body visible before sending.");
  });
  $("head,script,style,template,noscript,iframe,object,svg,[hidden],[aria-hidden='true']").remove();
  $("*").each((_, element) => {
    if (hidesSubtree($(element).attr("style"))) $(element).remove();
  });
  const inherited = (element, property) => {
    for (let parent = element; parent && parent.type !== "root"; parent = parent.parent) {
      const value = String($(parent).css(property) || "").replace(/\s*!important/gi, "").trim();
      if (value && !/^(?:inherit|unset)$/i.test(value)) return value;
    }
    return "";
  };
  // A zero-font container can have visible children with their own font size (common in emails).
  // Check inherited text visibility rather than discarding the entire container and its valid footer.
  $("body").find("*").addBack().contents().each((_, node) => {
    if (node.type !== "text") return;
    const size = inherited(node.parent, "font-size");
    const visibility = inherited(node.parent, "visibility");
    if ((size && Number.parseFloat(size) === 0) || /^(?:hidden|collapse)$/i.test(visibility)) $(node).remove();
  });
  $("br").replaceWith(" ");
  $("p,div,address,td,li,tr,section,footer,h1,h2,h3").append(" ");
  return $;
}

function nativeUnsubscribeToken(token, config, campaign) {
  if (campaign?.provider !== "sendgrid" || !Number.isSafeInteger(campaign.unsubscribeGroupId) || campaign.unsubscribeGroupId < 1)
    return false;
  if (["<%asm_group_unsubscribe_raw_url%>", "<%asm_group_unsubscribe_url%>", "<%asm_preferences_raw_url%>"].includes(token)) return true;
  // A global account opt-out can affect other projects, so require explicit central approval.
  return ["<%asm_global_unsubscribe_raw_url%>", "<%asm_global_unsubscribe_url%>"].includes(token) && config.approvedUnsubscribeUrls.includes(token);
}

function trustedUnsubscribeLink(href, config, campaign, recipient) {
  if (typeof href !== "string") return false;
  if (["<%asm_group_unsubscribe_raw_url%>", "<%asm_global_unsubscribe_raw_url%>", "<%asm_preferences_raw_url%>"].includes(href))
    return nativeUnsubscribeToken(href, config, campaign);
  try {
    const url = new URL(href);
    if (url.username || url.password) return false;
    if (campaign && recipient) {
      const own = new URL(trackingUrl(campaign, recipient, "unsubscribe"));
      if (url.origin === own.origin && url.pathname === own.pathname) {
        const token = verify(url.searchParams.get("token"), "tracking");
        return token.action === "unsubscribe" && token.workspaceId === String(campaign.workspaceId) &&
          token.campaignId === String(campaign._id) && token.recipientId === String(recipient._id);
      }
    }
    // External endpoints are accepted only after an administrator verifies the opt-out flow and suppression sync.
    const mailtoAllowed = url.protocol === "mailto:" && Boolean(normalizeEmail(decodeURIComponent(url.pathname)));
    const protocolAllowed = url.protocol === "https:" || mailtoAllowed ||
      (process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    return protocolAllowed && config.approvedUnsubscribeUrls.includes(href);
  } catch { return false; }
}

function inspectCompliance(document, config, campaign, recipient) {
  // Full ASM tags become links at SendGrid. Mark only literal tags in the inspection copy;
  // escaped examples, comments and hidden tags must not count as a working visible link.
  const markers = [];
  let inspectionCopy = document;
  for (const token of ["<%asm_group_unsubscribe_url%>", "<%asm_global_unsubscribe_url%>"]) {
    if (nativeUnsubscribeToken(token, config, campaign)) {
      const marker = require("crypto").randomUUID();
      inspectionCopy = inspectionCopy.split(token).join(marker);
      markers.push(marker);
    }
  }
  const $ = visibleDocument(inspectionCopy);
  const text = normalizedText($("body").text());
  const approved = [config.postalAddress, ...config.approvedPostalAddresses].filter(usablePostalAddress);
  const hasAddress = approved.some(address => text.includes(normalizedText(address)));
  if (!hasAddress && !usablePostalAddress(config.postalAddress))
    throw new HttpError(503, "Sender postal address cannot be established for this template. Ask an administrator to configure workspace compliance or COMPANY_POSTAL_ADDRESS, or approve the template's existing address.");
  const hasUnsubscribe = markers.some(marker => $("body").text().includes(marker)) || $("a[href]").toArray().some(element => {
    const link = $(element);
    const label = link.text().trim() || link.find("img[alt]").attr("alt");
    return Boolean(label) && trustedUnsubscribeLink(link.attr("href"), config, campaign, recipient);
  });
  return { hasAddress, hasUnsubscribe };
}

function validateTemplateCompliance(html, css, config) {
  // Inlining occurs on an inspection copy only; the stored HTML and CSS are untouched.
  return inspectCompliance(juice(emailDocument(html, css), { removeStyleTags: false }), config);
}

function complianceFooter(document, config, campaign, recipient, unsubscribeUrl) {
  const { hasAddress, hasUnsubscribe } = inspectCompliance(document, config, campaign, recipient);
  if (hasAddress && hasUnsubscribe) return "";
  const company = /{{|<%|\bplaceholder\b|your\s+company|^(?:company name|tbd|n\/?a)$/i.test(config.companyName) ? "" : config.companyName;
  const visible = "display:block!important;visibility:visible!important;opacity:1!important;font-size:12px!important";
  const style = `${visible};margin:16px 0 0;padding:8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#666;text-align:center`;
  const address = hasAddress ? "" : `<div style="${visible}">${company ? `${htmlEscape(company)} &middot; ` : ""}${htmlEscape(config.postalAddress)}</div>`;
  const link = hasUnsubscribe ? "" : `<div style="${visible}"><a href="${htmlEscape(unsubscribeUrl)}" clicktracking="off" style="${visible};color:#666;text-decoration:underline">Unsubscribe</a></div>`;
  return `<div data-trueblaster-compliance="footer" style="${style}">${address}${link}</div>`;
}

function render(campaign, recipient, test = false) {
  const sendgrid = campaign.provider === "sendgrid";
  const links = {
    pixel: test || sendgrid ? "" : trackingUrl(campaign, recipient, "pixel"),
    click: test || sendgrid ? campaign.redirectUrl || "#" : trackingUrl(campaign, recipient, "click"),
    unsubscribe: test ? "#" : trackingUrl(campaign, recipient, "unsubscribe"),
  };
  const custom = recipient.customFields instanceof Map ? Object.fromEntries(recipient.customFields) : recipient.customFields || {};
  const replacements = {
    ...Object.fromEntries(Object.entries(custom).filter(([key]) => /^[a-zA-Z]\w*$/.test(key)).map(([key, value]) => [key, htmlEscape(value)])),
    firstName: htmlEscape(recipient.firstName), lastName: htmlEscape(recipient.lastName),
    email: htmlEscape(recipient.email), companyName: htmlEscape(recipient.companyName),
    trackingPixelUrl: htmlEscape(links.pixel), clickUrl: htmlEscape(links.click), unsubscribeUrl: htmlEscape(links.unsubscribe),
  };
  let source = campaign.html;
  // SendGrid adds the only engagement pixel for new campaigns; retain legacy routes for old emails.
  if (sendgrid) source = source.replace(/<img\b[^>]*\{\{\s*trackingPixelUrl\s*\}\}[^>]*>/gi, "");
  let body = source.replace(/{{\s*(\w+)\s*}}/g, (whole, key) => replacements[key] === undefined ? whole : replacements[key]);
  // Preserve full documents and their embedded styles; fragments receive a single document wrapper.
  let document = juice(emailDocument(body, campaign.css || ""), { removeStyleTags: false });
  if (!test) {
    const config = complianceConfig({}, campaign);
    document = appendToEmail(document, complianceFooter(document, config, campaign, recipient, links.unsubscribe));
    if (!sendgrid && !/{{\s*trackingPixelUrl\s*}}/.test(source))
      document = appendToEmail(document, `<img src="${htmlEscape(links.pixel)}" width="1" height="1" alt="" />`);
  }
  return document;
}

function buildPayload(campaign, recipient, test = false) {
  const senderEmail = resolveSender({ senderEmail: campaign.senderEmail });
  if (!test && (!campaign.sendgridProject || !recipient.sendAttemptId))
    throw new HttpError(503, "Campaign must have a persisted SendGrid project and send attempt");
  const custom_args = test ? { tb_project: process.env.SENDGRID_PROJECT_ID, tb_message_kind: "test" } : {
    tb_project: campaign.sendgridProject, tb_workspace_id: String(campaign.workspaceId),
    tb_campaign_id: String(campaign._id), tb_recipient_id: String(recipient._id), tb_attempt_id: recipient.sendAttemptId,
    tb_message_kind: "campaign",
  };
  const snapshot = typeof campaign.toObject === "function" ? campaign.toObject() : campaign;
  const payload = {
    personalizations: [{ to: [{ email: recipient.email }], custom_args }],
    from: { email: senderEmail, name: campaign.senderName || process.env.FROM_NAME || "TrueBlaster" },
    reply_to: { email: normalizeEmail(campaign.replyTo || process.env.REPLY_TO_EMAIL || senderEmail) },
    subject: campaign.subject,
    content: [{ type: "text/html", value: render({ ...snapshot, provider: "sendgrid" }, recipient, test) }],
    tracking_settings: { open_tracking: { enable: true }, click_tracking: { enable: true, enable_text: true },
      subscription_tracking: { enable: false }, ganalytics: { enable: false } },
  };
  if (!test) {
    const url = trackingUrl(campaign, recipient, "unsubscribe");
    payload.headers = { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    if (campaign.unsubscribeGroupId) payload.asm = { group_id: campaign.unsubscribeGroupId };
  }
  // Never bypass SendGrid suppression lists or change account-wide settings.
  return payload;
}

async function sendEmail(campaign, recipient, test = false, transport = axios) {
  checkMailConfig({ preview: test });
  require("../config/local-safety").assertSend(campaign, recipient, test);
  // Offline fake transports are used only by tests; real marketing requests require reachable-form public links.
  if (!test && transport === axios) require("../config/local-safety").assertPublicEmailOrigin();
  const payload = buildPayload(campaign, recipient, test);
  let result;
  try {
    result = await transport.post("https://api.sendgrid.com/v3/mail/send", payload, {
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      timeout: 30000, maxRedirects: 0, validateStatus: () => true,
    });
  } catch {
    const error = new Error("SendGrid request interrupted; verify delivery before retrying");
    error.name = "SendGridUncertainError";
    throw error;
  }
  if (result.status !== 202) {
    const error = new Error(`SendGrid returned HTTP ${Number(result.status) || "unknown"}; review provider configuration or delivery status`);
    error.name = "SendGridSendError";
    // Only an explicit rejection is safe to classify as not sent. No automatic retries.
    error.definiteRejection = result.status >= 400 && result.status < 500;
    throw error;
  }
  return typeof result.headers?.["x-message-id"] === "string" ? result.headers["x-message-id"] : undefined;
}

async function sendTestMail(req, res) {
  const senderEmail = resolveSender(req.workspace);
  if (req.body.sender && normalizeEmail(req.body.sender) !== normalizeEmail(senderEmail))
    throw new HttpError(400, "Use the sender configured for this workspace");
  const email = normalizeEmail(req.body.receiver);
  const Suppression = require("../models/suppression.model");
  if (await Suppression.exists({ workspaceId: req.auth.workspaceId, email }))
    throw new HttpError(400, "Recipient is suppressed in this workspace");
  await sendEmail({ senderEmail, subject: required(req.body.subject, "Subject", 998),
    html: required(req.body.body, "Body", 1000000), css: String(req.body.style || "") },
  { email, firstName: "Tester" }, true);
  res.json({ success: true });
}

module.exports = { complianceConfig, validateTemplateCompliance, inspectCompliance, checkMailConfig, checkCampaignConfig, resolveSender, htmlEscape, sendEmail, buildPayload, render, trackingUrl, sendTestMail: asyncHandler(sendTestMail) };
