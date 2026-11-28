import { describe, expect, it } from 'vitest';
import { damWords as raw, profileChart, type Profile } from '../src/profile';
const damWords = (p: Profile) => raw(p)?.replace(/\u00a0/g, ' ') ?? null; // numbers and % are joined by a no-break space

const amu: Profile = { x: [0, 500, 1500, 2500], z: [4000, 1200, 200, 30], q: [50, 900, 1700, 1500], d: [0, 45, 150, 62], ir: 18.5, lk: [[1400, 7, 'Tuyamuyun Reservoir', 2, 300], [300, 8, '', 1, 2]] };
describe('river profile', () => {
  it('draws the profile with one marker per lake and escapes names', () => {
    const svg = profileChart({ ...amu, lk: [[1400, 7, 'A<b>', 2, 300], [300, 8, '', 1, 2]] });
    expect(svg).toContain('<rect');
    expect(svg).toContain('<circle');
    expect(svg).toContain('A&lt;b>');
    expect(svg).toContain('4,000 m');
    expect(svg).toContain('2,500 km');
  });
  it('needs two heights', () => {
    expect(profileChart({ ...amu, z: [null, null, null, 30] })).toBe('');
  });
  it('tells the degree of regulation and irrigation', () => {
    const w = damWords(amu)!;
    expect(w).toContain('can hold 62 % of a year');
    expect(raw(amu)).toContain('62\u00a0%');
    expect(w).toContain('up to 150 % further up');
    expect(damWords({ ...amu, d: [0, 45, 80, 62] })).not.toContain('further up');
    expect(w).toContain('One reservoir sits');
    expect(w).toContain('19 % of the land');
    expect(damWords({ ...amu, ir: 6.25 })).toContain('6.3 % of the land');
    expect(damWords({ ...amu, d: [0, 0.5, 1], ir: 0, lk: [] })).toContain('less than 2 %');
    expect(damWords({ ...amu, d: [0, 300, 250] })).toContain('more than a whole year');
  });
});
