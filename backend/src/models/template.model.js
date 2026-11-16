const mongoose = require("mongoose");

// Template documents retain their existing collection and indexes.
const templateSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    name: { type: String, required: true, trim: true },
    html: { type: String, default: "" },
    css: { type: String, default: "" },
  },
  { timestamps: true, collection: "templates" }
);

templateSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model("Template", templateSchema);
