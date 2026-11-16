const express = require("express");
const { unsubscribed: controller } = require("../controller/suppression.controller");

const router = express.Router();

router.get("/list", controller.list);
router.post("/upload", controller.add);
router.get("/search", controller.search);
router.delete("/remove/:id", controller.remove);

module.exports = router;
