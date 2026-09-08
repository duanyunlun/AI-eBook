import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 30000 }).trim();
const provider = { protocol: 'open_ai_chat_completions', baseUrl: 'http://127.0.0.1:18763/v1', model: 'android-test', maxOutputTokens: 1024 };
const requests = [];
const toolNames = ['reading_context', 'read_page', 'search_book', 'search_knowledge', 'save_note'];
const argumentsByTool = [{}, { page: 1 }, { query: '测试' }, { query: '测试' }, { title: '测试', body: '测试正文' }];
const server = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, 'Bearer android-test-only');
    const payload = JSON.parse(body);
    requests.push(payload);
    const results = payload.messages.filter(message => message.role === 'tool');
    const delta = results.length
      ? { content: 'Android DSH 工具验证成功' }
      : { tool_calls: toolNames.map((name, index) => ({ index, id: `call-${index}`, type: 'function', function: { name, arguments: JSON.stringify(argumentsByTool[index]) } })) };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [content, reason] of [[delta, null], [{}, results.length ? 'stop' : 'tool_calls']]) {
      response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: content, finish_reason: reason }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  } catch {
    response.writeHead(500);
    response.end('Test model request failed');
  }
});
await new Promise(resolve => server.listen(18763, '127.0.0.1', resolve));
adb('reverse', 'tcp:18763', 'tcp:18763');
let socket;
let sequence = 0;
const pending = new Map();
async function connect() {
  const pid = adb('shell', 'pidof', 'app.aiebook.reader');
  adb('forward', 'tcp:19222', `localabstract:webview_devtools_remote_${pid}`);
  let page;
  for (let attempt = 0; attempt < 20; attempt++) {
    const pages = await fetch('http://127.0.0.1:19222/json').then(response => response.json()).catch(() => []);
    page = pages.find(page => page.type === 'page' && page.webSocketDebuggerUrl);
    if (page) break;
    await delay(1000);
  }
  assert.ok(page, 'Android WebView 调试通道不可用');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    const callback = pending.get(reply.id);
    if (callback) { pending.delete(reply.id); callback(reply); }
  });
}
async function evaluate(expression, timeout = 300000) {
  const id = ++sequence;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Android DSH 测试超时')); }, timeout);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  assert.ok(!result.error && !result.result?.exceptionDetails, JSON.stringify(result.error || result.result?.exceptionDetails));
  return result.result.result.value;
}
const invoke = (command, args = {}) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
try {
  await connect();
  assert.equal(await evaluate('document.querySelector("#empty-open")?.textContent'), '打开书籍');
  assert.equal((await invoke('platform_info')).aiAvailable, true);
  await evaluate(`(() => {
    document.querySelector('#open-settings').click();
    document.querySelector('[data-settings-tab="ai"]').click();
    document.querySelector('#ai-base-url').value = ${JSON.stringify(provider.baseUrl)};
    document.querySelector('#ai-model').value = ${JSON.stringify(provider.model)};
    document.querySelector('#ai-api-key').value = 'android-test-only';
    document.querySelector('#ai-settings-form').requestSubmit();
  })()`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await evaluate('document.querySelector("#ai-settings-status").textContent === "已保存"')) break;
    await delay(500);
  }
  assert.equal(await evaluate('document.querySelector("#ai-settings-status").textContent'), '已保存');
  assert.equal(await evaluate('document.querySelector("#ai-api-key").value'), '');
  assert.equal(await evaluate('JSON.stringify(localStorage).includes("android-test-only")'), false);
  assert.equal(await invoke('has_ai_api_key', { provider }), true);
  assert.equal(await invoke('has_ai_api_key', { provider: { ...provider, baseUrl: 'https://unused.invalid/v1' } }), false);
  const credentialFile = adb('shell', 'run-as', 'app.aiebook.reader', 'ls', 'no_backup/credentials');
  assert.match(credentialFile, /^[a-f0-9]{64}$/);
  assert.equal(adb('shell', 'run-as', 'app.aiebook.reader', 'cat', `no_backup/credentials/${credentialFile}`).includes('android-test-only'), false);
  const registry = 'https://registry.npmjs.org/';
  const available = await invoke('check_dsh_update', { registry });
  assert.ok(available.latestVersion);
  const installed = await invoke('update_dsh', { registry });
  assert.equal(installed.installed, true);
  assert.equal((await invoke('get_reader_runtime_status')).compatible, true);
  assert.equal((await invoke('restore_reader_plugin')).compatible, true);
  console.log('PASS Android 应用私有目录安装 DSH、默认插件及系统安全存储');
  for (const cancelled of [false, true, false]) {
    const outcome = await evaluate(`(async () => {
      const api = window.__TAURI_INTERNALS__;
      const requestId = crypto.randomUUID();
      const events = [];
      const tools = [];
      let cancellation;
      const callback = api.transformCallback(raw => {
        if (!raw.message) return;
        const event = raw.message;
        events.push(event);
        if (event.type === 'tool') {
          tools.push(event.data.name);
          if (${cancelled}) {
            cancellation ??= api.invoke('cancel_ai', { requestId });
          } else {
            void api.invoke('resolve_reader_tool', { requestId, callId: event.data.callId, reply: { value: { matches: [{ page: 1, text: 'Android 测试证据' }], approved: false } } });
          }
        }
      });
      let error;
      try {
        await api.invoke('generate_ai', { request: { requestId, provider: ${JSON.stringify(provider)}, messages: [{ role: 'user', content: [{ type: 'text', text: '检索测试内容' }] }] }, onEvent: '__CHANNEL__:' + callback });
      } catch (failure) { error = String(failure); }
      finally { api.unregisterCallback(callback); }
      return { tools, events, error };
    })()`);
    if (cancelled) {
      assert.match(outcome.error, /中断|取消/);
      assert.ok(outcome.tools.length > 0);
    } else {
      assert.equal(outcome.error, undefined);
      assert.deepEqual([...new Set(outcome.tools)].sort(), [...toolNames].sort());
      assert.ok(outcome.events.some(event => event.type === 'finished'));
      assert.match(outcome.events.filter(event => event.type === 'delta').map(event => event.data).join(''), /工具验证成功/);
    }
  }
  assert.ok(requests.some(request => JSON.stringify(request).includes('Android 测试证据')));
  console.log('PASS Android DSH 五项工具往返、流式回答、取消及取消后再次对话');
  socket.close();
  adb('shell', 'am', 'force-stop', 'app.aiebook.reader');
  assert.ok(process.env.ANDROID_TEST_APK);
  adb('install', '-r', process.env.ANDROID_TEST_APK);
  adb('shell', 'am', 'start', '-W', '-n', 'app.aiebook.reader/.MainActivity');
  await delay(10000);
  await connect();
  assert.equal(await invoke('has_ai_api_key', { provider }), true);
  assert.equal((await invoke('get_dsh_status')).version, installed.version);
  assert.equal((await invoke('get_reader_runtime_status')).compatible, true);
  assert.equal((await invoke('update_dsh', { registry })).installed, true);
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("ai-provider-settings")).model'), provider.model);
  await evaluate(`(() => {
    document.querySelector('#open-settings').click();
    document.querySelector('[data-settings-tab="ai"]').click();
    document.querySelector('#dsh-status').scrollIntoView();
  })()`);
  await delay(1000);
  assert.match(await evaluate('document.querySelector("#reader-plugin-status").textContent'), /版本兼容/);
  console.log('PASS Android 覆盖安装并重启后配置保留与手动再次更新 DSH');
} finally {
  socket?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  adb('forward', '--remove', 'tcp:19222');
  adb('reverse', '--remove', 'tcp:18763');
}
