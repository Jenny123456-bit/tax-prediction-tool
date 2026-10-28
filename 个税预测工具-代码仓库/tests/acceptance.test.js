'use strict';

/**
 * 验收用例（对应 PRD 第 8.1 节 AC-01 ~ AC-06）
 * 每条用例都给出精确到元的期望值，任何计算口径变化都会被立即捕获。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./helpers/load-engine');

const E = loadEngine();

function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 0.01,
    `${msg || ''} 期望 ${expected}，实际 ${actual}`);
}

test('AC-01 标准白领：月薪 2 万 + 年终奖 6 万，无专项附加', () => {
  const r = E.compute({
    monthlySalary: 20000, bonus: 60000, otherIncome: 0,
    socialMonthly: 2100, fundMonthly: 2400,
    addMonthly: 0, addAnnual: 0, otherAnnual: 0,
    bonusMode: 'auto'
  });

  near(r.taxable, 126000, '应纳税所得额');
  near(r.rate, 0.10, '适用税率');
  near(r.quickDeduction, 2520, '速算扣除数');
  near(r.compare.separate, 15870, '单独计税合计');
  near(r.compare.merge, 20280, '并入综合合计');
  assert.equal(r.compare.chosen, 'separate', '应自动选择单独计税');
  near(r.totalTax, 15870, '全年个税');
  near(r.afterTaxAnnual, 230130, '税后年收入');
  near(r.monthlyNetAvg, 19177.5, '月均到手');
});

test('AC-02 增加赡养老人扣除后税负下降 3600 元', () => {
  const base = {
    monthlySalary: 20000, bonus: 60000, otherIncome: 0,
    socialMonthly: 2100, fundMonthly: 2400,
    addAnnual: 0, otherAnnual: 0, bonusMode: 'auto'
  };
  const before = E.compute({ ...base, addMonthly: 0 });
  const after = E.compute({ ...base, addMonthly: 3000 });

  near(after.taxable, 90000, '扣除后应纳税所得额');
  near(after.totalTax, 12270, '扣除后全年个税');
  near(before.totalTax - after.totalTax, 3600, '节税额');
});

test('AC-03 高收入家庭：并入综合所得更优', () => {
  const r = E.compute({
    monthlySalary: 35000, bonus: 150000, otherIncome: 0,
    socialMonthly: 3675, fundMonthly: 4200,
    addMonthly: 8500, addAnnual: 23600, otherAnnual: 14400,
    bonusMode: 'auto'
  });

  assert.equal(r.compare.chosen, 'merge', '应选择并入综合所得');
  near(r.taxable, 275500, '并入后应纳税所得额');
  near(r.rate, 0.20, '适用税率');
  near(r.totalTax, 38180, '并入方案全年个税');
  near(r.compare.separate, 38620, '单独方案全年个税');
  near(r.compare.diff, 440, '两方案差额');
});

test('AC-04 年终奖 15 万命中盲区，调整至 14.4 万税后多拿 8400 元', () => {
  const r = E.compute({
    monthlySalary: 35000, bonus: 150000, otherIncome: 0,
    socialMonthly: 3675, fundMonthly: 4200,
    addMonthly: 8500, addAnnual: 23600, otherAnnual: 14400,
    bonusMode: 'auto'
  });

  assert.equal(r.blindZone.inZone, true, '应命中盲区');
  near(r.blindZone.lower, 144000, '盲区下限');
  near(r.blindZone.loss, 8400, '税后损失');
});

test('AC-05 年终奖 36001 命中第一档盲区', () => {
  const r = E.compute({
    monthlySalary: 20000, bonus: 36001, otherIncome: 0,
    socialMonthly: 2100, fundMonthly: 2400,
    addMonthly: 0, addAnnual: 0, otherAnnual: 0, bonusMode: 'auto'
  });
  assert.equal(r.blindZone.inZone, true);
  near(r.blindZone.lower, 36000);
  near(r.blindZone.upper, 38566.67, undefined);
});

test('AC-06 年终奖 38600 已越过盲区上界', () => {
  const r = E.compute({
    monthlySalary: 20000, bonus: 38600, otherIncome: 0,
    socialMonthly: 2100, fundMonthly: 2400,
    addMonthly: 0, addAnnual: 0, otherAnnual: 0, bonusMode: 'auto'
  });
  assert.equal(r.blindZone.inZone, false);
});

test('AC-07 其他综合所得计入综合所得收入额', () => {
  const r = E.compute({
    monthlySalary: 20000, bonus: 0, otherIncome: 50000,
    socialMonthly: 2100, fundMonthly: 2400,
    addMonthly: 0, addAnnual: 0, otherAnnual: 0, bonusMode: 'auto'
  });
  near(r.gross.comprehensive, 290000, '工资 24 万 + 其他 5 万');
  near(r.taxable, 176000, '应纳税所得额');
});

test('AC-08 非数字 / 非法输入按 0 处理，不抛异常', () => {
  const r = E.compute({
    monthlySalary: 'abc', bonus: null, otherIncome: undefined,
    socialMonthly: -100, fundMonthly: NaN,
    addMonthly: 0, addAnnual: 0, otherAnnual: 0, bonusMode: 'auto'
  });
  assert.equal(r.totalTax, 0);
  assert.equal(r.taxable, 0);
  assert.ok(Number.isFinite(r.afterTaxAnnual));
});
