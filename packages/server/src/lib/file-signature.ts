/**
 * Magic-byte sniffing for uploaded media.
 *
 * The client-declared multipart `Content-Type` is attacker-controlled, so an
 * HTML/EXE payload can claim `image/png` and reach storage (#185). Everything
 * here inspects the first bytes of the body instead and only recognises the
 * small allow-list of types the app actually renders (images + audio). The
 * sniffed type — never `file.name` / `file.type` — decides the stored extension
 * and the stored `Content-Type`.
 */

export const UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
] as const;

export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<UploadMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
};

/** File extension (without the dot) for a sniffed type. */
export function extensionForMimeType(mime: UploadMimeType): string {
  return EXTENSION_BY_MIME[mime];
}

function matchesAt(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ASCII = (text: string): readonly number[] => Array.from(text, (char) => char.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF87A = ASCII('GIF87a');
const GIF89A = ASCII('GIF89a');
const RIFF = ASCII('RIFF');
const WEBP = ASCII('WEBP');
const WAVE = ASCII('WAVE');
const OGG = ASCII('OggS');

/**
 * MPEG audio frame header (`FF Ex`): 11 sync bits, then version / layer /
 * bitrate-index / sample-rate-index nibbles that must not be the reserved
 * values. Catches both ID3-tagged and bare-frame MP3s.
 */
function isMpegAudioFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const b1 = bytes[1];
  const b2 = bytes[2];

  if (bytes[0] !== 0xff || (b1 & 0xe0) !== 0xe0) return false;

  const version = (b1 >> 3) & 0x03; // 01 = reserved
  const layer = (b1 >> 1) & 0x03; // 00 = reserved
  if (version === 0x01 || layer === 0x00) return false;

  const bitrateIndex = (b2 >> 4) & 0x0f; // 0000 = free, 1111 = invalid
  const sampleRateIndex = (b2 >> 2) & 0x03; // 11 = reserved
  return bitrateIndex > 0x00 && bitrateIndex < 0x0f && sampleRateIndex !== 0x03;
}

/**
 * Returns the sniffed type of an upload, or `null` when the bytes are not one of
 * `UPLOAD_MIME_TYPES` (HTML, SVG, executables, plain text, empty/too-short
 * buffers all fall through to `null`).
 */
export function sniffMimeType(bytes: Uint8Array): UploadMimeType | null {
  if (matchesAt(bytes, PNG_SIGNATURE)) return 'image/png';
  if (matchesAt(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  if (matchesAt(bytes, GIF87A) || matchesAt(bytes, GIF89A)) return 'image/gif';
  if (matchesAt(bytes, RIFF)) {
    if (matchesAt(bytes, WEBP, 8)) return 'image/webp';
    if (matchesAt(bytes, WAVE, 8)) return 'audio/wav';
    return null;
  }
  if (matchesAt(bytes, OGG)) return 'audio/ogg';
  if (matchesAt(bytes, ASCII('ID3')) || isMpegAudioFrame(bytes)) return 'audio/mpeg';

  return null;
}
