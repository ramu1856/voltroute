import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WORKER_SITE_ORIGIN } from "@/lib/site-config";

const siteUrl = WORKER_SITE_ORIGIN;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "VoltRoute | EV Charger & Road-Trip Planner",
  description: "Plan EV charging with backup-first route checks, trip confidence scoring, queue allowances, and nearby stop planning in one flow.",
  applicationName: "VoltRoute",
  alternates: { canonical: "/" },
  keywords: ["EV charger finder", "EV route planner", "electric vehicle charging stations", "charging stops", "EV road trip"],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "VoltRoute",
    title: "VoltRoute | EV Charger & Road-Trip Planner",
    description: "Backup-first EV route planning with confidence scoring, transparent assumptions, and trip-ready charging decisions.",
  },
  twitter: {
    card: "summary",
    title: "VoltRoute | EV Charger & Road-Trip Planner",
    description: "Backup-first EV route planning with confidence scoring and transparent charging assumptions.",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#10241a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
