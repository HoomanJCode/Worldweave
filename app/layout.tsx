import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Worldweave — Map Studio",
  description: "Sketch and plan game worlds with a browser-based vector map editor.",
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
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
