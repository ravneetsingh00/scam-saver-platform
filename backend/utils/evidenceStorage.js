const crypto = require('crypto');
const path = require('path');

let cloudinary;
function isCloudinaryConfigured() {
  return Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
}
function cloudinaryClient() {
  if (!isCloudinaryConfigured()) throw Object.assign(new Error('Cloud evidence storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the root .env.'), { status: 503 });
  if (!cloudinary) {
    const sdk = require('cloudinary').v2;
    if (process.env.CLOUDINARY_URL) sdk.config({ url: process.env.CLOUDINARY_URL, secure: true });
    else sdk.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
    cloudinary = sdk;
  }
  return cloudinary;
}
function resourceType(mimeType) {
  if (String(mimeType).startsWith('image/')) return 'image';
  if (String(mimeType).startsWith('audio/') || String(mimeType).startsWith('video/')) return 'video';
  return 'raw';
}
function extension(filename) { return path.extname(filename || '').replace(/^\./, '').toLowerCase(); }
function deterministicPublicId(reportId, filename) {
  const hash = crypto.createHash('sha256').update(`${reportId}\0${filename}`).digest('hex');
  return `scam-saver/evidence/${hash}`;
}
function uploadBuffer(buffer, options) {
  const client = cloudinaryClient();
  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream({
      resource_type: options.resourceType || resourceType(options.mimeType),
      type: 'authenticated',
      public_id: options.publicId, overwrite: false, unique_filename: false,
      filename_override: options.originalName,
      context: { original_filename: options.originalName, mime_type: options.mimeType },
    }, (error, result) => error ? reject(error) : resolve(result));
    stream.end(buffer);
  });
}
async function uploadLocalFile(filePath, options) {
  const client = cloudinaryClient();
  const result = await client.uploader.upload(filePath, {
    resource_type: options.resourceType || resourceType(options.mimeType),
    type: 'authenticated',
    public_id: options.publicId, overwrite: false, unique_filename: false,
    filename_override: options.originalName,
    context: { original_filename: options.originalName, mime_type: options.mimeType },
  });
  return result;
}
function privateDownloadUrl(item, expiresInSeconds = 900) {
  const client = cloudinaryClient();
  const format = item.format || extension(item.originalName || item.filename) || 'bin';
  return client.utils.private_download_url(item.publicId, format, {
    resource_type: item.resourceType || resourceType(item.mimeType),
    type: item.deliveryType || 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    attachment: false,
  });
}
module.exports = { isCloudinaryConfigured, cloudinaryClient, resourceType, extension, deterministicPublicId, uploadBuffer, uploadLocalFile, privateDownloadUrl };
