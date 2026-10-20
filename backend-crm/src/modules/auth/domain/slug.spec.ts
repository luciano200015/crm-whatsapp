import { slugCandidates, slugify } from './slug';

const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

describe('slugify', () => {
  it.each([
    ['Acme Corp', 'acme-corp'],
    ['  Café  Niño & Co. ', 'cafe-nino-co'],
    ['---weird___name!!!', 'weird-name'],
    ['日本語', 'workspace'],
    ['', 'workspace'],
  ])('slugifies %p as %p', (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });

  it('always produces a slug the database accepts', () => {
    for (const name of ['a'.repeat(200), 'x-'.repeat(40), 'Ñ', '9 lives']) {
      for (const candidate of slugCandidates(name)) {
        expect(candidate).toMatch(SLUG_FORMAT);
      }
    }
  });

  it('offers distinct fallbacks after the plain slug', () => {
    const candidates = slugCandidates('Acme');
    expect(candidates[0]).toBe('acme');
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
