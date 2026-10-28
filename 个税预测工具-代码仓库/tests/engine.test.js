'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/load-engine');

const E = loadEngine();

/** 断言两个金额近似相等（允许 1 分钱误差） */
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.01,
    `${msg || ''} 期望 ${expected}，实际 ${actual}`);
}

/* 基础参数：月薪 20000 / 年终奖 60000 / 社保 2100 / 公积金 2400 */
const BASE = {
  monthlySalary: 20000, bonus: 60000, otherIncome: 0,
  socialMonthly: 2100, fundMonthly: 2400,
  addMonthly: 0, addAnnual: 0, otherAnnual: 0,
  bonusMode: 'auto'
};

test('综合所得：七档税率表的区间边界逐一校验', () => {
  near(E.annualTax(0), 0, '应税所得 0');
  near(E.annualTax(36000), 1080, '第 1 档上限');
  near(E.annualTax(36001), 1080.1, '刚进第 2 档');
  near(E.annualTax(144000), 11880, '第 2 档上限');
  near(E.annualTax(300000), 43080, '第 3 档上限');
  near(E.annualTax(420000), 73080, '第 4 档上限');
  near(E.annualTax(660000), 145080, '第 5 档上限');
  near(E.annualTax(960000), 250080, '第 6 档上限');
  near(E.annualTax(1000000), 268080, '第 7 档');
});

test('综合所得：负值与非数字输入不产生负税额', () => {
  assert.equal(E.annualTax(-1000), 0);
  assert.equal(E.annualTax(NaN), 0);
});

test('年终奖单独计税：按月换算定档，按全额计税', () => {
  near(E.bonusTaxEach(36000), 1080, '36000 落在 3% 档');
  near(E.bonusTaxEach(36001), 3390.1, '36001 跳入 10% 档');
  near(E.bonusTaxEach(144000), 14190, '144000 仍在 10% 档');
  near(E.bonusTaxEach(150000), 28590, '150000 落在 20% 档');
  near(E.bonusTaxEach(0), 0);
});

test('年终奖盲区：六个区间的上下界与官方口径一致', () => {
  const expected = [
    [36000, 38566.67],
    [144000, 160500],
    [300000, 318333.33],
    [420000, 447500],
    [660000, 706538.46],
    [960000, 1120000]
  ];
  assert.equal(E.BLIND_ZONES.length, expected.length);
  E.BLIND_ZONES.forEach((z, i) => {
    near(z.lower, expected[i][0], `第 ${i + 1} 个盲区下限`);
    near(z.upper, expected[i][1], `第 ${i + 1} 个盲区上限`);
  });
});

test('年终奖盲区：区间内命中、区间外不命中', () => {
  assert.equal(E.compute({ ...BASE, bonus: 38000 }).blindZone.inZone, true, '38000 应在盲区');
  assert.equal(E.compute({ ...BASE, bonus: 38600 }).blindZone.inZone, false, '38600 已出盲区');
  assert.equal(E.compute({ ...BASE, bonus: 150000 }).blindZone.inZone, true, '150000 应在盲区');
  assert.equal(E.compute({ ...BASE, bonus: 60000 }).blindZone.inZone, false, '60000 不在盲区');
});

test('年终奖盲区：调整到下限后税后收入确实更高', () => {
  const r = E.compute({ ...BASE, bonus: 150000 });
  const loss = r.blindZone.loss;
  near(loss, 8400, '150000 相对 144000 的税后损失');

  const afterTaxAt = (b) => b - E.bonusTaxEach(b);
  near(afterTaxAt(150000), afterTaxAt(144000) - loss, '税后差额自洽');
});

test('自动择优：两种计税方式中取税额较小者', () => {
  const r = E.compute(BASE);
  near(r.compare.separate, 15870, '单独计税合计');
  near(r.compare.merge, 20280, '并入综合合计');
  assert.equal(r.compare.chosen, 'separate');
  near(r.totalTax, 15870, '最终取单独计税');
});

test('自动择优：高收入场景下并入更优', () => {
  const p = {
    monthlySalary: 35000, bonus: 150000, otherIncome: 0,
    socialMonthly: 3675, fundMonthly: 4200,
    addMonthly: 8500, addAnnual: 23600, otherAnnual: 14400,
    bonusMode: 'auto'
  };
  const r = E.compute(p);
  near(r.compare.merge, 38180, '并入综合合计');
  near(r.compare.separate, 38620, '单独计税合计');
  assert.equal(r.compare.chosen, 'merge');
});

