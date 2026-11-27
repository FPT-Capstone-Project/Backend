const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/app-error');

const SNAPSHOT_MAX_BYTES = 10 * 1024 * 1024;
const SNAPSHOT_DOWNLOAD_TIMEOUT_MS = 15000;

function getSafeErrorDetail(error) {
  const message = typeof error?.message === 'string'
    ? error.message
    : 'Unknown upload error';
  return message
    .replace(/https?:\/\/[^\s)]+/gi, '[remote URL]')
    .replace(/\b(api_key|api_secret|signature|token)\b\s*[:=]\s*[^,\s]+/gi, '$1=[redacted]')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 160);
}

function uploadImageBuffer(file, folder, includeUploadErrorDetail) {
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
          reject(includeUploadErrorDetail
            ? new AppError(
              `Failed to upload snapshot to Cloudinary: ${getSafeErrorDetail(error)}`,
              502,
            )
            : new AppError('Failed to upload image to Cloudinary', 500));
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

async function uploadImage(file, folder = 'mushroom-types') {
  return uploadImageBuffer(file, folder, false);
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

async function uploadRemoteImage(imageUrl, folder) {
  let url;
  try {
    url = new URL(imageUrl);
  } catch {
    throw new AppError('Image URL must be a valid HTTPS URL', 400);
  }
  if (url.protocol !== 'https:') {
    throw new AppError('Image URL must be a valid HTTPS URL', 400);
  }

  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new AppError('Cloudinary is not configured', 500);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(SNAPSHOT_DOWNLOAD_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (error) {
    throw new AppError(
      `Unable to download snapshot from Imou cloud: ${getSafeErrorDetail(error)}`,
      502,
    );
  }

  if (!response.ok) {
    throw new AppError(`Imou snapshot download failed (HTTP ${response.status})`, 502);
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
    throw new AppError('Imou cloud returned a non-image snapshot', 502);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > SNAPSHOT_MAX_BYTES) {
    throw new AppError('Imou snapshot exceeds the 10 MB limit', 502);
  }
  if (!response.body) {
    throw new AppError('Imou cloud returned an empty snapshot', 502);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SNAPSHOT_MAX_BYTES) {
        await reader.cancel();
        throw new AppError('Imou snapshot exceeds the 10 MB limit', 502);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      `Unable to read snapshot from Imou cloud: ${getSafeErrorDetail(error)}`,
      502,
    );
  }

  if (size === 0) {
    throw new AppError('Imou cloud returned an empty snapshot', 502);
  }
  return uploadImageBuffer({ buffer: Buffer.concat(chunks, size) }, folder, true);
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
  uploadRemoteImage,
  deleteMedia,
  getPublicIdFromUrl,
};
