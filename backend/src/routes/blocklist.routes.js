const express = require("express");
const { blocked: controller } = require("../controller/suppression.controller");

const router = express.Router();

router.post("/upload", controller.add);
router.get("/list", controller.list);
router.get("/search", controller.search);
router.delete("/remove/:id", controller.remove);

module.exports = router;
