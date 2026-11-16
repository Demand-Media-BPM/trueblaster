const express = require("express");
const controller = require("../controller/template.controller");

const upload = require("../middleware/upload");
const router = express.Router();

router.get("/search", controller.searchTemplates);
router.get("/", controller.listTemplates);
router.post("/", controller.createTemplate);
router.post("/images", upload.image, controller.uploadImage);
router.put("/:id", controller.updateTemplate);
router.post("/:id/duplicate", controller.duplicateTemplate);
router.delete("/:id", controller.deleteTemplate);
router.patch("/:id/rename", controller.renameTemplate);

const images = express.Router();
images.get("/:filename", controller.getImage);

module.exports = router;
module.exports.images = images;
