import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000 }).trim();
const pid = adb('shell', 'pidof', 'app.aiebook.reader');
adb('forward', 'tcp:19222', `localabstract:webview_devtools_remote_${pid}`);
const pages = await fetch('http://127.0.0.1:19222/json').then(response => response.json());
const socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  pending.get(reply.id)?.(reply);
});
async function protocol(method, params) {
  const id = ++sequence;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`超时：${method}`)); }, 15000);
    pending.set(id, reply => { clearTimeout(timer); pending.delete(id); resolve(reply); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  assert.ok(!result.error && !result.result?.exceptionDetails, JSON.stringify(result));
  return result.result;
}
const evaluate = async expression => (await protocol('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
const visible = () => evaluate('document.documentElement.classList.contains("reading-controls-visible")');
async function gesture(startX, endX, startY = 300, endY = startY) {
  await protocol('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
  for (let step = 1; step <= 5; step++) {
    await protocol('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 5, y: startY + (endY - startY) * step / 5 }] });
  }
  await protocol('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(180);
}
try {
  await protocol('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  assert.ok(await evaluate('document.documentElement.classList.contains("touch-reader")'));
  await evaluate('document.querySelector("#left-drawer-close").click(); document.querySelector("#annotation-close").click(); document.documentElement.classList.remove("reading-controls-visible")');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-footer-zone")).visibility'), 'hidden');
  await gesture(180, 180);
  assert.equal(await visible(), true);
  await gesture(180, 180);
  assert.equal(await visible(), false);
  await gesture(260, 140);
  assert.equal(await evaluate('document.querySelector("#left-drawer").getAttribute("aria-hidden")'), 'false');
  await evaluate('document.querySelector("#left-drawer-close").click()');
  await gesture(140, 260);
  assert.equal(await evaluate('document.querySelector("#annotation-drawer").getAttribute("aria-hidden")'), 'false');
  await evaluate('document.querySelector("#annotation-close").click()');
  await gesture(8, 160);
  assert.equal(await evaluate('document.querySelector("#annotation-drawer").getAttribute("aria-hidden")'), 'true');
  await gesture(180, 185, 400, 250);
  assert.equal(await visible(), false);
  await protocol('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300 }] });
  await protocol('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await visible(), false);
  await protocol('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 300 }] });
  await delay(750);
  await protocol('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await visible(), false);
  await protocol('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 300 }, { x: 240, y: 300 }] });
  await protocol('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100, y: 300 }, { x: 280, y: 300 }] });
  await protocol('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await visible(), false);
  console.log('PASS 原生 WebView 点击、左右滑、边缘禁区、纵向滚动、系统取消触摸');

  await evaluate('document.querySelector("#open-settings").click(); document.querySelector("[data-settings-tab=appearance]").click()');
  assert.equal(await evaluate('document.querySelector("#status-bar-setting").hidden'), false);
  await evaluate('document.querySelector("#swipe-edge").value = "80"; document.querySelector("#swipe-edge").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('localStorage.getItem("swipe-edge")'), '80');
  await evaluate('document.querySelector("#left-drawer-close").click()');
  await gesture(60, 180);
  assert.equal(await evaluate('document.querySelector("#annotation-drawer").getAttribute("aria-hidden")'), 'true');
  await evaluate('document.querySelector("#open-settings").click()');
  await protocol('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  const setHidden = async hidden => {
    await evaluate(`(() => { const input = document.querySelector('#hide-status-bar'); input.checked = ${hidden}; input.dispatchEvent(new Event('change')); })()`);
    await delay(800);
    assert.equal(await evaluate('localStorage.getItem("hide-status-bar")'), String(hidden));
  };
  await setHidden(false);
  const normalHeight = await evaluate('innerHeight');
  assert.match(adb('shell', 'dumpsys', 'window'), /type=statusBars[^\n]*visible=true/);
  await setHidden(true);
  const hiddenHeight = await evaluate('innerHeight');
  assert.match(adb('shell', 'dumpsys', 'window'), /type=statusBars[^\n]*visible=false/);
  assert.ok(hiddenHeight >= normalHeight, `隐藏状态栏缩小了可用高度：${normalHeight}/${hiddenHeight}`);
  if (process.env.ANDROID_NO_CUTOUT === '1') assert.ok(hiddenHeight > normalHeight, '无开孔屏幕隐藏状态栏后应增加可用高度');
  await setHidden(false);
  assert.equal(await evaluate('innerHeight'), normalHeight);
  await evaluate('document.querySelector("#swipe-edge").value = "32"; document.querySelector("#swipe-edge").dispatchEvent(new Event("input"))');
  console.log(`PASS 状态栏设置与窗口重排：${normalHeight} → ${hiddenHeight} → ${normalHeight}；禁区设置持久化`);
} finally {
  socket.close();
  adb('forward', '--remove', 'tcp:19222');
}
