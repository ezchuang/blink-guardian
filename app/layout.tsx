import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "眨眼守門員 Blink Guardian";
const description = "使用鏡頭在裝置上偵測眨眼，專注太久時溫柔提醒。";
const fallbackOrigin = "https://blink-guardian-tw.kate0099.chatgpt.site";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const local = host?.startsWith("localhost") || host?.startsWith("127.0.0.1");
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : local ? "http" : "https";

  let origin = fallbackOrigin;
  if (host) {
    try { origin = new URL(`${protocol}://${host}`).origin; }
    catch { origin = fallbackOrigin; }
  }

  return {
    title,
    description,
    metadataBase: new URL(origin),
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      locale: "zh_TW",
      images: [{ url: `${origin}/og.png`, width: 1734, height: 907, alt: "眨眼守門員：別讓專注，忘了眨眼。" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
