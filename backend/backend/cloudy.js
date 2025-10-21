// backend/backend/cloudy.js
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Reusable storage for gallery uploads (you can tweak folder name)
const galleryStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "meadhall/gallery",
    resource_type: "image",
    overwrite: false,
  },
});

const uploadCloud = multer({
  storage: galleryStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

module.exports = { cloudinary, uploadCloud };



