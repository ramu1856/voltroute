"use client";

import { useEffect, useMemo } from "react";
import { WORKER_SITE_URL, isLocalhostOrigin } from "@/lib/site-config";

const productionSiteUrl = WORKER_SITE_URL;
const workerSiteUrl = WORKER_SITE_URL;

export default function AuthCallbackPage() {
  const target = useMemo(() => {
    if (typeof window === "undefined") return null;
    const currentOrigin = window.location.origin;
    const isLocal = isLocalhostOrigin(currentOrigin);
    const normalized = currentOrigin.toLowerCase();
    const origin = isLocal
      ? currentOrigin
      : normalized === "https://site-creator-vinext-starter.voltroutes.workers.dev"
        ? workerSiteUrl
        : normalized === "https://voltroutes.com" || normalized === "https://www.voltroutes.com"
          ? productionSiteUrl
          : productionSiteUrl;
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
