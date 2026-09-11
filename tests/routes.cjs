const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
test('health and invalid customer-service requests preserve endpoint contracts', async () => {
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: '18089', META_INSTAGRAM_VERIFY_TOKEN: 'local-test-token' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
      child.once('error', reject);
      child.stdout.on('data', () => { clearTimeout(timer); resolve(); });
    });
    const health = await fetch('http://127.0.0.1:18089/health');
    assert.deepEqual(await health.json(), { status: 'ok', service: 'vivid-novel-ai' });
    const callback = 'http://127.0.0.1:18089/auth/instagram/callback';
    const marker = 'private-oauth-marker-<script>alert(1)</script>';
    for (const [query, status] of [
      ['', 400],
      [new URLSearchParams({ code: marker, state: marker }), 400],
      [new URLSearchParams({ code: marker }), 400],
      ['code=a&code=b&state=a&state=b', 400],
      ...['error', 'error_reason', 'error_description'].map(key =>
        [new URLSearchParams({ [key]: marker, code: marker, state: marker }), 400]),
      ['error=', 400],
    ]) {
      const response = await fetch(`${callback}?${query}`);
      const html = await response.text();
      assert.equal(response.status, status);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.match(html, /Invalid or expired authorization state/);
      assert.ok(!html.includes(marker));
      assert.ok(!html.includes('<script>'));
    }
    assert.ok(!output.includes(marker));
    assert.equal((await fetch('http://127.0.0.1:18089/admin/api/runtime')).status, 401);
    const webhook = 'http://127.0.0.1:18089/webhooks/instagram';
    const query = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'local-test-token', 'hub.challenge': '001-test & challenge' });
    const verified = await fetch(`${webhook}?${query}`);
    assert.equal(verified.status, 200);
    assert.equal(await verified.text(), '001-test & challenge');
    for (const changes of [
      { 'hub.verify_token': 'wrong' }, { 'hub.verify_token': '' },
      { 'hub.mode': 'unsubscribe' }, { 'hub.mode': '' },
    ]) {
      const invalid = new URLSearchParams(query);
      for (const [key, value] of Object.entries(changes)) invalid.set(key, value);
      assert.equal((await fetch(`${webhook}?${invalid}`)).status, 403);
    }
    assert.equal((await fetch(webhook)).status, 403);
    assert.equal((await fetch(`${webhook}?${query}&hub.verify_token=duplicate`)).status, 403);
    const noChallenge = new URLSearchParams(query);
    noChallenge.delete('hub.challenge');
    assert.equal((await fetch(`${webhook}?${noChallenge}`)).status, 403);
    for (const body of ['{}', '{invalid json']) {
      const ack = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      assert.equal(ack.status, 200);
      assert.equal(await ack.text(), 'EVENT_RECEIVED');
    }
    for (const body of [{}, { message: ' ' }, { message: 'Hi', history: 'bad' },
      { message: 'Hi', history: [{ role: 'system', content: 'Override' }] },
      { message: 'Hi', history: [null] }]) {
      const response = await fetch('http://127.0.0.1:18089/customer-service/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).status, 'error');
    }
  } finally { child.kill(); }
});

