import { NextResponse } from "next/server";

export const runtime = "edge";

export default function Icon(request: Request) {
  const url = new URL("/gti-logo-white.png", request.url);
  return NextResponse.redirect(url);
}
