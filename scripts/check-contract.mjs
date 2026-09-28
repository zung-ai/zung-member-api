// Validates JSON documents against the response schemas in openapi.yaml.
//
//   node scripts/check-contract.mjs                 checks every file in fixtures/
//   node scripts/check-contract.mjs <dir>           checks <dir>/<name>.json the same way
//
// File names map to operations via FIXTURES below. Needs `ajv` and `yaml`,
// which are dev-only: `npm install --no-save ajv@8 ajv-formats@3 yaml@2`.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] ?? join(root, 'fixtures');

const FIXTURES = {
  'login': ['/login', 'post', '200'],
  'me': ['/me', 'get', '200'],
  'dashboard': ['/dashboard', 'get', '200'],
  'loans': ['/loans', 'get', '200'],
  'loan': ['/loans/{id}', 'get', '200'],
  'loan-products': ['/loans/products', 'get', '200'],
  'loan-applications': ['/loans/applications', 'get', '200'],
  'apply': ['/loans/apply', 'post', '201'],
  'savings': ['/savings', 'get', '200'],
  'savings-account': ['/savings/{id}', 'get', '200'],
  'wallets': ['/wallets', 'get', '200'],
  'logout': ['/logout', 'post', '200'],
  'error': ['/me', 'get', '401'],
};

const spec = YAML.parse(readFileSync(join(root, 'openapi.yaml'), 'utf8'));

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'spec', components: spec.components });

// Re-root "#/components/..." refs onto the registered "spec" document.
const rebase = (node) => {
  if (Array.isArray(node)) return node.map(rebase);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) =>
      [k, k === '$ref' && typeof v === 'string' && v.startsWith('#/') ? `spec${v}` : rebase(v)]));
  }
  return node;
};

const resolveResponse = (response) => {
  if (response.$ref) {
    const name = response.$ref.split('/').pop();
    return spec.components.responses[name];
  }
  return response;
};

let failures = 0;
let checked = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const name = basename(file, '.json');
  const target = FIXTURES[name];
  if (!target) {
    console.error(`?  ${file}: no operation mapped for this file name`);
    failures++;
    continue;
  }

  const [path, method, status] = target;
  const response = resolveResponse(spec.paths[path][method].responses[status]);
  const schema = rebase(response.content['application/json'].schema);
  const validate = ajv.compile(schema);
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));

  checked++;
  if (validate(data)) {
    console.log(`ok ${file}  ${method.toUpperCase()} ${path} ${status}`);
  } else {
    failures++;
    console.error(`X  ${file}  ${method.toUpperCase()} ${path} ${status}`);
    for (const error of validate.errors) {
      console.error(`     ${error.instancePath || '(root)'} ${error.message}`);
    }
  }
}

console.log(`\n${checked} checked, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
