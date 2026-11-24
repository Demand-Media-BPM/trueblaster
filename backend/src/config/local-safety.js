const { HttpError, normalizeEmail } = require("../middleware/request");

function testMode() {
  // Normal campaigns use the same flow locally and in production. Test limits are opt-in.
  return process.env.SENDGRID_TEST_MODE === "true";
}

function testSettings() {
  if (process.env.NODE_ENV === "development" && !/-(?:local|test)$/.test(process.env.SENDGRID_PROJECT_ID || ""))
    throw new HttpError(503, "Local SENDGRID_PROJECT_ID must end in -local or -test");
  if (!testMode()) return null;
  const allowlist = new Set((process.env.SENDGRID_TEST_RECIPIENT_ALLOWLIST || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
  if (!allowlist.size || [...allowlist].some(v => { try { return normalizeEmail(v) !== v; } catch { return true; } }))
    throw new HttpError(503, "Configure an explicit SENDGRID_TEST_RECIPIENT_ALLOWLIST before controlled testing");
  const max = Number(process.env.SENDGRID_TEST_MAX_RECIPIENTS || 3);
  if (!Number.isSafeInteger(max) || max < 1 || max > 10)
    throw new HttpError(503, "SENDGRID_TEST_MAX_RECIPIENTS must be between 1 and 10");
  const runId = process.env.SENDGRID_TEST_RUN_ID;
  if (!/^[\w-]{8,100}$/.test(runId || ""))
    throw new HttpError(503, "Configure a distinct SENDGRID_TEST_RUN_ID before controlled testing");
  if (process.env.NODE_ENV !== "production" && !/-(?:local|test)$/.test(process.env.SENDGRID_PROJECT_ID || ""))
    throw new HttpError(503, "Local SENDGRID_PROJECT_ID must end in -local or -test");
  return { allowlist, max, runId };
}

function assertRecipients(recipients) {
  const settings = testSettings();
  if (!settings) return;
  if (recipients.length > settings.max)
    throw new HttpError(400, `Controlled test campaigns allow at most ${settings.max} recipients`);
  if (recipients.some(r => !settings.allowlist.has(String(r.email).trim().toLowerCase())))
    throw new HttpError(400, "Every recipient must be explicitly allowed in SENDGRID_TEST_RECIPIENT_ALLOWLIST");
}

function assertSend(campaign, recipient, preview = false) {
  // A manually requested preview may target any valid receiver; bulk safety remains separate.
  if (preview) { normalizeEmail(recipient.email); return; }
  const settings = testSettings();
  if (!settings) {
    if (campaign.testMode) throw new HttpError(503, "Test campaigns cannot be sent by the normal campaign worker");
    if (campaign.sendgridProject !== process.env.SENDGRID_PROJECT_ID)
      throw new HttpError(503, "Campaign belongs to another SendGrid project");
    normalizeEmail(recipient.email);
    return;
  }
  assertRecipients([recipient]);
  if (!preview && (!campaign.testMode || campaign.testRunId !== settings.runId ||
      campaign.sendgridProject !== process.env.SENDGRID_PROJECT_ID ||
      !Number.isInteger(campaign.totalRecipients) || campaign.totalRecipients > settings.max))
    throw new HttpError(503, "Campaign is outside this controlled test run; create a new local campaign");
}

function usingSharedDatabaseLocally(uri = process.env.MONGO_URI) {
  if (process.env.NODE_ENV !== "development" || process.env.ALLOW_PRODUCTION_DATABASE_LOCAL !== "true") return false;
  try { return decodeURIComponent(new URL(uri).pathname.slice(1)) === "trueblaster"; } catch { return false; }
}

function assertLocalDatabase(uri) {
  if (process.env.NODE_ENV === "production") return;
  let url;
  try { url = new URL(uri); } catch { throw new Error("Invalid local MONGO_URI"); }
  const database = decodeURIComponent(url.pathname.slice(1));
  if (usingSharedDatabaseLocally(uri)) return;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (process.env.NODE_ENV === "test" && loopback && /_tests$/.test(database)) return;
  if (database !== (process.env.LOCAL_TEST_DATABASE_NAME || "trueblaster_local") || database === "trueblaster")
    throw new Error("Local MONGO_URI must select an isolated trueblaster_local database; set ALLOW_PRODUCTION_DATABASE_LOCAL=true in development to explicitly use the shared trueblaster database");
}

function assertPublicEmailOrigin(value = process.env.PUBLIC_API_URL) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(503, "Set PUBLIC_API_URL to the public HTTPS tunnel origin before marketing delivery"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") ||
      require("net").isIP(host.replace(/^\[|\]$/g, "")) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host))
    throw new HttpError(503, "Set PUBLIC_API_URL to the public HTTPS tunnel origin before marketing delivery");
}

module.exports = { usingSharedDatabaseLocally, assertPublicEmailOrigin, testMode, testSettings, assertRecipients, assertSend, assertLocalDatabase };
