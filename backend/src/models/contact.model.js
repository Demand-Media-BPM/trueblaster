const mongoose = require("mongoose");

// Contact documents retain their existing collection and indexes.
const contactSchema = new mongoose.Schema(
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
  },
  { timestamps: true, collection: "contacts" }
);

contactSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("Contact", contactSchema);
