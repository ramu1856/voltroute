"use client";

import { useEffect, useMemo } from "react";

export default function AuthCallbackPage() {
  const target = useMemo(() => {
    if (typeof window === "undefined") return null;
    const url = new URL("/", window.location.origin);
    if (window.location.hash) url.hash = window.location.hash.slice(1);
    return url.toString();
  }, []);

  useEffect(() => {
    if (!target) return;
    window.location.replace(target);
  }, [target]);

  return <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-[#c7dbce]">Completing sign-in…</main>;
}
