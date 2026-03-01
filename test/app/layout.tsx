import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Better Auth + Telegram Test",
  description: "Testing better-auth-telegram plugin",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" async></script>
      </head>
      <body className="bg-gray-50 min-h-screen">
        {children}
      </body>
    </html>
  );
}
