// backend/cloudy.js
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, // from .env
  api_key:    process.env.CLOUDINARY_API_KEY,    // from .env
  api_secret: process.env.CLOUDINARY_API_SECRET, // from .env
});

module.exports = { cloudinary, CloudinaryStorage, multer };


