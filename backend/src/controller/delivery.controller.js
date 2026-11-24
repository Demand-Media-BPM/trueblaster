const crypto = require("crypto");
const { HttpError } = require("../middleware/request");
const Campaign = require("../models/campaign.model");
const CampaignRecipient = require("../models/campaignRecipient.model");
const Suppression = require("../models/suppression.model");
const Workspace = require("../models/workspace.model");
const mail = require("./mail.controller");
const instance = crypto.randomUUID();
const LEASE_MS = 120000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberSetting(key, fallback, max) {
  const n = Number(process.env[key]);
  return Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
}

async function processCampaign(campaign, owner, sendEmail = mail.sendEmail) {
  const scope = { workspaceId: campaign.workspaceId, campaignId: campaign._id };
  const lock = {
    _id: campaign._id,
    workspaceId: campaign.workspaceId,
    leaseOwner: owner,
    status: "running",
  };
  let lost = false,
    heartbeatBusy = false;
  // Renew the campaign lease while sending; stop delivery if ownership is lost.
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      const result = await Campaign.updateOne(lock, {
        $set: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      if (!result.matchedCount) lost = true;
    } catch {
      lost = true;
    } finally {
      heartbeatBusy = false;
    }
  }, 15000);
  heartbeat.unref();
  try {
    // A crash after provider acceptance cannot be safely retried automatically.
    await CampaignRecipient.updateMany(
      { ...scope, status: "sending" },
      {
        $set: {
          status: "unknown",
          error: "Previous send was interrupted; verify delivery before retrying",
        },
      }
    );
    const batchSize = numberSetting("CAMPAIGN_BATCH_SIZE", 4, 100);
    const concurrency = numberSetting("CAMPAIGN_CONCURRENCY", 2, 10);
    while (!lost) {
      const batch = await CampaignRecipient.find({ ...scope, status: "pending" })
        .sort({ _id: 1 })
        .limit(batchSize);
      if (!batch.length) break;
      for (let i = 0; i < batch.length && !lost; i += concurrency) {
        await Promise.all(
          batch.slice(i, i + concurrency).map(async (recipient) => {
            if (lost) return;
            const workspace = await Workspace.findOne({ _id: campaign.workspaceId, active: true });
            if (!workspace) throw new Error("Workspace is disabled");
            if (!(await Campaign.exists({ ...lock, leaseUntil: { $gt: new Date() } }))) {
              lost = true;
              return;
            }
            const claimed = await CampaignRecipient.findOneAndUpdate(
              { ...scope, _id: recipient._id, status: "pending" },
              { $set: { status: "sending", attemptedAt: new Date(), sendAttemptId: crypto.randomUUID(), provider: "sendgrid" } },
              { new: true }
            );
            if (!claimed) return;
            // Recheck immediately before sending because recipients may have opted out after scheduling.
            const suppression = await Suppression.findOne({
              workspaceId: campaign.workspaceId,
              email: claimed.email,
            });
            if (suppression) {
              await CampaignRecipient.updateOne(
                { ...scope, _id: claimed._id, status: "sending" },
                {
                  $set: {
                    status: "skipped",
                    skipReason: suppression.reason,
                    bounceStatus: "dnd",
                    unsubscribe: suppression.reason === "unsubscribed",
                  },
                }
              );
              return;
            }
            let messageId;
            try {
              const snapshot = campaign.toObject();
              mail.checkCampaignConfig(workspace);
              require("../config/local-safety").assertSend(snapshot, claimed);
              // Old queued campaigns can inherit workspace configuration without changing stored content.
              snapshot.compliance = mail.complianceConfig(workspace, campaign);
              messageId = await sendEmail(snapshot, claimed);
            } catch (error) {
              const definite = error.definiteRejection === true || error instanceof HttpError;
              await CampaignRecipient.updateOne(
                { ...scope, _id: claimed._id, status: "sending" },
                {
                  $set: {
                    status: definite ? "failed" : "unknown",
                    error: /^(SendGrid|HttpError)/.test(error.name) || error instanceof HttpError ? String(error.message).slice(0, 500) : "Provider request interrupted; verify delivery before retrying",
                  },
                }
              );
              return;
            }
            // If persistence fails, leave this recipient in 'sending'; recovery marks it unknown instead of resending.
            await CampaignRecipient.updateOne(
              { ...scope, _id: claimed._id, status: "sending" },
              { $set: { status: "accepted", messageId, sendAt: new Date(), deliveryStatus: "accepted" } }
            );
          })
        );
      }
      if (!lost && (await CampaignRecipient.exists({ ...scope, status: "pending" })))
        await sleep(numberSetting("CAMPAIGN_BATCH_DELAY_MS", 30000, 300000));
    }
    if (lost) return;
    const uncertain = await CampaignRecipient.exists({
      ...scope,
      status: { $in: ["unknown", "sending"] },
    });
    const failed = await CampaignRecipient.exists({ ...scope, status: "failed" });
    await Campaign.updateOne(lock, {
      $set: {
        status: uncertain ? "needs_review" : failed ? "failed" : "completed",
        completedAt: new Date(),
      },
      $unset: { leaseOwner: 1, leaseUntil: 1 },
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function startWorker() {
  let busy = false,
    stopping = false;
  async function tick() {
    if (busy || stopping) return;
    try {
      mail.checkCampaignConfig();
    } catch {
      return;
    }
    busy = true;
    let campaign;
    try {
      // Only this project's new SendGrid campaigns may be claimed. Legacy SES queues require manual review.
      campaign = await Campaign.findOneAndUpdate(
        {
          ...(require("../config/local-safety").testMode() ? { testMode: true, testRunId: process.env.SENDGRID_TEST_RUN_ID } : { testMode: { $ne: true } }),
          provider: "sendgrid",
          sendgridProject: process.env.SENDGRID_PROJECT_ID,
          scheduleTime: { $lte: new Date() },
          $or: [
            { status: { $in: ["queued", "scheduled"] } },
            { status: "running", leaseUntil: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            status: "running",
            leaseOwner: instance,
            leaseUntil: new Date(Date.now() + LEASE_MS),
          },
        },
        { new: true, sort: { scheduleTime: 1 } }
      );
      if (campaign) await processCampaign(campaign, instance);
    } catch (error) {
      console.error("Campaign worker failed:", error.name);
      if (campaign)
        await Campaign.updateOne(
          { _id: campaign._id, workspaceId: campaign.workspaceId, leaseOwner: instance },
          {
            $set: {
              lastError: "Worker interrupted; pending recipients will resume after lease expiry",
            },
          }
        ).catch(() => { });
    } finally {
      busy = false;
    }
  }
  const interval = setInterval(tick, 2000);
  interval.unref();
  tick();
  return async () => {
    stopping = true;
    clearInterval(interval);
    while (busy) await sleep(100);
  };
}

module.exports = { startWorker, processCampaign };
