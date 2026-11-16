const mongoose = require("mongoose");

// Workspace documents retain their existing collection and indexes.
const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    active: { type: Boolean, default: true },
    senderEmail: { type: String, default: "" },
  },
  { timestamps: true, collection: "workspaces" }
);

workspaceSchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model("Workspace", workspaceSchema);
