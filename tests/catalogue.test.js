const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../src/routes/catalogue');

test('Catalogue Médicaments - Routes & Définition', async (t) => {
  await t.test('le module de routes du catalogue est bien exporté', () => {
    assert.ok(router);
    assert.equal(typeof router, 'function');
  });

  await t.test('le catalogue contient la pile de middlewares de recherche', () => {
    const stack = router.stack;
    assert.ok(stack.length >= 4); // '/', '/classes', '/formes', '/stats'
  });
});
