import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://voltroutes.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "VoltRoute | EV Charger & Road-Trip Planner",
  description: "Find mapped US EV charging stations, check vehicle compatibility, plan safer charging stops, and find nearby food and restrooms.",
  applicationName: "VoltRoute",
  alternates: { canonical: "/" },
  keywords: ["EV charger finder", "EV route planner", "electric vehicle charging stations", "charging stops", "EV road trip"],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "VoltRoute",
    title: "VoltRoute | EV Charger & Road-Trip Planner",
    description: "Find mapped US EV chargers, plan charging stops, and check nearby food and restrooms.",
  },
  twitter: {
    card: "summary",
    title: "VoltRoute | EV Charger & Road-Trip Planner",
    description: "Find mapped US EV chargers, plan charging stops, and check nearby food and restrooms.",
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
