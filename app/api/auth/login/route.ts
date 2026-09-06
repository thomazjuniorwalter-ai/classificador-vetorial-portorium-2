import { NextResponse } from "next/server";
import { authenticate, createSessionToken, isAuthConfigured, SESSION_COOKIE, sessionCookieOptions } from "../../../lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");

  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?erro=configuracao", request.url), 303);
  }
  if (!username || !password || username.length > 254 || password.length > 1024) {
    return NextResponse.redirect(new URL("/login?erro=1", request.url), 303);
  }

  let user;
  try {
    user = authenticate(username, password);
  } catch {
    return NextResponse.json({ error: "A autenticação ainda não foi configurada." }, { status: 503 });
  }

  if (!user) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.redirect(new URL("/login?erro=1", request.url), 303);
  }
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(SESSION_COOKIE, createSessionToken(user.username), sessionCookieOptions());
  return response;
}
