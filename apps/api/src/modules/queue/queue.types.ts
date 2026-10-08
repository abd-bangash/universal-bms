/** The queues of design.md "Background Jobs", and the one failed jobs end up in. */
export const QUEUE_NAMES = [
  'channel.inbound',
  'channel.outbound',
  'ai.process',
  'commission.calculate',
  'report.generate',
  'email.send',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export const DEAD_LETTER_QUEUE = 'dead-letter';

/** Every job says which workspace it is for, so the work runs inside that workspace's context. */
export interface JobPayload {
  workspaceId: string;
  /** The person on whose behalf the work is done, if any (audit and permissions context). */
  actorUserId?: string | null;
  [key: string]: unknown;
}

export interface JobInfo {
  name: string;
  attemptsMade: number;
}

export interface ProcessorDefinition<P extends JobPayload = JobPayload> {
  queue: QueueName;
  /** How many tries a job gets before it is moved to the dead-letter queue. */
  attempts?: number;
  /** Delay before the first retry, doubling each time (milliseconds). */
  backoffMs?: number;
  concurrency?: number;
  handler(payload: P, job: JobInfo): Promise<void>;
}

export interface DeadLetter {
  queue: string;
  jobName: string;
  payload: JobPayload;
  error: string;
  attempts: number;
  failedAt: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}
