const mongoose = require("mongoose");

// Suppression documents retain their existing collection and indexes.
const suppressionSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    contactNo: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    companyName: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    customFields: { type: Map, of: String, default: {} },
    reason: {
      type: String,
      enum: ["blocked", "unsubscribed", "hard_bounce", "complaint"],
      required: true,
    },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: false },
    campaignName: { type: String, default: "" },
  },
  { timestamps: true, collection: "suppressions" }
);

suppressionSchema.index({ workspaceId: 1, email: 1, reason: 1 }, { unique: true });
suppressionSchema.index({ workspaceId: 1, reason: 1, createdAt: -1 });

module.exports = mongoose.model("Suppression", suppressionSchema);
