import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Local media storage. Originals live under MEDIA_ROOT/originals and are only
 * ever streamed after an authorization check; derivatives (thumbnail and the
 * watermarked preview) live under MEDIA_ROOT/derived. Nothing here is inside
 * the web root.
 */

export type MediaVariant = "thumb" | "preview";
export const MEDIA_VARIANTS: readonly MediaVariant[] = ["thumb", "preview"];

const ALLOWED_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  heif: { mime: "image/heif", ext: "heic" },
  tiff: { mime: "image/tiff", ext: "tif" },
};

const MAX_INPUT_PIXELS = 120_000_000;

export function mediaRoot(): string {
  return path.resolve(env.MEDIA_ROOT);
}

export function originalPath(originalKey: string): string {
  return path.join(mediaRoot(), "originals", originalKey);
}

export function derivedPath(assetId: string, variant: MediaVariant): string {
  return path.join(mediaRoot(), "derived", assetId, `${variant}.webp`);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function watermarkSvg(width: number, height: number, text: string): Buffer {
  const label = escapeXml(text.trim() || "Vista previa");
  const fontSize = Math.max(14, Math.round(Math.min(width, height) / 18));
  const stepX = Math.max(fontSize * (label.length * 0.6 + 4), 160);
  const stepY = fontSize * 4;
  const rows: string[] = [];

  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      rows.push(`<text x="${x.toFixed(0)}" y="${y.toFixed(0)}">${label}</text>`);
    }
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<g transform="rotate(-30 ${width / 2} ${height / 2})" fill="#ffffff" fill-opacity="0.28" ` +
      `stroke="#000000" stroke-opacity="0.12" stroke-width="1" font-family="DejaVu Sans, sans-serif" ` +
      `font-size="${fontSize}" font-weight="bold">${rows.join("")}</g></svg>`,
  );
}

export type ProcessedImage = {
  assetId: string;
  originalKey: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  checksumSha256: string;
  thumb: Buffer;
  preview: Buffer;
  original: Buffer;
};

/**
 * Decodes and validates the upload, then renders derivatives in memory. Nothing
 * is written until every step succeeded, so a failed upload never touches the
 * current version of a photo.
 */
export async function processImage(
  storeId: string,
  input: Buffer,
  watermarkText: string,
): Promise<ProcessedImage> {
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;

  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_IMAGE",
      message: "The file is not a valid image.",
    });
  }

  const format = metadata.format ? ALLOWED_FORMATS[metadata.format] : undefined;

  if (!format || !metadata.width || !metadata.height) {
    throw new AppError({
      statusCode: 415,
      code: "UNSUPPORTED_IMAGE_FORMAT",
      message: "Only JPEG, PNG, WebP, HEIC and TIFF images are accepted.",
    });
  }

  const base = () => sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();

  try {
    // Derivatives never carry EXIF/GPS metadata: sharp drops it unless asked.
    const thumb = await base()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76 })
      .toBuffer();
    const resized = await base()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });
    const preview = await sharp(resized.data)
      .composite([
        {
          input: watermarkSvg(resized.info.width, resized.info.height, watermarkText),
          top: 0,
          left: 0,
        },
      ])
      .webp({ quality: 80 })
      .toBuffer();

    const assetId = randomUUID();
    const oriented = Boolean(metadata.orientation && metadata.orientation >= 5);

    return {
      assetId,
      originalKey: `${storeId}/${assetId}.${format.ext}`,
      mimeType: format.mime,
      bytes: input.length,
      width: oriented ? metadata.height : metadata.width,
      height: oriented ? metadata.width : metadata.height,
      checksumSha256: createHash("sha256").update(input).digest("hex"),
      thumb,
      preview,
      original: input,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError({
      statusCode: 422,
      code: "IMAGE_PROCESSING_FAILED",
      message: "The image could not be processed.",
    });
  }
}

export async function writeProcessedImage(image: ProcessedImage): Promise<void> {
  const original = originalPath(image.originalKey);
  await mkdir(path.dirname(original), { recursive: true });
  await mkdir(path.dirname(derivedPath(image.assetId, "thumb")), { recursive: true });
  await writeFile(original, image.original, { flag: "wx", mode: 0o640 });
  await writeFile(derivedPath(image.assetId, "thumb"), image.thumb, { mode: 0o640 });
  await writeFile(derivedPath(image.assetId, "preview"), image.preview, { mode: 0o640 });
}

/** Best-effort cleanup when the database transaction that follows a write fails. */
export async function discardProcessedImage(image: ProcessedImage): Promise<void> {
  await rm(originalPath(image.originalKey), { force: true });
  await rm(path.dirname(derivedPath(image.assetId, "thumb")), { recursive: true, force: true });
}
