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
  region: "sa-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey:process.env.AWS_SECRET_KEY
  }
});

const BUCKET ="onces3";

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
  region: "sa-east-1",
});

const BUCKET = "onces3";
    await s3.send(new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key
    }));
  }

  async getSignedUrl(key) {
    const s3 = new S3Client({
  region: "sa-east-1",
});

const BUCKET = "onces3";

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    });

    return await getSignedUrl(s3, command, { expiresIn: 3600 });
  }
}