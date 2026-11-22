import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends anyone without a session to sign-in. The API checks the session's
 * signature on every call; this only saves a round trip to an empty screen.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("d2c_session")) return NextResponse.next();
  // Vendor and courier partners sign in with their mobile number on their own page.
  const path = request.nextUrl.pathname;
  const vendor = path === "/v" || path.startsWith("/v/");
  const courier = path === "/p" || path.startsWith("/p/");
  const url = new URL(vendor ? "/v/login" : courier ? "/p/login" : "/login", request.url);
  const next = path + request.nextUrl.search;
  if (next !== "/" && !vendor && !courier) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the API, Next's files and public images.
  matcher: ["/((?!login|v/login|p/login|api|_next|brand|brands|favicon.ico).*)"],
};
