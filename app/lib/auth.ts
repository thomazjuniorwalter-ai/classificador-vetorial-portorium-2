import { createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "portorium_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const PASSWORD_ITERATIONS = 210_000;
const DUMMY_SALT = "portorium-authentication-dummy-salt";
const DUMMY_HASH = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

type StoredUser = {
  username: string;
  name: string;
  salt: string;
  hash: string;
  active?: boolean;
};

export type AuthenticatedUser = {
  username: string;
  name: string;
  initials: string;
};

type SessionPayload = { username: string; expiresAt: number };

function authSecret() {
  const secret = process.env.PORTORIUM_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("PORTORIUM_AUTH_SECRET deve possuir pelo menos 32 caracteres.");
  }
  return secret;
}

function users(): StoredUser[] {
  const raw = process.env.PORTORIUM_AUTH_USERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("PORTORIUM_AUTH_USERS não contém um JSON válido.");
  }
}

function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`.toUpperCase();
}

function sign(value: string) {
  return createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function authenticate(username: string, password: string): AuthenticatedUser | null {
  const normalized = normalizeUsername(username);
  const user = users().find((candidate) => normalizeUsername(candidate.username) === normalized && candidate.active !== false);
  const salt = typeof user?.salt === "string" ? user.salt : DUMMY_SALT;
  const expectedHash = typeof user?.hash === "string" ? user.hash : DUMMY_HASH;
  const calculated = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256").toString("base64url");
  if (!user || !safeEqual(calculated, expectedHash)) return null;
  return { username: user.username, name: user.name, initials: initials(user.name) };
}

export function isAuthConfigured() {
  try {
    authSecret();
    return users().length > 0;
  } catch {
    return false;
  }
}

export function createSessionToken(username: string) {
  const payload: SessionPayload = {
    username: normalizeUsername(username),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}

export function verifySessionToken(token?: string): AuthenticatedUser | null {
  if (!token) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    if (!safeEqual(sign(encoded), signature)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.username || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    const user = users().find((candidate) => normalizeUsername(candidate.username) === payload.username && candidate.active !== false);
    return user ? { username: user.username, name: user.name, initials: initials(user.name) } : null;
  } catch {
    return null;
  }
}

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}
