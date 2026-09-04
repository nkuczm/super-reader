import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Reader",
  description: "Paste a link or a topic. Get a feed you can actually read.",
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
