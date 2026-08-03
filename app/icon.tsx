import { ImageResponse } from "next/og";

/**
 * The favicon, drawn rather than stored.
 *
 * It is the same idea the site is built on: a contribution heatmap. Four cells
 * at four intensities read as a tiny calendar at 32px, which is the only size
 * that matters here — a wordmark would be an illegible smudge at this scale.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  const cells = [0.18, 0.55, 1, 0.34];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexWrap: "wrap",
          background: "#07070a",
          padding: 4,
          gap: 2,
        }}
      >
        {cells.map((level, index) => (
          <div
            key={index}
            style={{
              width: 11,
              height: 11,
              borderRadius: 2,
              background: `rgba(75, 59, 255, ${level})`,
            }}
          />
        ))}
      </div>
    ),
    size,
  );
}
