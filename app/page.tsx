"use client";

import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    window.location.replace("/blink-guardian.html");
  }, []);

  return (
    <main style={{minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3f0e7", color: "#17211c", fontFamily: "system-ui, sans-serif"}}>
      <p>正在開啟眨眼守門員…</p>
    </main>
  );
}
