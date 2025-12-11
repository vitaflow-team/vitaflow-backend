import { Storage } from '@google-cloud/storage';
import { Injectable } from '@nestjs/common';

@Injectable()
export class UploadService {
  private storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    },
  });

  private bucket = this.storage.bucket(process.env.GCP_BUCKET!);

  async uploadImage(file: Express.Multer.File): Promise<string> {
    const filename = `${Date.now()}-${file.originalname}`;
    const blob = this.bucket.file(filename);

    const stream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    return new Promise((resolve, reject) => {
      stream.on('finish', () => {
        void (() => {
          resolve(
            `https://storage.googleapis.com/${this.bucket.name}/${filename}`,
          );
        })();
      });

      stream.on('error', reject);
      stream.end(file.buffer);
    });
  }

  async getSignedUrl(filename: string): Promise<string> {
    if (!filename) {
      return '';
    }

    const objectName = filename.split('/').pop()!;

    const options = {
      version: 'v4' as const,
      action: 'read' as const,
      expires: Date.now() + 60 * 60 * 1000,
    };

    const [url] = await this.bucket.file(objectName).getSignedUrl(options);

    return url;
  }
}
