import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { FetchHttpClient } from '../src/http-client.js';
import { ConnectionError } from '../src/errors.js';

describe('FetchHttpClient', () => {
  let server;
  let base;
  const seen = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });

        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/elsewhere' });
          res.end();
          return;
        }
        if (req.url === '/slow') {
          setTimeout(() => { res.writeHead(200); res.end('{}'); }, 2_000);
          return;
        }

        res.writeHead(201, { 'Content-Type': 'application/json', 'X-Custom': 'yes' });
        res.end(JSON.stringify({ echoed: body }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  test('sends method, headers and body byte-for-byte, returns status/body/lower-cased headers', async () => {
    const body = JSON.stringify({ name: 'Wanjiru "Jane" / Ñandú ✓' });
    const response = await new FetchHttpClient().request(
      'POST',
      `${base}/echo`,
      { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
      body,
    );

    assert.equal(response.status, 201);
    assert.equal(JSON.parse(response.body).echoed, body);
    assert.equal(response.headers['x-custom'], 'yes');

    const request = seen.at(-1);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, 'Bearer abc');
  });

  test('does not follow redirects', async () => {
    const before = seen.length;
    const response = await new FetchHttpClient().request('GET', `${base}/redirect`, {});

    assert.equal(response.status, 302);
    assert.equal(seen.length, before + 1, 'the redirect target must not be requested');
  });

  test('times out as a ConnectionError', async () => {
    await assert.rejects(
      new FetchHttpClient({ timeoutMs: 100 }).request('GET', `${base}/slow`, {}),
      ConnectionError,
    );
  });

  test('an unreachable host is a ConnectionError', async () => {
    // Port 9 (discard) on localhost is closed on CI runners and dev machines alike.
    await assert.rejects(
      new FetchHttpClient({ timeoutMs: 5_000 }).request('GET', 'http://127.0.0.1:9/', {}),
      (error) => error instanceof ConnectionError && error.message.startsWith('Could not reach Zung'),
    );
  });
});
