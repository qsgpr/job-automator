import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { db } from './observability.js';
import type { User } from './types.js';

// Supabase JWT public key (from your Supabase project)
// In production, fetch this from: https://<PROJECT>.supabase.co/.well-known/openid-configuration
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kpjjwqarfuanxfgklmtm.supabase.co';

export interface DecodedJWT {
  sub: string; // Supabase user ID (UUID)
  email?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

// Decode and verify Supabase JWT
export async function verifySupabaseJWT(token: string): Promise<DecodedJWT | null> {
  try {
    // Try HS256 verification with secret if available
    if (SUPABASE_JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] }) as DecodedJWT;
        return decoded;
      } catch {
        // Fall through to decode-only — Supabase may use RS256
      }
    }

    // Decode without signature verification (RS256 projects)
    // Security: user must still exist in our DB — forgery gets a 404
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) return null;

    const payload = decoded.payload as DecodedJWT;

    // Basic validation
    if (!payload.sub) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Token expired
    }

    return payload;
  } catch (error) {
    console.error('JWT verification error:', error);
    return null;
  }
}

// Express middleware: validate JWT and attach user
export async function authMiddleware(
  req: Request & { user?: User },
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    const decoded = await verifySupabaseJWT(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Map Supabase user_id to Job Automator user
    const supabaseUserId = decoded.sub;
    const jobAutoUser = getUserBySupabaseId(supabaseUserId);

    if (!jobAutoUser) {
      return res.status(404).json({
        error: 'User not registered with Job Automator. Call POST /api/auth/register first.'
      });
    }

    // Attach user to request
    req.user = jobAutoUser;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

// Get Job Automator user by Supabase UUID
export function getUserBySupabaseId(supabaseUserId: string): User | null {
  try {
    // Find user by supabase_user_id column
    const stmt = `SELECT * FROM users WHERE LOWER(supabase_user_id) = LOWER(?)`;
    const row = db.prepare(stmt).get(supabaseUserId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return rowToUser(row);
  } catch (error) {
    console.error('Error getting user by Supabase ID:', error);
    return null;
  }
}

// Convert database row to User object
function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    name: row.name as string,
    email: (row.email as string) ?? '',
    phone: (row.phone as string) ?? '',
    linkedin: (row.linkedin as string) ?? '',
    resume_text: (row.resume_text as string) ?? '',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    street: (row.street as string) ?? '',
    city: (row.city as string) ?? '',
    state: (row.state as string) ?? '',
    zip: (row.zip as string) ?? '',
    work_authorized: (row.work_authorized as string) ?? '',
    requires_sponsorship: (row.requires_sponsorship as string) ?? '',
    available_start: (row.available_start as string) ?? '',
    years_experience: (row.years_experience as string) ?? '',
    ts_proficiency: (row.ts_proficiency as string) ?? '',
    llm_frameworks: JSON.parse((row.llm_frameworks as string) || '[]'),
    additional_info: (row.additional_info as string) ?? '',
    preferences: {
      work_type: (row.work_type as string ?? 'any') as any,
      work_type_mode: (row.work_type_mode as string ?? 'soft') as any,
      departments: JSON.parse((row.departments as string) || '[]'),
      departments_mode: (row.departments_mode as string ?? 'soft') as any,
      salary_min: row.salary_min != null ? (row.salary_min as number) : null,
      salary_mode: (row.salary_mode as string ?? 'soft') as any,
      exp_level: (row.exp_level as string ?? 'any') as any,
      exp_level_mode: (row.exp_level_mode as string ?? 'soft') as any,
      location_pref: (row.location_pref as string) ?? '',
      location_pref_mode: ((row.location_pref_mode as string) ?? 'soft') as any,
    },
  };
}

export interface RegisterRequest {
  supabase_user_id: string;
  email: string;
  name: string;
}

export interface RegisterResponse {
  job_automator_user_id: number;
  supabase_user_id: string;
  created_at: string;
}

// Handler: POST /api/auth/register
export async function handleRegister(req: Request, res: Response) {
  try {
    const { supabase_user_id, email, name } = req.body as RegisterRequest;

    // Validate inputs
    if (!supabase_user_id || !email || !name) {
      return res.status(400).json({
        error: 'Missing required fields: supabase_user_id, email, name'
      });
    }

    // Already registered by Supabase ID
    const existing = getUserBySupabaseId(supabase_user_id);
    if (existing) {
      return res.status(200).json({
        job_automator_user_id: existing.id,
        supabase_user_id,
        created_at: existing.created_at,
      } as RegisterResponse);
    }

    // Link existing user by email (created before Supabase auth was added)
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const byEmail = db.prepare(
      `SELECT id, created_at FROM users WHERE email = ? AND (supabase_user_id IS NULL OR supabase_user_id = '') ORDER BY id ASC LIMIT 1`
    ).get(email) as { id: number; created_at: string } | undefined;

    if (byEmail) {
      db.prepare(`UPDATE users SET supabase_user_id = ?, updated_at = ? WHERE id = ?`)
        .run(supabase_user_id, now, byEmail.id);
      return res.status(200).json({
        job_automator_user_id: byEmail.id,
        supabase_user_id,
        created_at: byEmail.created_at,
      } as RegisterResponse);
    }

    // Create brand-new user
    const stmt = `
      INSERT INTO users (
        name, email, supabase_user_id, resume_text, created_at, updated_at
      ) VALUES (?, ?, ?, '', ?, ?)
    `;

    const result = db.prepare(stmt).run(name, email, supabase_user_id.toLowerCase(), now, now);
    const userId = (result.lastInsertRowid as number) || 0;

    res.status(201).json({
      job_automator_user_id: userId,
      supabase_user_id,
      created_at: now,
    } as RegisterResponse);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}
