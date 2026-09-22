const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/app-error');

async function uploadImage(file, folder = 'mushroom-types') {
  if (!file) return null;

  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new AppError('Cloudinary is not configured', 500);
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          reject(new AppError('Failed to upload image to Cloudinary', 500));
          return;
        }

        if (!result || !result.secure_url) {
          reject(new AppError('Cloudinary returned an empty image URL', 500));
          return;
        }

        resolve(result.secure_url);
      },
    );

    uploadStream.end(file.buffer);
  });
}

module.exports = { uploadImage };
