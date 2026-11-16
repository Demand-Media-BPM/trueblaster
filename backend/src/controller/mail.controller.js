const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const juice = require("juice");
const { sign } = require("../middleware/auth");
const { HttpError, normalizeEmail, required, asyncHandler } = require("../middleware/request");
let client;

function checkMailConfig() {
  if (
    !process.env.FORCE_SES_REGION ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY
  )
    throw new HttpError(503, "AWS SES credentials and region must be configured before sending");
  let url;
  try {
    url = new URL(process.env.PUBLIC_API_URL || "");
  } catch {
    throw new HttpError(503, "PUBLIC_API_URL must be configured before sending");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new HttpError(503, "PUBLIC_API_URL must be an HTTP(S) backend URL");
}

function htmlEscape(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

function trackingUrl(campaign, recipient, action) {
  const token = sign(
    {
      workspaceId: String(campaign.workspaceId),
      campaignId: String(campaign._id),
      recipientId: String(recipient._id),
      action,
    },
    "tracking"
  );
  return `${process.env.PUBLIC_API_URL.replace(/\/$/, "")}/api/campaign/track-${action}?token=${encodeURIComponent(token)}`;
}

// Build recipient-specific HTML and signed tracking links from the saved campaign.
function render(campaign, recipient, test = false) {
  const links = test
    ? { pixel: "", click: campaign.redirectUrl || "#", unsubscribe: "#" }
    : {
      pixel: trackingUrl(campaign, recipient, "pixel"),
      click: trackingUrl(campaign, recipient, "click"),
      unsubscribe: trackingUrl(campaign, recipient, "unsubscribe"),
    };
  const custom =
    recipient.customFields instanceof Map
      ? Object.fromEntries(recipient.customFields)
      : recipient.customFields || {};
  const replacements = {
    ...Object.fromEntries(
      Object.entries(custom)
        .filter(([key]) => /^[a-zA-Z]\w*$/.test(key))
        .map(([key, value]) => [key, htmlEscape(value)])
    ),
    firstName: htmlEscape(recipient.firstName || ""),
    lastName: htmlEscape(recipient.lastName || ""),
    email: htmlEscape(recipient.email),
    companyName: htmlEscape(recipient.companyName),
    trackingPixelUrl: htmlEscape(links.pixel),
    clickUrl: htmlEscape(links.click),
    unsubscribeUrl: htmlEscape(links.unsubscribe),
  };
  let body = campaign.html.replace(/{{\s*(\w+)\s*}}/g, (whole, key) =>
    replacements[key] === undefined ? whole : replacements[key]
  );
  if (!test && !campaign.html.includes("{{trackingPixelUrl}}"))
    body += `<img src="${htmlEscape(links.pixel)}" width="1" height="1" alt="" />`;
  if (!test && !campaign.html.includes("{{unsubscribeUrl}}"))
    body += `<p><a href="${htmlEscape(links.unsubscribe)}">Unsubscribe</a></p>`;
  return juice(
    `<!doctype html><html><head><meta charset="UTF-8"><style>${campaign.css || ""}</style></head><body>${body}</body></html>`
  );
}

async function sendEmail(campaign, recipient, test = false) {
  checkMailConfig();
  if (!client)
    client = new SESClient({
      region: process.env.FORCE_SES_REGION,
      maxAttempts: 1,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  const result = await client.send(
    new SendEmailCommand({
      Source: campaign.senderEmail,
      Destination: { ToAddresses: [recipient.email] },
      Message: {
        Subject: { Charset: "UTF-8", Data: campaign.subject },
        Body: { Html: { Charset: "UTF-8", Data: render(campaign, recipient, test) } },
      },
      ...(test
        ? {}
        : {
          Tags: [
            { Name: "workspace", Value: String(campaign.workspaceId) },
            { Name: "campaign", Value: String(campaign._id) },
            { Name: "recipient", Value: String(recipient._id) },
          ],
        }),
    }),
    { abortSignal: AbortSignal.timeout(30000) }
  );
  return result.MessageId;
}

// Send a preview using the workspace sender.
async function sendTestMail(req, res) {
  const senderEmail = normalizeEmail(req.workspace.senderEmail || process.env.FROM_EMAIL);
  if (req.body.sender && normalizeEmail(req.body.sender) !== senderEmail)
    throw new HttpError(400, "Use the sender configured for this workspace");
  const email = normalizeEmail(req.body.receiver);
  await sendEmail(
    {
      senderEmail,
      subject: required(req.body.subject, "Subject", 998),
      html: required(req.body.body, "Body", 1000000),
      css: String(req.body.style || ""),
    },
    { email, firstName: "Tester" },
    true
  );
  res.json({ success: true });
}

module.exports = { checkMailConfig, sendEmail, render, trackingUrl, sendTestMail: asyncHandler(sendTestMail) };
