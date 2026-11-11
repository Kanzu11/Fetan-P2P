import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

// Configure Cloudinary from environment variables
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export type UploadFolder =
  | 'fetan_p2p/kyc'
  | 'fetan_p2p/chat'
  | 'fetan_p2p/receipts'
  | 'fetan_p2p/disputes'
  | 'fetan_p2p/general';

export interface CloudinaryUploadResult {
  success: boolean;
  url: string;
  secureUrl: string;
  publicId: string;
  format?: string;
  bytes?: number;
}

export class CloudinaryService {
  isConfigured(): boolean {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );
  }

  /**
   * Upload base64 / Data URI string directly to Cloudinary
   */
  async uploadDataUri(
    dataUri: string,
    folder: UploadFolder = 'fetan_p2p/general'
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      throw new Error('Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured.');
    }

    try {
      const response: UploadApiResponse = await cloudinary.uploader.upload(dataUri, {
        folder,
        resource_type: 'image',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf', 'heic'],
        transformation: [
          { quality: 'auto:good', fetch_format: 'auto' }
        ]
      });

      return {
        success: true,
        url: response.secure_url || response.url,
        secureUrl: response.secure_url,
        publicId: response.public_id,
        format: response.format,
        bytes: response.bytes,
      };
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      throw new Error(err instanceof Error ? err.message : 'Failed to upload image to Cloudinary.');
    }
  }

  /**
   * Upload Buffer to Cloudinary
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: UploadFolder = 'fetan_p2p/general',
    mimeType = 'image/jpeg'
  ): Promise<CloudinaryUploadResult> {
    const base64 = buffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64}`;
    return this.uploadDataUri(dataUri, folder);
  }
}

export const cloudinaryService = new CloudinaryService();

