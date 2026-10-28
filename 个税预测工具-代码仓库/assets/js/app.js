/*!
 * app.js — 个税预测工具主逻辑
 */
(function () {
  'use strict';

  var E = window.TaxEngine;
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    year: 2027,
    params: null,
    detail: null,
    result: null,
    salaryOnly: null,
    advice: []
  };

  /* ---------------- 工具 ---------------- */

  function num(id) {
    var n = parseFloat($(id).value);
    return isFinite(n) ? n : 0;
  }
  function money(n, dec) {
    n = Number(n) || 0;
    return n.toLocaleString('zh-CN', {
      minimumFractionDigits: dec || 0,
      maximumFractionDigits: dec || 0
    });
  }
  function yuan(n, dec) { return '¥' + money(n, dec); }
  function pct(n, dec) {
    var v = (Number(n) || 0) * 100;
    return (dec === undefined ? (Math.abs(v - Math.round(v)) < 0.05 ? v.toFixed(0) : v.toFixed(1)) : v.toFixed(dec)) + '%';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------------- 读取表单 ---------------- */

  function readInputs() {
    var monthlySalary = num('monthlySalary');
    var bonus = num('bonus');
    var otherIncome = num('otherIncome');
    var socialBase = num('socialBase');
    var socialRate = clamp(num('socialRate'), 0, 100);
    var fundBase = num('fundBase');
    var fundRate = parseFloat($('fundRate').value) || 12;

    var socialMonthly = socialBase * socialRate / 100;
    var fundMonthly = fundBase * fundRate / 100;

    var addMonthly = 0;
    var addAnnual = 0;
    var detail = {
      childEdu: 0, baby: 0, edu: 0, housing: 0, elderly: 0,
      medical: 0, pension: 0, healthIns: 0,
      flags: {}
    };

    if ($('dedChildEdu').checked) {
      var cCount = parseInt($('childEduCount').value, 10) || 1;
      var cShare = parseFloat($('childEduShare').value) || 100;
      detail.childEdu = 2000 * cCount * cShare / 100;
      addMonthly += detail.childEdu;
      detail.flags.children = cCount;
    }
    if ($('dedBaby').checked) {
      var bCount = parseInt($('babyCount').value, 10) || 1;
      var bShare = parseFloat($('babyShare').value) || 100;
      detail.baby = 2000 * bCount * bShare / 100;
      addMonthly += detail.baby;
    }
    if ($('dedEdu').checked) {
      var et = $('eduType').value;
      if (et === 'degree') {
        detail.edu = 400;
        addMonthly += 400;
      } else {
        detail.edu = 0;
        addAnnual += 3600;
        detail.eduOnce = 3600;
      }
    }
    if ($('dedHousing').checked) {
      var ht = $('housingType').value;
      detail.housing = ht === 'loan' ? 1000 : ht === 'rent1500' ? 1500 : ht === 'rent1100' ? 1100 : 800;
      addMonthly += detail.housing;
      detail.flags.housing = ht;
    }
    if ($('dedElderly').checked) {
      if ($('elderlyType').value === 'only') {
        detail.elderly = 3000;
      } else {
        detail.elderly = clamp(num('elderlyShare'), 0, 1500);
      }
      addMonthly += detail.elderly;
      detail.flags.elderly = $('elderlyType').value;
    }
    if ($('dedMedical').checked) {
      detail.medical = clamp(num('medicalAmount'), 0, 80000);
      addAnnual += detail.medical;
    }

    detail.pension = clamp(num('pension'), 0, 12000);
    detail.healthIns = clamp(num('healthIns'), 0, 2400);
    var otherAnnual = detail.pension + detail.healthIns;

    var bonusModeEl = document.querySelector('#bonusMode input:checked');
    var bonusMode = bonusModeEl ? bonusModeEl.value : 'auto';

    return {
      params: {
        monthlySalary: monthlySalary,
        bonus: bonus,
        otherIncome: otherIncome,
        socialMonthly: socialMonthly,
        fundMonthly: fundMonthly,
        addMonthly: addMonthly,
        addAnnual: addAnnual,
        otherAnnual: otherAnnual,
        bonusMode: bonusMode
      },
      ctx: {
        monthlySalary: monthlySalary,
        bonus: bonus,
        otherIncome: otherIncome,
        socialBase: socialBase,
        socialRate: socialRate,
        socialMonthly: socialMonthly,
        fundBase: fundBase,
        fundRate: fundRate,
        fundMonthly: fundMonthly,
        addMonthly: addMonthly,
        addAnnual: addAnnual,
        otherAnnual: otherAnnual,
        bonusMode: bonusMode,
        housing: !!$('dedHousing').checked,
        elderly: !!$('dedElderly').checked,
        childEdu: !!$('dedChildEdu').checked,
        baby: !!$('dedBaby').checked,
        edu: !!$('dedEdu').checked,
        majorMedical: !!$('dedMedical').checked,
        pension: detail.pension,
        healthIns: detail.healthIns,
        detail: detail
      }
    };
  }

  /* ---------------- 计算 ---------------- */

  function recalc() {
    var read = readInputs();
    var p = read.params;

    var r = E.compute(p);
    var salaryOnly = E.compute(Object.assign({}, p, { bonus: 0, bonusMode: 'separate' }));

    // 基准：不使用任何专项附加/其他扣除
    var base = E.compute(Object.assign({}, p, {
      addMonthly: 0, addAnnual: 0, otherAnnual: 0
    }));

    r.baselineTax = base.totalTax;
    r.savedByDeduction = Math.max(0, base.totalTax - r.totalTax);

    state.params = p;
    state.detail = read.ctx;
    state.result = r;
    state.salaryOnly = salaryOnly;
    state.advice = E.diagnose(read.ctx, r);

    render();
    syncDedUI();
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    var r = state.result;
    var d = state.detail;

    // Hero
    $('heroLabel').textContent = state.year + ' 年预计全年个税';
    $('totalTax').textContent = money(r.totalTax);
    $('afterTax').textContent = yuan(r.afterTaxAnnual);
    $('monthlyNet').textContent = yuan(r.monthlyNetAvg);
    $('taxStress').textContent = '综合税负率 ' + pct(r.effectiveRate, 1);
    var diffEl = $('taxDiff');
    if (r.savedByDeduction >= 1) {
      diffEl.innerHTML = '扣除项已帮您省下 <b>' + yuan(r.savedByDeduction) + '</b>';
    } else {
      diffEl.textContent = '含社保公积金与全部扣除';
    }

    // 应税与税率
    $('taxable').textContent = yuan(r.taxable);
    $('rateBadge').textContent = pct(r.rate);
    $('qd').textContent = yuan(r.quickDeduction);
    $('marginal').textContent = pct(r.marginalRate);
    renderRateTrack(r.rate);

    // 年终奖对比
    $('cmpSep').textContent = yuan(r.compare.separate);
    $('cmpMerge').textContent = yuan(r.compare.merge);
    var items = document.querySelectorAll('.cmp-item');
    items.forEach(function (el) {
      el.classList.toggle('win', el.dataset.mode === r.compare.chosen);
    });
    var note = $('cmpNote');
    if (r.inputs.bonus <= 0) {
      note.textContent = '未填写年终奖，本项不参与比较。';
    } else if (r.compare.diff < 1) {
      note.textContent = '两种方式税额一致，可任选其一。';
    } else {
      note.innerHTML = '当前按「<b>' + (r.compare.chosen === 'merge' ? '并入综合所得' : '单独计税')
        + '</b>」测算，比另一种方式少缴 <b>' + yuan(r.compare.diff) + '</b> 元。这一选择在每年汇算时都可自行切换。';
    }

    renderChart();
    renderFlow();
    renderAdvice();
    renderDetail();

    window.__TAX_STATE__ = state;
    if (window.TaxChat && window.TaxChat.onStateChange) window.TaxChat.onStateChange(state);
  }

  function renderRateTrack(rate) {
    var box = $('rateTrack');
    var labels = ['3%', '10%', '20%', '25%', '30%', '35%', '45%'];
    box.innerHTML = labels.map(function (lb, i) {
      var on = E.ANNUAL[i].rate === rate ? ' active' : '';
      return '<div class="rate-seg' + on + '">' + lb + '</div>';
    }).join('');
  }

  /* ---- 月度现金流 ---- */

  function renderChart() {
    var months = state.salaryOnly.months;
    var maxGross = Math.max.apply(null, months.map(function (m) { return m.gross; })) || 1;
    var box = $('chart');

    box.innerHTML = months.map(function (m) {
      var hTot = m.gross / maxGross * 100;
      var hNet = m.net / maxGross * 100;
      var hTax = m.tax / maxGross * 100;
      var hDed = (m.social + m.fund) / maxGross * 100;
      return '<div class="bar">'
        + '<div class="bar-tip">' + m.month + ' 月<br>'
        + '税前 <b>' + yuan(m.gross) + '</b><br>'
        + '社保公积金 ' + yuan(m.social + m.fund) + '<br>'
        + '个税 ' + yuan(m.tax) + '<br>'
        + '到手 <b>' + yuan(m.net) + '</b></div>'
        + '<div class="bar-stack" style="height:' + hTot.toFixed(2) + '%">'
        + '<div class="bar-seg ded" style="height:' + hDed.toFixed(2) + '%"></div>'
        + '<div class="bar-seg tax" style="height:' + hTax.toFixed(2) + '%"></div>'
        + '<div class="bar-seg net" style="height:' + hNet.toFixed(2) + '%"></div>'
        + '</div>'
        + '<div class="bar-x">' + m.month + '</div>'
        + '</div>';
    }).join('');

    $('monthHint').textContent = '逐月累计预扣法模拟 · 单位：元';

    var r = state.result;
    var note = $('settleNote');
    if (r.inputs.bonus > 0) {
      var bonusNet = r.inputs.bonus - (r.compare.bonusIncluded ? 0 : r.bonusTax);
      note.innerHTML = '年终奖 ¥' + money(r.inputs.bonus) + ' 一次性发放，'
        + (r.compare.bonusIncluded ? '已并入综合所得计税' : '单独计税 <b>' + yuan(r.bonusTax) + '</b>');
    } else if (Math.abs(r.settlement) >= 1) {
      note.textContent = r.settlement > 0
        ? '预计年度汇算可退税 ' + yuan(r.settlement)
        : '预计年度汇算需补税 ' + yuan(-r.settlement);
    } else {
      note.textContent = '';
    }
  }

  /* ---- 收入结构 ---- */

  function renderFlow() {
    var r = state.result;
    var g = r.gross.total || 1;
    var rows = [
      { lb: '税前总收入', v: r.gross.total, cls: 'b1' },
      { lb: '三险一金（个人）', v: r.deduction.specialYear, cls: 'b2' },
      { lb: '专项附加扣除', v: r.deduction.additionalYear, cls: 'b3' },
      { lb: '其他扣除', v: r.deduction.otherAnnual, cls: 'b4' },
      { lb: '基本减除费用', v: r.deduction.basic, cls: 'b5' }
    ];

    var html = rows.map(function (x) {
      var w = clamp(x.v / g * 100, 0, 100);
      return '<div class="flow-row">'
        + '<span class="flow-lb">' + x.lb + '</span>'
        + '<div class="flow-bar-wrap"><div class="flow-bar ' + x.cls + '" style="width:'
        + (x.v > 0 ? Math.max(w, 1.5) : 0).toFixed(2) + '%"></div></div>'
        + '<span class="flow-val">' + yuan(x.v) + '</span>'
        + '</div>';
    }).join('');

    html += '<div class="flow-row" style="margin-top:6px;padding-top:11px;border-top:1px solid var(--line)">'
      + '<span class="flow-lb" style="color:var(--ink);font-weight:700">应纳税所得额</span>'
      + '<div class="flow-bar-wrap"><div class="flow-bar b1" style="width:'
      + clamp(r.taxable / g * 100, 1, 100).toFixed(2) + '%"></div></div>'
      + '<span class="flow-val">' + yuan(r.taxable) + '</span>'
      + '</div>';

    html += '<div class="flow-row">'
      + '<span class="flow-lb" style="color:var(--ink);font-weight:700">全年应纳个税</span>'
      + '<div class="flow-bar-wrap"><div class="flow-bar" style="width:'
      + clamp(r.totalTax / g * 100, 0.6, 100).toFixed(2) + '%;background:var(--danger)"></div></div>'
      + '<span class="flow-val" style="color:var(--danger)">' + yuan(r.totalTax) + '</span>'
      + '</div>';

    $('flow').innerHTML = html;
  }

  /* ---- 诊断建议 ---- */

  var LEVEL_TAG = { danger: '风险', high: '重点', mid: '提示', info: '科普' };
  var LEVEL_ICO = { danger: '!', high: '↑', mid: 'i', info: '?' };

  function renderAdvice() {
    var list = state.advice;
    var total = list.reduce(function (s, x) {
      return s + (x.realized ? 0 : (x.saving || 0));
    }, 0);

    $('adviceTotal').innerHTML = total > 0
      ? '<span class="ico">'
        + '<svg viewBox="0 0 24 24" fill="none"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
        + '</span>还有约 <strong>' + yuan(total) + '</strong> 元的合规节税空间，相当于目前多缴的税'
      : '<span class="ico">'
        + '<svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</span>扣除项已基本用足，暂未发现明显缺口';

    if (!list.length) {
      $('adviceList').innerHTML = '<div class="adv info"><div class="adv-ico">✓</div>'
        + '<div class="adv-body"><div class="adv-title">各项扣除均已覆盖</div>'
        + '<div class="adv-desc">按当前填报信息，未发现可补充的扣除项目。如年内发生大病医疗、职业资格考试等情况，记得在汇算时补充申报。</div></div></div>';
      return;
    }

    $('adviceList').innerHTML = list.map(function (x) {
      var saveHtml;
      if (x.realized) {
        saveHtml = '<div class="adv-save" style="color:var(--brand)">已优化</div>'
          + '<div class="adv-basis">节省 ' + yuan(x.saving) + '</div>';
      } else if (x.saving > 0) {
        saveHtml = '<div class="adv-save">' + yuan(x.saving) + '</div><div class="adv-basis">'
          + (x.savingLabel || '预计可节税') + '</div>';
      } else {
        saveHtml = '<div class="adv-save zero">待测算</div><div class="adv-basis">' + (x.basis || '') + '</div>';
      }
      return '<div class="adv ' + x.level + '">'
        + '<div class="adv-ico">' + (LEVEL_ICO[x.level] || 'i') + '</div>'
        + '<div class="adv-body">'
        + '<div class="adv-title">' + x.title
        + '<span class="adv-tag">' + (LEVEL_TAG[x.level] || '') + '</span></div>'
        + '<div class="adv-desc">' + x.detail + '</div>'
        + '</div>'
        + '<div class="adv-side">' + saveHtml + '</div>'
        + '</div>';
    }).join('');
  }

  /* ---- 明细 ---- */

  function renderDetail() {
    var r = state.result;
    var d = state.detail;
    var rows = [];

    rows.push(['grp', '收入']);
    rows.push(['工资薪金 ' + yuan(d.monthlySalary) + ' × 12', yuan(r.gross.salaryYear)]);
    if (r.gross.otherIncome > 0) rows.push(['其他综合所得', yuan(r.gross.otherIncome)]);
    if (r.gross.bonus > 0) rows.push(['全年一次性奖金', yuan(r.gross.bonus)]);

    rows.push(['grp', '扣除项目']);
    rows.push(['基本减除费用（5000 × 12）', '−' + yuan(r.deduction.basic)]);
    rows.push(['三险一金（个人缴纳）', '−' + yuan(r.deduction.specialYear)]);
    rows.push(['专项附加扣除（按月申报）', '−' + yuan(r.deduction.addMonthlyYear)]);
    if (r.deduction.addAnnual > 0) rows.push(['专项附加扣除（汇算申报）', '−' + yuan(r.deduction.addAnnual)]);
    if (r.deduction.otherAnnual > 0) rows.push(['其他扣除（养老金 / 健康险）', '−' + yuan(r.deduction.otherAnnual)]);

    rows.push(['grp', '计税']);
    rows.push(['应纳税所得额', yuan(r.taxable)]);
    rows.push(['适用税率 / 速算扣除数', pct(r.rate) + ' / ' + yuan(r.quickDeduction)]);
    rows.push(['综合所得应纳税额', yuan(r.comprehensiveTax)]);
    if (!r.compare.bonusIncluded && r.gross.bonus > 0) {
      rows.push(['年终奖应纳税额（单独计税）', yuan(r.bonusTax)]);
    }
    rows.push(['total', '全年应纳个税合计', yuan(r.totalTax)]);

    rows.push(['grp', '结果']);
    rows.push(['税后年收入', yuan(r.afterTaxAnnual)]);
    rows.push(['月均到手', yuan(r.monthlyNetAvg)]);
    rows.push(['月度预扣合计', yuan(r.withheld)]);
    if (Math.abs(r.settlement) >= 1) {
      rows.push([
        r.settlement > 0 ? '预计汇算可退税' : '预计汇算需补税',
        (r.settlement > 0 ? '+' : '−') + yuan(Math.abs(r.settlement))
      ]);
    }

    $('detailTable').innerHTML = rows.map(function (x) {
      if (x[0] === 'grp') return '<tr class="grp"><td colspan="2">' + x[1] + '</td></tr>';
      if (x[0] === 'total') return '<tr class="total"><td>' + x[1] + '</td><td>' + x[2] + '</td></tr>';
      return '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td></tr>';
    }).join('');
  }

  /* ---------------- 扣除项 UI 联动 ---------------- */

  function syncDedUI() {
    var d = state.detail.detail;
    var isCert = $('dedEdu').checked && $('eduType').value === 'cert';

    var map = [
      { key: 'childEdu', amt: 'amtChildEdu', v: d.childEdu },
      { key: 'baby', amt: 'amtBaby', v: d.baby },
      { key: 'edu', amt: 'amtEdu', v: isCert ? 0 : d.edu, once: isCert ? 3600 : 0 },
      { key: 'housing', amt: 'amtHousing', v: d.housing },
      { key: 'elderly', amt: 'amtElderly', v: d.elderly },
      { key: 'majorMedical', amt: 'amtMedical', v: d.medical, perYear: true }
    ];

    map.forEach(function (item) {
      var el = $(item.amt);
      if (!el) return;
      if (item.once) {
        el.textContent = yuan(item.once) + '/年';
      } else if (item.v > 0) {
        el.textContent = yuan(item.v) + (item.perYear ? '/年' : '');
      } else {
        el.textContent = '¥0';
      }
    });

    // 开关状态
    document.querySelectorAll('.ded').forEach(function (el) {
      var cb = el.querySelector('.switch input');
      el.classList.toggle('on', !!(cb && cb.checked));
    });

    // 子控件显隐
    document.querySelectorAll('[data-when]').forEach(function (el) {
      var host = $(el.dataset.when);
      el.hidden = !(host && host.checked);
    });
    $('elderlyShareWrap').hidden = !($('dedElderly').checked && $('elderlyType').value === 'shared');

    // 合计
    var addM = state.detail.addMonthly;
    var addA = state.detail.addAnnual;
    var hint = '合计 ' + yuan(addM) + ' / 月';
    if (addA > 0) hint += ' · 汇算另扣 ' + yuan(addA);
    $('addSumHint').textContent = hint;
    $('socialFundSum').textContent = yuan(state.detail.socialMonthly + state.detail.fundMonthly) + ' / 月';
  }

  /* ---------------- 交互绑定 ---------------- */

  function bind() {
    var form = $('taxForm');
    var run = debounce(recalc, 110);

    form.addEventListener('input', function (e) {
      if (e.target.id === 'monthlySalary') {
        if (e.target.dataset.touched !== '1') {
          $('socialBase').value = e.target.value;
          $('fundBase').value = e.target.value;
        }
      }
      if (e.target.id === 'socialBase' || e.target.id === 'fundBase') {
        e.target.dataset.touched = '1';
      }
      run();
    });
    form.addEventListener('change', function (e) {
      if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT' ||
          (e.target.type === 'radio')) {
        run();
      }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    // 单选组高亮
    document.querySelectorAll('#bonusMode .radio').forEach(function (lab) {
      lab.addEventListener('click', function () {
        document.querySelectorAll('#bonusMode .radio').forEach(function (x) { x.classList.remove('on'); });
        lab.classList.add('on');
      });
    });

    // 年度切换
    $('yearSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-year]');
      if (!btn) return;
      state.year = parseInt(btn.dataset.year, 10);
      document.querySelectorAll('#yearSeg button').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      render();
    });

    // 重置
    $('btnReset').addEventListener('click', function () {
      $('monthlySalary').value = 20000;
      $('bonus').value = 60000;
      $('otherIncome').value = 0;
      $('socialBase').value = 20000;
      $('socialRate').value = 10.5;
      $('fundBase').value = 20000;
      $('fundRate').value = 12;
      ['dedChildEdu', 'dedBaby', 'dedEdu', 'dedHousing', 'dedElderly', 'dedMedical'].forEach(function (id) {
        $(id).checked = false;
      });
      $('childEduCount').value = '1';
      $('childEduShare').value = '100';
      $('babyCount').value = '1';
      $('babyShare').value = '100';
      $('eduType').value = 'degree';
      $('housingType').value = 'loan';
      $('elderlyType').value = 'only';
      $('elderlyShare').value = 1500;
      $('medicalAmount').value = 0;
      $('pension').value = 0;
      $('healthIns').value = 0;
      $('socialBase').dataset.touched = '';
      $('fundBase').dataset.touched = '';
      $('monthlySalary').dataset.touched = '';
      var auto = document.querySelector('#bonusMode input[value="auto"]');
      if (auto) { auto.checked = true; auto.dispatchEvent(new Event('change', { bubbles: true })); }
      document.querySelectorAll('#bonusMode .radio').forEach(function (x, i) {
        x.classList.toggle('on', i === 0);
      });
      history.replaceState(null, '', location.pathname);
      recalc();
      toast('已恢复默认参数');
    });

    // 分享
    $('btnShare').addEventListener('click', function () {
      var q = encodeState();
      var url = location.origin + location.pathname + '#s=' + q;
      var done = function () { toast('方案链接已复制，可直接发给同事'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url, done); });
      } else {
        fallbackCopy(url, done);
      }
      history.replaceState(null, '', '#s=' + q);
    });

    // 复制明细
    $('btnCopy').addEventListener('click', function () {
      var r = state.result;
      var lines = [
        '【' + state.year + ' 年个税测算】',
        '税前月薪：' + yuan(state.detail.monthlySalary),
        '年终奖：' + yuan(state.detail.bonus),
        '三险一金（个人）：' + yuan(r.deduction.specialYear) + '/年',
        '专项附加扣除：' + yuan(r.deduction.additionalYear) + '/年',
        '其他扣除：' + yuan(r.deduction.otherAnnual) + '/年',
        '应纳税所得额：' + yuan(r.taxable),
        '适用税率：' + pct(r.rate) + '（速算扣除 ' + yuan(r.quickDeduction) + '）',
        '全年个税：' + yuan(r.totalTax),
        '税后年收入：' + yuan(r.afterTaxAnnual),
        '月均到手：' + yuan(r.monthlyNetAvg),
        '综合税负率：' + pct(r.effectiveRate, 1)
      ];
      var text = lines.join('\n');
      var done = function () { toast('测算明细已复制'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    });
  }

  function fallbackCopy(text, cb) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb && cb(); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  /* ---------------- URL 状态 ---------------- */

  var FIELDS = ['monthlySalary', 'bonus', 'otherIncome', 'socialBase', 'socialRate',
    'fundBase', 'fundRate', 'childEduCount', 'childEduShare', 'babyCount', 'babyShare',
    'eduType', 'housingType', 'elderlyType', 'elderlyShare', 'medicalAmount',
    'pension', 'healthIns'];
  var CHECKS = ['dedChildEdu', 'dedBaby', 'dedEdu', 'dedHousing', 'dedElderly', 'dedMedical'];

  function encodeState() {
    var o = { y: state.year };
    FIELDS.forEach(function (id) { o[id] = $(id).value; });
    CHECKS.forEach(function (id) { o[id] = $(id).checked ? 1 : 0; });
    var el = document.querySelector('#bonusMode input:checked');
    o.bm = el ? el.value : 'auto';
    var json = JSON.stringify(o);
    return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeState(q) {
    try {
      var b = q.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function applyState(o) {
    if (!o) return;
    if (o.y) {
      state.year = parseInt(o.y, 10) || 2027;
      document.querySelectorAll('#yearSeg button').forEach(function (b) {
        b.classList.toggle('on', parseInt(b.dataset.year, 10) === state.year);
      });
    }
    FIELDS.forEach(function (id) {
      if (o[id] !== undefined && $(id)) $(id).value = o[id];
    });
    CHECKS.forEach(function (id) { if (o[id] !== undefined) $(id).checked = !!o[id]; });
    if (o.bm) {
      var el = document.querySelector('#bonusMode input[value="' + o.bm + '"]');
      if (el) {
        el.checked = true;
        document.querySelectorAll('#bonusMode .radio').forEach(function (x) {
          x.classList.toggle('on', x.querySelector('input').checked);
        });
      }
    }
    $('socialBase').dataset.touched = '1';
    $('fundBase').dataset.touched = '1';
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    bind();
    var m = location.hash.match(/s=([A-Za-z0-9\-_]+)/);
    if (m) {
      var o = decodeState(m[1]);
      if (o) applyState(o);
    }
    recalc();
    if (!m) setTimeout(function () { toast('已按示例参数完成测算，可直接修改左侧数值'); }, 900);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TaxApp = {
    state: state,
    recalc: recalc,
    yuan: yuan,
    money: money,
    pct: pct
  };
})();
