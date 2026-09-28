import { randomBytes } from 'node:crypto';

// Independent of the clip id, so a share link reveals nothing that could reach other API routes.
export function newShareToken(): string {
  return randomBytes(16).toString('base64url');
}
