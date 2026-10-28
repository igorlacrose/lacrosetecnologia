/**
 * Auditor de suficiência dos dados — fail-closed.
 * Nunca infere perdas financeiras, culpa pessoal ou produtividade individual
 * a partir de um relatório de chamados sem dados adicionais.
 * Saída: apenas indicadores e nomes de campos/fontes requeridos.
 */
export const QUALITY_STATUS=Object.freeze({ready:'Calculável',partial:'Parcial',blocked:'Dados insuficientes'});
function entry(id,title,status,missing=[],detail=''){
 return {id,title,status,missing,detail};
}
export function evaluateDataQuality(snapshot,history=[]){
 const s=snapshot;
 const fields=new Set(s?.availableFields||[]);
 const exists=Boolean(s && s.total>0);
 const missingFields=(...names)=>names.filter(name=>!fields.has(name));
 const hasOtherPeriod=exists&&history.some(p=>p!==s&&p?.total>0&&p.earliest&&p.latest&&s.earliest&&s.latest&&(p.latest<s.earliest||s.latest<p.earliest));
 const tickets=exists&&Number.isInteger(s.total)&&s.total>0;
 const issues=[
   entry('tickets','Volume, status e pendências',tickets?'ready':'blocked',tickets?[]:['Relatório de atendimentos IXC com Status, Assunto e Abertura'],'Quantidades referentes à data do relatório, não acompanhamento em tempo real.'),
   entry('sector','Resultados por setor',!tickets?'blocked':fields.has('Setor')?'ready':'blocked',!tickets?['Relatório de atendimentos']:missingFields('Setor'), 'Sem setor não é possível atribuir os indicadores por departamento.'),
   entry('closing','Tempos de encerramento',!tickets?'blocked':!fields.has('Fechamento')?'blocked':s.closedWithDates>0&&s.closedWithDates===s.finalized?'ready':s.closedWithDates>0?'partial':'blocked',!fields.has('Fechamento')?['Coluna Fechamento']:s.finalized>s.closedWithDates?[`Data de abertura/fechamento válida de ${s.finalized-s.closedWithDates} atendimentos finalizados`]:[], 'Não confundir duração entre datas com tempo de trabalho efetivo.'),
   entry('sla','Cumprimento do SLA','blocked',['Prazo/SLA contratual por categoria validado','Registro confiável de início, pausa e conclusão'],'O campo SLA exportado do IXC exige interpretação validada.'),
   entry('financial','Resultado, margem e perdas financeiras','blocked',['Relatório de receitas por competência','Relatório de despesas por competência','Regras de custo e rateio validadas'],'Não estimar perdas financeiras a partir de quantidade de chamados.'),
   entry('cost','Custo real por atendimento','blocked',['Duração efetiva de cada atendimento','Custo/hora por função ou colaborador','Deslocamento, materiais e rateio de custos indiretos'],'O simulador manual não transforma médias em despesas comprovadas.'),
   entry('customer','Custo por cliente','blocked',['ID técnico correlacionável com pseudonimização no backend','Atendimentos associados por cliente','Receita e custos por cliente ou critério de rateio'],'Não importar nome, documento, senha ou login do cliente.'),
   entry('person','Produtividade individual','blocked',['Identificador técnico pseudonimizado de colaborador','Horas/jornada trabalhada','Classificação da complexidade e retrabalho','Validação de fatores externos'],'Volume absoluto não prova qualidade ou culpa individual.'),
   entry('trend','Evolução histórica 7/30/90 dias',hasOtherPeriod?'partial':'blocked',hasOtherPeriod?['Séries de períodos homogêneos e cobertura completa para cada janela']:['Relatórios adicionais de períodos distintos e não sobrepostos','Datas e cobertura de períodos comparáveis'],'Não comparar dois arquivos com períodos sobrepostos como se fossem séries independentes.')
 ];
 if(exists&&s.invalidDates>0)issues.push(entry('dates','Qualidade das datas de abertura','partial',[`${s.invalidDates} registros sem data de abertura válida`],'Pendências antigas podem ficar subestimadas.'));
 const counts={ready:issues.filter(x=>x.status==='ready').length,partial:issues.filter(x=>x.status==='partial').length,blocked:issues.filter(x=>x.status==='blocked').length};
 return {issues,counts,precise:issues.filter(x=>x.status!=='ready').length===0};
}
