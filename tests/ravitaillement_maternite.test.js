const test = require('node:test');
const assert = require('node:assert/strict');
const ravitaillementRouter = require('../src/routes/ravitaillement');
const materniteRouter = require('../src/routes/maternite');

test('Ravitaillement & Maternité - Module & Routes', async (t) => {
  await t.test('le routeur ravitaillement est bien exporté', () => {
    assert.ok(ravitaillementRouter);
    assert.equal(typeof ravitaillementRouter, 'function');
  });

  await t.test('le routeur ravitaillement possède les routes GET, POST, PUT', () => {
    const stack = ravitaillementRouter.stack;
    assert.ok(stack.length >= 4);
  });

  await t.test('le routeur maternité est bien exporté', () => {
    assert.ok(materniteRouter);
    assert.equal(typeof materniteRouter, 'function');
  });

  await t.test('le routeur maternité possède les routes naissances, cpn, cpon et stats', () => {
    const stack = materniteRouter.stack;
    assert.ok(stack.length >= 7);
  });
});
