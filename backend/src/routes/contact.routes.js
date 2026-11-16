const express = require("express");
const controller = require("../controller/contact.controller");

const upload = require("../middleware/upload");

const router = express.Router();

router.post("/upload-contact", upload.single("file"), controller.uploadContacts);
router.get("/lists", controller.listContactLists);
router.get("/view-list-data", controller.viewListData);
router.delete("/delete-list", controller.deleteContactList);

module.exports = router;
