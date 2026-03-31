/**
 * Tests for media file detection in Gemini agent file loading.
 *
 * When files are attached via UI, media files (audio/video/image/pdf) must be loaded
 * immediately as inlineData in the user message, not lazily via tool responses.
 * The Gemini API rejects media content in functionResponse with INVALID_ARGUMENT.
 *
 * @see https://github.com/iOfficeAI/AionUi/issues/1120
 */
import { describe, it, expect } from 'vitest';
import path from 'path';

// Replicate the MEDIA_EXTENSIONS set and hasMediaFiles function from the source
// to test the logic independently without importing the full Gemini agent module
const MEDIA_EXTENSIONS = new Set([
  '.ogg',
  '.mp3',
  '.wav',
  '.flac',
  '.aac',
  '.wma',
  '.m4a',
  '.opus',
  '.mp4',
  '.avi',
  '.mov',
  '.mkv',
  '.webm',
  '.flv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.pdf',
]);

function hasMediaFiles(files: string[] | undefined): boolean {
  if (!files || files.length === 0) return false;
  return files.some((filePath) => MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

describe('hasMediaFiles', () => {
  it('returns false for undefined files', () => {
    expect(hasMediaFiles(undefined)).toBe(false);
  });

  it('returns false for empty files array', () => {
    expect(hasMediaFiles([])).toBe(false);
  });

  it('returns false for text files only', () => {
    expect(hasMediaFiles(['/path/to/file.ts', '/path/to/readme.md'])).toBe(false);
  });

  it('returns true for audio files (.ogg)', () => {
    expect(hasMediaFiles(['/home/user/Audio/voice_123.ogg'])).toBe(true);
  });

  it('returns true for audio files (.mp3)', () => {
    expect(hasMediaFiles(['/path/to/song.mp3'])).toBe(true);
  });

  it('returns true for image files (.png)', () => {
    expect(hasMediaFiles(['/path/to/screenshot.png'])).toBe(true);
  });

  it('returns true for image files (.jpg)', () => {
    expect(hasMediaFiles(['/path/to/photo.jpg'])).toBe(true);
  });

  it('returns true for video files (.mp4)', () => {
    expect(hasMediaFiles(['/path/to/video.mp4'])).toBe(true);
  });

  it('returns true for PDF files', () => {
    expect(hasMediaFiles(['/path/to/document.pdf'])).toBe(true);
  });

  it('returns true when media file is mixed with text files', () => {
    expect(hasMediaFiles(['/path/to/code.ts', '/path/to/voice.ogg'])).toBe(true);
  });

  it('handles uppercase extensions', () => {
    expect(hasMediaFiles(['/path/to/photo.PNG'])).toBe(true);
    expect(hasMediaFiles(['/path/to/audio.OGG'])).toBe(true);
  });

  it('returns false for non-media extensions', () => {
    expect(hasMediaFiles(['/path/to/data.json', '/path/to/config.yaml', '/path/to/script.sh'])).toBe(false);
  });

  describe('lazyFileLoading logic', () => {
    // Replicate the actual lazyFileLoading expression from GeminiAgent.send()
    function computeLazyFileLoading(files: string[] | undefined): boolean {
      return !!(files && files.length > 0) && !hasMediaFiles(files);
    }

    it('enables lazy loading for text-only files', () => {
      expect(computeLazyFileLoading(['/path/to/code.ts'])).toBe(true);
    });

    it('disables lazy loading when audio file is present', () => {
      expect(computeLazyFileLoading(['/home/user/Audio/voice.ogg'])).toBe(false);
    });

    it('disables lazy loading when image file is present', () => {
      expect(computeLazyFileLoading(['/path/to/screenshot.png'])).toBe(false);
    });

    it('disables lazy loading when PDF is present', () => {
      expect(computeLazyFileLoading(['/path/to/doc.pdf'])).toBe(false);
    });

    it('disables lazy loading when media is mixed with text', () => {
      expect(computeLazyFileLoading(['/path/to/code.ts', '/path/to/audio.mp3'])).toBe(false);
    });

    it('returns false (no lazy loading) when no files', () => {
      expect(computeLazyFileLoading(undefined)).toBe(false);
      expect(computeLazyFileLoading([])).toBe(false);
    });
  });
});
