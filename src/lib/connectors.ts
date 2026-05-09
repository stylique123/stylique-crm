import { safeRead, safeWrite } from '@/lib/safe-storage';
import { getApiBaseUrl } from '@/lib/backend-api';

export type ConnectorKey = 'claude' | 'codex' | 'clort' | 'botex';

export interface ConnectorConfig {
  key: ConnectorKey;
  label: string;
  enabled: boolean;
  endpoint: string;
  apiKeyRef: string;
  notes: string;
}

const STORAGE_KEY = 'stylique-connectors';

export const DEFAULT_CONNECTORS: ConnectorConfig[] = [
  { key: 'claude', label: 'Claude', enabled: false, endpoint: '', apiKeyRef: 'CONNECTOR_CLAUDE_API_KEY', notes: 'AI analysis and enrichment connector' },
  { key: 'codex', label: 'Codex', enabled: false, endpoint: '', apiKeyRef: 'CONNECTOR_CODEX_API_KEY', notes: 'Build, audit, and operations assistant connector' },
  { key: 'clort', label: 'Clort', enabled: false, endpoint: '', apiKeyRef: 'CONNECTOR_CLORT_API_KEY', notes: 'External business data connector' },
  { key: 'botex', label: 'Botex', enabled: false, endpoint: '', apiKeyRef: 'CONNECTOR_BOTEX_API_KEY', notes: 'Automation and sync connector' },
];

function gatewayEndpoint(key: ConnectorKey): string {
  const base = getApiBaseUrl();
  return base ? `${base}/api/connectors/${key}/invoke` : '';
}

export function getConnectors(): ConnectorConfig[] {
  try {
    const saved = safeRead<ConnectorConfig[]>(STORAGE_KEY, []);
    return DEFAULT_CONNECTORS.map(defaultConfig => ({
      ...defaultConfig,
      endpoint: gatewayEndpoint(defaultConfig.key),
      ...(saved.find(c => c.key === defaultConfig.key) || {}),
    }));
  } catch {
    return DEFAULT_CONNECTORS;
  }
}

export function saveConnectors(configs: ConnectorConfig[]) {
  safeWrite(STORAGE_KEY, configs);
}

export function getConnectorReadiness(config: ConnectorConfig): 'ready' | 'missing_endpoint' | 'missing_key' | 'disabled' {
  if (!config.enabled) return 'disabled';
  if (!config.endpoint.trim()) return 'missing_endpoint';
  if (!config.apiKeyRef.trim()) return 'missing_key';
  return 'ready';
}
