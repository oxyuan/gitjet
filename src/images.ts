import type { ImageData } from "./mygo";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"];

/** Whether the diff viewer can draw this file as an image. */
export function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A data URL an <img> element can show. */
export function imageSource(image: ImageData): string {
  return `data:${image.mime};base64,${image.data}`;
}
