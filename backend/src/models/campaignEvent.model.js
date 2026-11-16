const mongoose = require("mongoose");

// CampaignEvent documents retain their existing collection and indexes.
const campaignEventSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "CampaignRecipient", required: true },
    type: {
      type: String,
      enum: ["open", "click", "unsubscribe", "delivery", "bounce", "complaint"],
      required: true,
    },
    occurredAt: { type: Date, default: Date.now },
    dedupeKey: String,
    ip: { type: String, default: "" },
    city: { type: String, default: "" },
    region: { type: String, default: "" },
    country: { type: String, default: "" },
    device: { type: String, default: "" },
    browser: { type: String, default: "" },
    os: { type: String, default: "" },
  },
  { timestamps: true, collection: "campaign_events" }
);

campaignEventSchema.index({ workspaceId: 1, campaignId: 1, recipientId: 1, type: 1 });
campaignEventSchema.index({ workspaceId: 1, campaignId: 1, occurredAt: -1 });
campaignEventSchema.index({ workspaceId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });

module.exports = mongoose.model("CampaignEvent", campaignEventSchema);
