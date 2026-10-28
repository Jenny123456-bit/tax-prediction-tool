/*!
 * tax-engine.js — 中国个人所得税（居民个人）预测引擎
 * 依据：《个人所得税法》及其实施条例、财政部 税务总局公告2023年第30号
 * （全年一次性奖金单独计税优惠执行至 2027 年 12 月 31 日）
 * 纯前端运行，无任何网络依赖。
 */
(function (global) {
  'use strict';

  /* ---------------- 税率表 ---------------- */

  // 综合所得年度税率表
  var ANNUAL = [
    { up: 36000, rate: 0.03, qd: 0 },
    { up: 144000, rate: 0.10, qd: 2520 },
    { up: 300000, rate: 0.20, qd: 16920 },
    { up: 420000, rate: 0.25, qd: 31920 },
    { up: 660000, rate: 0.30, qd: 52920 },
    { up: 960000, rate: 0.35, qd: 85920 },
    { up: Infinity, rate: 0.45, qd: 181920 }
  ];

  // 全年一次性奖金税率表（按月换算后的综合所得税率表）
  var BONUS = [
    { up: 3000, rate: 0.03, qd: 0 },
    { up: 12000, rate: 0.10, qd: 210 },
    { up: 25000, rate: 0.20, qd: 1410 },
    { up: 35000, rate: 0.25, qd: 2660 },
    { up: 55000, rate: 0.30, qd: 4410 },
    { up: 80000, rate: 0.35, qd: 7160 },
    { up: Infinity, rate: 0.45, qd: 15160 }
  ];

  var BASIC_DEDUCTION_YEAR = 60000;   // 基本减除费用 5000 元/月
  var BASIC_DEDUCTION_MONTH = 5000;

  function pick(amount, table) {
    for (var i = 0; i < table.length; i++) {
      if (amount <= table[i].up) return table[i];
    }
    return table[table.length - 1];
  }

  function taxBy(amount, table) {
    if (!(amount > 0)) return 0;
    var b = pick(amount, table);
    return Math.max(0, amount * b.rate - b.qd);
  }

  /** 综合所得年度应纳税额 */
  function annualTax(taxable) { return taxBy(taxable, ANNUAL); }

  /** 年终奖单独计税应纳税额 */
  function bonusTaxEach(bonus) {
    if (!(bonus > 0)) return 0;
    var b = pick(bonus / 12, BONUS);
    return Math.max(0, bonus * b.rate - b.qd);
  }

  /* ---------------- 年终奖「多发一元」盲区 ---------------- */

  var BONUS_BOUNDARIES = [36000, 144000, 300000, 420000, 660000, 960000];

  /** 计算某个临界点之上的税后收入持平点 */
  function blindUpper(boundary) {
    var afterTaxAtBoundary = boundary - bonusTaxEach(boundary);
    var next = pick(boundary / 12 + 0.01, BONUS);
    // 解 b - (b*rate - qd) = afterTax  =>  b = (afterTax - qd) / (1 - rate)
    return (afterTaxAtBoundary - next.qd) / (1 - next.rate);
  }

  var BLIND_ZONES = BONUS_BOUNDARIES.map(function (b) {
    return { lower: b, upper: blindUpper(b) };
  });

  function detectBlindZone(bonus) {
    for (var i = 0; i < BLIND_ZONES.length; i++) {
      var z = BLIND_ZONES[i];
      if (bonus > z.lower && bonus < z.upper) {
        var atLower = z.lower - bonusTaxEach(z.lower);
        var here = bonus - bonusTaxEach(bonus);
        return {
          inZone: true,
          lower: z.lower,
          upper: z.upper,
          loss: atLower - here,
          advice: z.lower
        };
      }
    }
    return { inZone: false };
  }

  /* ---------------- 主计算 ---------------- */

  /**
   * @param {Object} p 参数
   *  monthlySalary  月薪（税前）
   *  bonus          全年一次性奖金
   *  otherIncome    其他综合所得「收入额」（劳务报酬等已按 80% 折算后的金额，全年）
   *  socialMonthly  社保个人月缴
   *  fundMonthly    公积金个人月缴
   *  addMonthly     专项附加扣除合计（按月申报部分，元/月）
   *  addAnnual      专项附加扣除中仅年度汇算扣除部分（大病医疗，元/年）
   *  otherAnnual    其他扣除（个人养老金、商业健康险等，元/年）
   *  bonusMode      'auto' | 'separate' | 'merge'
   */
  function compute(p) {
    var monthlySalary = Math.max(0, num(p.monthlySalary));
    var bonus = Math.max(0, num(p.bonus));
    var otherIncome = Math.max(0, num(p.otherIncome));
    var socialMonthly = Math.max(0, num(p.socialMonthly));
    var fundMonthly = Math.max(0, num(p.fundMonthly));
    var addMonthly = Math.max(0, num(p.addMonthly));
    var addAnnual = Math.max(0, num(p.addAnnual));
    var otherAnnual = Math.max(0, num(p.otherAnnual));
    var bonusMode = p.bonusMode || 'auto';

    var salaryYear = monthlySalary * 12;
    var grossComprehensive = salaryYear + otherIncome;      // 综合所得收入额

    var specialMonthly = socialMonthly + fundMonthly;
    var specialYear = specialMonthly * 12;                   // 专项扣除（三险一金）
    var addMonthlyYear = addMonthly * 12;
    var additionalYear = addMonthlyYear + addAnnual;         // 专项附加扣除合计

    var baseTaxable = Math.max(
      0,
      grossComprehensive - BASIC_DEDUCTION_YEAR - specialYear - additionalYear - otherAnnual
    );

    // 方案一：年终奖单独计税
    var taxSep = annualTax(baseTaxable);
    var bTax = bonusTaxEach(bonus);
    var totalSep = taxSep + bTax;

    // 方案二：并入综合所得
    var mergedTaxable = Math.max(0, baseTaxable + bonus);
    var totalMerge = annualTax(mergedTaxable);

    var chosen, bonusIncluded;
    if (bonusMode === 'separate') { chosen = 'separate'; }
    else if (bonusMode === 'merge') { chosen = 'merge'; }
    else { chosen = totalMerge <= totalSep ? 'merge' : 'separate'; }
    bonusIncluded = chosen === 'merge';

    var taxable = bonusIncluded ? mergedTaxable : baseTaxable;
    var totalTax = bonusIncluded ? totalMerge : totalSep;
    var br = pick(taxable, ANNUAL);

    // ---- 累计预扣法逐月模拟 ----
    var months = [];
    var cumTax = 0;
    var monthlyOtherDed = otherAnnual / 12;
    for (var m = 1; m <= 12; m++) {
      var incomeM = monthlySalary + (m === 12 && bonusIncluded ? bonus : 0);
      var cumulativeIncome = monthlySalary * m + otherIncome * (m / 12)
        + (m === 12 && bonusIncluded ? bonus : 0);
      var cumulativeDeduct = BASIC_DEDUCTION_MONTH * m
        + specialMonthly * m
        + addMonthly * m
        + monthlyOtherDed * m;
      var cumulativeTaxable = Math.max(0, cumulativeIncome - cumulativeDeduct);
      var cumulativeTax = annualTax(cumulativeTaxable);
      var monthTax = Math.max(0, cumulativeTax - cumTax);
      cumTax = cumulativeTax;

      if (m === 12 && !bonusIncluded) monthTax += bTax;

      months.push({
        month: m,
        gross: incomeM,
        social: socialMonthly,
        fund: fundMonthly,
        tax: monthTax,
        net: incomeM - socialMonthly - fundMonthly - monthTax
      });
    }

    var withheld = months.reduce(function (s, x) { return s + x.tax; }, 0);
    var settlement = Math.round((withheld - totalTax) * 100) / 100; // >0 可退税，<0 需补税

    var afterTaxAnnual = salaryYear + otherIncome + bonus - specialYear - totalTax;
    var effectiveRate = (salaryYear + otherIncome + bonus) > 0
      ? totalTax / (salaryYear + otherIncome + bonus) : 0;

    var marginal = br.rate;

    return {
      inputs: {
        monthlySalary: monthlySalary, bonus: bonus, otherIncome: otherIncome,
        socialMonthly: socialMonthly, fundMonthly: fundMonthly,
        addMonthly: addMonthly, addAnnual: addAnnual, otherAnnual: otherAnnual,
        bonusMode: bonusMode
      },
      gross: {
        salaryYear: salaryYear,
        otherIncome: otherIncome,
        bonus: bonus,
        comprehensive: grossComprehensive,
        total: salaryYear + otherIncome + bonus
      },
      deduction: {
        basic: BASIC_DEDUCTION_YEAR,
        specialYear: specialYear,
        socialYear: socialMonthly * 12,
        fundYear: fundMonthly * 12,
        addMonthlyYear: addMonthlyYear,
        addAnnual: addAnnual,
        additionalYear: additionalYear,
        otherAnnual: otherAnnual,
        total: BASIC_DEDUCTION_YEAR + specialYear + additionalYear + otherAnnual
      },
      taxable: taxable,
      baseTaxable: baseTaxable,
      mergedTaxable: mergedTaxable,
      rate: br.rate,
      quickDeduction: br.qd,
      comprehensiveTax: bonusIncluded ? totalMerge : taxSep,
      bonusTax: bonusIncluded ? 0 : bTax,
      totalTax: totalTax,
      compare: {
        separate: totalSep,
        merge: totalMerge,
        best: totalMerge <= totalSep ? 'merge' : 'separate',
        diff: Math.abs(totalSep - totalMerge),
        chosen: chosen,
        bonusIncluded: bonusIncluded
      },
      afterTaxAnnual: afterTaxAnnual,
      monthlyNetAvg: afterTaxAnnual / 12,
      monthlyNetAvgSalaryOnly: (salaryYear - specialYear - (bonusIncluded ? totalTax : taxSep)) / 12,
      effectiveRate: effectiveRate,
      marginalRate: marginal,
      months: months,
      withheld: withheld,
      settlement: settlement,
      blindZone: detectBlindZone(bonus)
    };
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  /* ---------------- 扣除缺口诊断 ---------------- */

  /** 增加 d 元/年扣除可节税多少（考虑跨档） */
  function savingOf(taxable, d) {
    if (d <= 0) return 0;
    return annualTax(taxable) - annualTax(Math.max(0, taxable - d));
  }

  /**
   * @param {Object} a 当前填报情况（含明细）
   * @param {Object} r compute() 结果
   */
  function diagnose(a, r) {
    var out = [];
    var T = r.baseTaxable;              // 用未并入年终奖的应税所得评估，更直观
    var rate = r.marginalRate;
    var hasBonusExtra = r.inputs.bonus > 0;

    function add(o) { out.push(o); }

    // 1. 住房相关
    if (!a.housing) {
      var s1 = savingOf(T, 18000);
      add({
        key: 'housing', level: s1 > 0 ? 'high' : 'info',
        title: '未申报住房贷款利息 / 住房租金',
        detail: '首套房贷利息 1000 元/月（最长 240 个月）；或按城市档位申报租金 1500 / 1100 / 800 元/月。二者只能选其一。',
        saving: s1, basis: '按租金最高档 1500 元/月测算'
      });
    }

    // 2. 赡养老人
    if (!a.elderly) {
      var s2 = savingOf(T, 36000);
      add({
        key: 'elderly', level: s2 > 0 ? 'high' : 'info',
        title: '未申报赡养老人',
        detail: '父母（或子女均已去世的祖父母）年满 60 周岁即可申报：独生子女 3000 元/月，非独生子女分摊每人不超过 1500 元/月。',
        saving: s2, basis: '按独生子女 3000 元/月测算'
      });
    }

    // 3. 子女教育 / 婴幼儿照护
    if (!a.childEdu && !a.baby) {
      var s3 = savingOf(T, 24000);
      add({
        key: 'child', level: s3 > 0 ? 'high' : 'info',
        title: '未申报子女教育 / 3 岁以下婴幼儿照护',
        detail: '子女教育 2000 元/月·每个子女（含学前至博士）；3 岁以下婴幼儿照护 2000 元/月·每个婴幼儿。父母可各扣 50%，也可一方 100% 扣除。',
        saving: s3, basis: '按 1 个子女 2000 元/月测算'
      });
    }

    // 4. 继续教育
    if (!a.edu) {
      var s4 = savingOf(T, 3600);
      add({
        key: 'edu', level: 'info',
        title: '继续教育扣除可用未用',
        detail: '学历（学位）继续教育 400 元/月（同一学历最长 48 个月）；技能人员 / 专业技术人员职业资格继续教育，取得证书当年一次性扣除 3600 元。',
        saving: s4, basis: '按职业资格证书 3600 元/年测算'
      });
    }

    // 5. 公积金比例
    if (a.fundRate < 12 && r.inputs.monthlySalary > 0) {
      var gapMonthly = a.fundBase * (0.12 - a.fundRate) / 100;
      var s5 = savingOf(T, gapMonthly * 12);
      if (s5 > 0) {
        add({
          key: 'fund', level: 'high',
          title: '公积金缴存比例可提升至 12%',
          detail: '公积金个人缴存部分全额税前扣除，且进入个人账户归自己所有。当前比例 ' + a.fundRate + '%，提升至 12% 每月多缴 '
            + fmt(gapMonthly) + ' 元，属于「换个账户存钱 + 少缴税」。',
          saving: s5, basis: '按提升至 12% 增加的扣除额测算'
        });
      }
    }

    // 6. 个人养老金
    if (a.pension < 12000) {
      var s6 = savingOf(T, 12000 - a.pension);
      if (s6 > 0) {
        add({
          key: 'pension', level: 'high',
          title: '个人养老金账户未顶格使用',
          detail: '每年最高 12000 元税前扣除，资金进入个人养老金账户（退休后领取时按 3% 单独计税）。当前已用 ' + fmt(a.pension) + ' 元。',
          saving: s6, basis: '按补足至 12000 元测算'
        });
      }
    }

    // 7. 大病医疗
    if (!a.majorMedical) {
      add({
        key: 'medical', level: 'info',
        title: '大病医疗扣除别忘在汇算时补报',
        detail: '一个纳税年度内，医保目录范围内个人自付累计超过 15000 元的部分，可在 80000 元限额内据实扣除。该项只能在年度汇算时申报，需留存医疗服务收费票据。',
        saving: 0, basis: '需按实际自付金额测算'
      });
    }

    // 8. 跨档临界点
    var next = null, lower = null, nextIdx = -1;
    for (var i = 0; i < ANNUAL.length - 1; i++) {
      if (T > ANNUAL[i].up && T - ANNUAL[i].up <= 30000) {
        next = ANNUAL[i]; nextIdx = i; break;
      }
    }
    if (next) {
      lower = nextIdx > 0 ? ANNUAL[nextIdx - 1] : null;
      var need = Math.ceil(T - next.up);
      var s8 = annualTax(T) - annualTax(next.up);
      add({
        key: 'bracket', level: 'high',
        title: '距降档只差 ' + fmt(need) + ' 元扣除额',
        detail: '应纳税所得额 ' + fmt(T) + ' 元，刚好越过 ' + fmt(next.up) + ' 元临界点。若再增加 '
          + fmt(need) + ' 元扣除（补缴公积金、个人养老金、补充申报专项附加扣除等），'
          + '整体税负即可回落到 ' + pct(lower ? lower.rate : 0.03) + ' 档区间，少缴 ' + fmt(s8) + ' 元。',
        saving: s8, basis: '按扣除额刚好降至临界点测算'
      });
    }

    // 9. 年终奖盲区
    if (r.blindZone && r.blindZone.inZone) {
      add({
        key: 'blind', level: 'danger',
        title: '年终奖落在「多发少得」盲区',
        detail: '年终奖 ' + fmt(r.inputs.bonus) + ' 元，位于 ' + fmt(r.blindZone.lower) + '–'
          + fmt(r.blindZone.upper) + ' 元的税率跳档盲区：超过 ' + fmt(r.blindZone.lower)
          + ' 元的部分几乎全被更高税率吃掉。建议将发放额调整为 '
          + fmt(r.blindZone.lower) + ' 元及以下，或把超出部分改到下一年发放。',
        saving: r.blindZone.loss, savingLabel: '税后多拿',
        basis: '按调整至临界点测算的税后差额'
      });
    }

    // 10. 年终奖计税方式
    if (hasBonusExtra && r.compare.diff >= 1) {
      add({
        key: 'mode', level: 'mid', realized: true,
        title: '年终奖计税方式已自动择优',
        detail: '单独计税合计 ' + fmt(r.compare.separate) + ' 元，并入综合所得合计 '
          + fmt(r.compare.merge) + ' 元。当前选择「'
          + (r.compare.chosen === 'merge' ? '并入综合所得' : '单独计税') + '」，少缴 '
          + fmt(r.compare.diff) + ' 元。该选择每年汇算时可自行切换。',
        saving: r.compare.diff, basis: '两种方案差额'
      });
    }

    // 11. 高边际税率提醒
    if (rate >= 0.30) {
      add({
        key: 'high', level: 'mid',
        title: '边际税率已达 ' + pct(rate) + '，扣除的「含金量」很高',
        detail: '每增加 1 万元合规扣除，可直接少缴 ' + fmt(10000 * rate)
          + ' 元。优先用足：公积金 12% 顶格、个人养老金 12000 元、企业年金、商业健康险 2400 元/年。',
        saving: 0, basis: '按边际税率测算'
      });
    }

    // 12. 社保基数
    if (a.socialBase > 0 && a.socialBase < r.inputs.monthlySalary * 0.999 && r.inputs.monthlySalary > 0) {
      add({
        key: 'socialbase', level: 'mid',
        title: '社保缴费基数低于实际工资',
        detail: '缴费基数 ' + fmt(a.socialBase) + ' 元低于月薪 ' + fmt(r.inputs.monthlySalary)
          + ' 元。按实际工资足额缴纳，既能增加税前扣除，也直接影响养老、医疗、失业待遇与公积金贷款额度。',
        saving: savingOf(T, (Math.min(r.inputs.monthlySalary, a.socialCap || Infinity) - a.socialBase) * 0.105 * 12),
        basis: '按个人合计费率 10.5% 测算'
      });
    }

    // 排序：先按等级，再按节税额
    var rank = { danger: 0, high: 1, mid: 2, info: 3 };
    out.sort(function (x, y) {
      if (rank[x.level] !== rank[y.level]) return rank[x.level] - rank[y.level];
      return y.saving - x.saving;
    });

    return out;
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  function pct(n) { return (n * 100).toFixed(0) + '%'; }

  /* ---------------- 对外 API ---------------- */

  global.TaxEngine = {
    ANNUAL: ANNUAL,
    BONUS: BONUS,
    BASIC_DEDUCTION_YEAR: BASIC_DEDUCTION_YEAR,
    BLIND_ZONES: BLIND_ZONES,
    compute: compute,
    diagnose: diagnose,
    annualTax: annualTax,
    bonusTaxEach: bonusTaxEach,
    savingOf: savingOf
  };
})(window);
