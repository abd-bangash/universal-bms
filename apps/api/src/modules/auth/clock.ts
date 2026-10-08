import { Injectable } from '@nestjs/common';

/** Source of the current time; replaced in tests to exercise expiry without waiting. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
