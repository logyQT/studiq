import {
  extensionForMimeType,
  sniffMimeType,
  UPLOAD_MIME_TYPES,
} from '@studiq/server/lib/file-signature';
import { describe, expect, it } from 'vitest';

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const concat = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const flat = parts.flatMap((part) => Array.from(part));
  return Uint8Array.from(flat);
};

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = concat(ascii('GIF89a'), [0x01, 0x00, 0x01, 0x00]);
const WEBP = concat(ascii('RIFF'), [0x20, 0x00, 0x00, 0x00], ascii('WEBPVP8 '));
const WAV = concat(ascii('RIFF'), [0x24, 0x00, 0x00, 0x00], ascii('WAVEfmt '));
const OGG = concat(ascii('OggS'), [0x00, 0x02, 0x00, 0x00]);
const MP3_WITH_ID3 = concat(ascii('ID3'), [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
// MPEG-1 Layer III, 128 kbps, 44.1 kHz.
const MP3_FRAME = Uint8Array.from([0xff, 0xfb, 0x90, 0x64]);
// MPEG-2 Layer III, 64 kbps, 22.05 kHz.
const MP3_FRAME_MPEG2 = Uint8Array.from([0xff, 0xf3, 0x80, 0x64]);

describe('sniffMimeType', () => {
  it('detects every allow-listed image type', () => {
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(GIF)).toBe('image/gif');
    expect(sniffMimeType(WEBP)).toBe('image/webp');
  });

  it('detects every allow-listed audio type', () => {
    expect(sniffMimeType(MP3_WITH_ID3)).toBe('audio/mpeg');
    expect(sniffMimeType(MP3_FRAME)).toBe('audio/mpeg');
    expect(sniffMimeType(MP3_FRAME_MPEG2)).toBe('audio/mpeg');
    expect(sniffMimeType(WAV)).toBe('audio/wav');
    expect(sniffMimeType(OGG)).toBe('audio/ogg');
  });

  it('disambiguates RIFF containers', () => {
    const avi = concat(ascii('RIFF'), [0x20, 0x00, 0x00, 0x00], ascii('AVI LIST'));

    expect(sniffMimeType(WEBP)).toBe('image/webp');
    expect(sniffMimeType(WAV)).toBe('audio/wav');
    expect(sniffMimeType(avi)).toBeNull();
  });

  it('rejects non-media payloads declared as images by clients', () => {
    expect(sniffMimeType(ascii('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffMimeType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffMimeType(Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // MZ (exe)
    expect(sniffMimeType(ascii('plain text'))).toBeNull();
    expect(sniffMimeType(ascii('%PDF-1.7'))).toBeNull();
  });

  it('rejects empty and too-short buffers', () => {
    expect(sniffMimeType(new Uint8Array())).toBeNull();
    expect(sniffMimeType(Uint8Array.from([0x89]))).toBeNull();
    expect(sniffMimeType(Uint8Array.from([0xff, 0xfb]))).toBeNull();
  });

  it('rejects MPEG headers with reserved version/layer/bitrate fields', () => {
    // version = 01 (reserved)
    expect(sniffMimeType(Uint8Array.from([0xff, 0xeb, 0x90, 0x64]))).toBeNull();
    // layer = 00 (reserved)
    expect(sniffMimeType(Uint8Array.from([0xff, 0xf9, 0x90, 0x64]))).toBeNull();
    // bitrate index = 1111 (invalid)
    expect(sniffMimeType(Uint8Array.from([0xff, 0xfb, 0xf0, 0x64]))).toBeNull();
    // sample rate index = 11 (reserved)
    expect(sniffMimeType(Uint8Array.from([0xff, 0xfb, 0x9c, 0x64]))).toBeNull();
  });
});

describe('extensionForMimeType', () => {
  it('maps every allow-listed type to an extension', () => {
    expect(UPLOAD_MIME_TYPES.map(extensionForMimeType)).toEqual([
      'png',
      'jpg',
      'gif',
      'webp',
      'mp3',
      'wav',
      'ogg',
    ]);
  });
});
