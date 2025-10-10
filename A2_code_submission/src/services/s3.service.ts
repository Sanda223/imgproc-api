// src/services/s3.service.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Config } from "./config"; // ✅ cached values after loadConfig()

const REGION = process.env.AWS_REGION || "ap-southeast-2";
export const s3 = new S3Client({ region: REGION });

export async function presignUpload(
  key: string,
  contentType = "application/octet-stream"
) {
  const bucket = Config.S3_BUCKET; // ✅ safe to access here
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 }); // 5 min
}

export async function presignDownload(key: string) {
  const bucket = Config.S3_BUCKET; // ✅ safe to access here
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3, cmd, { expiresIn: 300 });
}