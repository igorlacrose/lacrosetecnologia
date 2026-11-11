import { startEmbeddedSignup } from './whatsapp-signup.mjs';

const title = document.querySelector('#title');
const view = document.querySelector('#view');
const tenant = document.querySelector('#tenant');
const feedback = document.querySelector('#feedback');
const nav = document.querySelector('#navigation');
const tabs = {
  overview: 'Visão geral', leads: 'Leads', clients: 'Clientes', opportunities: 'Oportunidades',
  interactions: 'Atendimentos', oca: 'OCA', products: 'Catálogo', plans: 'Planos',
  subscription_drafts: 'Assinaturas', license_requests: 'Licenças', whatsapp: 'WhatsApp', audit: 'Auditoria',
};
const stages = { qualification: 'Qualificação', proposal: 'Proposta', negotiation: 'Negociação', won: 'Ganha', lost: 'Perdida' };
const channels = { oca: 'OCA', email: 'E-mail', phone: 'Telefone', internal: 'Interno' };
const intervals = { once: 'Único', monthly: 'Mensal', annual: 'Anual' };
const sandboxStates = { pending: 'pendentes', paid: 'pagas', overdue: 'vencidas', reversed: 'estornadas', disputed: 'em disputa' };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let page = 'overview';
let generation = 0;
let accessToken;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function message(text, error = false) {
  feedback.textContent = text;
  feedback.toggleAttribute('data-error', error);
}

async function api(route, data) {
  const query = new URLSearchParams({ tenant: tenant.value });
  const headers = accessToken ? { Authorization: 'Bearer ' + accessToken } : {};
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/' + route + '?' + query, {
    headers, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}

function options(select, values) {
  for (const [value, label] of Object.entries(values)) select.add(new Option(label, value));
}

const name = ['name', 'Nome'];
const email = ['email', 'E-mail', 'email'];
const formFields = {
  leads: [name, email],
  clients: [name, email],
  opportunities: [['lead_id', 'Lead', 'select', 'leads'], ['title', 'Título']],
  interactions: [['lead_id', 'Lead', 'select', 'leads'], ['channel', 'Canal', 'select', channels], ['note', 'Resumo', 'textarea']],
  products: [name, ['slug', 'Identificador (ex. produto-x)'], ['kind', 'Tipo', 'select', { service: 'Serviço', saas: 'SaaS' }]],
  plans: [name, ['product_id', 'Produto', 'select', 'products'], ['amount_brl_cents', 'Valor em centavos', 'number'], ['interval', 'Periodicidade', 'select', intervals]],
  subscription_drafts: [['client_id', 'Cliente', 'select', 'clients'], ['plan_id', 'Plano', 'select', 'plans']],
  license_requests: [['subscription_id', 'Assinatura em rascunho', 'select', 'subscription_drafts']],
};

