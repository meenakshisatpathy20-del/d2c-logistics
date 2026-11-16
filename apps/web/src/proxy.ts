import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends anyone without a session to sign-in. The API checks the session's
 * signature on every call; this only saves a round trip to an empty screen.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("d2c_session")) return NextResponse.next();
  // Vendor partners sign in with their mobile number on their own page.
  const vendor = request.nextUrl.pathname === "/v" || request.nextUrl.pathname.startsWith("/v/");
  const url = new URL(vendor ? "/v/login" : "/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/" && !vendor) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the API, Next's files and public images.
  matcher: ["/((?!login|v/login|api|_next|brand|brands|favicon.ico).*)"],
};
