import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { diskStorage } from "multer";

const DEFAULT_DATA_DIR = join(process.cwd(), "data");

export const uploadTempDir = process.env.UPLOAD_TMP_DIR?.trim() || join(process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR, "tmp", "uploads");

export const uploadDiskStorage = diskStorage({
  destination: (_request, _file, callback) => {
    try {
      mkdirSync(uploadTempDir, { recursive: true });
      callback(null, uploadTempDir);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("No se pudo preparar el directorio temporal de uploads."), uploadTempDir);
    }
  },
  filename: (_request, file, callback) => {
    const extension = extname(file.originalname);
    const safeBaseName = basename(file.originalname, extension).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "upload";
    callback(null, `${Date.now()}-${randomUUID()}-${safeBaseName}${extension}`);
  }
});

export function uploadLimits(options: { fileSizeMb: number; files?: number }) {
  return {
    fileSize: options.fileSizeMb * 1024 * 1024,
    files: options.files ?? 1,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
    fields: 20,
    parts: (options.files ?? 1) + 20
  };
}

export async function attachUploadedFileBuffers(files: Express.Multer.File[] | undefined) {
  for (const file of files ?? []) {
    await attachUploadedFileBuffer(file);
  }
}

export async function attachUploadedFileBuffer(file: Express.Multer.File | undefined) {
  if (!file) {
    return;
  }
  if (file.buffer?.length) {
    return;
  }
  if (!file.path) {
    throw new BadRequestException("No se pudo leer el fichero subido.");
  }
  file.buffer = await readFile(file.path);
}

export async function cleanupUploadedFiles(files: Express.Multer.File[] | undefined) {
  await Promise.all((files ?? []).map((file) => cleanupUploadedFile(file)));
}

export async function cleanupUploadedFile(file: Express.Multer.File | undefined) {
  if (!file?.path) {
    return;
  }
  try {
    await unlink(file.path);
  } catch {
    // Best-effort cleanup. Upload processing should not fail because temp cleanup failed.
  }
}
