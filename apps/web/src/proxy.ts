import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends anyone without a session to sign-in. The API checks the session's
 * signature on every call; this only saves a round trip to an empty screen.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("d2c_session")) return NextResponse.next();
  const url = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the API, Next's files and public images.
  matcher: ["/((?!login|api|_next|brand|brands|favicon.ico).*)"],
};
