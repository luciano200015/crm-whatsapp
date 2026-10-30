import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { isValidObjectId, mongo, type Connection } from 'mongoose';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MediaStore, type StoredMedia } from '../application/media';

const BUCKET = 'media';

/**
 * Media in MongoDB GridFS (bucket "media"): no extra infrastructure and shared
 * by every API instance. The workspace is stored in the file metadata and
 * checked on every read.
 */
@Injectable()
export class GridFsMediaStore extends MediaStore {
  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  private bucket() {
    const db = this.connection.db;
    if (!db) throw new Error('MongoDB is not connected');
    return new mongo.GridFSBucket(db, { bucketName: BUCKET });
  }

  async put(
    workspaceId: string,
    file: {
      body: Readable | Buffer;
      mimeType: string;
      filename: string | null;
    },
  ): Promise<{ fileId: string; size: number }> {
    const upload = this.bucket().openUploadStream(file.filename ?? 'media', {
      metadata: { workspaceId, mimeType: file.mimeType },
    });
    const source = Buffer.isBuffer(file.body)
      ? Readable.from(file.body)
      : file.body;
    await pipeline(source, upload);
    return { fileId: upload.id.toHexString(), size: upload.length };
  }

  async open(workspaceId: string, fileId: string): Promise<StoredMedia | null> {
    if (!isValidObjectId(fileId)) return null;
    const bucket = this.bucket();
    const _id = new mongo.ObjectId(fileId);
    const [file] = await bucket
      .find({ _id, 'metadata.workspaceId': workspaceId })
      .limit(1)
      .toArray();
    if (!file) return null;
    const metadata = (file.metadata ?? {}) as { mimeType?: string };
    return {
      stream: bucket.openDownloadStream(_id),
      size: file.length,
      mimeType: metadata.mimeType ?? 'application/octet-stream',
      filename: file.filename === 'media' ? null : file.filename,
    };
  }

  async delete(workspaceId: string, fileId: string): Promise<void> {
    if (!isValidObjectId(fileId)) return;
    const bucket = this.bucket();
    const _id = new mongo.ObjectId(fileId);
    const [file] = await bucket
      .find({ _id, 'metadata.workspaceId': workspaceId })
      .limit(1)
      .toArray();
    if (!file) return;
    try {
      await bucket.delete(_id);
    } catch (error: unknown) {
      // Already deleted by another request.
      if (!(error instanceof mongo.MongoRuntimeError)) throw error;
    }
  }
}