function form(specs, buttonLabel, submit) {
  const wrapper = element('form');
  for (const [key, label, type = 'text', choices] of specs) {
    const field = element('label', label);
    const input = element(type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input');
    if (type === 'select') options(input, choices);
    if (input.tagName === 'INPUT') input.type = type;
    if (type === 'number') { input.min = '1'; input.step = '1'; }
    input.name = key;
    if (type === 'password') input.autocomplete = 'current-password';
    input.required = true;
    input.maxLength = key === 'note' ? 2000 : key === 'question' ? 350 : key === 'email' ? 254 : 160;
    field.append(input);
    wrapper.append(field);
  }
  const button = element('button', buttonLabel);
  wrapper.append(button);
  wrapper.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    const token = generation;
    try {
      const data = Object.fromEntries([...new FormData(wrapper)].map(([key,value]) => [key, key === 'password' ? value : value.trim()]));
      if (data.email) data.email = data.email.toLowerCase();
      if (data.amount_brl_cents) data.amount_brl_cents = Number(data.amount_brl_cents);
      await submit(data, token);
    } catch (error) {
      if (token === generation) message(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return wrapper;
}

function card(heading, content) {
  const wrapper = element('article');
  wrapper.append(element('h2', heading), content);
  return wrapper;
}

function record(heading, details, control) {
  const row = element('article', undefined, 'record');
  const copy = element('div');
  copy.append(element('strong', heading), element('p', details));
  row.append(copy);
  if (control) row.append(control);
  return row;
}

async function mutate(route, data, token = generation) {
  await api(route, data);
  if (token === generation) await render('Registro atualizado.');
}

async function build(section) {
  const content = element('div');
  if (section === 'overview') {
    const resources = ['leads', 'clients', 'opportunities', 'interactions', 'subscription_drafts'];
    const counts = await api('overview');
    content.className = 'cards';
    resources.forEach(key => {
      content.append(card(tabs[key], element('strong', String(counts[key]), 'metric')));
    });
    return content;
  }

  if (section === 'whatsapp') {
    content.className = 'records';
    const [connections, metaConfig, reminders, reminderCounts] = await Promise.all([
      api('whatsapp'), api('whatsapp/config'), api('whatsapp/reminders'),
      api('whatsapp/reminders/summary'),
    ]);
    const instructions = element('p',
      'Cada empresa conecta sua própria conta Meta e configura o pagamento direto ' +
      'no Gerenciador do WhatsApp. A assinatura do software é separada, via Asaas.');
    const setup = element('div');
    setup.append(instructions);
    if (metaConfig.enabled) {
      const button = element('button', 'Conectar meu WhatsApp Business');
      button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        const token = generation;
        try {
          // Same-origin authenticated API binds the challenge to tenant + operator.
          const intent = await api('whatsapp/signup', {});
          const grant = await startEmbeddedSignup(intent);
          await api('whatsapp/complete', {
            intentId: intent.intentId, state: intent.state, ...grant,
          });
          if (token === generation) await render('Conta conectada. Faturamento Meta ainda não verificado.');
        } catch (error) {
          if (token === generation) message(error.message, true);
        } finally {
          button.disabled = false;
        }
      };
      setup.append(button);
    } else {
      setup.append(element('p',
        'Conexão ainda indisponível neste ambiente: aguardando aprovação da Meta e ' +
        'configuração protegida no backend. Nenhuma mensagem paga será enviada.'));
    }
    content.append(card('WhatsApp da empresa · faturamento próprio', setup));
    for (const item of connections) {
      const label = item.phone_display || 'Número cadastrado na Meta';
      const payment = item.billing_state === 'verified' ? 'verificado' :
        item.billing_state === 'customer_reported' ? 'informado, aguardando revisão' :
        'ainda não informado';
      const details = 'Conta ' + item.meta_waba_id +
        ' · Cobrança: Meta diretamente à empresa · Pagamento ' + payment +
        ' · Envios: ' + (item.connection_state === 'ready' ? 'aptos após homologação' : 'bloqueados');
      let action;
      if (item.connection_state === 'awaiting_billing' && item.billing_state === 'unverified') {
        action = element('button', 'Informar pagamento configurado na Meta');
        action.type = 'button';
        action.onclick = async () => {
          action.disabled = true;
          const token = generation;
          try {
            await api('whatsapp/' + item.id + '/report-billing', {});
            if (token === generation) await render('Informação recebida. Os envios continuam bloqueados até verificação.');
          } catch (error) {
            if (token === generation) message(error.message, true);
          } finally {
            action.disabled = false;
          }
        };
      }
      content.append(record(label, details, action));
    }
    if (!connections.length) content.append(element('p', 'Nenhum número conectado para esta empresa.'));
    content.append(card('Lembretes de agendamento', element('p',
      'Estado: ' + (reminders.enabled ? 'política cadastrada (não homologada)' : 'desativados') +
      ' · 24h e 2h antes do horário. Agendamentos: ' + Number(reminderCounts.appointments) +
      ' · Pendentes (sem disparo): ' + Number(reminderCounts.pending) +
      ' · Cancelados: ' + Number(reminderCounts.cancelled) +
      '. Os eventos são recebidos apenas de agendas com assinatura HMAC. ' +
      'NENHUMA mensagem será enviada antes da homologação da conta, consentimento, ' +
      'template aprovado e cobrança própria validada.')));
    // Operator settings are drafts; neither this form nor the API can enable
    // message delivery, verify customer billing or select a Meta credit line.
    const settings = element('form');
    const offsetLabel = element('label', 'Quando lembrar');
    const offsetSelect = element('select');
    options(offsetSelect, {
      both: '24 horas e 2 horas antes',
      day: 'Somente 24 horas antes',
      two_hours: 'Somente 2 horas antes',
    });
    const savedOffsets = new Set(reminders.offsets_minutes);
    offsetSelect.value = savedOffsets.has(1440) && savedOffsets.has(120) ? 'both'
      : savedOffsets.has(1440) ? 'day' : 'two_hours';
    offsetLabel.append(offsetSelect);
    const capLabel = element('label', 'Limite mensal desejado de mensagens');
    const cap = element('input');
    cap.type = 'number';
    cap.min = '0';
    cap.max = '10000';
    cap.step = '1';
    cap.required = true;
    cap.value = String(reminders.monthly_message_limit);
    capLabel.append(cap);
    const save = element('button', 'Salvar preferências');
    save.type = 'submit';
    settings.append(offsetLabel, capLabel,
      element('p', 'Configuração preparatória: os envios permanecem DESATIVADOS ' +
        'até a homologação da integração Meta, cobrança própria, consentimento e templates.'),
      save);
    settings.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      const token = generation;
      try {
        const configured = offsetSelect.value === 'both' ? [1440, 120]
          : offsetSelect.value === 'day' ? [1440] : [120];
        const limit = Number(cap.value);
        if (!Number.isInteger(limit) || limit < 0 || limit > 10000)
          throw new Error('Escolha um limite mensal entre 0 e 10.000.');
        await api('whatsapp/reminders', {
          offsets_minutes: configured, monthly_message_limit: limit,
        });
        if (token === generation) await render('Preferências salvas. O envio continua bloqueado.');
      } catch (error) {
        if (token === generation) message(error.message, true);
      } finally {
        save.disabled = false;
      }
    });
    content.append(card('Configurar lembretes e limite mensal', settings));
    return content;
  }

  if (section === 'oca') {
    const answer = element('p');
    answer.setAttribute('aria-live', 'polite');
    content.className = 'records';
    const assist = form([['question', 'Pergunta comercial']], 'Consultar conhecimento', async (data, token) => {
      const result = await api('oca/assist', data);
      if (token !== generation) return;
      answer.textContent = result.answer + (result.drafts.length ? ' Catálogo interno em rascunho: ' + result.drafts.join(', ') + '.' : '');
    });
    const assistance = card('Resposta aprovada', assist);
    assistance.append(answer);
    const intake = form([['oca_reference', 'UUID do atendimento'], name, email], 'Registrar lead', async (data, token) => {
      await api('oca/intake', data);
      if (token === generation) message('Lead registrado no CRM.');
    });
    content.append(assistance, card('Registrar atendimento no CRM', intake));
    return content;
  }

  const specs = formFields[section] ?? [];
  const sources = [...new Set(specs.map(field => field[3]).filter(source => typeof source === 'string'))];
  const [items, ...references] = await Promise.all([api(section), ...sources.map(apiKey => api(apiKey))]);
  const choices = Object.fromEntries(sources.map((source, index) => [
    source, Object.fromEntries(references[index].map(row => [row.id, row.name ?? ('Rascunho ' + row.id.slice(0, 8))])),
  ]));
  if (specs.length) {
    const fields = specs.map(([key, label, type, values]) => [key, label, type, choices[values] ?? values]);
    const missing = sources.find(source => Object.keys(choices[source]).length === 0);
    if (missing) content.append(card('Cadastro indisponível', element('p', 'Cadastre primeiro um registro em ' + tabs[missing] + '.')));
    else content.append(card(section === 'subscription_drafts' ? 'Nova assinatura em rascunho' : 'Novo registro',
      form(fields, 'Salvar', (data, token) => mutate(section, data, token))));
  }
  const list = element('div', undefined, 'records');
  const token = generation;
  for (const row of items) {
    let heading = row.name ?? row.title ?? row.entity;
    let details = row.email ?? '';
    let control;
    if (section === 'leads') {
      details += row.client_id ? ' · Convertido' : ' · Lead aberto';
      if (!row.client_id) {
        control = element('button', 'Converter em cliente');
        control.onclick = async () => {
          control.disabled = true;
          try { await mutate('leads/' + row.id + '/convert', {}, token); }
          catch (error) { if (token === generation) message(error.message, true); }
          finally { control.disabled = false; }
        };
      }
    } else if (section === 'opportunities') {
      details = choices.leads[row.lead_id] ?? 'Lead vinculado';
      control = element('select');
      control.setAttribute('aria-label', 'Etapa de ' + row.title);
      options(control, stages);
      control.value = row.stage;
      control.onchange = async () => {
        control.disabled = true;
        try { await mutate('opportunities/' + row.id + '/stage', { stage: control.value }, token); }
        catch (error) { control.value = row.stage; if (token === generation) message(error.message, true); }
        finally { control.disabled = false; }
      };
    } else if (section === 'interactions') {
      heading = (channels[row.channel] ?? row.channel) + ' · ' + (choices.leads[row.lead_id] ?? 'Lead');
      details = row.note;
    } else if (section === 'products') {
      details = 'Em desenvolvimento / rascunho';
    } else if (section === 'plans') {
      details = (choices.products[row.product_id] ?? 'Produto') + ' · ' + money.format(row.amount_brl_cents / 100)
        + ' · ' + intervals[row.interval] + ' · Rascunho';
    } else if (section === 'subscription_drafts') {
      heading = choices.clients[row.client_id] ?? 'Cliente';
      const paymentCounts = Object.entries(row.sandbox_payments).map(([state, total]) => total + ' ' + sandboxStates[state]);
      details = (choices.plans[row.plan_id] ?? 'Plano') + ' · Rascunho';
      if (paymentCounts.length) details += ' · Cobranças Sandbox: ' + paymentCounts.join(', ');
      control = element('button', 'Consultar liberação');
      control.onclick = async () => {
        control.disabled = true;
        try {
          const result = await api('subscription_drafts/' + row.id + '/eligibility');
          if (token === generation && !result.eligible) message('Provisionamento bloqueado. Produto ainda sem homologação.');
        } catch (error) {
          if (token === generation) message(error.message, true);
        } finally {
          control.disabled = false;
        }
      };
    } else if (section === 'license_requests') {
      heading = choices.subscription_drafts[row.subscription_id] ?? 'Assinatura em rascunho';
      details = 'Bloqueada até homologação';
    } else if (section === 'audit') {
      details = row.operation + ' · ' + new Date(row.occurred_at).toLocaleString('pt-BR');
    }
    list.append(record(heading, details, control));
  }
  if (!items.length) list.append(element('p', 'Nenhum registro.'));
  content.append(list);
  return content;
}

