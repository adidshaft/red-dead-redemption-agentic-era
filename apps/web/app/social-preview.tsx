import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

const width = 1200;
const height = 630;

async function getLogoDataUri() {
  const logoPath = path.join(process.cwd(), "public", "branding", "rdr-logo.svg");
  const logoSvg = await readFile(logoPath, "utf8");
  return `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
}

export const runtime = "nodejs";
export const alt = "Red Dead Redemption: Agentic Era";
export const size = {
  width,
  height,
};
export const contentType = "image/png";

export async function renderSocialPreview() {
  const logoSrc = await getLogoDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at top left, rgba(213,117,45,0.28), transparent 42%), linear-gradient(135deg, #120b08 0%, #1f130d 45%, #090705 100%)",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            borderRadius: "32px",
            border: "2px solid rgba(244,200,133,0.18)",
            background: "linear-gradient(180deg, rgba(7,6,5,0.08), rgba(0,0,0,0.28))",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
            alignItems: "center",
            justifyContent: "center",
            padding: "48px 64px",
          }}
        >
          <img
            src={logoSrc}
            alt="Red Dead Redemption: Agentic Era"
            style={{
              width: "1000px",
              height: "auto",
              objectFit: "contain",
            }}
          />
        </div>
      </div>
    ),
    {
      width,
      height,
    },
  );
}
