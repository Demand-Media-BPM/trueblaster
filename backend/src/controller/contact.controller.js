const fs = require("fs/promises");
const xlsx = require("xlsx");
const mongoose = require("mongoose");
const Contact = require("../models/contact.model");
const ContactList = require("../models/contactList.model");
const ListMembership = require("../models/listMembership.model");
const { handlers, required, escapeRegex, HttpError, normalizeEmail } = require("../middleware/request");

// Contact imports and list management.
async function uploadContacts(req, res) {
  try {
    if (!req.file) throw new HttpError(400, "A contact spreadsheet is required");
    const name = required(req.body.listName, "List name", 150);
    let rows;
    try {
      const workbook = xlsx.readFile(req.file.path, { sheetRows: 20002 });
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    } catch {
      throw new HttpError(400, "Upload a readable CSV or Excel contact spreadsheet");
    }
    if (!rows.length || rows.length > 20000)
      throw new HttpError(400, "Upload between 1 and 20,000 contacts per file");
    // Normalize and deduplicate by email before writing the imported list.
    const contacts = [
      ...new Map(
        rows.map((row, i) => {
          try {
            const item = profile(row);
            return [item.email, item];
          } catch {
            throw new HttpError(400, `Invalid or missing email on spreadsheet row ${i + 2}`);
          }
        })
      ).values(),
    ];
    const workspaceId = req.auth.workspaceId;
    // Save contacts and memberships together so failed imports cannot leave partial lists.
    await mongoose.connection.transaction(async (session) => {
      const list = await ContactList.findOneAndUpdate(
        { workspaceId, name },
        { $setOnInsert: { workspaceId, name } },
        { upsert: true, new: true, session }
      );
      await Contact.bulkWrite(
        contacts.map((data) => ({
          updateOne: {
            filter: { workspaceId, email: data.email },
            update: { $set: data, $setOnInsert: { workspaceId } },
            upsert: true,
          },
        })),
        { session }
      );
      const saved = await Contact.find({
        workspaceId,
        email: { $in: contacts.map((c) => c.email) },
      })
        .session(session)
        .select("_id");
      await ListMembership.bulkWrite(
        saved.map((contact) => ({
          updateOne: {
            filter: { workspaceId, listId: list._id, contactId: contact._id },
            update: { $setOnInsert: { workspaceId, listId: list._id, contactId: contact._id } },
            upsert: true,
          },
        })),
        { session }
      );
    });
    res.json({ success: true, imported: contacts.length });
  } finally {
    if (req.file) await fs.unlink(req.file.path).catch(() => { });
  }
}

async function listContactLists(req, res) {
  const workspaceId = req.auth.workspaceId;
  const query = { workspaceId };
  if (req.query.search) query.name = { $regex: escapeRegex(req.query.search), $options: "i" };
  const lists = await ContactList.find(query).sort({ createdAt: -1 }).lean();
  const counts = await ListMembership.aggregate([
    { $match: { workspaceId } },
    { $group: { _id: "$listId", count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json(
    lists.map((list) => ({
      listName: list.name,
      count: byId.get(String(list._id)) || 0,
      createdAt: list.createdAt,
    }))
  );
}

async function viewListData(req, res) {
  const workspaceId = req.auth.workspaceId;
  const list = await ContactList.findOne({
    workspaceId,
    name: required(req.query.listName, "List name", 150),
  });
  if (!list) throw new HttpError(404, "Contact list not found");
  const links = await ListMembership.find({ workspaceId, listId: list._id }).limit(100).lean();
  const contacts = await Contact.find({
    workspaceId,
    _id: { $in: links.map((m) => m.contactId) },
  }).lean();
  res.json(contacts.map(legacyContact));
}

// List removal keeps shared contacts and historical campaign recipients intact.
async function deleteContactList(req, res) {
  const workspaceId = req.auth.workspaceId;
  await mongoose.connection.transaction(async (session) => {
    const list = await ContactList.findOneAndDelete(
      { workspaceId, name: required(req.body.listName, "List name", 150) },
      { session }
    );
    if (!list) throw new HttpError(404, "Contact list not found");
    await ListMembership.deleteMany({ workspaceId, listId: list._id }).session(session);
  });
  res.json({ success: true });
}

// Normalize uploaded contacts and preserve frontend response fields.
function profile(input) {
  const pick = (...keys) =>
    String(keys.map((k) => input[k]).find((v) => v != null) || "")
      .trim()
      .slice(0, 1000);
  const customFields = {};
  if (
    input.customFields &&
    typeof input.customFields === "object" &&
    !Array.isArray(input.customFields)
  ) {
    for (const [key, value] of Object.entries(input.customFields).slice(0, 50)) {
      if (/^[a-zA-Z][a-zA-Z0-9_ -]{0,99}$/.test(key) && !["constructor", "prototype"].includes(key))
        customFields[key] = String(value).slice(0, 1000);
    }
  }
  return {
    email: normalizeEmail(input.email || input.Email),
    firstName: pick("firstName", "FirstName"),
    lastName: pick("lastName", "LastName"),
    contactNo: pick("contactNo", "ContactNo"),
    jobTitle: pick("jobTitle", "JobTitle"),
    companyName: pick("companyName", "CompanyName"),
    linkedin: pick("linkedin", "LinkdinLink", "LinkedinLink", "LinkedIn"),
    customFields,
  };
}

function legacyContact(doc) {
  return {
    _id: doc._id,
    FirstName: doc.firstName,
    LastName: doc.lastName,
    Email: doc.email,
    ContactNo: doc.contactNo,
    JobTitle: doc.jobTitle,
    CompanyName: doc.companyName,
    LinkdinLink: doc.linkedin,
    LinkedinLink: doc.linkedin,
    LinkedIn: doc.linkedin,
    createdAt: doc.createdAt,
    CampaignId: doc.campaignName || "",
    CampaignName: doc.campaignName || "",
    UnsubscribeOn: doc.createdAt,
  };
}

module.exports = { ...handlers({ uploadContacts, listContactLists, viewListData, deleteContactList }), profile, legacyContact };
