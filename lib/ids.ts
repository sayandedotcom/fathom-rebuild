import { z } from 'zod';

const uuid = z.uuid();

export function isUuid(s: string): boolean {
  return uuid.safeParse(s).success;
}
