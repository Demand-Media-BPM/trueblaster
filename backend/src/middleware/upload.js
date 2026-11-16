const fs = require("fs");
const path = require("path");
const multer = require("multer");

// Store temporary spreadsheets outside src and limit uploads to one 10 MB file.
const uploadDir = path.join(__dirname, "../../uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const imageUpload = multer({ dest: uploadDir, limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single("file");

// Keep the image limit and its error message separate from spreadsheet imports.
upload.image = (req, res, next) => imageUpload(req, res, error => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    const { HttpError } = require("./request");
    return next(new HttpError(413, "Choose an image up to 5 MB"));
  }
  next(error);
});

module.exports = upload;
