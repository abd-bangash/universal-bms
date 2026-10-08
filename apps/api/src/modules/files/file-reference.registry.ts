import { Injectable } from '@nestjs/common';

/**
 * Modules whose records hold a file id (issued documents, messages ...) register a check here so
 * that a file they use cannot be deleted (Requirement 34.8). Message attachments are built in.
 */
@Injectable()
export class FileReferenceRegistry {
  private readonly checks = new Map<string, (fileId: string) => Promise<boolean>>();

  register(name: string, isReferenced: (fileId: string) => Promise<boolean>): void {
    this.checks.set(name, isReferenced);
  }

  async isReferenced(fileId: string): Promise<boolean> {
    for (const check of this.checks.values()) if (await check(fileId)) return true;
    return false;
  }
}
