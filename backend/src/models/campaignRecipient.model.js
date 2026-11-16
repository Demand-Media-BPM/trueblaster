const mongoose = require("mongoose");

// CampaignRecipient documents retain their existing collection and indexes.
const campaignRecipientSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    contactNo: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    companyName: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    customFields: { type: Map, of: String, default: {} },
    status: {
      type: String,
      enum: [
        "pending",
        "sending",
        "accepted",
        "delivered",
        "bounced",
        "failed",
        "skipped",
        "unknown",
      ],
      default: "pending",
    },
    messageId: String,
    sendAt: Date,
    attemptedAt: Date,
    error: { type: String, default: "" },
    skipReason: { type: String, default: "" },
    bounceStatus: { type: String, enum: ["NA", "hard", "soft", "no", "dnd"], default: "NA" },
    unsubscribe: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "campaign_recipients" }
);

campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, email: 1 }, { unique: true });
campaignRecipientSchema.index({ workspaceId: 1, campaignId: 1, status: 1 });
campaignRecipientSchema.index({ messageId: 1 }, { sparse: true });

module.exports = mongoose.model("CampaignRecipient", campaignRecipientSchema);
