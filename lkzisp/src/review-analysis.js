/**
 * Diagnóstico de relatórios reprovados usando SOMENTE agregados canônicos autorizados.
 * Limiar exploratório interno; não é SLA, meta contratual, prova de causa ou culpa.
 * Não exportar informações pessoais, identificadores ou dados de outros tenants.
 */
const count=v=>Number.isSafeInteger(v)&&v>=0?v:0;
const percentage=(part,total)=>total>0?(100*part/total).toFixed(1).replace('.',',')+'%':'—';
const add=(items,title,evidence,hypothesis,action)=>items.push({title,evidence,hypothesis,action});
export function analyzeRejectedReport(snapshot){
 const s=snapshot;
 if(!s||!Number.isSafeInteger(s.total)||s.total<=0)return {
  findings:[],limitations:['Relatório sem volume válido para analisar.','Solicite relatório IXC com datas, status, assuntos e setores confiáveis.']
 };
 const total=count(s.total), pending=count(s.pending),closed=count(s.finalized);
 const findings=[];
 if(pending>=5&&pending/total>=0.30){
  add(findings,'Concentração de atendimentos pendentes',
   pending+' de '+total+' atendimentos seguem não finalizados ('+percentage(pending,total)+').',
   'Pode haver fila de tratamento, concentração de chamados recentes, dependências externas ou classificação desatualizada de status.',
   'Conferir datas de abertura e motivos reais de permanência em aberto; segmentar por tipo e setor.');
 }
 const aged=count(s.pendingOlder7d);
 if(aged>=1){
  add(findings,'Pendências com mais de sete dias',
   aged+' pendências ultrapassaram sete dias na data de referência do relatório.',
   'Possíveis bloqueios de atendimento, espera de terceiros, priorização inadequada ou ausência de atualização no sistema.',
   'Revisar as pendências antigas no sistema de origem e registrar causas e responsáveis pelas providências.');
 }
 const dated=count(s.closedWithDates),slow=count(s.closedOver24);
 if(slow>=3&&dated>=slow&&slow/dated>=0.20){
  add(findings,'Tempo cronológico entre abertura e fechamento',
   slow+' de '+dated+' encerramentos com datas válidas ultrapassaram 24 horas ('+percentage(slow,dated)+').',
   'Pode ocorrer por esperas, deslocamento, agendamento ou dependências operacionais; duração cronológica não demonstra tempo efetivo ou violação de SLA.',
   'Validar timestamps, pausas e SLAs contratuais antes de identificar atrasos de execução.');
 }
 const groups=(raw,type,limit)=>Object.entries(raw||{})
  .filter(([,g])=>g&&count(g.total)>=5&&count(g.pending)>=5&&count(g.pending)/count(g.total)>=0.30)
  .sort((a,b)=>count(b[1].pending)-count(a[1].pending))
  .slice(0,limit)
  .forEach(([name,g])=>add(findings,
   'Pendências concentradas por '+type+': '+String(name).slice(0,100),
   count(g.pending)+' de '+count(g.total)+' registros pendentes ('+percentage(count(g.pending),count(g.total))+').',
   type==='setor'
    ?'Pode haver descompasso entre demanda e capacidade, diferenças de complexidade ou repasse entre equipes.'
    :'Pode haver recorrência de uma categoria, dificuldade de resolução ou registro incompleto da conclusão.',
   type==='setor'
    ?'Comparar demanda, jornada e complexidade do setor; ouvir a equipe antes de definir ações.'
    :'Auditar uma amostra da categoria no sistema de origem e classificar os motivos reais.'));
 groups(s.sectors,'setor',4);
 groups(s.subjects,'assunto',4);
 const invalid=count(s.invalidDates);
 if(invalid>0)add(findings,'Qualidade das datas de origem',
  invalid+' registros possuem data de abertura ausente ou inválida.',
  'A cobertura incompleta pode distorcer a leitura de idade da fila e distribuição por período.',
  'Corrigir a exportação ou a origem das datas antes de comparações históricas.');
 const limitations=[
  'Estas são hipóteses explicativas dos indicadores, não causas demonstradas nem diagnóstico individual.',
  'Sem jornada, capacidade, complexidade, pausas, prazos contratuais e motivos reais dos chamados, não é possível afirmar causa-raiz, culpa, impacto financeiro ou descumprimento de SLA.',
  'Percentuais e limites são sinais exploratórios, não metas aprovadas. Valide a justificativa humana e os dados na origem.'
 ];
 if(!findings.length)limitations.unshift('Nenhum indicador ultrapassou os limiares exploratórios. A reprovação pode depender de critérios externos ainda não informados.');
 return {findings:findings.slice(0,12),limitations};
}
