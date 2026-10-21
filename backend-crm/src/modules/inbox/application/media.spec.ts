import {
  baseMimeType,
  mediaHeaders,
  outgoingMedia,
  sanitizeFilename,
} from './media';

describe('outgoing media rules', () => {
  it('maps each accepted type to how WhatsApp sends it', () => {
    expect(outgoingMedia('image/jpeg', 1000)).toEqual({ type: 'image' });
    expect(outgoingMedia('video/mp4', 1000)).toEqual({ type: 'video' });
    expect(outgoingMedia('audio/ogg; codecs=opus', 1000)).toEqual({
      type: 'audio',
    });
    expect(outgoingMedia('application/pdf', 1000)).toEqual({
      type: 'document',
    });
  });

  it('refuses types WhatsApp does not accept and files over its limits', () => {
    expect(outgoingMedia('text/html', 10)).toEqual({
      error: 'unsupported_type',
    });
    expect(outgoingMedia('audio/webm', 10)).toEqual({
      error: 'unsupported_type',
    });
    expect(outgoingMedia('image/png', 6 * 1024 * 1024)).toEqual({
      error: 'too_large',
      maxBytes: 5 * 1024 * 1024,
    });
  });

  it('strips parameters from MIME types', () => {
    expect(baseMimeType('Audio/OGG; codecs=opus')).toBe('audio/ogg');
  });
});

describe('media response headers', () => {
  it('shows known media inline and never lets the browser sniff', () => {
    expect(
      mediaHeaders({ mimeType: 'image/jpeg', filename: null, size: 3 }),
    ).toMatchObject({
      'Content-Type': 'image/jpeg',
      'Content-Length': '3',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': expect.stringMatching(/^inline;/) as string,
    });
  });

  it('turns anything else into a download with a safe name', () => {
    const headers = mediaHeaders({
      mimeType: 'text/html',
      filename: '../../evil".html',
      size: 1,
    });
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Content-Disposition']).toBe(
      `attachment; filename="evil.html"; filename*=UTF-8''evil.html`,
    );
  });

  it('keeps only the base name of uploaded files', () => {
    expect(sanitizeFilename('C:\\Users\\ana\\catálogo.pdf')).toBe(
      'catálogo.pdf',
    );
    expect(sanitizeFilename('   ')).toBeNull();
  });
});
