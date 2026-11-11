import { fetchAsaasSandboxPayment } from './asaas-sandbox.mjs';

const { ASAAS_SANDBOX_API_KEY, ASAAS_SANDBOX_PAYMENT_ID } = process.env;
if (!ASAAS_SANDBOX_API_KEY || !ASAAS_SANDBOX_PAYMENT_ID) {
  console.error('Configure ASAAS_SANDBOX_API_KEY e ASAAS_SANDBOX_PAYMENT_ID com uma cobrança fictícia existente.');
  process.exitCode = 2;
} else {
  try {
    await fetchAsaasSandboxPayment(ASAAS_SANDBOX_PAYMENT_ID, ASAAS_SANDBOX_API_KEY);
    console.log('Asaas Sandbox: cobrança fictícia consultada e referência confirmada.');
  } catch {
    console.error('Falha na consulta ao Asaas Sandbox.');
    process.exitCode = 1;
  }
}
