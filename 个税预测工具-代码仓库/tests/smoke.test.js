'use strict';

/**
 * 静态契约测试：保证页面结构与资源的完整性。
 * 这些断言覆盖了「改了样式/结构调整后功能悄悄失效」这类回归。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// 入口解析：优先模块化 index.html；若交付包只保留单文件版，则退回 index-standalone.html
const MODULAR = path.join(ROOT, 'index.html');
const STANDALONE = path.join(ROOT, 'index-standalone.html');
const ENTRY = fs.existsSync(MODULAR) ? MODULAR : STANDALONE;
const IS_SINGLE_FILE = ENTRY === STANDALONE;

const html = fs.readFileSync(ENTRY, 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'css', 'style.css'), 'utf8');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

/* 页面脚本依赖的全部元素 id */
const REQUIRED_IDS = [
  // 顶栏
  'yearSeg', 'btnShare', 'btnReset',
  // 输入
  'monthlySalary', 'bonus', 'otherIncome',
  'socialBase', 'socialRate', 'fundBase', 'fundRate',
  // 专项附加扣除
  'dedChildEdu', 'childEduCount', 'childEduShare',
  'dedBaby', 'babyCount', 'babyShare',
  'dedEdu', 'eduType',
  'dedHousing', 'housingType',
  'dedElderly', 'elderlyType', 'elderlyShare', 'elderlyShareWrap',
  'dedMedical', 'medicalAmount',
  'pension', 'healthIns', 'bonusMode',
  // 结果区
  'totalTax', 'afterTax', 'monthlyNet', 'taxStress', 'taxDiff',
  'taxable', 'rateBadge', 'rateTrack', 'qd', 'marginal',
  'cmpSep', 'cmpMerge', 'cmpNote',
  'chart', 'flow', 'adviceList', 'adviceTotal', 'detailTable', 'btnCopy',
  // AI 助手
  'chatFab', 'chatPanel', 'chatBody', 'chatForm', 'chatText', 'chatChips',
  'chatStatus', 'btnChatCfg', 'btnChatClose',
  // 设置弹窗
  'cfgModal', 'cfgBase', 'cfgModel', 'cfgKey', 'cfgTemp',
  'cfgSave', 'cfgTest', 'cfgClear', 'cfgStatus',
  'toast'
];

test('页面包含全部关键元素', () => {
  const missing = REQUIRED_IDS.filter(id => !ids.has(id));
  assert.deepEqual(missing, [], `缺少元素：${missing.join(', ')}`);
});

test('脚本按依赖顺序加载', () => {
  if (IS_SINGLE_FILE) {
    // 单文件版：样式与脚本全部内联，且不得再引用任何外部资源
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(inline.length, 3, '单文件版应内联三段脚本');
    assert.equal([...html.matchAll(/<script src=/g)].length, 0, '单文件版不应引用外部 js');
    assert.match(inline[0][1], /(?:window|global)\.TaxEngine/, '第 1 段应为计税引擎');
    assert.match(inline[1][1], /window\.TaxApp/, '第 2 段应为主逻辑');
    assert.match(inline[2][1], /window\.TaxChat/, '第 3 段应为 AI 助手');
    assert.match(html, /<style>[\s\S]*--brand/, '样式应已内联');
    return;
  }
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, [
    'assets/js/tax-engine.js',
    'assets/js/app.js',
    'assets/js/chat.js'
  ], '计税引擎必须先于 app 与 chat 加载');
});

test('所有本地资源文件真实存在', () => {
  const refs = [
    ...html.matchAll(/(?:src|href)="((?!data:|https?:|#)[^"]+)"/g)
  ].map(m => m[1]);

  if (IS_SINGLE_FILE) {
    assert.deepEqual(refs, [], '单文件版不应依赖任何外部资源，否则换个目录打开就会丢样式');
    assert.ok(html.length > 80000, '单文件版应包含内联的样式与脚本');
    return;
  }

  assert.ok(refs.length >= 4, '至少引用 css 与 3 个 js');
  refs.forEach(ref => {
    const p = path.join(ROOT, ref);
    assert.ok(fs.existsSync(p), `资源不存在：${ref}`);
  });
});

test('零外部依赖：不加载任何 CDN 资源', () => {
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(external, [], `发现外部资源：${external.join(', ')}（本工具须支持离线运行）`);
});

test('法定扣除上限写在输入控件上', () => {
  const maxOf = id => {
    const re = new RegExp(`id="${id}"[^>]*`);
    const tag = html.match(re);
    if (!tag) return null;
    const m = tag[0].match(/max="([\d.]+)"/);
    return m ? Number(m[1]) : null;
  };
  assert.equal(maxOf('pension'), 12000, '个人养老金年度上限');
  assert.equal(maxOf('healthIns'), 2400, '商业健康险年度上限');
  assert.equal(maxOf('medicalAmount'), 80000, '大病医疗扣除限额');
  assert.equal(maxOf('elderlyShare'), 1500, '非独生子女赡养分摊上限');
});

test('hidden 属性必须强制生效（防止被类选择器覆盖）', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/, 
    '缺少 [hidden]{display:none!important} 会导致弹窗永远显示');
});

test('样式包含响应式与打印适配断点', () => {
  assert.match(css, /@media\s*\(max-width:\s*1120px\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /@media\s*print/);
});

test('页面声明了移动端视口', () => {
  assert.match(html, /<meta name="viewport" content="[^"]*width=device-width/);
});

test('答辩与合规所需的说明文案存在', () => {
  assert.match(html, /2027\s*年\s*12\s*月\s*31\s*日/, '应说明年终奖优惠执行至 2027 年底');
  assert.match(html, /以扣缴义务人申报及税务机关年度汇算结果为准/, '应有免责说明');
  assert.match(html, /不会上传到任何服务器/, 'AI 设置应说明 Key 不外传');
});
