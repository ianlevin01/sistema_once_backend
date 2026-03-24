import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuid } from "uuid";


export default class S3Service {

  async upload(file) {
    const s3 = new S3Client({
  region: process.env.AWS_REGION || "sa-east-1",
});

const BUCKET = process.env.AWS_BUCKET;

    const key = `products/${uuid()}-${file.originalname}`;

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    }));

    return key;
  }

  async delete(key) {
    const s3 = new S3Client({
  region: process.env.AWS_REGION || "sa-east-1",
});

const BUCKET = process.env.AWS_BUCKET;
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    }));
  }

  async getSignedUrl(key) {
    const s3 = new S3Client({
  region: process.env.AWS_REGION || "sa-east-1",
});

const BUCKET = process.env.AWS_BUCKET;

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    });

    return await getSignedUrl(s3, command, { expiresIn: 3600 });
  }
}