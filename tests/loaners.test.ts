import { describe, expect, it } from 'vitest';
import { expandShip, matchLoaners, myLoaners, parseLoanerHtml } from '@/lib/loaners';

const td = (a: string, b: string) => `<tr style="height: 22px;"> <td style="padding: 3px">${a}</td> <td>${b}</td> </tr>`;
const BODY = `<p>intro</p><table><thead><tr><th>YOUR SHIP</th><th>OUR LOANER(S)</th></tr></thead><tbody>
${td('600i Explorer and Executive', 'Cyclone')}
${td('Arrastra', 'Mole, Arrow')}
${td('Carrack / Carrack Expedition', 'C8 Pisces, URSA Rover')}
${td('Carrack w/ C8X / Carrack Expedition w/C8X', 'C8X Pisces Expedition, URSA Rover')}
${td('Crucible', 'Constellation Andromeda&nbsp;')}
${td('Fury Variants', 'Mustang Alpha')}
${td('G12 Variants', 'Lynx')}
${td('Genesis Starliner', 'Hercules C2')}
${td('Hull D, E', 'Hull C, Hercules C2')}
${td('Idris-M &amp; P', 'F7C-M Super Hornet, MPUV Passenger')}
${td('Nox', 'Mustang Alpha')}
${td('Pulse (+ LX)', 'Mustang Alpha')}
${td('X1 (+ Velocity, Force)', 'Mustang Alpha')}
</tbody></table><table><tr><td>other</td><td>table</td></tr></table>`;

describe('loaner ship matrix', () => {
  const rows = parseLoanerHtml(BODY);
  it('reads the first table, skips the header, splits loaners, decodes entities', () => {
    expect(rows).toHaveLength(13);
    expect(rows[1]).toEqual({ ship: 'Arrastra', loaners: ['Mole', 'Arrow'] });
    expect(rows[4]!.loaners).toEqual(['Constellation Andromeda']);
    expect(rows[9]!.ship).toBe('Idris-M & P');
  });
  it('expands the names a row stands for', () => {
    expect(expandShip('600i Explorer and Executive').names).toEqual(['600i explorer', '600i executive']);
    expect(expandShip('Idris-M & P').names).toEqual(['idris m', 'idris p']);
    expect(expandShip('Hull D, E').names).toEqual(['hull d', 'hull e']);
    expect(expandShip('X1 (+ Velocity, Force)').names).toEqual(['x1', 'x1 velocity', 'x1 force']);
    expect(expandShip('Carrack w/ C8X / Carrack Expedition w/C8X').names).toEqual(['carrack w/c8x', 'carrack expedition w/c8x']);
    expect(expandShip('Fury Variants')).toEqual({ names: ['fury'], variants: true });
  });
  it('matches store ships to their best row', () => {
    const ships = ['600i Executive Edition', 'Carrack', 'Carrack w/C8X', 'Fury MX', 'G12r', 'Genesis', 'Hull E', 'Idris-P', 'Nox Kue', 'Pulse LX', 'X1 Force', 'Arrow', 'Hull C'].map((name, id) => ({ id, name }));
    const m = matchLoaners(rows, ships);
    const of = (name: string) => m.get(ships.find((s) => s.name === name)!.id)?.ship;
    expect(of('600i Executive Edition')).toBe('600i Explorer and Executive');
    expect(of('Carrack')).toBe('Carrack / Carrack Expedition');
    expect(of('Carrack w/C8X')).toBe('Carrack w/ C8X / Carrack Expedition w/C8X');
    expect(of('Fury MX')).toBe('Fury Variants');
    expect(of('G12r')).toBe('G12 Variants');
    expect(of('Genesis')).toBe('Genesis Starliner');
    expect(of('Hull E')).toBe('Hull D, E');
    expect(of('Idris-P')).toBe('Idris-M & P');
    expect(of('Nox Kue')).toBe('Nox');
    expect(of('Pulse LX')).toBe('Pulse (+ LX)');
    expect(of('X1 Force')).toBe('X1 (+ Velocity, Force)');
    expect(of('Arrow')).toBeUndefined();
    expect(of('Hull C')).toBeUndefined();
  });
  it('your loaners: one per name, with every ship that grants it', () => {
    const ships = [{ id: 1, name: 'Fury' }, { id: 2, name: 'Nox' }, { id: 3, name: 'Arrastra' }];
    expect(myLoaners(ships, matchLoaners(rows, ships))).toEqual([
      { name: 'Arrow', from: ['Arrastra'] },
      { name: 'Mole', from: ['Arrastra'] },
      { name: 'Mustang Alpha', from: ['Fury', 'Nox'] },
    ]);
  });
});
