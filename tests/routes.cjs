const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
test('health and invalid customer-service requests preserve endpoint contracts', async () => {
  const child = spawn(process.execPath, ['dist/server.js'], {
    env: { ...process.env, PORT: '18089', META_INSTAGRAM_VERIFY_TOKEN: 'local-test-token' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
      child.once('error', reject);
      child.stdout.on('data', () => { clearTimeout(timer); resolve(); });
    });
    const health = await fetch('http://127.0.0.1:18089/health');
    assert.deepEqual(await health.json(), { status: 'ok', service: 'vivid-novel-ai' });
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

