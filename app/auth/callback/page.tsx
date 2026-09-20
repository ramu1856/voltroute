"use client";

import { useEffect, useMemo } from "react";

const hostedOrigin = "https://site-creator-vinext-starter.voltroutes.workers.dev";
const allowedOrigins = new Set([hostedOrigin, "https://voltroutes.com", "https://www.voltroutes.com"]);

function safeReturnOrigin(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (allowedOrigins.has(parsed.origin)) return parsed.origin;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(parsed.origin)) return parsed.origin;
  } catch {
    return null;
  }
  return null;
}

export default function AuthCallbackPage() {
  const target = useMemo(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const returnTo = safeReturnOrigin(params.get("returnTo"));
    const origin = returnTo ?? window.location.origin;
    const url = new URL("/", origin);
    if (window.location.hash) url.hash = window.location.hash.slice(1);
    return url.toString();
  }, []);

  useEffect(() => {
    if (!target) return;
    window.location.replace(target);
  }, [target]);

  return <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-[#c7dbce]">Completing sign-in…</main>;
}
