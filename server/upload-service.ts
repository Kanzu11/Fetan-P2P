import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type UploadFolder = 'kyc' | 'receipts' | 'general';

export interface LocalUploadResult {
  url: string;
  filename: string;
  size: number;
  format: string;
}

export class UploadService {
  private getUploadDir(folder: UploadFolder): string {
    const dir = path.join(process.cwd(), 'public', 'uploads', folder);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getExtensionFromMime(mime: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
    };
    return map[mime.toLowerCase()] || 'jpg';
  }

  /**
   * Saves a binary Buffer directly into public/uploads/<folder>/<filename>
   */
  async uploadBuffer(
    buffer: Buffer,
    folder: UploadFolder = 'general',
    mimeType: string = 'image/jpeg'
  ): Promise<LocalUploadResult> {
    try {
      const ext = this.getExtensionFromMime(mimeType);
      const randomSuffix = crypto.randomBytes(8).toString('hex');
      const filename = `${Date.now()}-${randomSuffix}.${ext}`;
      const uploadDir = this.getUploadDir(folder);
      const filePath = path.join(uploadDir, filename);

      await fs.promises.writeFile(filePath, buffer);

      const publicUrl = `/uploads/${folder}/${filename}`;
      return {
        url: publicUrl,
        filename,
        size: buffer.length,
        format: ext,
      };
    } catch (err) {
      console.warn('Local disk write failed, falling back to data URI:', err);
      // Fallback: return data URI if filesystem is read-only
      const base64 = buffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64}`;
      return {
        url: dataUri,
        filename: `inline-${Date.now()}`,
        size: buffer.length,
        format: 'base64',
      };
    }
  }

  /**
   * Saves a Data URI / Base64 string directly into public/uploads/<folder>/
   */
  async uploadDataUri(
    dataUri: string,
    folder: UploadFolder = 'general'
  ): Promise<LocalUploadResult> {
    const matches = dataUri.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const mimeType = matches[1];
      const buffer = Buffer.from(matches[2], 'base64');
      return this.uploadBuffer(buffer, folder, mimeType);
    }

    // Raw base64 string
    const buffer = Buffer.from(dataUri, 'base64');
    return this.uploadBuffer(buffer, folder, 'image/jpeg');
  }
}

export const uploadService = new UploadService();

