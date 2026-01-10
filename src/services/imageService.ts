import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

// Image size configurations
const IMAGE_SIZES = {
  primary: 512,   // Main logo
  medium: 128,    // Medium thumbnail
  small: 64,      // Small thumbnail (for lists)
} as const;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: 'jpeg';
}

export interface UploadResult {
  logoImageUrl: string;
  logoImageKey: string;
  thumbnails: {
    small: string;
    medium: string;
  };
}

// Lazy-initialized S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      // Credentials will be picked up from environment or IAM role
    });
  }
  return s3Client;
}

/**
 * Validates an image buffer by checking magic bytes and file size
 */
export function validateImage(buffer: Buffer, _mimeType?: string): { valid: boolean; error?: string } {
  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return { valid: false, error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
  }

  if (buffer.length === 0) {
    return { valid: false, error: 'Empty file' };
  }

  // Check magic bytes for JPEG
  const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

  // Check magic bytes for PNG
  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const isPng = buffer.slice(0, 8).equals(pngMagic);

  // Check for HEIC/HEIF (ftyp box with heic/mif1 brand)
  const isHeic = buffer.length > 12 &&
    buffer.slice(4, 8).toString() === 'ftyp' &&
    (buffer.slice(8, 12).toString() === 'heic' ||
     buffer.slice(8, 12).toString() === 'mif1' ||
     buffer.slice(8, 12).toString() === 'heix');

  if (!isJpeg && !isPng && !isHeic) {
    return { valid: false, error: 'Invalid image format. Only JPEG, PNG, and HEIC are allowed.' };
  }

  return { valid: true };
}

/**
 * Processes an image: resize to square, strip EXIF, convert to JPEG
 */
export async function processImage(buffer: Buffer, size: number): Promise<ProcessedImage> {
  const processed = await sharp(buffer)
    // Remove EXIF and other metadata (privacy)
    .rotate() // Auto-rotate based on EXIF orientation before stripping
    .removeAlpha() // Remove alpha channel for JPEG output
    .resize(size, size, {
      fit: 'cover',      // Crop to fill the square
      position: 'centre', // Center the crop
    })
    .jpeg({
      quality: 85,
      mozjpeg: true, // Better compression
    })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: processed.data,
    width: processed.info.width,
    height: processed.info.height,
    format: 'jpeg',
  };
}

/**
 * Process an image into all required sizes
 */
export async function processImageAllSizes(buffer: Buffer): Promise<Map<string, ProcessedImage>> {
  const results = new Map<string, ProcessedImage>();

  // Process all sizes in parallel
  const [primary, medium, small] = await Promise.all([
    processImage(buffer, IMAGE_SIZES.primary),
    processImage(buffer, IMAGE_SIZES.medium),
    processImage(buffer, IMAGE_SIZES.small),
  ]);

  results.set('primary', primary);
  results.set('medium', medium);
  results.set('small', small);

  return results;
}

/**
 * Upload processed images to S3
 */
export async function uploadToS3(
  merchantId: string,
  images: Map<string, ProcessedImage>
): Promise<UploadResult> {
  const client = getS3Client();
  const bucket = config.aws.s3BucketProfiles;
  const timestamp = Date.now();

  // S3 keys for each size
  const keys = {
    primary: `merchants/${merchantId}/logo.jpg`,
    medium: `merchants/${merchantId}/logo_128.jpg`,
    small: `merchants/${merchantId}/logo_64.jpg`,
  };

  // Upload all sizes in parallel
  const uploadPromises = [
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: keys.primary,
      Body: images.get('primary')!.buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=86400', // 24 hours
    })),
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: keys.medium,
      Body: images.get('medium')!.buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=86400',
    })),
    client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: keys.small,
      Body: images.get('small')!.buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=86400',
    })),
  ];

  await Promise.all(uploadPromises);

  // Generate CDN URLs with cache-busting timestamp
  const cdnBase = config.cdnBaseUrl;

  return {
    logoImageUrl: `${cdnBase}/${keys.primary}?v=${timestamp}`,
    logoImageKey: keys.primary,
    thumbnails: {
      medium: `${cdnBase}/${keys.medium}?v=${timestamp}`,
      small: `${cdnBase}/${keys.small}?v=${timestamp}`,
    },
  };
}

/**
 * Delete logo images from S3
 */
export async function deleteFromS3(merchantId: string): Promise<void> {
  const client = getS3Client();
  const bucket = config.aws.s3BucketProfiles;

  // Keys to delete
  const keys = [
    `merchants/${merchantId}/logo.jpg`,
    `merchants/${merchantId}/logo_128.jpg`,
    `merchants/${merchantId}/logo_64.jpg`,
  ];

  // Delete all sizes in parallel
  const deletePromises = keys.map(key =>
    client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }))
  );

  await Promise.all(deletePromises);
}

/**
 * Generate initials color deterministically from merchantId
 */
export function generateInitialsColor(merchantId: string): string {
  const colors = [
    '#E53935', '#D81B60', '#8E24AA', '#5E35B1',
    '#3949AB', '#1E88E5', '#039BE5', '#00ACC1',
    '#00897B', '#43A047', '#7CB342', '#C0CA33',
    '#FDD835', '#FFB300', '#FB8C00', '#F4511E',
  ];

  // Simple hash from merchantId
  const hash = merchantId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

/**
 * Full upload flow: validate, process, upload
 */
export async function uploadMerchantLogo(
  merchantId: string,
  imageBuffer: Buffer,
  mimeType?: string
): Promise<UploadResult> {
  // Validate
  const validation = validateImage(imageBuffer, mimeType);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Process all sizes
  const processedImages = await processImageAllSizes(imageBuffer);

  // Upload to S3
  const result = await uploadToS3(merchantId, processedImages);

  return result;
}
