import { describe, it, expect } from 'vitest'
import { buildLeaders } from '../../../scripts/aggregate/leaders.mjs'

describe('buildLeaders', () => {
  const makePlayers = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      displayName: `Player ${i}`,
      totals: { gp: 10 + i, g: 100 - i, a: 50 + i, pts: 150, ppg: 0, ppa: 0, shg: 0, sha: 0, pim: i * 5 }
    }))

  const makeGoalies = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: `g${i}`,
      displayName: `Goalie ${i}`,
      totals: { gp: 20 + i, w: 80 - i, l: 10, t: 2, ga: 50, sa: 500, sv: 450, so: 30 - i, gaa: '2.50', svpct: '0.900' }
    }))

  it('produces all six leaderboard categories', () => {
    const leaders = buildLeaders(makePlayers(5), makeGoalies(3))
    expect(leaders).toHaveProperty('goals')
    expect(leaders).toHaveProperty('assists')
    expect(leaders).toHaveProperty('points')
    expect(leaders).toHaveProperty('pim')
    expect(leaders).toHaveProperty('wins')
    expect(leaders).toHaveProperty('shutouts')
  })

  it('sorts goals descending by value', () => {
    const leaders = buildLeaders(makePlayers(10), makeGoalies(2))
    for (let i = 1; i < leaders.goals.length; i++) {
      expect(leaders.goals[i].value).toBeLessThanOrEqual(leaders.goals[i - 1].value)
    }
  })

  it('sorts assists descending by value', () => {
    const leaders = buildLeaders(makePlayers(10), makeGoalies(2))
    for (let i = 1; i < leaders.assists.length; i++) {
      expect(leaders.assists[i].value).toBeLessThanOrEqual(leaders.assists[i - 1].value)
    }
  })

  it('sorts points descending by value', () => {
    const leaders = buildLeaders(makePlayers(10), makeGoalies(2))
    for (let i = 1; i < leaders.points.length; i++) {
      expect(leaders.points[i].value).toBeLessThanOrEqual(leaders.points[i - 1].value)
    }
  })

  it('sorts pim descending by value', () => {
    const leaders = buildLeaders(makePlayers(10), makeGoalies(2))
    for (let i = 1; i < leaders.pim.length; i++) {
      expect(leaders.pim[i].value).toBeLessThanOrEqual(leaders.pim[i - 1].value)
    }
  })

  it('sorts wins descending by value', () => {
    const leaders = buildLeaders(makePlayers(2), makeGoalies(10))
    for (let i = 1; i < leaders.wins.length; i++) {
      expect(leaders.wins[i].value).toBeLessThanOrEqual(leaders.wins[i - 1].value)
    }
  })

  it('sorts shutouts descending by value', () => {
    const leaders = buildLeaders(makePlayers(2), makeGoalies(10))
    for (let i = 1; i < leaders.shutouts.length; i++) {
      expect(leaders.shutouts[i].value).toBeLessThanOrEqual(leaders.shutouts[i - 1].value)
    }
  })

  it('limits each category to 100 entries max', () => {
    const leaders = buildLeaders(makePlayers(150), makeGoalies(120))
    expect(leaders.goals).toHaveLength(100)
    expect(leaders.assists).toHaveLength(100)
    expect(leaders.points).toHaveLength(100)
    expect(leaders.pim).toHaveLength(100)
    expect(leaders.wins).toHaveLength(100)
    expect(leaders.shutouts).toHaveLength(100)
  })

  it('returns fewer than 100 when input has fewer entries', () => {
    const leaders = buildLeaders(makePlayers(5), makeGoalies(3))
    expect(leaders.goals).toHaveLength(5)
    expect(leaders.assists).toHaveLength(5)
    expect(leaders.points).toHaveLength(5)
    expect(leaders.pim).toHaveLength(5)
    expect(leaders.wins).toHaveLength(3)
    expect(leaders.shutouts).toHaveLength(3)
  })

  it('uses playerId for skater entries', () => {
    const leaders = buildLeaders(makePlayers(3), makeGoalies(1))
    expect(leaders.goals[0]).toHaveProperty('playerId')
    expect(leaders.goals[0]).toHaveProperty('displayName')
    expect(leaders.goals[0]).toHaveProperty('value')
    expect(leaders.goals[0]).not.toHaveProperty('goalieId')
  })

  it('uses goalieId for goalie entries', () => {
    const leaders = buildLeaders(makePlayers(1), makeGoalies(3))
    expect(leaders.wins[0]).toHaveProperty('goalieId')
    expect(leaders.wins[0]).toHaveProperty('displayName')
    expect(leaders.wins[0]).toHaveProperty('value')
    expect(leaders.wins[0]).not.toHaveProperty('playerId')
  })

  it('handles empty inputs gracefully', () => {
    const leaders = buildLeaders([], [])
    expect(leaders.goals).toEqual([])
    expect(leaders.assists).toEqual([])
    expect(leaders.points).toEqual([])
    expect(leaders.pim).toEqual([])
    expect(leaders.wins).toEqual([])
    expect(leaders.shutouts).toEqual([])
  })

  it('correctly maps stat values from totals', () => {
    const players = [{
      id: 'abc',
      displayName: 'Test Player',
      totals: { gp: 50, g: 30, a: 20, pts: 50, ppg: 5, ppa: 3, shg: 1, sha: 1, pim: 40 }
    }]
    const goalies = [{
      id: 'xyz',
      displayName: 'Test Goalie',
      totals: { gp: 60, w: 35, l: 20, t: 5, ga: 100, sa: 1000, sv: 900, so: 8, gaa: '1.67', svpct: '0.900' }
    }]

    const leaders = buildLeaders(players, goalies)

    expect(leaders.goals[0]).toEqual({ playerId: 'abc', displayName: 'Test Player', value: 30 })
    expect(leaders.assists[0]).toEqual({ playerId: 'abc', displayName: 'Test Player', value: 20 })
    expect(leaders.points[0]).toEqual({ playerId: 'abc', displayName: 'Test Player', value: 50 })
    expect(leaders.pim[0]).toEqual({ playerId: 'abc', displayName: 'Test Player', value: 40 })
    expect(leaders.wins[0]).toEqual({ goalieId: 'xyz', displayName: 'Test Goalie', value: 35 })
    expect(leaders.shutouts[0]).toEqual({ goalieId: 'xyz', displayName: 'Test Goalie', value: 8 })
  })
})
