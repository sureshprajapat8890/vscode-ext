export interface ImageSize {
  width: number;
  height: number;
}

/** Reads pixel dimensions from PNG, JPEG, GIF, WebP or BMP headers. Returns undefined if unknown. */
export function imageSize(buf: Uint8Array): ImageSize | undefined {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...buf.subarray(offset, offset + length));

  // PNG: signature, then the IHDR chunk.
  if (buf.length >= 24 && view.getUint32(0) === 0x89504e47 && ascii(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // GIF87a / GIF89a.
  if (buf.length >= 10 && ascii(0, 3) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  // BMP: BITMAPINFOHEADER width/height (height may be negative for top-down bitmaps).
  if (buf.length >= 26 && ascii(0, 2) === 'BM') {
    return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  }
  // WebP: RIFF container with VP8 / VP8L / VP8X chunk.
  if (buf.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8 ') {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') {
      const w = buf[24] | (buf[25] << 8) | (buf[26] << 16);
      const h = buf[27] | (buf[28] << 8) | (buf[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
    return undefined;
  }
  // JPEG: walk segments to the first start-of-frame marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) return undefined;
      const marker = buf[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      const length = view.getUint16(offset + 2);
      const isSOF =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return undefined;
}
