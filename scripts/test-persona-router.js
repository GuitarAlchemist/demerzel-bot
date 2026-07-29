const assert = require('node:assert/strict');
const { test } = require('node:test');

const { detectPersona } = require('../src/persona-router');

function message(content, channelName) {
  return {
    content,
    channel: channelName === undefined ? {} : { name: channelName },
  };
}

const cases = [
  {
    name: 'DM with no routing signal uses the Demerzel fallback',
    input: message('hello there'),
    expected: 'demerzel',
  },
  {
    name: 'academy channel selects Seldon',
    input: message('hello', 'academy'),
    expected: 'seldon',
  },
  {
    name: 'research channel selects Seldon',
    input: message('summarize the findings', 'research'),
    expected: 'seldon',
  },
  {
    name: 'governance channel selects Demerzel',
    input: message('status update', 'governance'),
    expected: 'demerzel',
  },
  {
    name: 'explicit Seldon prefix selects Seldon',
    input: message('Seldon: hello there', 'general'),
    expected: 'seldon',
  },
  {
    name: 'explicit Demerzel prefix selects Demerzel',
    input: message('Demerzel: hello there', 'general'),
    expected: 'demerzel',
  },
  {
    name: 'guitar content selects the GA persona',
    input: message('show me a Dorian guitar scale', 'general'),
    expected: 'ga',
  },
  {
    name: 'BS detector content selects the BS persona',
    input: message('translate this BS', 'general'),
    expected: 'bs',
  },
  {
    name: 'ambiguous Seldon and governance signals preserve Seldon precedence',
    input: message('Seldon, audit this constitution', 'governance'),
    expected: 'seldon',
  },
  {
    name: 'unmatched content uses the Demerzel fallback',
    input: message('thanks for the update', 'general'),
    expected: 'demerzel',
  },
];

for (const example of cases) {
  test(example.name, () => {
    assert.equal(detectPersona(example.input), example.expected);
  });
}
