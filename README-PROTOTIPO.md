# Lacrose Tecnologia — Protótipo navegável V2

Versão preparada para validar a experiência final do **Agente Comercial e de Automação Empresarial com IA** antes da conexão com backend, banco e IA real.

## O que mudou na V2

Além da digitação livre, o agente agora oferece **respostas rápidas contextuais** em cada etapa do diagnóstico.

- botões/balões para escolhas simples;
- seleção múltipla com opções marcáveis quando mais de uma resposta pode fazer sentido;
- botão **Prefiro digitar** para manter a conversa livre;
- opções adaptadas ao tipo de necessidade escolhido;
- experiência otimizada para celular, com menos necessidade de teclado;
- lead lateral atualizado conforme as respostas;
- score e classificação continuam sendo calculados por regras do protótipo;
- painel comercial recebe os dados e a conversa da sessão.

## Como testar

Abra `index.html` no navegador.

Na página principal, vá até **Agente IA** ou clique em **Conte o problema da sua empresa**.

Teste principalmente estes fluxos:

1. **Preciso de um sistema**
2. **Quero automatizar um processo**
3. **Tenho um problema de TI, rede ou segurança**
4. **Quero melhorar algo que minha empresa já utiliza**
5. escrever livremente um problema sem escolher categoria
6. usar o exemplo da clínica com 12 computadores

Durante o diagnóstico, use tanto as respostas rápidas quanto o campo de texto. Nas perguntas **Como isso funciona hoje?** e **O que esse problema está causando hoje?**, é possível marcar várias opções antes de continuar.

Ao final, clique em **Ver painel comercial** para visualizar o lead estruturado, a conversa e o modelo de aprovação humana.

## Publicação no GitHub Pages

Esta versão continua sendo totalmente estática e pode ser hospedada no GitHub Pages para demonstração. Interface, navegação, respostas rápidas, chat simulado, localStorage e painel funcionarão normalmente.

O que ainda **não** deve ser colocado diretamente no frontend:

- chave da OpenAI;
- credenciais do banco;
- regras comerciais sensíveis;
- envio automático de propostas;
- ações de WhatsApp/e-mail com credenciais;
- permissões administrativas reais.

Essas funções entrarão na próxima fase por meio de backend seguro.

## Próxima fase

A V2 foi deixada pronta para seguirmos para o MVP real:

**Site → API segura → Agente IA → PostgreSQL/Supabase → Painel → aprovação humana**

A próxima implementação deverá substituir o motor de demonstração pelo backend real sem alterar a experiência aprovada do visitante.

## Identidade

A interface utiliza **Lacrose Tecnologia** e as logos oficiais fornecidas. O domínio `lacrose-informatica.com.br` e o Instagram `@lacroseinformatica` continuam mantidos apenas porque ainda são os endereços oficiais existentes.

## Importante

Este protótipo não envia dados para a Lacrose e não utiliza IA real. Ele foi criado para validar visual, UX, fluxo comercial, perguntas, respostas rápidas, lead estruturado, score, painel e controles antes do desenvolvimento da infraestrutura de produção.
