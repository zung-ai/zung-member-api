import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

/**
 * A response body from the repo-level fixtures/ directory, shared with the
 * PHP SDK's tests and validated against openapi.yaml.
 *
 * @param {string} name
 * @returns {string}
 */
export function fixture(name) {
  return readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8');
}

/**
 * Test double: records every request and replays queued responses (or
 * throws a queued error).
 */
export class FakeHttpClient {
  constructor() {
    /** @type {Array<{method: string, url: string, headers: Record<string, string>, body: string | null}>} */
    this.requests = [];
    /** @type {Array<import('../../src/http-client.js').HttpResponse | Error>} */
    this.queue = [];
  }

  queueFixture(name, status = 200) {
    this.queue.push({ status, body: fixture(name), headers: {} });
    return this;
  }

  queueJson(status, data, headers = {}) {
    this.queue.push({ status, body: JSON.stringify(data), headers });
    return this;
  }

  queueResponse(status, body, headers = {}) {
    this.queue.push({ status, body, headers });
    return this;
  }

  queueError(error) {
    this.queue.push(error);
    return this;
  }

  async request(method, url, headers, body = null) {
    this.requests.push({ method, url, headers, body });

    const next = this.queue.shift();
    if (next === undefined) {
      throw new Error('FakeHttpClient: no response queued.');
    }
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }

  lastRequest() {
    return this.requests.at(-1);
  }
}
