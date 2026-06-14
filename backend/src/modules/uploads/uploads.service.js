const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const crypto = require('crypto');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME;
const PREFIX = process.env.S3_UPLOAD_PREFIX || 'uploads';
const MAX_SIZE_MB = parseInt(process.env.UPLOAD_MAX_SIZE_MB || '10', 10);
const URL_EXPIRY_SECONDS = 300; // 5 minutes

/**
 * Generates a pre-signed S3 PUT URL for direct browser uploads.
 * @param {object} params
 * @param {string} params.fileName - Original file name (used for extension only)
 * @param {string} params.contentType - MIME type e.g. "image/jpeg"
 * @param {string} [params.itemId] - Optional item ID for folder structure
 * @param {string} [params.userId] - Optional user ID for folder structure
 * @returns {{ uploadUrl: string, key: string, publicUrl: string }}
 */
const generatePresignedUrl = async ({ fileName, contentType, itemId, userId = 'anonymous' }) => {
  const ext = path.extname(fileName) || '.jpg';
  const uniqueId = crypto.randomBytes(8).toString('hex');
  const safeItemId = itemId || 'misc';

  // Key format: uploads/{userId}/{itemId}/{uniqueId}{ext}
  const key = `${PREFIX}/${userId}/${safeItemId}/${uniqueId}${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    // Do NOT set ContentLength on a presigned URL — S3 enforces it exactly,
    // so any file smaller than MAX_SIZE_MB would be rejected with a 403.
    // The browser sends the real Content-Length header automatically.
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: URL_EXPIRY_SECONDS });

  const publicUrl = `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${key}`;

  return { uploadUrl, key, publicUrl };
};

module.exports = { generatePresignedUrl };
