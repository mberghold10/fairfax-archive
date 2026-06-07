import { describe, it, expect } from 'vitest';
import { normalizeQuery, filterSearchIndex } from '../../../src/utils/searchFilter.mjs';

describe('normalizeQuery', () => {
  it('lowercases input', () => {
    expect(normalizeQuery('MIKE')).toBe('mike');
  });

  it('strips punctuation', () => {
    expect(normalizeQuery("O'Brien")).toBe('obrien');
  });

  it('trims whitespace', () => {
    expect(normalizeQuery('  smith  ')).toBe('smith');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeQuery('')).toBe('');
  });

  it('handles mixed punctuation and spaces', () => {
    expect(normalizeQuery("St. Mary's")).toBe('st marys');
  });
});

describe('filterSearchIndex', () => {
  const mockIndex = {
    players: [
      { id: 'p1', name: 'Giardina, Mike', normalized: 'giardina mike', type: 'player' },
      { id: 'p2', name: 'Smith, John', normalized: 'smith john', type: 'player' },
      { id: 'p3', name: 'Smithson, Dave', normalized: 'smithson dave', type: 'player' },
      { id: 'p4', name: 'Johnson, Mike', normalized: 'johnson mike', type: 'player' },
    ],
    teams: [
      { id: 't1', name: 'Smith Plumbing', normalized: 'smith plumbing', type: 'team' },
      { id: 't2', name: 'Blacksmiths', normalized: 'blacksmiths', type: 'team' },
      { id: 't3', name: 'Ice Dogs', normalized: 'ice dogs', type: 'team' },
    ],
  };

  it('returns empty array for empty query', () => {
    expect(filterSearchIndex('', mockIndex)).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    expect(filterSearchIndex('   ', mockIndex)).toEqual([]);
  });

  it('matches players and teams (unified results)', () => {
    const results = filterSearchIndex('smith', mockIndex);
    const types = results.map((r) => r.type);
    expect(types).toContain('player');
    expect(types).toContain('team');
  });

  it('prioritizes prefix matches over substring matches', () => {
    const results = filterSearchIndex('smith', mockIndex);
    // "smith john", "smithson dave", "smith plumbing" are prefix matches
    // "blacksmiths" is a substring match
    const names = results.map((r) => r.name);
    const blacksmithsIdx = names.indexOf('Blacksmiths');
    const smithIdx = names.indexOf('Smith, John');
    expect(smithIdx).toBeLessThan(blacksmithsIdx);
  });

  it('returns at most 10 results', () => {
    // Create index with many matching entries
    const bigIndex = {
      players: Array.from({ length: 20 }, (_, i) => ({
        id: `p${i}`,
        name: `Player ${i}`,
        normalized: `player ${i}`,
        type: 'player',
      })),
      teams: [],
    };
    const results = filterSearchIndex('player', bigIndex);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('returns no results when nothing matches', () => {
    const results = filterSearchIndex('xyz999', mockIndex);
    expect(results).toEqual([]);
  });

  it('handles case-insensitive matching', () => {
    const results = filterSearchIndex('GIARDINA', mockIndex);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Giardina, Mike');
  });

  it('strips punctuation from query before matching', () => {
    const indexWithPunc = {
      players: [{ id: 'p1', name: "O'Brien, Pat", normalized: 'obrien pat', type: 'player' }],
      teams: [],
    };
    const results = filterSearchIndex("O'Brien", indexWithPunc);
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("O'Brien, Pat");
  });

  it('returns results with correct shape', () => {
    const results = filterSearchIndex('ice', mockIndex);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('type');
    }
  });
});
