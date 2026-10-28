/*!
 * chat.js — 个税 AI 助手浮窗
 * 支持任意 OpenAI 兼容 Chat Completions 接口；未配置 Key 时使用内置规则引擎。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var CFG_KEY = 'taxai.cfg.v1';
  var HISTORY_KEY = 'taxai.history.v1';

  var cfg = loadCfg();
  var history = [];          // {role, content}
  var busy = false;
  var ctxState = null;

  var PRESETS = {
    deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    moonshot: { base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  };

  /* ---------------- 配置 ---------------- */

  function loadCfg() {
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (!raw) return { base: '', model: '', key: '', temp: 0.4 };
      var o = JSON.parse(raw);
      return {
        base: o.base || '', model: o.model || '', key: o.key || '',
        temp: typeof o.temp === 'number' ? o.temp : 0.4
      };
    } catch (e) {
      return { base: '', model: '', key: '', temp: 0.4 };
    }
  }

  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
    updateStatus();
  }

  function apiReady() {
    return !!(cfg.base && cfg.model && cfg.key);
  }

  function updateStatus() {
    var s = $('chatStatus');
    var dot = $('fabDot');
    if (apiReady()) {
      s.textContent = 'AI 已连接 · ' + cfg.model;
      dot.classList.remove('off');
    } else {
      s.textContent = '本地知识库模式 · 可在设置里接入 AI';
      dot.classList.add('off');
    }
  }

  /* ---------------- 消息渲染 ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function mdLite(text) {
    var t = esc(text);
    t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    var blocks = t.split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split('\n');
      var out = [];
      var list = [];
      function flush() {
        if (list.length) {
          out.push('<ul>' + list.map(function (l) { return '<li>' + l + '</li>'; }).join('') + '</ul>');
          list = [];
        }
      }
      lines.forEach(function (l) {
        if (/^\s*([-*·]|\d+[.、])\s+/.test(l)) {
          list.push(l.replace(/^\s*([-*·]|\d+[.、])\s+/, ''));
        } else {
          flush();
          if (l.trim()) out.push(l);
        }
      });
      flush();
      return out.join('<br>');
    }).join('<br>');
  }

  function pushMsg(role, html, opts) {
    opts = opts || {};
    var body = $('chatBody');
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'me' : 'bot');
    wrap.innerHTML = '<div class="av">' + (role === 'user' ? '我' : 'AI') + '</div>'
      + '<div class="bubble">' + (opts.raw ? html : mdLite(html)) + '</div>';
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap.querySelector('.bubble');
  }

  function pushTyping() {
    var body = $('chatBody');
    var wrap = document.createElement('div');
    wrap.className = 'msg bot';
    wrap.dataset.typing = '1';
    wrap.innerHTML = '<div class="av">AI</div><div class="bubble">'
      + '<div class="typing"><i></i><i></i><i></i></div></div>';
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap;
  }

  /* ---------------- 上下文 ---------------- */

  function money(n) {
    return (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  function yuan(n) { return '¥' + money(n); }
  function pct(n) {
    var v = (Number(n) || 0) * 100;
    return (Math.abs(v - Math.round(v)) < 0.05 ? v.toFixed(0) : v.toFixed(1)) + '%';
  }

  function snapshot() {
    if (!ctxState || !ctxState.result) return null;
    var r = ctxState.result;
    var d = ctxState.detail;
    return {
      year: ctxState.year,
      monthlySalary: d.monthlySalary,
      bonus: d.bonus,
      socialYear: r.deduction.specialYear,
      fundRate: d.fundRate,
      addMonthly: d.addMonthly,
      addAnnual: d.addAnnual,
      otherAnnual: d.otherAnnual,
      taxable: r.taxable,
      rate: r.rate,
      qd: r.quickDeduction,
      totalTax: r.totalTax,
      afterTax: r.afterTaxAnnual,
      monthlyNet: r.monthlyNetAvg,
      effectiveRate: r.effectiveRate,
      compare: r.compare,
      settlement: r.settlement,
      withheld: r.withheld,
      blindZone: r.blindZone,
      advice: ctxState.advice,
      saved: r.savedByDeduction
    };
  }

  function contextText() {
    var s = snapshot();
    if (!s) return '（用户尚未完成测算）';
    var lines = [
      '测算年度：' + s.year,
      '税前月薪：' + money(s.monthlySalary),
      '全年一次性奖金：' + money(s.bonus),
      '三险一金（个人）全年：' + money(s.socialYear),
      '公积金缴存比例：' + s.fundRate + '%',
      '专项附加扣除（按月）：' + money(s.addMonthly) + '/月，汇算额外：' + money(s.addAnnual),
      '其他扣除全年：' + money(s.otherAnnual),
      '应纳税所得额：' + money(s.taxable),
      '适用税率：' + pct(s.rate) + '，速算扣除：' + money(s.qd),
      '全年应纳个税：' + money(s.totalTax),
      '税后年收入：' + money(s.afterTax) + '，月均到手：' + money(s.monthlyNet),
      '综合税负率：' + pct(s.effectiveRate),
      '年终奖单独计税：' + money(s.compare.separate) + '，并入综合：' + money(s.compare.merge) + '，当前选择：' + (s.compare.chosen === 'merge' ? '并入综合' : '单独计税'),
      '月度预扣合计：' + money(s.withheld) + '，预计汇算差额：' + money(s.settlement) + '（正数可退税）'
    ];
    if (s.blindZone && s.blindZone.inZone) lines.push('年终奖处于计税盲区：' + money(s.blindZone.lower) + '–' + money(s.blindZone.upper));
    if (s.advice && s.advice.length) {
      lines.push('系统诊断出的扣除缺口：' + s.advice.map(function (a) {
        return a.title + (a.saving ? '（约可节税 ' + money(a.saving) + ' 元）' : '');
      }).join('；'));
    }
    return lines.join('\n');
  }

  function systemPrompt() {
    return [
      '你是一位熟悉中国个人所得税的财税顾问，正在一个网页版个税测算工具的侧边窗里与用户对话。',
      '用户当前已填写的测算数据如下：',
      contextText(),
      '',
      '回答要求：',
      '1. 用简体中文，语气专业、直接、可落地，不要说客套话。',
      '2. 必须结合上面的具体数字举例说明，不要只讲空泛政策。',
      '3. 控制在 220 字以内，可用短横线列表；不要输出 Markdown 表格和标题符号。',
      '4. 涉及政策时说明依据（如《个人所得税专项附加扣除暂行办法》、财政部税务总局公告2023年第30号）。',
      '5. 只讨论合法合规的税前扣除与计税方式选择，绝不提供虚开发票、虚假申报等违法建议；如果用户问到，明确拒绝并说明风险。',
      '6. 不确定的数字不要编造，建议用户以扣缴义务人申报和个税 APP 汇算结果为准。'
    ].join('\n');
  }

  /* ---------------- 本地规则引擎 ---------------- */

  function localAnswer(q) {
    var s = snapshot();
    if (!s) return '先在左侧填一下月薪和年终奖，我就能帮你算了。';

    var has = function () {
      for (var i = 0; i < arguments.length; i++) {
        if (q.indexOf(arguments[i]) >= 0) return true;
      }
      return false;
    };

    // 年终奖
    if (has('年终奖', '一次性奖金', '奖金', '十三薪')) {
      var sep = s.compare.separate, mer = s.compare.merge;
      var out = ['按你填的年终奖 **' + yuan(s.bonus) + '**：',
        '- 单独计税：全年合计个税 **' + yuan(sep) + '**',
        '- 并入综合所得：全年合计个税 **' + yuan(mer) + '**'];
      if (Math.abs(sep - mer) >= 1) {
        out.push('- 差额 **' + yuan(Math.abs(sep - mer)) + '**，当前自动选了更省的「'
          + (s.compare.chosen === 'merge' ? '并入综合' : '单独计税') + '」');
      } else {
        out.push('两种方式税额几乎一样。');
      }
      if (s.blindZone && s.blindZone.inZone) {
        out.push('');
        out.push('⚠️ **注意：**年终奖正处于 **' + yuan(s.blindZone.lower) + '–' + yuan(s.blindZone.upper)
          + '** 的税率跳档盲区，多发的那一段几乎全被更高税率吃掉。建议把发放额压到 **'
          + yuan(s.blindZone.lower) + '** 元及以下，或把超出部分改到下一年发放。');
      }
      out.push('');
      out.push('单独计税优惠依据财政部 税务总局公告 2023 年第 30 号，执行至 2027 年 12 月 31 日，每年只能用一次。');
      return out.join('\n');
    }

    // 公积金
    if (has('公积金')) {
      var cur = s.monthlySalary * s.fundRate / 100;
      var full = s.monthlySalary * 0.12;
      var out2 = ['你现在公积金比例 **' + s.fundRate + '%**，个人月缴约 **' + yuan(cur) + '** 元。'];
      if (s.fundRate < 12) {
        out2.push('- 提到 12%，每月多缴 **' + yuan(full - cur) + '** 元，一年多扣除 ' + yuan((full - cur) * 12) + ' 元');
        out2.push('- 按你 ' + pct(s.rate) + ' 的边际税率，大约少缴个税 **' + yuan((full - cur) * 12 * s.rate) + '** 元');
        out2.push('- 而且这笔钱还在你自己的公积金账户里，可买房、还贷、租房提取');
      } else {
        out2.push('已经顶格 12%，这一项没有优化空间了。');
      }
      out2.push('');
      out2.push('公积金个人缴存部分全额税前扣除，是唯一「钱还是自己的、又能抵税」的项目，优先用满。');
      return out2.join('\n');
    }

    // 扣除缺口
    if (has('扣除', '专项附加', '还能补', '漏', '有没有少', '怎么减', '补什么')) {
      var list = (s.advice || []).filter(function (a) { return a.saving > 0 && !a.realized; });
      if (!list.length) {
        return '按目前填报的信息，专项附加扣除基本用足了。\n\n如果年内有大病医疗自付、职业资格考试、新出生子女，记得在次年 3–6 月汇算时补报，这些往往只能年度汇算扣除。';
      }
      var total = list.reduce(function (a, b) { return a + b.saving; }, 0);
      var out3 = ['还有约 **' + yuan(total) + '** 元的节税空间：'];
      list.slice(0, 4).forEach(function (a) {
        out3.push('- **' + a.title.replace(/<[^>]+>/g, '') + '**：约省 ' + yuan(a.saving));
      });
      out3.push('');
      out3.push('专项附加扣除共 6 项：子女教育、3 岁以下婴幼儿照护、继续教育、住房贷款利息、住房租金、赡养老人；此外个人养老金每年还有 12000 元的其他扣除。');
      return out3.join('\n');
    }

    // 为什么这么高
    if (has('为什么', '这么高', '税负', '太高', '扣这么多')) {
      var out4 = ['你的应纳税所得额是 **' + yuan(s.taxable) + '** 元，落在 ' + pct(s.rate)
        + ' 档，速算扣除数 ' + yuan(s.qd) + '。',
        '- 全年个税 **' + yuan(s.totalTax) + '**，综合税负率 ' + pct(s.effectiveRate) + '（个税 ÷ 税前总收入）',
        '- 各项扣除已经帮你省下 ' + yuan(s.saved) + ' 元',
        '- 月均到手 ' + yuan(s.monthlyNet) + ' 元'];
      out4.push('');
      out4.push('觉得「高」一般有两个原因：一是年终奖单独计税时，税率按奖金 ÷12 定档、却按全额乘税率，跳档瞬间税负陡增；二是累计预扣法下，下半年累计应纳税所得额升档，月度到手会明显变少——这是预扣节奏，不是多收你的税，全年总额不变。');
      return out4.join('\n');
    }

    // 汇算退税
    if (has('汇算', '退税', '补税', '年度申报', '清缴')) {
      var out5 = [];
      if (Math.abs(s.settlement) >= 1) {
        out5.push(s.settlement > 0
          ? '预计年度汇算可退税 **' + yuan(s.settlement) + '** 元。'
          : '预计年度汇算需补税 **' + yuan(-s.settlement) + '** 元。');
        out5.push('原因：月度预扣合计 ' + yuan(s.withheld) + ' 元，全年实际应纳 ' + yuan(s.totalTax) + ' 元。');
      } else {
        out5.push('你的月度预扣和全年应纳基本一致，汇算时差额不大。');
      }
      out5.push('');
      out5.push('汇算时间：次年 3 月 1 日–6 月 30 日，用「个人所得税」APP 办理。年收入不超过 12 万元，或补税金额不超过 400 元的，可以免于办理。');
      return out5.join('\n');
    }

    // 个人养老金
    if (has('养老金', '个人养老')) {
      return '个人养老金账户每年可在税前扣除 **12000 元**，你目前用了 **'
        + yuan(s.otherAnnual) + '** 元（含商业健康险）。\n\n'
        + '按你 ' + pct(s.rate) + ' 的边际税率，缴满一年大约少缴个税 **' + yuan(12000 * s.rate) + '** 元。\n\n'
        + '注意：这笔钱退休领取时按 3% 单独计税，所以边际税率高于 3% 才划算。你现在的档位是合适的。';
    }

    // 计算方式
    if (has('怎么算', '公式', '计算方式', '累计预扣', '预扣', '原理')) {
      return '**全年个税公式**\n'
        + '应纳税所得额 = 综合所得收入 − 6 万 − 三险一金 − 专项附加扣除 − 其他扣除\n'
        + '全年个税 = 应纳税所得额 × 税率 − 速算扣除数\n\n'
        + '**套你的数字**\n'
        + '收入 ' + yuan(s.monthlySalary * 12) + ' − 三险一金 ' + yuan(s.socialYear)
        + ' − 专项附加 ' + yuan(s.addMonthly * 12) + ' − 6 万 − 其他 ' + yuan(s.otherAnnual)
        + ' = 应纳税所得额 **' + yuan(s.taxable) + '**\n'
        + '× ' + pct(s.rate) + ' − ' + yuan(s.qd) + ' = **' + yuan(s.totalTax) + '** 元\n\n'
        + '月度用累计预扣法：把年初到当月的收入与扣除累计后算出应缴总额，再减去已缴部分，所以下半年到手会逐月变少。';
    }

    // 通用画像
    var saveTotal = (s.advice || []).reduce(function (a, b) { return a + (b.realized ? 0 : (b.saving || 0)); }, 0);
    return '按你现在的填写：税前月薪 **' + yuan(s.monthlySalary) + '**，年终奖 **' + yuan(s.bonus)
      + '**，全年个税约 **' + yuan(s.totalTax) + '** 元，月均到手 **' + yuan(s.monthlyNet)
      + '** 元，综合税负率 ' + pct(s.effectiveRate) + '。\n\n'
      + '扣除缺口方面，还有约 **' + yuan(saveTotal) + '** 元的合规节税空间。\n\n'
      + '可以直接问我：年终奖怎么发更省税、公积金要不要提到 12%、还有哪些专项附加扣除没申报。\n\n'
      + '（当前为本地知识库模式，点右上角齿轮接入 AI 模型后可以自由追问。）';
  }

  /* ---------------- API 调用 ---------------- */

  function endpoint() {
    var b = cfg.base.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  function apiError(e) {
    var msg = String(e && e.message || e);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return '网络请求失败。常见原因：1）接口地址填错；2）该服务不允许浏览器直连（CORS 限制），可换用 DeepSeek / 通义等支持前端调用的接口；3）Key 无效。';
    }
    if (/401|403/.test(msg)) return '鉴权失败：API Key 无效或无权限。';
    if (/404/.test(msg)) return '接口路径 404：请确认地址形如 https://api.deepseek.com/v1（不要漏 /v1）。';
    if (/429/.test(msg)) return '请求过于频繁或余额不足（429），稍后再试。';
    return '接口调用失败：' + msg;
  }

  function askAPI(userText, onDelta) {
    var messages = [{ role: 'system', content: systemPrompt() }];
    history.slice(-8).forEach(function (h) { messages.push(h); });
    messages.push({ role: 'user', content: userText });

    return fetch(endpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: messages,
        temperature: cfg.temp,
        stream: true
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 160));
        });
      }
      if (!res.body || !res.body.getReader) {
        return res.json().then(function (j) {
          var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          if (c) onDelta(c);
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          buf += dec.decode(r.value, { stream: true });
          var parts = buf.split('\n');
          buf = parts.pop();
          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (!line || line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              var j = JSON.parse(data);
              var d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message);
              if (d && d.content) onDelta(d.content);
            } catch (err) { /* 忽略心跳 */ }
          }
          return pump();
        });
      }
      return pump();
    });
  }

  /* ---------------- 发送流程 ---------------- */

  function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    $('chatText').value = '';
    $('chatText').style.height = 'auto';
    pushMsg('user', text);

    busy = true;
    $('chatSend').disabled = true;
    var typing = pushTyping();

    function finish(answer, useLocalTag) {
      typing.remove();
      var bubble = pushMsg('bot', '');
      bubble.innerHTML = mdLite(answer) + (useLocalTag
        ? '<div style="margin-top:8px;padding-top:7px;border-top:1px dashed #e2e9f2;font-size:10.5px;color:#93a1b5">本地知识库回答 · 接入 AI 可获得更细致的分析</div>'
        : '');
      $('chatBody').scrollTop = $('chatBody').scrollHeight;
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: answer });
      if (history.length > 16) history = history.slice(-16);
      busy = false;
      $('chatSend').disabled = false;
    }

    if (!apiReady()) {
      setTimeout(function () { finish(localAnswer(text), true); }, 320);
      return;
    }

    var acc = '';
    var bubble = null;
    var started = false;

    var onDelta = function (chunk) {
      if (!started) {
        typing.remove();
        bubble = pushMsg('bot', '');
        started = true;
      }
      acc += chunk;
      bubble.innerHTML = mdLite(acc);
      $('chatBody').scrollTop = $('chatBody').scrollHeight;
    };

    askAPI(text, onDelta).then(function () {
      if (!started) { finish('（接口返回为空，已切换本地知识库回答）\n\n' + localAnswer(text), true); return; }
      typing.remove();
      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: acc });
      if (history.length > 16) history = history.slice(-16);
      busy = false;
      $('chatSend').disabled = false;
    }).catch(function (e) {
      if (started && acc) {
        typing.remove();
        busy = false;
        $('chatSend').disabled = false;
        return;
      }
      typing.remove();
      var b = pushMsg('bot', '');
      b.innerHTML = '<b style="color:#dc2626">AI 接口调用失败</b><br>' + esc(apiError(e))
        + '<hr><span style="font-size:11px;color:#93a1b5">已切换为本地知识库回答：</span><br>'
        + mdLite(localAnswer(text));
      $('chatBody').scrollTop = $('chatBody').scrollHeight;
      busy = false;
      $('chatSend').disabled = false;
    });
  }

  /* ---------------- 事件 ---------------- */

  function openPanel() {
    $('chatPanel').hidden = false;
    $('chatFab').classList.add('hide');
    if (!history.length && !$('chatBody').children.length) {
      pushMsg('bot', '我是你的个税助手。左侧的测算数据我已同步，可以直接问我：\n\n'
        + '- 我的税为什么这么高\n'
        + '- 还有哪些扣除能补\n'
        + '- 年终奖怎么发最省税\n'
        + '- 公积金要不要提到 12%', { raw: false });
    }
    setTimeout(function () { $('chatText').focus(); }, 180);
  }

  function closePanel() {
    $('chatPanel').hidden = true;
    $('chatFab').classList.remove('hide');
  }

  function openCfg() {
    $('cfgBase').value = cfg.base;
    $('cfgModel').value = cfg.model;
    $('cfgKey').value = cfg.key;
    $('cfgTemp').value = cfg.temp;
    $('cfgStatus').textContent = '';
    $('cfgStatus').className = 'cfg-status';
    $('cfgModal').hidden = false;
  }

  function closeCfg() { $('cfgModal').hidden = true; }

  function bind() {
    $('chatFab').addEventListener('click', openPanel);
    $('btnChatClose').addEventListener('click', closePanel);
    $('btnChatCfg').addEventListener('click', openCfg);

    $('chatForm').addEventListener('submit', function (e) {
      e.preventDefault();
      send($('chatText').value);
    });

    $('chatText').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send($('chatText').value);
      }
    });
    $('chatText').addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(96, this.scrollHeight) + 'px';
    });

    $('chatChips').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (btn) send(btn.textContent.trim());
    });

    // 弹窗
    $('cfgModal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeCfg();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeCfg(); }
    });

    document.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = PRESETS[btn.dataset.preset];
        if (!p) return;
        $('cfgBase').value = p.base;
        $('cfgModel').value = p.model;
        $('cfgStatus').textContent = '已填入 ' + p.base + '，补上 API Key 后保存即可。';
        $('cfgStatus').className = 'cfg-status';
      });
    });

    $('cfgSave').addEventListener('click', function () {
      cfg.base = $('cfgBase').value.trim() || 'https://api.deepseek.com/v1';
      cfg.model = $('cfgModel').value.trim() || 'deepseek-chat';
      cfg.key = $('cfgKey').value.trim();
      cfg.temp = Math.max(0, Math.min(1.5, parseFloat($('cfgTemp').value) || 0.4));
      saveCfg();
      closeCfg();
      if (cfg.key) {
        pushMsg('bot', '接口已接入：<code>' + esc(cfg.model) + '</code>。后续提问会带上你当前的测算数字，回答会更有针对性。');
      } else {
        pushMsg('bot', '没有填 API Key，继续使用本地知识库模式。');
      }
    });

    $('cfgClear').addEventListener('click', function () {
      cfg = { base: '', model: '', key: '', temp: 0.4 };
      saveCfg();
      $('cfgBase').value = ''; $('cfgModel').value = ''; $('cfgKey').value = '';
      $('cfgStatus').textContent = '已清除本地接口配置。';
      $('cfgStatus').className = 'cfg-status';
    });

    $('cfgTest').addEventListener('click', function () {
      var base = $('cfgBase').value.trim();
      var model = $('cfgModel').value.trim();
      var key = $('cfgKey').value.trim();
      var st = $('cfgStatus');
      if (!base || !model || !key) {
        st.textContent = '请先填写接口地址、模型和 API Key。';
        st.className = 'cfg-status err';
        return;
      }
      st.textContent = '正在连接…';
      st.className = 'cfg-status';

      var url = base.replace(/\/+$/, '');
      if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: '回复"连接成功"四个字' }],
          max_tokens: 20,
          stream: false
        })
      }).then(function (res) {
        if (!res.ok) return res.text().then(function (t) { throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 120)); });
        return res.json();
      }).then(function (j) {
        var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        st.textContent = '连接成功，模型返回：' + (c || '(空)').slice(0, 40);
        st.className = 'cfg-status ok';
      }).catch(function (e) {
        st.textContent = apiError(e);
        st.className = 'cfg-status err';
      });
    });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    bind();
    updateStatus();
    if (!ctxState && window.__TAX_STATE__) ctxState = window.__TAX_STATE__;

    // 支持 ?chat=1 直接展开助手，?q=xxx 预置问题
    try {
      var qs = new URLSearchParams(location.search);
      if (qs.get('chat')) {
        openPanel();
        var q = qs.get('q');
        if (q) setTimeout(function () { send(q); }, 420);
      }
    } catch (e) { /* 忽略不支持的环境 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.TaxChat = {
    onStateChange: function (s) { ctxState = s; },
    open: openPanel,
    send: send
  };
})();
