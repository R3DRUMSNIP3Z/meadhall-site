// backend/cloudy.js
const cloudinary = require("cloudinary").v2;

const required = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

for (const k of required) {
  if (!process.env[k] || String(process.env[k]).trim() === "") {
    throw new Error(`Missing required env var: ${k}`);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = { cloudinary };





