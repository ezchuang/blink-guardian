import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "眨眼守門員 Blink Guardian",
  description: "使用鏡頭在裝置上偵測眨眼，專注太久時溫柔提醒。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
