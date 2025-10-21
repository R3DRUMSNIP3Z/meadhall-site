// backend/backend/cloudy.js
const cloudinary = require("cloudinary").v2;

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const API_KEY    = process.env.CLOUDINARY_API_KEY || "";
const API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

const HAVE_CLOUD = !!(CLOUD_NAME && API_KEY && API_SECRET);

if (HAVE_CLOUD) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
  });
}

module.exports = { cloudinary, HAVE_CLOUD };




