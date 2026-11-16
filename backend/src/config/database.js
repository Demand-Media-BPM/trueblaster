const mongoose = require("mongoose");
const models = {
  Workspace: require("../models/workspace.model"),
  User: require("../models/user.model"),
  Contact: require("../models/contact.model"),
  ContactList: require("../models/contactList.model"),
  ListMembership: require("../models/listMembership.model"),
  Template: require("../models/template.model"),
  Campaign: require("../models/campaign.model"),
  CampaignRecipient: require("../models/campaignRecipient.model"),
  CampaignEvent: require("../models/campaignEvent.model"),
  Suppression: require("../models/suppression.model"),
};

async function connectDatabase() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  for (const model of Object.values(models)) await model.init();
}

module.exports = { connectDatabase };
