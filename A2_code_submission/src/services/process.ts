import sharp from "sharp";
import { s3 } from "./s3.service";
import { Config } from "./config";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

type Op =
  | { op: "resize"; width: number; height: number }
  | { op: "blur"; sigma: number }
  | { op: "sharpen"; sigma?: number };

// helper: convert S3 stream → Buffer
async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (d: Buffer) => chunks.push(d));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Run Sharp pipeline with input/output stored in S3.
 * @param inputKey - S3 key for input (e.g. "seed/seed.png")
 * @param ops - array of processing steps
 * @param outputKey - S3 key for output (e.g. "users/u1/jobs/j1/output.png")
 */
export async function runPipelineS3(inputKey: string, ops: Op[], outputKey: string) {
  const bucket = Config.S3_BUCKET; // ✅ now synchronous

  // 1) read input from S3
  const inputObj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: inputKey }));
  const inputBuf = await streamToBuffer(inputObj.Body as any);

  // 2) run sharp ops
  let img = sharp(inputBuf, { failOn: "none" });
  for (const step of ops) {
    if (step.op === "resize") img = img.resize(step.width, step.height, { fit: "fill" });
    if (step.op === "blur") img = img.blur(step.sigma);
    if (step.op === "sharpen") img = img.sharpen(step.sigma);
  }
  const outputBuf = await img.png().toBuffer();

  // 3) write output to S3
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: outputKey,
      Body: outputBuf,
      ContentType: "image/png",
    })
  );

  return { outputKey };
}