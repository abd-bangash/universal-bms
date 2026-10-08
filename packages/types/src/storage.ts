/** File storage behind an adapter (design.md "Files"): local disk in development, S3-compatible elsewhere. */
export interface StorageAdapter {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  /** A time-limited URL that serves the object without further authentication. */
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** The stored bytes, or null when the object does not exist. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Size and type of a stored object, or null when it does not exist. */
  head(key: string): Promise<{ size: number; mime: string } | null>;
  /** Throws when the storage cannot be used; backs the readiness check. */
  ping(): Promise<void>;
}
