import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ValidationFailedException } from '../../common/errors/app.exception';

const MIN_LENGTH = 10;
const MAX_LENGTH = 200;

/** Cheaper parameters under test so suites stay fast; production uses the argon2id defaults. */
const OPTIONS: argon2.Options =
  process.env.NODE_ENV === 'test'
    ? { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 }
    : { type: argon2.argon2id };

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real verification, so an unknown account is not detectable by timing. */
  private dummyHash?: Promise<string>;
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /** Requirement 45.1: at least 10 characters and different from the email. */
  assertPolicy(password: string, email: string): void {
    const problems: string[] = [];
    if (password.length < MIN_LENGTH) problems.push(`must be at least ${MIN_LENGTH} characters`);
    if (password.length > MAX_LENGTH) problems.push(`must be at most ${MAX_LENGTH} characters`);
    if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
      problems.push('must differ from the email address');
    }
    if (problems.length > 0) throw new ValidationFailedException({ password: problems });
  }
}
