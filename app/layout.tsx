import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoltRoute | Find EV Chargers You Can Trust",
  description: "Find compatible, reliable and affordable EV charging stations for your vehicle.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
