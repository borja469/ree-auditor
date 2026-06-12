import AdmZip from "adm-zip";
import iconv from "iconv-lite";

export interface SourceFile {
  name: string;
  containerName?: string;
  buffer: Buffer;
  content: string;
  encoding: "utf8" | "latin1";
}

export function extractSourceFiles(fileName: string, buffer: Buffer): SourceFile[] {
  if (isZip(fileName, buffer)) {
    const zip = new AdmZip(buffer);
    return zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => buildSourceFile(entry.entryName, entry.getData(), fileName))
      .filter((entry) => entry.content.trim().length > 0);
  }

  return [buildSourceFile(fileName, buffer)];
}

function buildSourceFile(name: string, buffer: Buffer, containerName?: string): SourceFile {
  const decoded = decodeText(buffer);
  return {
    name,
    containerName,
    buffer,
    content: decoded.content,
    encoding: decoded.encoding
  };
}

function isZip(fileName: string, buffer: Buffer) {
  const lowerName = fileName.toLowerCase();
  const hasZipSignature = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  return lowerName.endsWith(".zip") || hasZipSignature;
}

function decodeText(buffer: Buffer): { content: string; encoding: "utf8" | "latin1" } {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\uFFFD")) {
    return {
      content: utf8,
      encoding: "utf8"
    };
  }

  return {
    content: iconv.decode(buffer, "latin1"),
    encoding: "latin1"
  };
}
