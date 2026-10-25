import { canonicalItems, isSameSnapshot, itemsTotal, sortItems } from './budget-snapshot';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const header = { totalAmount: '1000000.00', currency: 'ARS', approvalDate: '2026-10-12' };

describe('sortItems', () => {
  it('ordena por nombre de rubro y, a igual nombre, por id (estable, sin depender del orden de la base)', () => {
    const items = [
      { costCategoryId: B, categoryName: 'Otros', amount: '1.00' },
      { costCategoryId: A, categoryName: 'Recursos humanos', amount: '2.00' },
      { costCategoryId: A, categoryName: 'Otros', amount: '3.00' },
    ];
    expect(sortItems(items).map((i) => [i.categoryName, i.costCategoryId])).toEqual([['Otros', A], ['Otros', B], ['Recursos humanos', A]]);
    expect(sortItems([...items].reverse())).toEqual(sortItems(items));
  });

  it('no muta el arreglo recibido', () => {
    const items = [{ costCategoryId: B, categoryName: 'b', amount: '1.00' }, { costCategoryId: A, categoryName: 'a', amount: '1.00' }];
    sortItems(items);
    expect(items[0]!.costCategoryId).toBe(B);
  });
});

describe('itemsTotal', () => {
  it('suma exacta', () => {
    expect(itemsTotal([{ amount: '0.10' }, { amount: '0.20' }])).toBe('0.30');
  });
});

describe('canonicalItems / isSameSnapshot', () => {
  const v1 = { ...header, items: [{ costCategoryId: A, amount: '700000.00' }, { costCategoryId: B, amount: '300000.00' }] };

  it('es independiente del orden del request', () => {
    expect(canonicalItems(v1.items)).toBe(canonicalItems([...v1.items].reverse()));
    expect(isSameSnapshot(v1, { ...v1, items: [...v1.items].reverse() })).toBe(true);
  });

  it('normaliza los importes ("700000" = "700000.00")', () => {
    expect(isSameSnapshot(v1, { ...v1, totalAmount: '1000000', items: [{ costCategoryId: A, amount: '700000' }, { costCategoryId: B, amount: '300000.0' }] })).toBe(true);
  });

  it('otra distribución con el mismo total ES un cambio', () => {
    expect(isSameSnapshot(v1, { ...v1, items: [{ costCategoryId: A, amount: '600000.00' }, { costCategoryId: B, amount: '400000.00' }] })).toBe(false);
  });

  it('cualquier diferencia de encabezado es un cambio', () => {
    expect(isSameSnapshot(v1, { ...v1, totalAmount: '1000000.01' })).toBe(false);
    expect(isSameSnapshot(v1, { ...v1, currency: 'USD' })).toBe(false);
    expect(isSameSnapshot(v1, { ...v1, approvalDate: '2026-10-13' })).toBe(false);
  });

  it('un rubro distinto o uno de menos es un cambio', () => {
    expect(isSameSnapshot(v1, { ...v1, items: [v1.items[0]!] })).toBe(false);
    expect(isSameSnapshot(v1, { ...v1, items: [v1.items[0]!, { costCategoryId: 'c'.repeat(8) + '-cccc-4ccc-8ccc-cccccccccccc', amount: '300000.00' }] })).toBe(false);
  });

  it('un presupuesto vigente sin partidas (previo a PRES-04) nunca es igual a uno con partidas', () => {
    expect(isSameSnapshot({ ...v1, items: [] }, v1)).toBe(false);
  });
});