async function render(done = '') {
  const token = ++generation;
  title.textContent = tabs[page];
  for (const button of nav.children) {
    if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  view.replaceChildren();
  view.setAttribute('aria-busy', 'true');
  message('Carregando…');
  try {
    const content = await build(page);
    if (token === generation) { view.append(content); message(done); }
  } catch (error) {
    if (token === generation) message(error.message, true);
  } finally {
    if (token === generation) view.removeAttribute('aria-busy');
  }
}

for (const [key,label] of Object.entries(tabs)) {
  const button = element('button', label);
  button.dataset.page = key;
  button.onclick = () => { page = key; render(); };
  nav.append(button);
}
tenant.onchange = () => render();

async function openWorkspace() {
  const tenants = await api('tenants');
  options(tenant, Object.fromEntries(tenants.map(row => [row.id, row.name ?? ('Rascunho ' + row.id.slice(0, 8))])));
  nav.hidden = false;
  tenant.parentElement.hidden = false;
  if (tenants.length) await render();
  else message('Nenhuma empresa disponível.', true);
}

async function sendAuth(path, data, token) {
  const response = await fetch('/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível autenticar.');
  return result;
}

function showLogin() {
  nav.hidden = true;
  tenant.parentElement.hidden = true;
  title.textContent = 'Entrar';
  view.replaceChildren(card('Acesso à homologação', form([email, ['password', 'Senha', 'password']], 'Continuar', async (data) => {
    const result = await sendAuth('login', data);
    const codeForm = form([['code', 'Código do autenticador']], 'Verificar', async ({ code }) => {
      const verified = await sendAuth('mfa', { code, factorId: result.factorId }, result.token);
      accessToken = verified.token;
      await openWorkspace();
    });
    codeForm.elements.code.inputMode = 'numeric';
    codeForm.elements.code.autocomplete = 'one-time-code';
    codeForm.elements.code.maxLength = 6;
    title.textContent = 'Verificação em duas etapas';
    message('');
    view.replaceChildren(card('Autenticador', codeForm));
    codeForm.elements.code.focus();
  })));
}

try {
  const status = await (await fetch('/auth/status')).json();
  if (status.requiresLogin) {
    document.querySelector('.environment').textContent = 'Homologação isolada';
    showLogin();
  } else {
    await openWorkspace();
  }
} catch (error) {
  message(error.message, true);
}
