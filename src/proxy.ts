import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Customer, crew, approval and webhook routes carry their own signed tokens.
const isOwnerRoute = createRouteMatcher([
  "/",
  "/jobs(.*)",
  "/settings(.*)",
  "/prices(.*)",
  "/outbox(.*)",
  "/onboarding(.*)",
  "/api/files(.*)",
]);

const withClerk = clerkMiddleware(async (auth, request) => {
  if (isOwnerRoute(request)) await auth.protect();
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const configured = process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return configured ? withClerk(request, event) : NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
