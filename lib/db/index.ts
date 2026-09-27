import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { requireEnv } from '../env';
import * as schema from './schema';

export const db = drizzle(neon(requireEnv('DATABASE_URL')), { schema });
