const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateCustomerServiceReply } = require('../dist/customer-service/agent');
const { EMILY_INTRODUCTION } = require('../dist/customer-service/behavior');

test('legacy request and history use the same bubble contract and protected system rules', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output: [{ content: [{
      type: 'output_text', text: JSON.stringify({ messages: [EMILY_INTRODUCTION] }),
    }] }] }) };
  };
  try {
    assert.deepEqual(await generateCustomerServiceReply({ message: 'Hello' }), [EMILY_INTRODUCTION]);
    const history = [
      { role: 'user', content: 'My name is Alex.' },
      { role: 'assistant', content: 'Welcome.' },
    ];
    await generateCustomerServiceReply({ message: 'I like blue.', history });
    assert.equal(requests[0].input[0].role, 'system');
    assert.match(requests[0].input[0].content, /Behavioral Rulebook v0\.2/);
    assert.match(requests[0].input[0].content, /NON-NEGOTIABLE GUARDRAILS/);
    assert.equal(requests[0].input[0].content, requests[1].input[0].content);
    const context = JSON.parse(requests[1].input[1].content.split(': ').slice(1).join(': '));
    assert.equal(context.customerTurn, 2);
    assert.deepEqual(context.history, history);
    assert.equal(requests[1].input.at(-1).content, 'I like blue.');
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
