'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * 在隔离的 vm 沙箱中加载计税引擎。
 * tax-engine.js 是挂载到 window 上的 IIFE，不依赖真实浏览器环境。
 */
function loadEngine() {
  const file = path.join(__dirname, '..', '..', 'assets', 'js', 'tax-engine.js');
  const code = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'tax-engine.js' });

  if (!sandbox.window.TaxEngine) {
    throw new Error('tax-engine.js 未导出 window.TaxEngine');
  }
  return sandbox.window.TaxEngine;
}

module.exports = { loadEngine };
