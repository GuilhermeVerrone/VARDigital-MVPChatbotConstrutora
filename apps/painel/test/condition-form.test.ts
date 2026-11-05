import { illustrativeSalesConditions } from '@mvp/simulation';
import { describe, expect, it } from 'vitest';
import { conditionToValues, valuesToCondition } from '../src/lib/condition-form';

describe('formulário da condição comercial', () => {
  for (const [slug, condition] of Object.entries(illustrativeSalesConditions)) {
    it(`ida e volta sem perder nada (${slug})`, () => {
      const built = valuesToCondition(conditionToValues(condition), { validFrom: condition.validFrom, version: condition.version });
      expect(built.errors).toEqual({});
      expect(built.condition).toEqual({ ...condition, validTo: null });
    });
  }

  it('taxas aparecem em % e voltam como fração, sem ruído de ponto flutuante', () => {
    const c = illustrativeSalesConditions['lumen-urban'];
    const values = conditionToValues(c);
    expect(values['cash.discountRatio']).toBe(String(c.cash.discountRatio * 100));
    const built = valuesToCondition({ ...values, 'cash.discountRatio': '8,5' }, { validFrom: c.validFrom, version: 'x' });
    expect(built.condition?.cash.discountRatio).toBe(0.085);
  });

  it('campo vazio, texto e regra entre campos viram erro no campo certo', () => {
    const c = illustrativeSalesConditions['lumen-urban'];
    const values = conditionToValues(c);
    const r1 = valuesToCondition({ ...values, 'installments.monthly.maxCount': '' }, { validFrom: c.validFrom, version: 'x' });
    expect(r1.condition).toBeNull();
    expect(r1.errors['installments.monthly.maxCount']).toBeDefined();
    const r2 = valuesToCondition({ ...values, 'cash.discountRatio': 'abc' }, { validFrom: c.validFrom, version: 'x' });
    expect(r2.errors['cash.discountRatio']).toBe('Use um número');
    const r3 = valuesToCondition({ ...values, 'downPayment.minRatio': '60', 'downPayment.maxRatio': '20' }, { validFrom: c.validFrom, version: 'x' });
    expect(r3.condition).toBeNull();
    expect(Object.keys(r3.errors)).toHaveLength(1);
    const r4 = valuesToCondition({ ...values, 'cash.enabled': '', 'upfront.enabled': '', 'installments.enabled': '' }, { validFrom: c.validFrom, version: 'x' });
    expect(r4.condition).toBeNull();
  });

  it('reforços desligados viram null; ligados exigem intervalo e teto', () => {
    const c = illustrativeSalesConditions['lumen-urban'];
    const values = conditionToValues(c);
    const off = valuesToCondition({ ...values, 'installments.balloons.enabled': '' }, { validFrom: c.validFrom, version: 'x' });
    expect(off.condition?.installments.balloons).toBeNull();
    const bad = valuesToCondition({ ...values, 'installments.balloons.enabled': 'on', 'installments.balloons.intervalMonths': '', 'installments.balloons.maxRatio': '' }, { validFrom: c.validFrom, version: 'x' });
    expect(bad.errors['installments.balloons.intervalMonths']).toBeDefined();
    expect(bad.errors['installments.balloons.maxRatio']).toBeDefined();
  });
});
