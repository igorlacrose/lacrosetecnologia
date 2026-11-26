// Official Facebook Login for Business / Embedded Signup (Meta).
// Public App ID + Config ID only; Meta App Secret and Business Integration
// access tokens are processed exclusively by VNext backend.
const ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);
const META_SDK = 'https://connect.facebook.net/pt_BR/sdk.js';
let sdkPromise;
const businessId = /^[0-9]{5,30}$/;

export function loadFacebookSdk(appId, version) {
  if (!businessId.test(appId) || !/^v(?:2[4-9]|3[0-9])\.0$/.test(version)) {
    return Promise.reject(new TypeError('Configuração Meta inválida.'));
  }
  if (globalThis.FB?.login) return Promise.resolve(globalThis.FB);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    let finished = false;
    const script = document.createElement('script');
    script.src = META_SDK;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    const finish = (error, sdk) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(sdk);
    };
    const timer = setTimeout(() => finish(new Error('Tempo esgotado ao carregar a Meta.')), 12000);
    const previous = globalThis.fbAsyncInit;
    globalThis.fbAsyncInit = () => {
      try {
        previous?.();
        globalThis.FB.init({ appId, autoLogAppEvents: false,
          xfbml: false, cookie: false, version });
        finish(null, globalThis.FB);
      } catch {
        finish(new Error('Falha ao inicializar a conexão Meta.'));
      }
    };
    script.onerror = () => finish(new Error('Não foi possível carregar a integração Meta.'));
    document.head.append(script);
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}

export async function startEmbeddedSignup({ appId, configId, version }) {
  if (!businessId.test(configId)) throw new TypeError('Configuração Meta inválida.');
  const sdk = await loadFacebookSdk(appId, version);
  return new Promise((resolve, reject) => {
    let code = null;
    let assets = null;
    let done = false;
    function finish(error) {
      if (done) return;
      if (!error && (!code || !assets)) return;
      done = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (error) reject(error);
      else resolve({ code, ...assets });
    }
    function onMessage(event) {
      if (!ORIGINS.has(event.origin)) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; }
      catch { return; }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'CANCEL' || data.event === 'ERROR') {
        finish(new Error('A conexão foi cancelada na Meta.'));
        return;
      }
      if (data.event !== 'FINISH') return;
      const wabaId = String(data.data?.waba_id ?? '');
      const phoneNumberId = String(data.data?.phone_number_id ?? '');
      if (!businessId.test(wabaId) || !businessId.test(phoneNumberId)) {
        finish(new Error('Selecione e valide um número na Meta para continuar.'));
        return;
      }
      assets = { wabaId, phoneNumberId };
      finish();
    }
    const timeout = setTimeout(() => finish(new Error('A autorização Meta expirou.')), 90000);
    window.addEventListener('message', onMessage);
    try {
      sdk.login(response => {
        const value = response?.authResponse?.code;
        if (typeof value !== 'string' || value.length < 12 || value.length > 2048) {
          finish(new Error('A Meta não devolveu autorização válida.'));
          return;
        }
        code = value;
        finish();
      }, {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, version: 'v4' },
      });
    } catch {
      finish(new Error('Não foi possível abrir a autorização Meta.'));
    }
  });
}
