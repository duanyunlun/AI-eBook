import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = resolve('.npm-cache/dsh-runtime/node_modules/@deepseek-ai/dsh/package.json');
const runtimeRequire = createRequire(runtime);
const { JsonRpcLineTransport } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-sdk-protocol')).href);

for (const cancelDuringTool of [false, true]) test(cancelDuringTool ? '取消等待中的阅读工具并结束 DSH 回答' : '真实 DSH 进程执行阅读工具并继续回答', { timeout: 45000 }, async () => {
  const home = await mkdtemp(resolve('.npm-cache/dsh-test-'));
  await mkdir(resolve(home, 'profiles/reader'), { recursive: true });
  await writeFile(resolve(home, 'profiles/reader/package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [], patchReload: 'startup' } } }));
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = requests.length === 1
      ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_book', arguments: '{"query":"测试"}' } }] }
      : { content: '根据检索结果，测试成功。' };
    response.write(`data: ${JSON.stringify({ id: 'response', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'response', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const child = spawn(process.execPath, [resolve('.npm-cache/dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'reader', '--patch', resolve('plugins/dsh-reader/cordis.patch.yml')], {
    env: { ...process.env, DSH_HOME: home, AI_EBOOK_DSH_PACKAGE: runtime, AI_EBOOK_API_KEY: 'test-only' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin);
  const tools = [];
  let toolStarted;
  const toolReady = new Promise((done) => { toolStarted = done; });
  let text = '';
  transport.onRequest(async (method, params) => {
    assert.equal(method, 'reader/tool');
    tools.push(params.name);
    toolStarted();
    if (cancelDuringTool) return new Promise(() => {});
    return { matches: [{ page: 2, text: '测试证据' }] };
  });
  transport.onNotification((method, params) => {
    if (method === 'reader/delta') text += params.text;
    if (method === 'reader/reset') text = '';
  });
  transport.start();
  try {
    const hello = await transport.request('reader/hello', {});
    assert.equal(hello.bridgeVersion, 1);
    assert.deepEqual(hello.tools, ['reading_context', 'read_page', 'search_book', 'search_knowledge', 'save_note']);
    const generation = transport.request('reader/generate', {
      requestId: 'integration-test',
      provider: { protocol: 'open_ai_chat_completions', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test-model', maxOutputTokens: 1024 },
      messages: [{ role: 'user', content: [{ type: 'text', text: '请检索本书中的测试。' }] }],
    });
    if (cancelDuringTool) {
      const rejected = assert.rejects(generation, /未完成/);
      await toolReady;
      await transport.request('reader/cancel', {});
      await rejected;
      assert.equal(requests.length, 1);
      return;
    }
    await generation;
    assert.deepEqual(tools, ['search_book']);
    assert.equal(text, '根据检索结果，测试成功。');
    assert.equal(requests.length, 2);
    assert.ok(JSON.stringify(requests[1]).includes('测试证据'));
  } catch (error) {
    throw new Error(`${error.message}\n${errors}`);
  } finally {
    transport.close();
    child.kill();
    await new Promise((done) => child.exitCode !== null ? done() : child.once('exit', done));
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(home, { recursive: true, force: true });
  }
});
