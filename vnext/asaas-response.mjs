import { readBoundedJson } from './bounded-json.mjs';

// Preserve the existing Asaas size cap and public function while sharing the
// same strict streaming parser used by staging authentication.
const maxProviderJsonBytes = 256 * 1024;

export const readAsaasJson = response =>
  readBoundedJson(response, maxProviderJsonBytes, 'Asaas');
