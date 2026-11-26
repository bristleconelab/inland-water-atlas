import { describe, expect, it } from 'vitest';
import { areaWords, depthCheck, evidence, volumeWords, type LakeProps } from '../src/lake';

// Baikal as it comes out of HydroLAKES (Vol_src 1) with a Wikidata maximum depth
const baikal: LakeProps = { id: 11, tier: 3, a: 31967.85, n: 'Baikal', c: 'Russia', t: 1, d: 738.7, v: 23615000, vs: 1, wx: 1642 };
const modelled: LakeProps = { id: 900000, tier: 1, a: 0.42, t: 1, d: 3.1, v: 1.3, vs: 3 };
const seen: LakeProps = { id: 555, tier: 2, a: 2.5, t: 2, d: 6.2, v: 15.5, vs: 3, s: 0.66 };

describe('words', () => {
  it('writes volumes and areas people can picture', () => {
    expect(volumeWords(23615000)).toBe('23,615 km³ of water');
    expect(volumeWords(1.3)).toBe('1.3 million m³ of water');
    expect(areaWords(0.42)).toBe('42 hectares');
    expect(areaWords(31967.85)).toBe('31,968 km²');
  });
});

describe('evidence', () => {
  it('puts published facts first and keeps the model for modelled lakes only', () => {
    const e = evidence(baikal);
    expect(e.map((x) => x.kind)).toEqual(['published', 'published']);
    expect(e[0].text).toContain('1,642 m at its deepest');
    expect(e[1].text).toContain('from the scientific literature');
    expect(evidence({ ...baikal, wr: 0 })[0].text).toContain('without a cited source');
  });
  it('explains what the satellites saw and what is modelled', () => {
    expect(evidence(seen).map((x) => x.kind)).toEqual(['seen', 'model']);
    expect(evidence(seen)[0].text).toContain('0.7 m');
    expect(evidence(modelled)).toEqual([expect.objectContaining({ kind: 'model' })]);
  });
});

describe('consistency of published numbers', () => {
  it('accepts a maximum depth a few times the mean, flags impossible or unusual ones', () => {
    expect(depthCheck(baikal)).toBeNull(); // 1,642 m max vs 738.7 m mean from volume: 2.2x
    // Titicaca as matched on 2026-11-25: Wikidata 489 m (no criterion) vs 112 m mean from a literature volume
    expect(depthCheck({ id: 78, tier: 3, a: 8003, d: 112, v: 893000, vs: 1, wu: 489 })).toContain('4.4 times'); // literature: ~281 m
    expect(depthCheck({ id: 78, tier: 3, a: 8003, d: 112, v: 893000, vs: 1, wx: 281 })).toBeNull(); // 2.5x
    expect(depthCheck({ id: 1, tier: 3, a: 10, d: 20, vs: 1, wx: 12 })).toContain('less than the average depth');
    expect(depthCheck({ id: 2, tier: 3, a: 10, d: 5, vs: 2, wu: 40 })).toContain('8 times');
    expect(depthCheck(seen)).toBeNull(); // modelled volume: nothing to compare
  });
});
