const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('Patients Router - structure et endpoints', async (t) => {
  const patientRouter = require('../src/routes/patients');
  assert.ok(patientRouter, 'Le routeur des patients doit être exporté');

  const routes = [];
  patientRouter.stack.forEach((middleware) => {
    if (middleware.route) {
      const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${middleware.route.path}`);
    }
  });

  assert.ok(routes.some(r => r.includes('GET /')), 'Route GET / existante');
  assert.ok(routes.some(r => r.includes('GET /stats')), 'Route GET /stats existante');
  assert.ok(routes.some(r => r.includes('POST /')), 'Route POST / existante');
  assert.ok(routes.some(r => r.includes('GET /:id')), 'Route GET /:id existante');
  assert.ok(routes.some(r => r.includes('PUT /:id')), 'Route PUT /:id existante');
  assert.ok(routes.some(r => r.includes('POST /:id/visites')), 'Route POST /:id/visites existante');
});
