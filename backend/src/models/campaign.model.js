const mongoose = require("mongoose");

// Campaign documents retain their existing collection and indexes.
const campaignSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    css: { type: String, default: "" },
    listId: { type: mongoose.Schema.Types.ObjectId, ref: "ContactList", required: true },
    listName: { type: String, required: true },
    senderEmail: { type: String, required: true },
    testMode: Boolean,
    testRunId: String,
    provider: String,
    sendgridProject: String,
    senderName: String,
    replyTo: String,
    companyName: String,
    postalAddress: String,
    // Snapshot central settings; never rewrite the campaign's original HTML/CSS.
    compliance: {
      type: new mongoose.Schema({
        companyName: String,
        postalAddress: String,
        approvedPostalAddresses: [String],
        approvedUnsubscribeUrls: [String],
      }, { _id: false }),
      default: undefined,
    },
    unsubscribeGroupId: Number,
    redirectUrl: { type: String, default: "" },
    scheduleTime: { type: Date, required: true },
    status: {
      type: String,
      enum: ["queued", "scheduled", "running", "completed", "failed", "needs_review"],
      default: "queued",
    },
    totalRecipients: { type: Number, default: 0 },
    leaseUntil: Date,
    leaseOwner: String,
    completedAt: Date,
    lastError: { type: String, default: "" },
  },
  { timestamps: true, collection: "campaigns" }
);

campaignSchema.index({ workspaceId: 1, name: 1 }, { unique: true });
campaignSchema.index({ status: 1, scheduleTime: 1, leaseUntil: 1 });

module.exports = mongoose.model("Campaign", campaignSchema);
