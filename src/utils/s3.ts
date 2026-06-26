import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const REGION = process.env.AWS_REGION || 'ap-south-1';
const BUCKET = process.env.AWS_S3_BUCKET || 'biddaro-uploads';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export function isS3Configured(): boolean {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/** Upload a raw buffer to S3 and return its public URL. */
export async function uploadBufferToS3(
  buffer: Buffer,
  contentType: string,
  ext: string,
  folder = 'uploads',
): Promise<string> {
  const key = `${folder}/${uuidv4()}.${ext.replace(/^\./, '')}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}
