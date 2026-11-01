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

async function uploadMedia(file, folder) {
  if (!file) throw new AppError('Media file is required', 400);

  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new AppError('Cloudinary is not configured', 500);
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => {
        if (error) {
          reject(new AppError('Failed to upload media to Cloudinary', 500));
          return;
        }
        if (!result || !result.secure_url || !result.public_id) {
          reject(new AppError('Cloudinary returned incomplete media information', 500));
          return;
        }
        resolve({
          mediaUrl: result.secure_url,
          publicId: result.public_id,
          mediaType: file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE',
          resourceType: result.resource_type,
        });
      },
    );

    uploadStream.end(file.buffer);
  });
}

async function deleteMedia(publicId, resourceType) {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new AppError('Cloudinary is not configured', 500);
  }
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
  if (!result || !['ok', 'not found'].includes(result.result)) {
    throw new AppError('Failed to delete media from Cloudinary', 502);
  }
}

function getPublicIdFromUrl(mediaUrl) {
  let url;
  try {
    url = new URL(mediaUrl);
  } catch {
    return null;
  }
  if (url.hostname !== 'res.cloudinary.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const uploadIndex = segments.indexOf('upload');
  if (uploadIndex < 0) return null;
  const publicIdSegments = segments.slice(uploadIndex + 1);
  if (publicIdSegments[0] && /^v\d+$/.test(publicIdSegments[0])) {
    publicIdSegments.shift();
  }
  if (publicIdSegments.length === 0) return null;

  const lastSegment = publicIdSegments[publicIdSegments.length - 1];
  const extensionIndex = lastSegment.lastIndexOf('.');
  if (extensionIndex > 0) {
    publicIdSegments[publicIdSegments.length - 1] = lastSegment.slice(0, extensionIndex);
  }
  return publicIdSegments.join('/') || null;
}

module.exports = {
  uploadImage,
  uploadMedia,
  deleteMedia,
  getPublicIdFromUrl,
};
