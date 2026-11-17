import { BLUESKY_IMAGE_MAX } from "../convex/shared/platforms";

// Leave a little room under the limit.
const TARGET = BLUESKY_IMAGE_MAX - 100_000;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * Makes a smaller JPEG copy of a large image, in the browser. Returns null
 * when no copy is needed (already small, a video, or an animated GIF) or the
 * browser cannot do it. Quality drops first, then dimensions.
 */
export async function shrinkImage(file: File): Promise<Blob | null> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= TARGET) return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    let scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
    for (let pass = 0; pass < 6; pass++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // JPEG has no transparency, so see-through areas become white.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.9, 0.82, 0.74]) {
        const blob = await toJpeg(canvas, quality);
        if (blob && blob.size <= TARGET) return blob;
      }
      scale *= 0.8;
    }
  } catch {
    // Fall through: the original uploads without a smaller copy.
  }
  return null;
}
