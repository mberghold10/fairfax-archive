import { describe, it, expect } from 'vitest'
import { buildSearchIndex } from '../../../scripts/aggregate/searchIndex.mjs'

describe('buildSearchIndex', () => {
  it('builds entries for players, goalies, and teams', () => {
    const players = [
      { id: 'p1', displayName: 'Smith, John' },
      { id: 'p2', displayName: "O'Brien, Mike" }
    ]
    const goalies = [
      { id: 'g1', displayName: 'Jones, Tim' }
    ]
    const teams = [
      { teamId: 't1', teamName: 'Ice Hawks' },
      { teamId: 't2', teamName: 'Rink Rats' }
    ]

    const index = buildSearchIndex(players, goalies, teams)

    expect(index.players).toHaveLength(3)
    expect(index.teams).toHaveLength(2)

    // Check player entries
    expect(index.players[0]).toEqual({
      id: 'p1',
      name: 'Smith, John',
      normalized: 'smith, john',
      type: 'player'
    })
    expect(index.players[1]).toEqual({
      id: 'p2',
      name: "O'Brien, Mike",
      normalized: 'obrien, mike',
      type: 'player'
    })
    expect(index.players[2]).toEqual({
      id: 'g1',
      name: 'Jones, Tim',
      normalized: 'jones, tim',
      type: 'player'
    })

    // Check team entries
    expect(index.teams[0]).toEqual({
      id: 't1',
      name: 'Ice Hawks',
      normalized: 'ice hawks',
      type: 'team'
    })
    expect(index.teams[1]).toEqual({
      id: 't2',
      name: 'Rink Rats',
      normalized: 'rink rats',
      type: 'team'
    })
  })

  it('deduplicates players appearing in both skater and goalie lists', () => {
    const players = [{ id: 'p1', displayName: 'Smith, John' }]
    const goalies = [{ id: 'p1', displayName: 'Smith, John' }]
    const teams = []

    const index = buildSearchIndex(players, goalies, teams)
    expect(index.players).toHaveLength(1)
    expect(index.players[0].id).toBe('p1')
  })

  it('deduplicates teams with same teamId', () => {
    const players = []
    const goalies = []
    const teams = [
      { teamId: 't1', teamName: 'Ice Hawks' },
      { teamId: 't1', teamName: 'Ice Hawks (renamed)' }
    ]

    const index = buildSearchIndex(players, goalies, teams)
    expect(index.teams).toHaveLength(1)
    expect(index.teams[0].name).toBe('Ice Hawks')
  })

  it('skips entries with missing id or name', () => {
    const players = [
      { id: '', displayName: 'NoId Player' },
      { id: 'p1', displayName: '' },
      { id: null, displayName: 'Null Id' }
    ]
    const goalies = []
    const teams = [
      { teamId: '', teamName: 'No Id Team' },
      { teamId: 't1', teamName: '' }
    ]

    const index = buildSearchIndex(players, goalies, teams)
    expect(index.players).toHaveLength(0)
    expect(index.teams).toHaveLength(0)
  })

  it('normalizes names: lowercases, strips punctuation, collapses whitespace', () => {
    const players = [
      { id: 'p1', displayName: 'LaDuke,  Ryan' }
    ]
    const goalies = []
    const teams = [
      { teamId: 't1', teamName: 'Team #1 - Special!' }
    ]

    const index = buildSearchIndex(players, goalies, teams)
    expect(index.players[0].normalized).toBe('laduke, ryan')
    expect(index.teams[0].normalized).toBe('team special')
  })

  it('handles empty inputs gracefully', () => {
    const index = buildSearchIndex([], [], [])
    expect(index.players).toEqual([])
    expect(index.teams).toEqual([])
  })

  it('supports teams with id/name fields instead of teamId/teamName', () => {
    const teams = [
      { id: 't1', name: 'Alternate Format' }
    ]
    const index = buildSearchIndex([], [], teams)
    expect(index.teams).toHaveLength(1)
    expect(index.teams[0].id).toBe('t1')
    expect(index.teams[0].name).toBe('Alternate Format')
  })
})
