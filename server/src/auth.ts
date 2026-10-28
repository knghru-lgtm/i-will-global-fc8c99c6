import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from './config.ts';
import { one } from './db/index.ts';

export type Role = 'admin' | 'manager' | 'licensed_agent' | 'scheduler';
export interface AuthUser { id: string; name: string; email: string; role: Role; states: string[] }

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export const hashPassword = (p: string) => bcrypt.hashSync(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compareSync(p, h);

export function signToken(u: { id: string; role: string }) {
  return jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, { expiresIn: '7d' });
}

export function publicUser(u: any) {
  if (!u) return null;
  const { password_hash, google_tokens, ...rest } = u;
  const username = u.email ? u.email.split('@')[0].toLowerCase() : 'agent';
  const defaultMeet = u.email?.toLowerCase().endsWith(`@${config.google.allowedDomain}`) ? `https://meet.google.com/iwg-${username}` : null;
  return {
    ...rest,
    caller_id_name: u.caller_id_name || 'Medicare Helpline by IWG',
    cnam: u.cnam || 'MEDICARE BY IWG',
    spam_status: u.spam_status || 'Whitelisted',
    google_meet_url: u.google_meet_url || defaultMeet,
    google_connected: Boolean(google_tokens),
  };
}

async function userFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as any;
    const u = await one('SELECT id,name,email,role,states,active FROM users WHERE id=$1', [payload.sub]);
    if (!u || !u.active) return null;
    const isExecutiveAdmin = u.email?.toLowerCase() === 'king@iwillglobal.com' || u.email?.toLowerCase() === 'aneesha@iwillglobal.com' || u.role === 'admin';
    const effectiveRole: Role = isExecutiveAdmin ? 'admin' : u.role;
    return { id: u.id, name: u.name, email: u.email, role: effectiveRole, states: u.states || [] };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden for your role' });
    next();
  };
}

export const isAdminUser = (u?: AuthUser | null): boolean => {
  if (!u) return false;
  const email = (u.email || '').toLowerCase();
  return u.role === 'admin' || email === 'king@iwillglobal.com' || email === 'aneesha@iwillglobal.com' || u.id === 'u_principal';
};

export const isManager = (u?: AuthUser) => isAdminUser(u) || u?.role === 'manager';
export const isLicensed = (u?: AuthUser) => u?.role === 'licensed_agent' || isManager(u);
