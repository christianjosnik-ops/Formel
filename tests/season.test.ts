import { describe, expect, it } from 'vitest';
import { CALENDAR, driverTable, newSeason, recordRound, seasonDone, teamTable } from '../src/season';

describe('Saison', () => {
  it('vergibt Punkte nach Zielreihenfolge, Ausfälle erhalten keine', () => {
    const s = newSeason();
    const mine = recordRound(s, [{ driver: 3, out: false }, { driver: 0, out: false }, { driver: 5, out: true }, { driver: 1, out: false }], 0);
    expect(mine).toBe(18);
    expect(s.pts['3']).toBe(25);
    expect(s.pts['5']).toBe(0);
    expect(s.pts['1']).toBe(12);
    expect(s.wins['3']).toBe(1);
    expect(s.round).toBe(1);
    expect(s.log[0].pos).toBe(2);
  });

  it('endet nach dem letzten Lauf, Wertungen sind sortiert', () => {
    const s = newSeason();
    for (let i = 0; i < CALENDAR.length; i++) recordRound(s, [{ driver: 2, out: false }, { driver: 4, out: false }], 4);
    expect(seasonDone(s)).toBe(true);
    const d = driverTable(s);
    expect(d[0].driver).toBe(2);
    expect(d[0].pts).toBe(75);
    expect(d[1].pts).toBe(54);
    const t = teamTable(s);
    expect(t[0].pts).toBeGreaterThanOrEqual(t[1].pts);
  });
});