test('累计预扣法：逐月税额合计等于全年综合所得税额', () => {
  const r = E.compute(BASE);
  const sum = r.months.reduce((s, m) => s + m.tax, 0);
  near(sum, r.comprehensiveTax + r.bonusTax, '预扣合计 = 综合所得税额 + 奖金税');
  assert.equal(r.months.length, 12);
});

test('累计预扣法：无年终奖时逐月税额合计等于全年税额', () => {
  const r = E.compute({ ...BASE, bonus: 0 });
  const sum = r.months.reduce((s, m) => s + m.tax, 0);
  near(sum, r.totalTax, '无奖金时完全一致');
  near(r.settlement, 0, '汇算差额为 0');
});

test('累计预扣法：下半年月度税额不高于上半年（累计预扣的升档现象）', () => {
  const r = E.compute(BASE);
  const h1 = r.months.slice(0, 6).reduce((s, m) => s + m.tax, 0);
  const h2 = r.months.slice(6, 12).reduce((s, m) => s + m.tax, 0);
  assert.ok(h2 > h1, `下半年预扣（${h2}）应高于上半年（${h1}）`);
});

test('仅年度汇算扣除项：产生可退税差额', () => {
  const r = E.compute({ ...BASE, addAnnual: 20000 });
  assert.ok(r.settlement > 0, '大病医疗类年度扣除应产生退税');
  near(r.settlement, 2000, '按 10% 档应退 2000');
});

test('税后年收入 = 总收入 − 三险一金 − 个税', () => {
  const r = E.compute(BASE);
  near(r.afterTaxAnnual, 240000 + 60000 - 54000 - 15870, '税后年收入');
  near(r.monthlyNetAvg, r.afterTaxAnnual / 12, '月均到手');
});

test('节税额必须用精确期权衡，而非扣除额 × 边际税率', () => {
  // 应税所得 150000（20% 档），增加 10000 扣除后回落到 10% 档
  const taxable = 150000;
  const exact = E.savingOf(taxable, 10000);
  const naive = 10000 * 0.2;
  near(exact, E.annualTax(150000) - E.annualTax(140000), '精确值自洽');
  near(exact, 1600, '实际只省 1600：其中 6000 按 20%、4000 按 10% 抵扣');
  assert.notEqual(exact, naive, '跨档时两种算法结果不同');
  assert.ok(exact < naive, '朴素算法会高估节税额，这正是必须精算的原因');
});

test('诊断：未申报任何专项附加时给出缺口语义', () => {
  const r = E.compute(BASE);
  const ctx = {
    monthlySalary: 20000, socialBase: 20000, socialRate: 10.5, socialCap: Infinity,
    fundBase: 20000, fundRate: 12, pension: 0, healthIns: 0,
    housing: false, elderly: false, childEdu: false, baby: false, edu: false,
    majorMedical: false
  };
  const advice = E.diagnose(ctx, r);
  assert.ok(advice.length >= 4, '至少给出 4 条建议');

  const keys = advice.map(a => a.key);
  ['housing', 'elderly', 'child'].forEach(k => {
    assert.ok(keys.includes(k), `应包含 ${k} 建议`);
  });

  // 汇总不得重复计入已自动优化项
  const realTotal = advice.reduce((s, a) => s + (a.realized ? 0 : (a.saving || 0)), 0);
  assert.ok(realTotal > 0, '存在可节税空间');
  const mode = advice.find(a => a.key === 'mode');
  if (mode) assert.equal(mode.realized, true, '年终奖择优项应标记为已优化');
});

test('诊断：全部扣除已申报时不再提示缺口', () => {
  const p = { ...BASE, addMonthly: 8500, otherAnnual: 12000 };
  const r = E.compute(p);
  const ctx = {
    monthlySalary: 20000, socialBase: 20000, socialRate: 10.5, socialCap: Infinity,
    fundBase: 20000, fundRate: 12, pension: 12000, healthIns: 0,
    housing: true, elderly: true, childEdu: true, baby: true, edu: true,
    majorMedical: true
  };
  const advice = E.diagnose(ctx, r);
  const actionable = advice.filter(a => !a.realized && a.saving > 0);
  assert.equal(actionable.length, 0, '不应再有可节税缺口');
});
