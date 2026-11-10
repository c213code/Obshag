import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Общак",
  description: "Общие расходы без таблиц",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Общак", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** The Supabase origin (absent in mock mode): the first request of every session goes there, so the connection is opened early. */
function supabaseOrigin(): string | null {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const origin = supabaseOrigin();
  return (
    <html lang="ru">
      <head>
        {origin && <link rel="preconnect" href={origin} crossOrigin="" />}
        {origin && <link rel="dns-prefetch" href={origin} />}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
