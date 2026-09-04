import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Reader",
  description: "Paste a link or a topic. Get a feed you can actually read.",
  applicationName: "Super Reader",
  // Lets iOS run it as a standalone app once added to the Home Screen.
  appleWebApp: {
    capable: true,
    title: "Reader",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  other: {
    // Next emits the modern mobile-web-app-capable; iOS before 16.4 still
    // needs the Apple-prefixed one to launch without Safari chrome.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content extends under the notch; safe-area insets handle the padding.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
