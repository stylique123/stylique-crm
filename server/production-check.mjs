const required = [
  'STYLIQUE_ALLOWED_ORIGIN',
  'STYLIQUE_JWT_SECRET',
  'STYLIQUE_ADMIN_PASSWORD',
];

const connectorPairs = [
  ['CONNECTOR_CLAUDE_URL', 'CONNECTOR_CLAUDE_API_KEY'],
  ['CONNECTOR_CODEX_URL', 'CONNECTOR_CODEX_API_KEY'],
  ['CONNECTOR_CLORT_URL', 'CONNECTOR_CLORT_API_KEY'],
  ['CONNECTOR_BOTEX_URL', 'CONNECTOR_BOTEX_API_KEY'],
];

const missing = required.filter(key => !process.env[key]);
const weak = [];

if ((process.env.STYLIQUE_JWT_SECRET || '').length < 32) weak.push('STYLIQUE_JWT_SECRET must be at least 32 characters');
if ((process.env.STYLIQUE_ADMIN_PASSWORD || '').length < 12) weak.push('STYLIQUE_ADMIN_PASSWORD must be at least 12 characters');
if (process.env.STYLIQUE_ALLOWED_ORIGIN === '*') weak.push('STYLIQUE_ALLOWED_ORIGIN must not be * in production');

const partialConnectors = connectorPairs
  .filter(([url, key]) => Boolean(process.env[url]) !== Boolean(process.env[key]))
  .map(([url, key]) => `${url}/${key}`);

if (missing.length || weak.length || partialConnectors.length) {
  console.error('Stylique production check failed.');
  if (missing.length) console.error(`Missing: ${missing.join(', ')}`);
  if (weak.length) console.error(`Weak config: ${weak.join('; ')}`);
  if (partialConnectors.length) console.error(`Partial connector config: ${partialConnectors.join(', ')}`);
  process.exit(1);
}

console.log('Stylique production env check passed.');
