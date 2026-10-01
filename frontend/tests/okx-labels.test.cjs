const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/okx-labels.user.js'), 'utf8'), context);
const { cleanTag } = context.module.exports;

test('keeps decrypted OKX labels and rejects encrypted API fields', () => {
  assert.equal(cleanTag('# Exchange: FixedFloat. User'), 'Exchange: FixedFloat. User');
  assert.equal(cleanTag('ChangeNOWExchange'), 'ChangeNOWExchange');
  assert.equal(cleanTag('NrNv7OglClduVmyERKAMGg==. qfvdjkM2iKe+urUC86qSk8/M4JO9AvOtOcPoKkKN/tQ='), null);
  assert.equal(cleanTag('EFN0Bmo4qT4c+hAU2MqgcQ==: NrNv7OglClduVmyERKAMGg==. yfk4ST76Hl/ZwVHaM0LoYw=='), null);
});
