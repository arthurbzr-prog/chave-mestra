/* Chave Mestra — app (Aluguéis + Caixa Mensal). Carregado por shell.js depois do login. */
/* ===== Caixa Mensal ===== */
(function(){
'use strict';
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const CATS_D=['Moradia','Contas da casa','Alimentação','Transporte','Saúde','Educação','Impostos','Cartão','Manutenção','Lazer','Outros'];
const CATS_R=['Salário','Aluguéis','Serviços','Vendas','Rendimentos','Outros'];
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const fmt=v=>brl.format(v||0);
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=new Date();
const TODAY=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
const addM=(k,n)=>{let [y,m]=k.split('-').map(Number);m+=n;y+=Math.floor((m-1)/12);m=((m-1)%12+12)%12+1;return y+'-'+String(m).padStart(2,'0')};
const diffM=(a,b)=>{const [ya,ma]=a.split('-').map(Number),[yb,mb]=b.split('-').map(Number);return (yb-ya)*12+(mb-ma)};
const label=k=>{const [y,m]=k.split('-').map(Number);return MESES[m-1]+' '+y};
const short=k=>{const [y,m]=k.split('-').map(Number);return MESES[m-1].slice(0,3)+'/'+String(y).slice(2)};
const uid=()=>'i'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const parseMoney=s=>{s=String(s).trim().replace(/[R$\s]/g,'');if(s.includes(',')){s=s.replace(/\./g,'').replace(',','.')}const v=Number(s);return isFinite(v)?Math.round(v*100)/100:NaN};

/* ---------- state + storage ---------- */
const S={itens:{},meses:{},transf:{},config:{saldoInicial:0,mesInicial:null,exemplo:false},view:TODAY,tab:'mes',db:null,readonly:false,ready:false};
const LSK='caixa-mensal-v1';
function lsLoad(){try{const d=JSON.parse(localStorage.getItem(LSK)||'null');if(d){S.itens=d.itens||{};S.meses=d.meses||{};S.transf=d.transf||{};S.config=Object.assign(S.config,d.config||{})}}catch(e){}}
function lsSave(){try{localStorage.setItem(LSK,JSON.stringify({itens:S.itens,meses:S.meses,transf:S.transf,config:S.config}))}catch(e){}}
const chains={};
function queue(path,fn){const p=(chains[path]||Promise.resolve()).then(fn,fn);chains[path]=p.catch(()=>{});return p}
async function put(col,id,data){
  data=JSON.parse(JSON.stringify(data));
  if(col==='config')S.config=data;else S[col][id]=data;
  render();
  if(!S.db){lsSave();return}
  try{await queue(col+'/'+id,()=>S.db.doc(col+'/'+id).set(data))}catch(e){fail(e)}
}
async function del(col,id){
  delete S[col][id];render();
  if(!S.db){lsSave();return}
  try{await queue(col+'/'+id,()=>S.db.doc(col+'/'+id).delete())}catch(e){fail(e)}
}
function fail(e){
  if(e&&e.code==='invalid_argument'){S.readonly=true;toast('Você tem acesso só de leitura a este caixa.');render()}
  else if(e&&e.code==='quota_exceeded')toast('Limite de registros atingido. Exclua lançamentos antigos.');
  else toast('Não foi possível salvar agora. Tente de novo.');
}

/* ---------- month computation ---------- */
function applies(it,k){
  if(!it.inicio||k<it.inicio)return false;
  if(it.rec==='unica')return k===it.inicio;
  if(it.rec==='parcelada')return diffM(it.inicio,k)<(it.parcelas||1);
  if(it.rec==='recorrente'&&diffM(it.inicio,k)%(Number(it.intervalo)||1)!==0)return false;
  return !it.fim||k<=it.fim;
}
function mesDoc(k){return S.meses[k]||{ajustes:{}}}
function linhas(k){
  const md=mesDoc(k);
  if(md.fechado&&md.linhas)return md.linhas;
  const aj=md.ajustes||{};const out=[];
  for(const id in S.itens){const it=S.itens[id];if(!applies(it,k))continue;const a=aj[id]||{};if(a.oculto)continue;
    out.push({id,tipo:it.tipo,descricao:it.descricao,categoria:it.categoria||'Outros',rec:it.rec,
      parcela:it.rec==='parcelada'?(diffM(it.inicio,k)+1)+'/'+it.parcelas:null,intervalo:it.intervalo,
      valor:a.valor!=null?a.valor:Number(it.valor)||0,ajustado:a.valor!=null&&a.valor!==Number(it.valor),pago:!!a.pago,exemplo:!!it.exemplo});
  }
  out.forEach(l=>{l.bruto=l.valor;l.tr=[]});
  for(const t of transfDo(k)){const de=out.find(l=>l.id===t.de),pa=out.find(l=>l.id===t.para);if(!de||!pa)continue;const v=Number(t.valor)||0;
    de.valor=Math.round((de.valor-v)*100)/100;pa.valor=Math.round((pa.valor+v)*100)/100;de.tr.push({v:-v,nome:pa.descricao});pa.tr.push({v,nome:de.descricao})}
  out.sort((a,b)=>b.valor-a.valor);return out;
}
function transfAplica(t,k){if(!t.inicio||k<t.inicio)return false;if((t.pular||[]).includes(k))return false;return t.rec==='mensal'?(!t.fim||k<=t.fim):k===t.inicio}
function transfDo(k){return Object.entries(S.transf).map(([id,t])=>({id,...t})).filter(t=>transfAplica(t,k))}
function totais(k){let r=0,d=0,rp=0,dp=0;for(const l of linhas(k)){if(l.tipo==='receita'){r+=l.valor;if(l.pago)rp+=l.valor}else{d+=l.valor;if(l.pago)dp+=l.valor}}return {r,d,s:r-d,rp,dp}}
function inicioBase(){
  if(S.config.mesInicial)return S.config.mesInicial;
  let m=null;for(const id in S.itens){const i=S.itens[id].inicio;if(i&&(!m||i<m))m=i}
  for(const k in S.meses){if(S.meses[k].fechado&&(!m||k<m))m=k}
  return m||TODAY;
}
function acumulado(k){const ini=inicioBase();let acc=Number(S.config.saldoInicial)||0;if(k<ini)return acc;const n=Math.min(diffM(ini,k),600);for(let i=0;i<=n;i++)acc+=totais(addM(ini,i)).s;return acc}
function statusOf(k){if(mesDoc(k).fechado)return 'closed';if(k>TODAY)return 'future';return 'open'}

/* ---------- rendering ---------- */
const ICON={
  check:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  more:'<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  plus:'<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  lock:'<svg class="i" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  swap:'<svg class="i" viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  edit:'<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  unlock:'<svg class="i" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/></svg>'
};
const INTV={2:'Bimestral',3:'Trimestral',4:'Quadrimestral',6:'Semestral',12:'Anual'};
const recLabel=l=>l.rec==='recorrente'?(INTV[l.intervalo]||'A cada '+l.intervalo+' meses'):l.rec==='mensal'?'Mensal':l.rec==='parcelada'?'Parcela '+(l.parcela||''):'Só este mês';
function render(){
  if(!S.ready)return;
  const k=S.view,st=statusOf(k);
  $('#monthTitle').textContent=label(k);
  const pill=$('#monthPill');
  pill.className='pill '+st;
  pill.innerHTML=st==='closed'?ICON.lock+' Fechado':st==='future'?'Previsto':'Aberto';
  $('#banner').hidden=!Object.values(S.itens).some(i=>i.exemplo)||S.readonly;
  for(const t of ['mes','prev','hist']){$('#tab-'+t).setAttribute('aria-selected',S.tab===t);$('#view-'+t).hidden=S.tab!==t}
  renderStrip();
  if(S.tab==='mes')renderMes();else if(S.tab==='prev')renderPrev();else renderHist();
  $('#statusLine').textContent=S.db?'Salvo automaticamente na nuvem deste caixa.':'Salvo apenas neste navegador.';
}
function renderStrip(){
  const y=S.view.slice(0,4);let h=`<div class="yr"><b id="yrLbl">${y}</b><div><button class="icon-btn" data-yr="-1" aria-label="Ano anterior"><svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><button class="icon-btn" data-yr="1" aria-label="Próximo ano"><svg class="i" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button></div></div>`;
  for(let m=1;m<=12;m++){const k=y+'-'+String(m).padStart(2,'0'),t=totais(k),st=statusOf(k);
    h+=`<button class="mchip ${k===TODAY?'today':''}" data-goto="${k}" data-keep aria-current="${k===S.view}" title="${label(k)}: saldo ${fmt(t.s)}"><span class="mn">${MESES[m-1].slice(0,3)}</span><span class="ms ${t.s>=0?'pos':'neg'}">${Math.abs(t.s)>=1000?(t.s/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':Math.round(t.s).toLocaleString('pt-BR')}</span><span class="st">${st==='closed'?'arquivado':st==='future'?'previsto':k===TODAY?'atual':'aberto'}</span></button>`}
  $('#strip').innerHTML=h;
}
function listCard(tipo,ls,locked){
  const tot=ls.reduce((a,l)=>a+l.valor,0),pago=ls.filter(l=>l.pago).reduce((a,l)=>a+l.valor,0);
  const isR=tipo==='receita';
  const rows=ls.map(l=>`<li class="row ${l.pago?'done':''}" data-id="${esc(l.id)}">
    <button class="chk" data-act="pago" aria-pressed="${l.pago}" aria-label="${isR?'Recebido':'Pago'}" ${locked||S.readonly?'disabled':''}>${ICON.check}</button>
    <div><div class="desc">${esc(l.descricao)}</div><div class="meta"><span>${esc(l.categoria)}</span><span class="tag">${esc(recLabel(l))}</span>${l.ajustado?'<span class="tag adj">Ajustado neste mês</span>':''}${(l.tr||[]).map(x=>`<span class="tag tr">${x.v<0?'→ '+fmt(-x.v)+' para ':'← '+fmt(x.v)+' de '}${esc(x.nome)}</span>`).join('')}</div></div>
    <div class="amt-cell"><button class="amt num ${isR?'pos':'neg'}" data-act="valor" ${locked||S.readonly?'disabled':''} title="Alterar valor deste mês">${fmt(l.valor)}</button></div>
    ${locked||S.readonly?'<span></span>':`<div class="more racts"><button class="icon-btn" data-act="edit" aria-label="Editar" title="Editar (valor, repetição, parcelas…)">${ICON.edit}</button><button class="icon-btn" data-act="menu" aria-label="Mais opções">${ICON.more}</button></div>`}
  </li>`).join('');
  return `<div class="card">
    <div class="card-h"><h2><span class="dot" style="background:var(${isR?'--pos':'--neg'})"></span>${isR?'Receitas':'Despesas'}</h2>
      <div style="text-align:right"><div class="tot num ${isR?'pos':'neg'}">${fmt(tot)}</div><div class="meta" style="justify-content:flex-end">${isR?'Recebido':'Pago'}: <span class="num">${fmt(pago)}</span></div></div></div>
    <ul class="rows">${rows||`<li class="empty">Nenhuma ${isR?'receita':'despesa'} neste mês.</li>`}</ul>
    ${locked||S.readonly?'':`<form class="quick" data-quick="${tipo}" novalidate><input id="q-${tipo}-d" placeholder="${isR?'Receita rápida (ex.: venda)':'Despesa rápida (ex.: farmácia)'}" aria-label="Descrição"><input id="q-${tipo}-v" class="num" inputmode="decimal" placeholder="0,00" aria-label="Valor"><label class="qpago" title="${isR?'Já recebida':'Já paga'}"><input type="checkbox" id="q-${tipo}-p"> ${isR?'recebida':'paga'}</label><button class="btn ${isR?'qr':'qd'}" type="submit">${ICON.plus} Incluir</button></form>`}
    ${locked||S.readonly?'':`<div class="card-f">${isR&&ls.length>1?`<button class="btn ghost" data-transf>${ICON.swap} Transferir</button>`:''}<button class="btn ghost" data-add="${tipo}">${ICON.plus} ${isR?'Receita':'Despesa'} fixa ou parcelada</button></div>`}
  </div>`;
}
function renderMes(){
  const k=S.view,md=mesDoc(k),locked=!!md.fechado,ls=linhas(k),t=totais(k),acc=acumulado(k),antes=acumulado(addM(k,-1));
  const cats={};ls.filter(l=>l.tipo==='despesa').forEach(l=>cats[l.categoria]=(cats[l.categoria]||0)+l.valor);
  const catArr=Object.entries(cats).sort((a,b)=>b[1]-a[1]);const cmax=catArr.length?catArr[0][1]:1;
  const sCls=v=>v>=0?'pos':'neg';
  $('#view-mes').innerHTML=`
  <div class="summary">
    <div><span class="lbl">Receitas</span><span class="val num pos">${fmt(t.r)}</span><span class="sub">Recebido ${fmt(t.rp)}</span></div>
    <div><span class="lbl">Despesas</span><span class="val num neg">${fmt(t.d)}</span><span class="sub">Pago ${fmt(t.dp)}</span></div>
    <div><span class="lbl">Saldo do mês</span><span class="val num ${sCls(t.s)}">${fmt(t.s)}</span><span class="sub">${t.s>=0?'Sobra no mês':'Falta no mês'}</span></div>
    <div><span class="lbl">Saldo acumulado</span><span class="val num ${sCls(acc)}">${fmt(acc)}</span><span class="sub">Vindo de ${short(addM(k,-1))}: <span class="num">${fmt(antes)}</span></span></div>
  </div>
  <div class="cols">${listCard('receita',ls.filter(l=>l.tipo==='receita'),locked)}${listCard('despesa',ls.filter(l=>l.tipo==='despesa'),locked)}</div>
  <div class="actions">
    <div class="meta">${locked?`Mês fechado em ${esc(md.fechadoEm||'')} e arquivado. Os valores ficam congelados.`:'Clique no valor para alterar só neste mês. Marque o quadrado quando pagar ou receber.'}</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn" data-cxxl="mes" title="Baixar o fluxo de caixa deste mês em Excel">Planilha do mês</button>${S.readonly?'':locked?`<button class="btn" id="reopen">${ICON.unlock} Reabrir mês</button>`:`<button class="btn primary" id="closeMonth">${ICON.lock} Fechar e arquivar ${esc(label(k))}</button>`}</div>
  </div>
  ${trCard(k,locked)}
  ${catArr.length?`<div class="card"><div class="card-h"><h2>Despesas por categoria</h2></div><div class="cat">${catArr.map(([c,v])=>`<div class="cat-row"><span>${esc(c)}</span><div class="bar"><i style="width:${(v/cmax*100).toFixed(1)}%"></i></div><span class="num">${fmt(v)}</span></div>`).join('')}</div></div>`:''}`;
}
function trCard(k,locked){
  const ts=locked?(mesDoc(k).transfs||[]):transfDo(k);if(!ts.length)return '';
  const nm=id=>(S.itens[id]&&S.itens[id].descricao)||'(receita removida)';
  return `<div class="card" style="margin-bottom:20px"><div class="card-h"><h2>${ICON.swap} Transferências entre receitas</h2><span class="meta">${ts.length}</span></div><ul class="rows">${ts.map(t=>`<li class="row" style="grid-template-columns:1fr auto auto"><div><div class="desc">${esc(t.deNome||nm(t.de))} → ${esc(t.paraNome||nm(t.para))}</div><div class="meta"><span class="tag">${t.rec==='mensal'?'Todo mês':'Só este mês'}</span>${t.obs?`<span>${esc(t.obs)}</span>`:''}</div></div><span class="num">${fmt(t.valor)}</span>${locked||S.readonly?'<span></span>':`<button class="icon-btn" data-tdel="${esc(t.id)}" aria-label="Desfazer transferência" title="Desfazer">✕</button>`}</li>`).join('')}</ul><div class="note">A transferência move o valor de uma receita para outra; o total de receitas do mês não muda.</div></div>`;
}
function transfForm(){
  const k=S.view,rs=linhas(k).filter(l=>l.tipo==='receita');
  const opts=sel=>rs.map(l=>`<option value="${esc(l.id)}" ${l.id===sel?'selected':''}>${esc(l.descricao)} — ${fmt(l.valor)}</option>`).join('');
  modal(`<h3>Transferir entre receitas</h3><p>${esc(label(k))}. O valor sai de uma receita e entra na outra.</p>
  <form id="tf" novalidate>
    <div class="field"><label for="t-de">De (sai de)</label><select id="t-de">${opts(rs[0]&&rs[0].id)}</select></div>
    <div class="field"><label for="t-para">Para (entra em)</label><select id="t-para">${opts(rs[1]&&rs[1].id)}</select></div>
    <div class="grid2"><div class="field"><label for="t-val">Valor (R$)</label><input id="t-val" inputmode="decimal" placeholder="0,00"></div>
    <div class="field"><label for="t-rec">Repetir</label><select id="t-rec"><option value="unica">Só este mês</option><option value="mensal">Todo mês a partir deste</option></select></div></div>
    <div class="field"><label for="t-obs">Observação (opcional)</label><input id="t-obs" placeholder="Ex.: reserva para manutenção"></div>
    <div class="meta" id="t-err" style="color:var(--neg)"></div>
  </form><div class="sheet-f"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Transferir</button></div>`,(el,close)=>{
    el.querySelector('[data-x]').onclick=close;
    const ok=async()=>{const de=el.querySelector('#t-de').value,para=el.querySelector('#t-para').value,v=parseMoney(el.querySelector('#t-val').value),err=el.querySelector('#t-err');
      if(!de||!para||de===para){err.textContent='Escolha duas receitas diferentes.';return}
      if(!(v>0)){err.textContent='Informe um valor maior que zero, como 500,00.';return}
      const disp=(rs.find(l=>l.id===de)||{}).valor||0;if(v>disp+0.001){err.textContent='A receita de origem tem só '+fmt(disp)+' neste mês.';return}
      const rec=el.querySelector('#t-rec').value,obs=el.querySelector('#t-obs').value.trim();close();
      await put('transf',uid(),{de,para,valor:v,rec,inicio:k,obs:obs||undefined});toast('Transferido '+fmt(v)+(rec==='mensal'?' todo mês a partir de '+label(k):'')+'.')};
    el.querySelector('[data-ok]').onclick=ok;el.querySelector('#tf').addEventListener('submit',e=>{e.preventDefault();ok()});
  });
}
async function transfDel(id){
  const t=S.transf[id],k=S.view;if(!t)return;const opts=[];
  if(t.rec==='mensal'){opts.push({label:'Desfazer só em '+label(k),value:'one'});if(k>t.inicio)opts.push({label:'Desfazer deste mês em diante',hint:'Meses anteriores continuam',value:'fwd'})}
  opts.push({label:t.rec==='mensal'?'Excluir de todos os meses':'Desfazer transferência',value:'all',danger:true});
  const c=await choose('Desfazer transferência de '+fmt(t.valor)+'?','',opts);if(!c)return;
  if(c==='one')await put('transf',id,{...t,pular:[...(t.pular||[]),k]});
  else if(c==='fwd')await put('transf',id,{...t,fim:addM(k,-1)});
  else await del('transf',id);
  toast('Transferência desfeita.');
}
function renderPrev(){
  const Y=S.view.slice(0,4),start=Y+'-01',N=12,rows=[];
  for(let i=0;i<N;i++){const k=addM(start,i),t=totais(k);rows.push({k,...t,acc:acumulado(k),st:statusOf(k)})}
  const sum=rows.reduce((a,r)=>({r:a.r+r.r,d:a.d+r.d}),{r:0,d:0});
  // chart
  const W=720,H=240,pl=64,pr=12,pt=14,pb=28,cw=(W-pl-pr)/N;
  const vals=rows.flatMap(r=>[r.r,r.d,r.acc,0]);let max=Math.max(...vals),min=Math.min(...vals);
  const niceStep=x=>{const p=Math.pow(10,Math.floor(Math.log10(x||1)));const f=x/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p};
  const step=niceStep((max-min)/4||1);max=Math.ceil(max/step)*step;min=Math.floor(min/step)*step;if(max===min)max=min+step;
  const y=v=>pt+(max-v)/(max-min)*(H-pt-pb);
  let g='';for(let v=min;v<=max+1e-6;v+=step){g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${v===0?'stroke-width="1.5"':''}/><text x="${pl-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${Math.abs(v)>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':v.toLocaleString('pt-BR')}</text>`}
  const bw=Math.min(16,cw/3);let bars='',pts=[];
  rows.forEach((r,i)=>{const cx=pl+cw*i+cw/2;
    bars+=`<rect x="${cx-bw-1}" y="${y(r.r)}" width="${bw}" height="${Math.max(0,y(0)-y(r.r))}" rx="2" fill="var(--pos)" opacity="${r.st==='closed'?1:.8}"><title>${label(r.k)} · receitas ${fmt(r.r)}</title></rect>`;
    bars+=`<rect x="${cx+1}" y="${y(r.d)}" width="${bw}" height="${Math.max(0,y(0)-y(r.d))}" rx="2" fill="var(--neg)" opacity="${r.st==='closed'?1:.8}"><title>${label(r.k)} · despesas ${fmt(r.d)}</title></rect>`;
    bars+=`<text x="${cx}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted)">${short(r.k)}</text>`;
    pts.push([cx,y(r.acc)]);
  });
  const line=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`+pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===pts.length-1?4.5:3}" fill="var(--accent)"><title>${label(rows[i].k)} · acumulado ${fmt(rows[i].acc)}</title></circle>`).join('');
  $('#view-prev').innerHTML=`
  <div class="summary">
    <div><span class="lbl">Receitas em ${Y}</span><span class="val num pos">${fmt(sum.r)}</span><span class="sub">Média ${fmt(sum.r/N)}/mês</span></div>
    <div><span class="lbl">Despesas em ${Y}</span><span class="val num neg">${fmt(sum.d)}</span><span class="sub">Média ${fmt(sum.d/N)}/mês</span></div>
    <div><span class="lbl">Resultado do ano</span><span class="val num ${sum.r-sum.d>=0?'pos':'neg'}">${fmt(sum.r-sum.d)}</span><span class="sub">${short(start)} a ${short(addM(start,N-1))}</span></div>
    <div><span class="lbl">Saldo acumulado em dez/${Y.slice(2)}</span><span class="val num ${rows[N-1].acc>=0?'pos':'neg'}">${fmt(rows[N-1].acc)}</span><span class="sub">${rows.some(r=>r.acc<0)?'Atenção: fica negativo em '+short(rows.find(r=>r.acc<0).k):'Sem meses negativos'}</span></div>
  </div>
  <div class="card" style="margin-bottom:18px">
    <div class="card-h"><h2>Projeção de ${Y} · janeiro a dezembro</h2><button class="btn" data-cxxl="ano">Planilha do ano</button></div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas, despesas e saldo acumulado de janeiro a dezembro">${g}${bars}${line}</svg></div>
    <div class="legend"><span><i style="background:var(--pos)"></i>Receitas</span><span><i style="background:var(--neg)"></i>Despesas</span><span><i style="background:var(--accent);height:3px"></i>Saldo acumulado</span></div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo do mês</th><th>Acumulado</th><th>Situação</th></tr></thead><tbody>
    ${rows.map(r=>`<tr class="${r.k===S.view?'cur':''}"><td><button class="link" data-goto="${r.k}">${label(r.k)}</button></td><td class="num pos">${fmt(r.r)}</td><td class="num neg">${fmt(r.d)}</td><td class="num ${r.s>=0?'pos':'neg'}">${fmt(r.s)}</td><td class="num ${r.acc>=0?'pos':'neg'}">${fmt(r.acc)}</td><td><span class="pill ${r.st}">${r.st==='closed'?'Fechado':r.st==='future'?'Previsto':'Aberto'}</span></td></tr>`).join('')}
    </tbody></table></div>
    <div class="note">Meses passados mostram o que foi lançado; meses futuros mostram a projeção. A projeção usa as receitas e despesas cadastradas (fixas mensais, parcelas e lançamentos únicos), com os ajustes que você fez em cada mês. Meses fechados usam os valores arquivados.</div>
  </div>
  <div class="card" style="margin-top:18px"><div class="card-h"><h2>Ponto de partida</h2>${S.readonly?'':'<button class="btn" id="editConfig">Alterar</button>'}</div>
    <div class="note" style="border-top:0">Saldo inicial de <b class="num">${fmt(S.config.saldoInicial)}</b> em ${label(inicioBase())}. O saldo acumulado soma a partir daqui.</div></div>`;
}
function renderHist(){
  const ks=Object.keys(S.meses).filter(k=>S.meses[k].fechado).sort().reverse();
  const tot=ks.reduce((a,k)=>{const t=S.meses[k].totais||totais(k);return {r:a.r+t.r,d:a.d+t.d}},{r:0,d:0});
  $('#view-hist').innerHTML=`
  <div class="card">
    <div class="card-h"><h2>Meses fechados e arquivados</h2><span class="meta">${ks.length} ${ks.length===1?'mês':'meses'}</span></div>
    ${ks.length?`<div class="tbl-wrap"><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo do mês</th><th>Acumulado no fechamento</th><th>Fechado em</th></tr></thead><tbody>
    ${ks.map(k=>{const m=S.meses[k],t=m.totais||totais(k);return `<tr><td><button class="link" data-goto="${k}" data-tab="mes">${label(k)}</button></td><td class="num pos">${fmt(t.r)}</td><td class="num neg">${fmt(t.d)}</td><td class="num ${t.s>=0?'pos':'neg'}">${fmt(t.s)}</td><td class="num ${(t.acc??0)>=0?'pos':'neg'}">${fmt(t.acc)}</td><td>${esc(m.fechadoEm||'')}</td></tr>`}).join('')}
    <tr><td><b>Total arquivado</b></td><td class="num pos"><b>${fmt(tot.r)}</b></td><td class="num neg"><b>${fmt(tot.d)}</b></td><td class="num ${tot.r-tot.d>=0?'pos':'neg'}"><b>${fmt(tot.r-tot.d)}</b></td><td></td><td></td></tr>
    </tbody></table></div>`:`<div class="empty">Nenhum mês fechado ainda. No fim de cada mês, use “Fechar e arquivar” na aba Mês — os valores ficam guardados aqui.</div>`}
  </div>`;
}

/* ---------- modals ---------- */
function modal(html,onMount){
  const root=$('#modalRoot');root.innerHTML=`<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov=root.firstElementChild;const close=()=>{root.innerHTML='';document.removeEventListener('keydown',kd)};
  const kd=e=>{if(e.key==='Escape')close()};document.addEventListener('keydown',kd);
  ov.addEventListener('mousedown',e=>{if(e.target===ov)close()});
  onMount&&onMount(ov.firstElementChild,close);
  const f=ov.querySelector('input,button');f&&f.focus();
  return close;
}
function choose(title,text,opts){
  return new Promise(res=>{
    modal(`<h3>${esc(title)}</h3>${text?`<p>${esc(text)}</p>`:''}<div class="choices">${opts.map((o,i)=>`<button data-i="${i}" class="${o.danger?'danger':''}"><b>${esc(o.label)}</b>${o.hint?`<small>${esc(o.hint)}</small>`:''}</button>`).join('')}</div><div class="sheet-f"><button class="btn" data-x>Cancelar</button></div>`,
    (el,close)=>{el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-x')){close();res(null)}else if(b.dataset.i!=null){close();res(opts[+b.dataset.i].value)}})});
  });
}
function toast(msg){const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2800)}

function itemForm(tipo,it){
  const k=S.view,editing=!!it;it=it||{tipo,descricao:'',categoria:'',valor:'',rec:'mensal',inicio:k,fim:'',parcelas:2};
  let cur=it.tipo;
  const cats=()=>(cur==='receita'?CATS_R:CATS_D).map(c=>`<option value="${esc(c)}">`).join('');
  modal(`<h3>${editing?'Editar lançamento':'Novo lançamento'}</h3>
  <form id="f" novalidate>
    <div class="seg" role="group" aria-label="Tipo"><button type="button" class="r" data-t="receita" aria-pressed="${cur==='receita'}">Receita</button><button type="button" class="d" data-t="despesa" aria-pressed="${cur==='despesa'}">Despesa</button></div>
    <div class="field"><label for="f-desc">Descrição</label><input id="f-desc" required value="${esc(it.descricao)}" placeholder="Ex.: Conta de energia"></div>
    <div class="grid2">
      <div class="field"><label for="f-cat">Categoria</label><input id="f-cat" list="f-cats" value="${esc(it.categoria)}" placeholder="Escolha ou digite"><datalist id="f-cats">${cats()}</datalist></div>
      <div class="field"><label for="f-val">Valor (R$) · do mês ou da parcela</label><input id="f-val" inputmode="decimal" value="${it.valor!==''?String(it.valor).replace('.',','):''}" placeholder="0,00"></div>
    </div>
    <div class="grid2">
      <div class="field"><label for="f-rec">Repetição</label><select id="f-rec"><option value="mensal">Mensal (todo mês)</option><option value="recorrente">Recorrente (a cada X meses)</option><option value="parcelada">Parcelada</option><option value="unica">Só um mês</option></select></div>
      <div class="field"><label for="f-ini">Começa em</label><input id="f-ini" type="month" value="${esc(it.inicio)}"></div>
    </div>
    <div class="grid2">
      <div class="field" id="w-fim"><label for="f-fim">Termina em (opcional)</label><input id="f-fim" type="month" value="${esc(it.fim||'')}"></div>
      <div class="field" id="w-parc"><label for="f-parc">Nº de parcelas</label><input id="f-parc" type="number" min="2" max="120" value="${esc(it.parcelas||2)}"></div>
      <div class="field" id="w-int"><label for="f-int">Repete a cada</label><select id="f-int">${[2,3,4,6,12].map(n=>`<option value="${n}" ${Number(it.intervalo||12)===n?"selected":""}>${n} meses (${INTV[n].toLowerCase()})</option>`).join("")}</select></div>
    </div>
    <div class="meta" id="f-hint"></div>
    <div class="meta" id="f-err" style="color:var(--neg)"></div>
  </form>
  <div class="sheet-f">${editing?'<button class="btn danger" data-del style="margin-right:auto">Excluir</button>':''}<button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>${editing?'Salvar':'Adicionar'}</button></div>`,
  (el,close)=>{
    const rec=el.querySelector('#f-rec');rec.value=it.rec;
    const sync=()=>{el.querySelector('#f-hint').textContent=rec.value==='mensal'?'Aparece automaticamente em todos os meses seguintes, até o mês final (se informado).':rec.value==='parcelada'?'Aparece uma parcela por mês a partir do mês inicial.':'Aparece só no mês inicial.';el.querySelector('#w-fim').hidden=!(rec.value==='mensal'||rec.value==='recorrente');el.querySelector('#w-parc').hidden=rec.value!=='parcelada';el.querySelector('#w-int').hidden=rec.value!=='recorrente';
      if(rec.value==='recorrente')el.querySelector('#f-hint').textContent='Aparece no mês inicial e depois a cada '+el.querySelector('#f-int').value+' meses (ex.: IPVA, seguro anual).';
      if(rec.value==='parcelada'){const v=parseMoney(el.querySelector('#f-val').value),n=parseInt(el.querySelector('#f-parc').value,10)||0;if(v>0&&n>0)el.querySelector('#f-hint').textContent+=' Valor da parcela '+fmt(v)+' × '+n+' = '+fmt(v*n)+' no total.'}};
    sync();rec.onchange=sync;el.querySelector('#f-int').onchange=sync;el.querySelector('#f-parc').oninput=sync;el.querySelector('#f-val').addEventListener('input',sync);
    el.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{cur=b.dataset.t;el.querySelectorAll('[data-t]').forEach(x=>x.setAttribute('aria-pressed',x===b));el.querySelector('#f-cats').innerHTML=cats()});
    el.querySelector('[data-x]').onclick=close;
    const del=el.querySelector('[data-del]');if(del)del.onclick=()=>{close();removeFlow(it.id)};
    const submit=async()=>{
      const d={tipo:cur,descricao:el.querySelector('#f-desc').value.trim(),categoria:el.querySelector('#f-cat').value.trim()||'Outros',valor:parseMoney(el.querySelector('#f-val').value),rec:rec.value,inicio:el.querySelector('#f-ini').value||k};
      if(d.rec==='mensal'||d.rec==='recorrente'){const f=el.querySelector('#f-fim').value;if(f)d.fim=f}
      if(d.rec==='recorrente')d.intervalo=parseInt(el.querySelector('#f-int').value,10)||12;
      if(d.rec==='parcelada')d.parcelas=Math.max(2,parseInt(el.querySelector('#f-parc').value,10)||2);
      const err=el.querySelector('#f-err');
      if(!d.descricao){err.textContent='Informe uma descrição.';return}
      if(!(d.valor>=0)){err.textContent='Informe um valor válido, como 150,00.';return}
      if(d.fim&&d.fim<d.inicio){err.textContent='O mês final precisa ser depois do inicial.';return}
      close();
      if(!editing){await put('itens',uid(),d);if(!applies(d,S.view))toast('Adicionado a partir de '+label(d.inicio)+'.');else toast('Lançamento adicionado.');return}
      const old=S.itens[it.id];
      if((old.rec==='mensal'||old.rec==='recorrente')&&k>old.inicio&&(!old.fim||k<=old.fim)){
        const c=await choose('Aplicar a alteração a quais meses?','Meses anteriores ficam como estavam se você escolher “deste mês em diante”.',[
          {label:'Deste mês em diante',hint:'A partir de '+label(k),value:'fwd'},
          {label:'Todos os meses',hint:'Inclusive os anteriores ainda abertos',value:'all'}]);
        if(!c)return;
        if(c==='fwd'){await put('itens',it.id,{...old,fim:addM(k,-1)});await put('itens',uid(),{...d,inicio:k,fim:d.fim||old.fim||undefined,exemplo:old.exemplo||undefined});toast('Alterado de '+label(k)+' em diante.');return}
      }
      await put('itens',it.id,{...d,exemplo:old.exemplo||undefined});toast('Lançamento atualizado.');
    };
    el.querySelector('[data-ok]').onclick=submit;
    el.querySelector('#f').addEventListener('submit',e=>{e.preventDefault();submit()});
  });
}
async function setAjuste(id,patch){
  const k=S.view,md=JSON.parse(JSON.stringify(mesDoc(k)));md.ajustes=md.ajustes||{};
  const a=Object.assign(md.ajustes[id]||{},patch);for(const x in a)if(a[x]==null)delete a[x];
  if(Object.keys(a).length)md.ajustes[id]=a;else delete md.ajustes[id];
  await put('meses',k,md);
}
async function removeFlow(id){
  const it=S.itens[id],k=S.view;if(!it)return;
  const opts=[];
  if(it.rec!=='unica')opts.push({label:'Só de '+label(k),hint:'Os outros meses continuam',value:'one'});
  if((it.rec==='mensal'||it.rec==='recorrente')&&k>it.inicio)opts.push({label:'Deste mês em diante',hint:'Encerra em '+label(addM(k,-1))+'; meses anteriores ficam',value:'fwd'});
  opts.push({label:'Excluir de todos os meses',hint:'Meses já fechados não mudam',value:'all',danger:true});
  const c=await choose('Remover “'+it.descricao+'”?','',opts);if(!c)return;
  if(c==='one'){await setAjuste(id,{oculto:true});toast('Removido de '+label(k)+'.')}
  else if(c==='fwd'){await put('itens',id,{...it,fim:addM(k,-1)});toast('Encerrado a partir de '+label(k)+'.')}
  else {await del('itens',id);toast('Lançamento excluído.')}
}
function editValue(btn,id){
  const l=linhas(S.view).find(x=>x.id===id);if(!l)return;
  const inp=document.createElement('input');inp.className='amt-input';inp.id='amt-'+id;inp.inputMode='decimal';inp.value=(l.bruto??l.valor).toFixed(2).replace('.',',');inp.setAttribute('aria-label','Valor deste mês');
  btn.replaceWith(inp);inp.focus();inp.select();
  let done=false;
  const finish=async save=>{if(done)return;done=true;
    if(!save){render();return}
    const v=parseMoney(inp.value);if(!(v>=0)){toast('Valor inválido. Use o formato 150,00.');render();return}
    const base=Number(S.itens[id].valor)||0;
    await setAjuste(id,{valor:v===base?null:v});
    if(v!==(l.bruto??l.valor))toast('Valor de '+label(S.view)+' alterado para '+fmt(v)+'.');
  };
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')finish(true);if(e.key==='Escape')finish(false)});
  inp.addEventListener('blur',()=>finish(true));
}
async function closeMonth(){
  const k=S.view,t=totais(k);
  const c=await choose('Fechar '+label(k)+'?','Os valores do mês ficam arquivados e congelados. Você pode reabrir depois se precisar corrigir algo.',[
    {label:'Fechar e arquivar',hint:'Receitas '+fmt(t.r)+' · Despesas '+fmt(t.d)+' · Saldo '+fmt(t.s),value:'ok'}]);
  if(c!=='ok')return;
  const md=JSON.parse(JSON.stringify(mesDoc(k)));
  md.linhas=linhas(k);md.transfs=transfDo(k).map(t=>({...t,deNome:(S.itens[t.de]||{}).descricao,paraNome:(S.itens[t.para]||{}).descricao}));md.totais={...t,acc:acumulado(k)};md.fechado=true;md.fechadoEm=new Date().toLocaleDateString('pt-BR');
  await put('meses',k,md);toast(label(k)+' fechado e arquivado.');
}
async function reopen(){
  const k=S.view;
  const c=await choose('Reabrir '+label(k)+'?','O mês volta a ser calculado pelos lançamentos cadastrados, mantendo os ajustes e pagamentos marcados.',[{label:'Reabrir mês',value:'ok'}]);
  if(c!=='ok')return;
  const md=JSON.parse(JSON.stringify(mesDoc(k)));
  // keep pago flags from snapshot
  (md.linhas||[]).forEach(l=>{if(S.itens[l.id]){md.ajustes=md.ajustes||{};md.ajustes[l.id]=Object.assign(md.ajustes[l.id]||{},l.pago?{pago:true}:{})}});
  delete md.linhas;delete md.transfs;delete md.totais;delete md.fechado;delete md.fechadoEm;
  await put('meses',k,md);toast(label(k)+' reaberto.');
}
function configForm(){
  modal(`<h3>Ponto de partida</h3><p>Quanto você tinha em caixa no começo do controle.</p>
  <form id="cf"><div class="grid2"><div class="field"><label for="c-saldo">Saldo inicial (R$)</label><input id="c-saldo" inputmode="decimal" value="${String(S.config.saldoInicial||0).replace('.',',')}"></div>
  <div class="field"><label for="c-mes">A partir de</label><input id="c-mes" type="month" value="${esc(inicioBase())}"></div></div></form>
  <div class="sheet-f"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Salvar</button></div>`,(el,close)=>{
    el.querySelector('[data-x]').onclick=close;
    const ok=async()=>{const v=parseMoney(el.querySelector('#c-saldo').value);if(!isFinite(v)){toast('Saldo inválido.');return}close();await put('config','geral',{...S.config,saldoInicial:v,mesInicial:el.querySelector('#c-mes').value||null});toast('Ponto de partida salvo.')};
    el.querySelector('[data-ok]').onclick=ok;el.querySelector('#cf').addEventListener('submit',e=>{e.preventDefault();ok()});
  });
}

window.CX={modal,choose,toast,fmt,esc,parseMoney,cx:{linhas,totais,acumulado,label,statusOf,recLabel}};
/* ---------- events ---------- */
$('#prev').onclick=()=>{S.view=addM(S.view,-1);render()};
$('#next').onclick=()=>{S.view=addM(S.view,1);render()};
['mes','prev','hist'].forEach(t=>$('#tab-'+t).onclick=()=>{S.tab=t;try{localStorage.setItem(LSK+'-tab',t)}catch(e){};render()});
document.addEventListener('click',e=>{
  const yb=e.target.closest('[data-yr]');if(yb){S.view=addM(S.view,12*+yb.dataset.yr);render();return}
  const g=e.target.closest('[data-goto]');if(g){S.view=g.dataset.goto;if(!g.hasAttribute('data-keep')){S.tab='mes';window.scrollTo(0,0)}render();return}
  const add=e.target.closest('[data-add]');if(add&&!S.readonly){itemForm(add.dataset.add);return}
  const xl=e.target.closest('[data-cxxl]');if(xl){if(window.RELAT_run)window.RELAT_run(xl.dataset.cxxl==='mes'?'caixaMes':'caixaAno',xl.dataset.cxxl==='mes'?S.view:S.view.slice(0,4));return}
  if(e.target.closest('[data-transf]')&&!S.readonly){transfForm();return}
  const td=e.target.closest('[data-tdel]');if(td&&!S.readonly){transfDel(td.dataset.tdel);return}
  if(e.target.closest('#closeMonth')){closeMonth();return}
  if(e.target.closest('#reopen')){reopen();return}
  if(e.target.closest('#editConfig')){configForm();return}
  const act=e.target.closest('[data-act]');if(!act||S.readonly)return;
  const id=act.closest('[data-id]').dataset.id;
  if(act.dataset.act==='pago'){const l=linhas(S.view).find(x=>x.id===id);setAjuste(id,{pago:l&&l.pago?null:true})}
  else if(act.dataset.act==='valor')editValue(act,id);
  else if(act.dataset.act==='edit'){const it=S.itens[id];if(it)itemForm(it.tipo,{...it,id})}
  else if(act.dataset.act==='menu'){const it=S.itens[id];if(it)choose(it.descricao,'',[
    {label:'Alterar valor só deste mês',value:'v'},{label:'Editar lançamento',hint:'Descrição, categoria, valor base e repetição',value:'e'},{label:'Remover…',value:'r',danger:true}]).then(c=>{
      if(c==='v'){const b=document.querySelector(`[data-id="${CSS.escape(id)}"] [data-act="valor"]`);b&&editValue(b,id)}
      else if(c==='e')itemForm(it.tipo,{...it,id});else if(c==='r')removeFlow(id)})}
});
$('#clearExamples').onclick=async()=>{
  const c=await choose('Apagar os lançamentos de exemplo?','Seus próprios lançamentos não são afetados.',[{label:'Apagar exemplos',value:'ok',danger:true}]);
  if(c!=='ok')return;
  for(const id of Object.keys(S.itens))if(S.itens[id].exemplo)await del('itens',id);
  toast('Exemplos apagados.');
};

document.addEventListener('submit',async e=>{
  const f=e.target.closest&&e.target.closest('[data-quick]');if(!f)return;e.preventDefault();if(S.readonly)return;
  const tipo=f.dataset.quick,dI=f.querySelector('#q-'+tipo+'-d'),vI=f.querySelector('#q-'+tipo+'-v'),pI=f.querySelector('#q-'+tipo+'-p');
  const d=dI.value.trim(),v=parseMoney(vI.value);
  if(!d){toast('Escreva o que é essa '+(tipo==='receita'?'receita':'despesa')+'.');dI.focus();return}
  if(!(v>0)){toast('Informe o valor, como 150,00.');vI.focus();return}
  const id=uid(),k=S.view;
  await put('itens',id,{tipo,descricao:d,categoria:'Avulsa',valor:v,rec:'unica',inicio:k});
  if(pI.checked)await setAjuste(id,{pago:true});
  toast((tipo==='receita'?'Receita':'Despesa')+' incluída em '+label(k)+'.');
  const n=document.getElementById('q-'+tipo+'-d');if(n)n.focus();
});
/* ---------- boot ---------- */
try{const t=localStorage.getItem(LSK+'-tab');if(t)S.tab=t}catch(e){}
function start(){S.ready=true;render()}
let booted=false;
const fallback=setTimeout(()=>{if(!booted){booted=true;lsLoad();start()}},10500);
(async()=>{
  let db=null;try{db=window.claude&&window.claude.use?await window.claude.use('db'):null}catch(e){db=null}
  if(booted)return;
  if(!db){booted=true;clearTimeout(fallback);lsLoad();start();return}
  booted=true;clearTimeout(fallback);S.db=db;
  let got={itens:false,meses:false,transf:false,config:false};
  const maybe=()=>{if(got.itens&&got.meses&&got.transf&&got.config&&!S.ready)start();else render()};
  const err=e=>{if(e&&e.code==='revoked'){S.readonly=true;render()}};
  db.collection('itens').onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=JSON.parse(JSON.stringify(d.data())));S.itens=o;got.itens=true;maybe()},err);
  db.collection('transf').onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=JSON.parse(JSON.stringify(d.data())));S.transf=o;got.transf=true;maybe()},err);
  db.collection('meses').onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=JSON.parse(JSON.stringify(d.data())));S.meses=o;got.meses=true;maybe()},err);
  db.doc('config/geral').onSnapshot(s=>{if(s.exists)S.config=Object.assign({saldoInicial:0,mesInicial:null},JSON.parse(JSON.stringify(s.data())));got.config=true;maybe()},err);
  try{const u=await window.claude.use('user');if(u&&u.can){const w=await u.can('data.write');if(w===false){S.readonly=true;render()}}}catch(e){}
})();
if(!(window.claude&&window.claude.use)){booted=true;clearTimeout(fallback);lsLoad();start()}
})();

/* ===== Aluguéis ===== */
(function(){
'use strict';
const {modal,choose,toast,fmt,esc,parseMoney}=window.CX;
const $=s=>document.querySelector(s);
const p2=n=>String(n).padStart(2,'0');
const isoD=d=>d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const TODAY=isoD(new Date());
const CUR=TODAY.slice(0,7);
const MES3=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const fd=s=>s?String(s).split('-').reverse().join('/'):'—';
const fm=s=>{if(!s)return '—';const [y,m]=s.split('-');return MES3[+m-1]+'/'+y};
const fms=s=>{const [y,m]=s.split('-');return MES3[+m-1]+'/'+y.slice(2)};
const addMon=(s,n)=>{const [y,m,d]=s.split('-').map(Number);const dt=new Date(y,m-1+n,1);const last=new Date(dt.getFullYear(),dt.getMonth()+1,0).getDate();dt.setDate(Math.min(d||1,last));return isoD(dt)};
const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number);return isoD(new Date(y,m-1,d+n))};
const addComp=(k,n)=>addMon(k+'-01',n).slice(0,7);
const days=s=>{if(!s)return null;const [y,m,d]=s.split('-').map(Number);const t=new Date();t.setHours(0,0,0,0);return Math.round((new Date(y,m-1,d)-t)/864e5)};
const uid=()=>'c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const num=v=>Number(v)||0;
const pct=v=>(Number(v)||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const sum=(a,k)=>a.reduce((s,r)=>s+num(r[k]),0);
const vencOf=(comp,dia)=>{const [y,m]=comp.split('-').map(Number);const last=new Date(y,m,0).getDate();return comp+'-'+p2(Math.min(num(dia)||10,last))};
const dataExtenso=s=>{const [y,m,d]=s.split('-').map(Number);return d+' de '+MESES[m-1]+' de '+y};
const blob=id=>window.MIDIA?window.MIDIA.src(id):'';

const COLS=['precad','pessoas','imoveis','contratos','vistorias','financeiro','despesas','manutencao','estoque'];
const DEF_CFG={empresa:'',taxaAdm:10,multa:2,jurosMes:1,igpm:4,ipca:4,inpc:4,alertaDias:30,modelo:''};
const C={data:Object.fromEntries(COLS.map(c=>[c,{}])),config:{...DEF_CFG},mod:'painel',q:'',finMes:'',finIm:'',finTab:'receb',finAno:CUR.slice(0,4),finSel:'',db:null,assets:null,downloads:null,ready:false};
const LSK='chave-mestra-v1';
try{const m=localStorage.getItem(LSK+'-mod');if(m)C.mod=m;const f=localStorage.getItem(LSK+'-fin');if(f)C.finTab=f}catch(e){}

/* ---------- storage ---------- */
function lsLoad(){try{const d=JSON.parse(localStorage.getItem(LSK)||'null');if(d){COLS.forEach(c=>C.data[c]=d.data&&d.data[c]||{});C.config={...DEF_CFG,...(d.config||{})}}}catch(e){}}
function lsSave(){try{localStorage.setItem(LSK,JSON.stringify({data:C.data,config:C.config}))}catch(e){}}
const chains={};
function queue(p,fn){const r=(chains[p]||Promise.resolve()).then(fn,fn);chains[p]=r.catch(()=>{});return r}
function fail(e){if(e&&e.code==='invalid_argument')toast('Você tem acesso só de leitura.');else if(e&&e.code==='quota_exceeded')toast('Limite de registros atingido. Exclua registros antigos.');else toast('Não foi possível salvar agora. Tente de novo.')}
async function put(c,id,data){
  data=JSON.parse(JSON.stringify(data));
  if(c==='config')C.config={...DEF_CFG,...data};else C.data[c][id]=data;
  render();
  if(!C.db){lsSave();return}
  const path=c==='config'?'cm_config/geral':'cm_'+c+'/'+id;
  try{await queue(path,()=>C.db.doc(path).set(data))}catch(e){fail(e)}
}
async function del(c,id){
  delete C.data[c][id];render();
  if(!C.db){lsSave();return}
  try{await queue('cm_'+c+'/'+id,()=>C.db.doc('cm_'+c+'/'+id).delete())}catch(e){fail(e)}
}

/* ---------- helpers ---------- */
const rows=c=>Object.entries(C.data[c]).map(([id,r])=>({id,...r}));
const get=(c,id)=>id&&C.data[c][id]?{id,...C.data[c][id]}:null;
const nome=(c,id)=>{const r=get(c,id);return r?MODS[c].title(r):'—'};
function endereco(r){if(!r)return '';if(!r.logradouro)return r.endereco||'';
  return [[r.logradouro,r.numero].filter(Boolean).join(', ')+(r.complemento?' – '+r.complemento:''),r.bairro,[r.cidade,r.uf].filter(Boolean).join('/'),r.cep?'CEP '+r.cep:''].filter(Boolean).join(', ')}
function finStatus(r){if(r.status==='Pago')return 'Pago';return r.vencimento&&r.vencimento<TODAY?'Atrasado':'Pendente'}
const perReaj=c=>{const n=parseInt(c&&c.periodoReajuste,10);return isNaN(n)?12:n};
function proxReaj(c){if(c.status!=='Ativo'||!c.inicio)return null;const n=perReaj(c);if(!n)return null;return addMon(c.ultimoReajuste||c.inicio,n)}
const IDX={'IGP-M':'igpm','IPCA':'ipca','INPC':'inpc'};
const sugestao=c=>{const p=num(C.config[IDX[c.indice||'IGP-M']]);return {p,v:Math.round(num(c.aluguel)*(1+p/100)*100)/100}};
const BCLS={Locador:'info',Inquilino:'ok','Locatário':'ok','Disponível':'ok',Alugado:'info','Em manutenção':'warn',Ativo:'ok',Rescindido:'bad',Pago:'ok',Pendente:'warn',Atrasado:'bad','A pagar':'warn',Previsto:'',Aberto:'bad','Em andamento':'warn','Concluído':'ok','Média':'info',Alta:'warn',Urgente:'bad',Sim:'ok','Ótimo':'ok',Bom:'ok',Regular:'warn',Ruim:'bad','Entrega das chaves':'info','Recebimento das chaves':'warn'};
const B=t=>t?`<span class="badge ${BCLS[t]||''}">${esc(t)}</span>`:'—';
const bdg=(t,c)=>`<span class="badge ${c}">${esc(t)}</span>`;
const M$=k=>r=>`<span class="num">${fmt(num(r[k]))}</span>`;
function prazoBadge(d){if(d==null)return '';if(d<0)return bdg('atrasado há '+(-d)+' d','bad');if(d===0)return bdg('hoje','bad');if(d<=num(C.config.alertaDias||30))return bdg('em '+d+' d','warn');return ''}
const PRIO={Urgente:0,Alta:1,'Média':2,Baixa:3};
const maskDoc=v=>{const d=String(v||'').replace(/\D/g,'').slice(0,14);if(!d)return '';if(d.length<=11)return d.replace(/^(\d{3})(\d)/,'$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/,'$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/,'.$1-$2');return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/,(m,a,b,c,e,f)=>a+'.'+b+'.'+c+'/'+e+(f?'-'+f:''))};
const CONSULTAS_HTML=()=>`<div class="consbox"><b>Consultas rápidas</b> <span class="meta">(com autorização da pessoa)</span>
<div class="conslinks"><a class="btn sm" href="https://www.serasa.com.br/voceconsulta/" target="_blank" rel="noopener">Serasa · consultar CPF de terceiros</a>
<a class="btn sm" href="https://www.gov.br/pt-br/servicos/emitir-certidao-de-antecedentes-criminais" target="_blank" rel="noopener">Antecedentes criminais · Polícia Federal</a>
<a class="btn sm" href="https://servicos.receita.fazenda.gov.br/servicos/cpf/consultasituacao/consultapublica.asp" target="_blank" rel="noopener">Situação do CPF · Receita Federal</a></div>
<div class="meta">Abra a consulta, veja o resultado e registre aqui embaixo (situação, data e um print ou PDF do comprovante).</div></div>`;
const consBadges=r=>{const s=r.serasaStatus,a=r.antStatus,o=[];if(s&&s!=='Não consultado')o.push(bdg('Serasa: '+s,s==='Nome limpo'?'ok':'bad'));if(a&&a!=='Não consultado')o.push(bdg('Antecedentes: '+a,a==='Nada consta'?'ok':'bad'));return o.join(' ')};
const catsOf=r=>Array.isArray(r.categorias)&&r.categorias.length?r.categorias:(r.categoria?[r.categoria]:[]);
const compOf=r=>(r.data||'').slice(0,7);
const INTV={2:'bimestral',3:'trimestral',4:'quadrimestral',6:'semestral',12:'anual'};
function expandDesp(d,ate){
  if(!d.rec||d.rec==='unica'||!d.data)return [{...d,_src:'despesas',_id:d.id}];
  const k0=d.data.slice(0,7),dia=+d.data.slice(8,10)||1,out=[];
  const step=d.rec==='recorrente'?(num(d.intervalo)||12):1;
  const n=d.rec==='parcelada'?Math.max(1,num(d.parcelas)):9999;
  for(let i=0,k=k0;i<n&&k<=ate&&(!d.fim||k<=d.fim);i++,k=addComp(k,step)){
    const [y,m]=k.split('-').map(Number),last=new Date(y,m,0).getDate();
    out.push({...d,id:d.id+'@'+k,_src:'despesas',_id:d.id,_k:k,data:k+'-'+p2(Math.min(dia,last)),
      descricao:d.descricao+(d.rec==='parcelada'?` (${i+1}/${n})`:''),
      _rec:d.rec==='parcelada'?'parcelada':d.rec==='mensal'?'mensal':(INTV[step]||'a cada '+step+' meses'),
      status:(d.pagos||{})[k]?'Pago':'A pagar'})}
  return out;
}
const despRows=()=>{const ate=addComp(CUR,24);return rows('despesas').flatMap(d=>expandDesp(d,ate)).concat(MODS.despesas.extra())};
const doDono=d=>d.pagoPor!=='Inquilino';
const thumb=id=>id?`<img class="thumb" src="${blob(id)}" alt="" loading="lazy" data-zoom>`:`<span class="thumb ph">${ICON.home}</span>`;

const ICON={
  edit:'<svg class="i" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  pct:'<svg class="i" viewBox="0 0 24 24"><path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/></svg>',
  cash:'<svg class="i" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  minus:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus:'<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  doc:'<svg class="i" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  cam:'<svg class="i" viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  home:'<svg class="i" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M5 10v10h14V10"/></svg>',
  x:'<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play:'<svg class="i" viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
  check:'<svg class="i" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  print:'<svg class="i" viewBox="0 0 24 24"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/></svg>'
};

/* ---------- modules ---------- */
const UF=['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const OPT={
  tipoPessoa:['Locador','Locatário','Inquilino','Fiador'],
  estadoCivil:['Solteiro(a)','Casado(a)','União estável','Divorciado(a)','Separado(a)','Viúvo(a)'],
  tipoImovel:['Casa','Apartamento','Sala comercial','Loja','Galpão','Terreno'],
  statusImovel:['Disponível','Alugado','Em manutenção'],
  indice:['IGP-M','IPCA','INPC'],
  garantia:['Fiador','Caução','Seguro fiança','Título de capitalização','Sem garantia'],
  finalidade:['residenciais','comerciais'],
  statusContrato:['Ativo','Encerrado','Rescindido'],
  tipoVist:['Entrega das chaves','Recebimento das chaves','Periódica'],
  estado:['Ótimo','Bom','Regular','Ruim'],
  simnao:['Não','Sim'],
  statusFin:['Pendente','Pago'],
  catDesp:['IPTU','Condomínio','Seguro','Taxas e tarifas','Reforma','Comissão','Jurídico','Outros'],
  catManut:['Hidráulica','Elétrica','Pintura','Portas e janelas','Fechaduras','Telhado','Estrutural / alvenaria','Piso e revestimento','Marcenaria','Vidraçaria','Ar-condicionado','Gás','Limpeza','Jardinagem','Outros'],
  prioridade:['Baixa','Média','Alta','Urgente'],
  pagoPor:['Locador','Inquilino','Administradora'],
  statusManut:['Aberto','Em andamento','Concluído'],
  unidade:['un','m','m²','kg','L','caixa','saco','galão','rolo']
};
const ADDR=[{t:'sec',l:'Endereço completo'},{k:'cep',l:'CEP',t:'text',ph:'00000-000'},{k:'uf',l:'Estado (UF)',t:'sel',opt:UF},
  {k:'logradouro',l:'Rua / avenida',t:'text',full:1},{k:'numero',l:'Número',t:'text'},{k:'complemento',l:'Complemento',t:'text',ph:'Apto, bloco, sala…'},
  {k:'bairro',l:'Bairro',t:'text'},{k:'cidade',l:'Cidade',t:'text'}];
const pessoaCard=(t,p,need)=>{if(!p)return `<div class="pcard"><span class="lbl">${t}</span><div class="meta">Não selecionado</div></div>`;
  const falta=(need||[]).filter(([k])=>!(k==='endereco'?endereco(p):p[k])).map(x=>x[1]);
  return `<div class="pcard"><span class="lbl">${t}</span><b>${esc(p.nome)}</b><div class="meta">${esc([p.nacionalidade,p.estadoCivil,p.profissao].filter(Boolean).join(' · ')||'—')}</div>
  <div class="meta">CPF/CNPJ ${esc(p.doc||'—')}${p.rg?' · RG '+esc(p.rg):''}</div><div class="meta">${esc(endereco(p)||'Endereço não cadastrado')}</div>
  ${falta.length?`<div class="meta warnt">Falta: ${esc(falta.join(', '))}</div>`:''}</div>`};
const imovelCard=(i,t)=>i?`<div class="pcard im">${i.foto?`<img src="${blob(i.foto)}" alt="" data-zoom>`:''}<div><span class="lbl">${t||'Imóvel'}</span><b>${esc([i.tipo,i.codigo].filter(Boolean).join(' · '))}</b><div class="meta">${esc(endereco(i)||'Endereço não cadastrado')}</div><div class="meta">${esc(i.descricao||'Sem descrição')}</div></div></div>`:`<div class="pcard"><span class="lbl">${t||'Imóvel'}</span><div class="meta">Não selecionado</div></div>`;
const NEED=[['nacionalidade','nacionalidade'],['estadoCivil','estado civil'],['profissao','profissão'],['doc','CPF/CNPJ'],['endereco','endereço']];

const MODS={
pessoas:{nome:'Pessoas',sing:'pessoa',novo:'Nova pessoa',salvo:'Pessoa salva.',title:r=>r.nome||'Sem nome',
  defaults:()=>({tipo:'Locador',nacionalidade:'brasileiro(a)'}),sort:(a,b)=>(a.nome||'').localeCompare(b.nome||''),
  prep:v=>{if(v.rg&&!v.rgOrgao){const m=String(v.rg).match(/^\s*([\dxX.\-]+)\s*[-–/,]?\s*([A-Za-zÀ-ú]{2,}.*)$/);if(m){v.rg=m[1];v.rgOrgao=m[2].trim()}}if(v.doc)v.doc=maskDoc(v.doc);return v},
  fields:[{k:'nome',l:'Nome completo',t:'text',req:1,full:1,strong:1},{k:'tipo',l:'Tipo',t:'sel',opt:OPT.tipoPessoa,req:1},{k:'nacionalidade',l:'Nacionalidade',t:'text'},
    {k:'dataNasc',l:'Data de nascimento',t:'date'},{k:'nomeMae',l:'Nome da mãe',t:'text'},
    {t:'sec',l:'Documentos'},{k:'doc',l:'CPF / CNPJ',t:'text',ph:'000.000.000-00',mask:'doc',strong:1},{k:'rg',l:'RG (número)',t:'text',ph:'0.000.000',strong:1},
    {k:'rgOrgao',l:'Órgão emissor / UF',t:'text',ph:'SSP/RN',strong:1},{k:'rgExpedicao',l:'Data de expedição do RG',t:'date'},
    {t:'sec',l:'Contato e situação'},{k:'estadoCivil',l:'Estado civil',t:'sel',opt:OPT.estadoCivil},{k:'profissao',l:'Profissão',t:'text'},
    {k:'telefone',l:'Telefone',t:'text'},{k:'email',l:'E-mail',t:'text'},
    ...ADDR,{t:'sec',l:'Consultas: Serasa e antecedentes criminais'},{t:'html',html:()=>CONSULTAS_HTML()},
    {k:'consentimento',l:'Autorizou as consultas?',t:'sel',opt:['Não informado','Sim','Não']},{k:'serasaStatus',l:'Serasa / SPC',t:'sel',opt:['Não consultado','Nome limpo','Com restrições']},
    {k:'serasaData',l:'Data da consulta Serasa',t:'date'},{k:'serasaObs',l:'Resultado Serasa (score, pendências)',t:'text'},
    {k:'serasaArq',l:'Comprovante Serasa (print, foto ou PDF)',t:'photo',pdf:1},
    {k:'antStatus',l:'Antecedentes criminais',t:'sel',opt:['Não consultado','Nada consta','Consta registro']},{k:'antData',l:'Data da certidão',t:'date'},
    {k:'antOrgao',l:'Órgão da certidão',t:'text',ph:'Polícia Federal, TJ, SSP…'},
    {k:'antArq',l:'Certidão de antecedentes (print, foto ou PDF)',t:'photo',pdf:1},
    {t:'sec',l:'Documento de identidade (fotos)'},{k:'docFrente',l:'Foto da identidade — FRENTE',t:'photo'},{k:'docVerso',l:'Foto da identidade — VERSO',t:'photo'},{t:'sec',l:'Outros'},{k:'banco',l:'Dados para repasse (banco / PIX)',t:'text',full:1},{k:'obs',l:'Observações',t:'area',full:1}],
  cols:[['Nome',r=>`<b>${esc(r.nome)}</b><div class="meta">${esc([r.profissao,r.estadoCivil].filter(Boolean).join(' · '))}</div>`],['Tipo',r=>B(r.tipo)],
    ['Documento',r=>`<b>${esc(maskDoc(r.doc)||'—')}</b>`+(r.rg?`<div class="meta"><b>RG ${esc(r.rg)}${r.rgOrgao?' · '+esc(r.rgOrgao):''}</b>${r.rgExpedicao?' · exp. '+fd(r.rgExpedicao):''}</div>`:'')+(consBadges(r)?`<div class="cats">${consBadges(r)}</div>`:'')+(r.docFrente||r.docVerso?`<button class="btn sm" style="margin-top:4px" data-verdocs="${esc(r.id)}">${ICON.cam} fotos do RG</button>`:'')],['Contato',r=>esc(r.telefone||'—')+(r.email?`<div class="meta">${esc(r.email)}</div>`:'')],
    ['Endereço',r=>`<span class="meta">${esc(endereco(r)||'—')}</span>`]]},
imoveis:{nome:'Imóveis',sing:'imóvel',novo:'Novo imóvel',salvo:'Imóvel salvo.',title:r=>(r.codigo?r.codigo+' · ':'')+([r.logradouro,r.numero].filter(Boolean).join(', ')||r.endereco||'Sem endereço'),
  defaults:()=>({status:'Disponível',tipo:'Casa'}),sort:(a,b)=>(a.codigo||'').localeCompare(b.codigo||''),
  prep:v=>{if(!v.logradouro&&v.endereco)v.logradouro=v.endereco;return v},
  fields:[{k:'foto',l:'Foto do imóvel',t:'photo',full:1},{k:'codigo',l:'Código',t:'text',ph:'Ex.: IM-01'},{k:'tipo',l:'Tipo',t:'sel',opt:OPT.tipoImovel},
    ...ADDR.map(f=>f.k==='logradouro'?{...f,req:1}:f),
    {t:'sec',l:'Valores e situação'},{k:'aluguel',l:'Valor do aluguel (R$)',t:'money',req:1},{k:'status',l:'Situação',t:'sel',opt:OPT.statusImovel},
    {k:'condominio',l:'Condomínio (R$)',t:'money'},{k:'iptu',l:'IPTU mensal (R$)',t:'money'},
    {k:'locador',l:'Pessoa responsável (locador, locatário, inquilino ou fiador)',t:'ref',ref:'pessoas',groupBy:'tipo',full:1,hint:'Escolha qualquer pessoa cadastrada; as opções aparecem separadas por tipo. É usada para preencher o contrato automaticamente.'},
    {t:'sec',l:'Descrição'},{k:'quartos',l:'Quartos',t:'num'},{k:'banheiros',l:'Banheiros',t:'num'},{k:'vagas',l:'Vagas de garagem',t:'num'},{k:'area',l:'Área (m²)',t:'num'},
    {k:'descricao',l:'Descrição do imóvel',t:'area',full:1,ph:'Ex.: 2 quartos (1 suíte), sala, cozinha com armários, área de serviço, 1 vaga…',hint:'Vai para o contrato e para as vistorias.'},
    {k:'obs',l:'Observações internas',t:'area',full:1}],
  cols:[['Imóvel',r=>`<div class="withthumb">${thumb(r.foto)}<div><b>${esc(r.codigo||'')}</b> ${esc(r.tipo||'')}<div class="meta">${esc(endereco(r))}</div></div></div>`],
    ['Descrição',r=>`<span class="meta clamp">${esc(r.descricao||'—')}</span>`],['Locador',r=>esc(nome('pessoas',r.locador))],['Aluguel',M$('aluguel'),1],['Situação',r=>B(r.status)]]},
contratos:{nome:'Contratos',sing:'contrato',novo:'Novo contrato',salvo:'Contrato salvo.',title:r=>'Nº '+(r.numero||'s/n')+' · '+nome('imoveis',r.imovel),
  defaults:()=>({status:'Ativo',prazo:30,diaVenc:10,indice:'IGP-M',periodoReajuste:'12',garantia:'Fiador',finalidade:'residenciais',modelo:'0',inicio:TODAY}),
  sort:(a,b)=>(a.status==='Ativo'?0:1)-(b.status==='Ativo'?0:1)||String(a.numero||'').localeCompare(String(b.numero||'')),
  fields:[{t:'sec',l:'Quem e o quê'},{k:'imovel',l:'Imóvel',t:'ref',ref:'imoveis',req:1},{k:'inquilino',l:'Inquilino',t:'ref',ref:'pessoas',filter:p=>p.tipo==='Inquilino'||p.tipo==='Locatário',req:1},
    {k:'locador',l:'Locador',t:'ref',ref:'pessoas',filter:p=>p.tipo==='Locador',hint:'Vem do cadastro do imóvel.'},
    {k:'fiador',l:'Fiador',t:'ref',ref:'pessoas',filter:p=>p.tipo==='Fiador'},
    {t:'calc'},
    {t:'sec',l:'Condições'},{k:'numero',l:'Número do contrato',t:'text'},{k:'status',l:'Situação',t:'sel',opt:OPT.statusContrato},
    {k:'inicio',l:'Início',t:'date',req:1},{k:'prazo',l:'Prazo (meses)',t:'num'},
    {k:'fim',l:'Término',t:'date',hint:'Calculado pelo início e prazo.'},{k:'diaVenc',l:'Dia do vencimento',t:'num'},
    {k:'aluguel',l:'Aluguel (R$)',t:'money',req:1,hint:'Vem do valor do imóvel.'},{k:'indice',l:'Índice de reajuste',t:'sel',opt:OPT.indice},{k:'periodoReajuste',l:'Período do reajuste',t:'sel',opt:[['12','A cada 12 meses (anual)'],['6','A cada 6 meses'],['24','A cada 24 meses'],['30','A cada 30 meses'],['36','A cada 36 meses'],['0','Sem reajuste']],hint:'O próximo reajuste é contado a partir do início ou do último reajuste.'},
    {k:'garantia',l:'Garantia',t:'sel',opt:OPT.garantia},{k:'caucao',l:'Valor da caução (R$)',t:'money'},
    {k:'modelo',l:'Modelo de contrato',t:'sel',opt:()=>[0,1,2].map(i=>[String(i),'Modelo '+(i+1)+' · '+mdl(i).nome]),hint:'Escolha qual texto usar ao gerar o contrato.'},{k:'finalidade',l:'Finalidade',t:'sel',opt:OPT.finalidade},{k:'atividade',l:'Ramo de atividade (comercial)',t:'text',ph:'Ex.: loja de roupas'},{k:'ultimoReajuste',l:'Último reajuste',t:'date',hint:'Vazio = nunca reajustado.'},
    {k:'obs',l:'Observações e histórico de reajustes',t:'area',full:1}],
  onChange:(k,v,set)=>{
    if(k==='imovel'){const i=get('imoveis',v.imovel);if(i){if(i.locador)set('locador',i.locador);if(i.aluguel)set('aluguel',i.aluguel)}}
    if((k==='inicio'||k==='prazo')&&v.inicio&&num(v.prazo)>0)set('fim',addDays(addMon(v.inicio,num(v.prazo)),-1));
    if(k==='finalidade')set('modelo',v.finalidade==='comerciais'?'1':'0');
    if(k==='modelo'&&(v.modelo==='0'||v.modelo==='1'))set('finalidade',v.modelo==='1'?'comerciais':'residenciais');
  },
  calc:v=>`<div class="pcards">${imovelCard(get('imoveis',v.imovel))}${pessoaCard('Inquilino',get('pessoas',v.inquilino),NEED)}${pessoaCard('Locador',get('pessoas',v.locador),NEED)}${v.fiador?pessoaCard('Fiador',get('pessoas',v.fiador),NEED):''}</div><div class="meta">Esses dados vêm dos cadastros de Pessoas e Imóveis e entram no contrato. Para corrigir, edite o cadastro.</div>`,
  prep:v=>{if(v.modelo==null||v.modelo==='')v.modelo=String(mdlOf(v));if(v.periodoReajuste==null||v.periodoReajuste==='')v.periodoReajuste='12';return v},
  beforeSave:o=>{if(!o.fim&&o.inicio&&num(o.prazo)>0)o.fim=addDays(addMon(o.inicio,num(o.prazo)),-1);if(!o.locador){const i=get('imoveis',o.imovel);if(i&&i.locador)o.locador=i.locador}return o},
  afterSave:async o=>{const i=get('imoveis',o.imovel);if(i&&o.status==='Ativo'&&i.status!=='Alugado'){const {id,...raw}=i;await put('imoveis',id,{...raw,status:'Alugado'})}},
  cols:[['Contrato',r=>`<b>Nº ${esc(r.numero||'s/n')}</b><div class="meta">${esc(nome('imoveis',r.imovel))}</div>`],
    ['Inquilino',r=>esc(nome('pessoas',r.inquilino))+`<div class="meta">Locador: ${esc(nome('pessoas',r.locador))}</div>`],
    ['Aluguel',M$('aluguel'),1],
    ['Vigência',r=>`${fd(r.inicio)} a ${fd(r.fim)} ${r.status==='Ativo'&&r.fim&&days(r.fim)<=90?bdg(days(r.fim)<0?'vencido':'termina em '+days(r.fim)+' d',days(r.fim)<=30?'bad':'warn'):''}`],
    ['Próx. reajuste',r=>{const d=proxReaj(r);return d?`${fd(d)} ${prazoBadge(days(d))}`:'—'}],
    ['Situação',r=>B(r.status)+`<div class="meta">Modelo ${mdlOf(r)+1} · ${esc(mdl(mdlOf(r)).nome)}</div>`]],
  acts:r=>`<button class="icon-btn" data-docc="${esc(r.id)}" title="Gerar contrato preenchido" aria-label="Gerar contrato preenchido">${ICON.doc}</button>`+(r.status==='Ativo'?`<button class="icon-btn" data-reaj="${esc(r.id)}" title="Reajustar aluguel" aria-label="Reajustar aluguel">${ICON.pct}</button>`:'')},
vistorias:{nome:'Vistorias',sing:'vistoria',novo:'Nova vistoria',salvo:'Vistoria salva.',title:r=>(r.tipo||'Vistoria')+' · '+fd(r.data),
  defaults:()=>({data:TODAY,tipo:'Entrega das chaves',estado:'Bom',assLocador:'Não',assInquilino:'Não'}),sort:(a,b)=>(b.data||'').localeCompare(a.data||''),
  fields:[{k:'imovel',l:'Imóvel',t:'ref',ref:'imoveis',req:1},{k:'contrato',l:'Contrato (opcional)',t:'ref',ref:'contratos'},{t:'calc'},
    {k:'tipo',l:'Tipo da vistoria',t:'sel',opt:OPT.tipoVist,req:1,hint:'Entrega = início da locação · Recebimento = devolução do imóvel'},{k:'data',l:'Data',t:'date',req:1},
    {k:'responsavel',l:'Responsável',t:'text'},{k:'estado',l:'Estado geral',t:'sel',opt:OPT.estado},
    {k:'itens',l:'Itens vistoriados e observações',t:'area',full:1,ph:'Ex.: Sala — pintura boa; Cozinha — torneira pingando…'},
    {k:'midia',l:'Fotos e vídeos da vistoria',t:'media',full:1},
    {t:'sec',l:'Assinatura do locador'},{k:'assLocador',l:'Assinada pelo locador',t:'sel',opt:OPT.simnao},{k:'assLocadorNome',l:'Nome do locador (quem assinou)',t:'text'},
    {k:'assLocadorFoto',l:'Foto do locador ou da assinatura',t:'photo',full:1},
    {t:'sec',l:'Assinatura do inquilino'},{k:'assInquilino',l:'Assinada pelo inquilino',t:'sel',opt:OPT.simnao},{k:'assInquilinoNome',l:'Nome do inquilino (quem assinou)',t:'text'},
    {k:'assInquilinoFoto',l:'Foto do inquilino ou da assinatura',t:'photo',full:1}],
  prep:v=>{if(v.tipo==='Entrada')v.tipo='Entrega das chaves';if(v.tipo==='Saída')v.tipo='Recebimento das chaves';return v},
  onChange:(k,v,set)=>{if(k==='contrato'){const c=get('contratos',v.contrato);if(c){if(c.imovel)set('imovel',c.imovel);if(!v.assLocadorNome&&c.locador)set('assLocadorNome',nome('pessoas',c.locador));if(!v.assInquilinoNome&&c.inquilino)set('assInquilinoNome',nome('pessoas',c.inquilino))}}
    if(k==='imovel'&&!v.assLocadorNome){const i=get('imoveis',v.imovel);if(i&&i.locador)set('assLocadorNome',nome('pessoas',i.locador))}},
  calc:v=>imovelCard(get('imoveis',v.imovel),'Imóvel vistoriado'),
  cols:[['Data',r=>fd(r.data)],['Imóvel',r=>`<b>${esc(nome('imoveis',r.imovel))}</b><div class="meta">${esc(endereco(get('imoveis',r.imovel)))}</div>`],['Tipo',r=>B(MODS.vistorias.prep({...r}).tipo)],['Estado',r=>B(r.estado)],
    ['Arquivos',r=>{const m=Array.isArray(r.midia)?r.midia:[];return m.length?`<button class="btn sm" data-gal="${esc(r.id)}">${ICON.cam} ${m.length} ${m.length===1?'arquivo':'arquivos'}</button>`:'<span class="meta">—</span>'}],
    ['Assinaturas',r=>`${r.assLocador==='Sim'?bdg('Locador','ok'):bdg('Locador pendente','')} ${r.assInquilino==='Sim'?bdg('Inquilino','ok'):bdg('Inquilino pendente','')}${r.assLocadorNome||r.assInquilinoNome?`<div class="meta">${esc([r.assLocadorNome,r.assInquilinoNome].filter(Boolean).join(' · '))}</div>`:''}`]],
  acts:r=>`<button class="icon-btn" data-printv="${esc(r.id)}" title="Imprimir vistoria com fotos" aria-label="Imprimir vistoria">${ICON.print}</button>`},
financeiro:{nome:'Recebimentos',sing:'recebimento',novo:'Novo recebimento',salvo:'Recebimento salvo.',title:r=>fm(r.competencia)+' · '+nome('pessoas',r.inquilino),
  defaults:()=>({competencia:C.finMes||CUR,status:'Pendente'}),
  sort:(a,b)=>(b.competencia||'').localeCompare(a.competencia||'')||(a.vencimento||'').localeCompare(b.vencimento||''),
  fields:[{k:'contrato',l:'Contrato',t:'ref',ref:'contratos',req:1,full:1,hint:'Preenche imóvel, inquilino e valores.'},
    {k:'competencia',l:'Competência (mês)',t:'month',req:1},{k:'vencimento',l:'Vencimento',t:'date',req:1},
    {k:'aluguel',l:'Aluguel (R$)',t:'money'},{k:'condominio',l:'Condomínio (R$)',t:'money'},{k:'iptu',l:'IPTU (R$)',t:'money'},
    {k:'outros',l:'Outros valores (R$)',t:'money'},{k:'desconto',l:'Desconto (R$)',t:'money'},{k:'multa',l:'Multa e juros (R$)',t:'money'},
    {k:'status',l:'Situação',t:'sel',opt:OPT.statusFin},{k:'dataPagamento',l:'Data do pagamento',t:'date'},{t:'calc'},{k:'obs',l:'Observações',t:'text',full:1}],
  onChange:(k,v,set)=>{
    const c=get('contratos',v.contrato);
    if(k==='contrato'&&c){const i=get('imoveis',c.imovel)||{};set('aluguel',c.aluguel);if(i.condominio)set('condominio',i.condominio);if(i.iptu)set('iptu',i.iptu);if(v.competencia)set('vencimento',vencOf(v.competencia,c.diaVenc))}
    if(k==='competencia'&&v.competencia)set('vencimento',vencOf(v.competencia,c?c.diaVenc:10));
    if(k==='status'&&v.status==='Pago'&&!v.dataPagamento)set('dataPagamento',TODAY);
  },
  calc:v=>{const t=num(v.aluguel)+num(v.condominio)+num(v.iptu)+num(v.outros)-num(v.desconto)+num(v.multa),tx=num(v.aluguel)*num(C.config.taxaAdm)/100;
    return `<div class="calc"><span>Total a receber</span><span class="num">${fmt(t)}</span></div><div class="meta" style="margin-top:6px">Taxa de administração (${pct(C.config.taxaAdm)} do aluguel): <b class="num">${fmt(tx)}</b> · Repasse ao locador: <b class="num">${fmt(num(v.aluguel)-tx)}</b></div>`},
  beforeSave:o=>{const c=get('contratos',o.contrato);if(c){o.imovel=c.imovel;o.inquilino=c.inquilino;o.locador=c.locador}
    o.total=Math.round((num(o.aluguel)+num(o.condominio)+num(o.iptu)+num(o.outros)-num(o.desconto)+num(o.multa))*100)/100;
    o.taxaAdm=Math.round(num(o.aluguel)*num(C.config.taxaAdm))/100;o.repasse=Math.round((num(o.aluguel)-o.taxaAdm)*100)/100;
    if(o.status==='Pago'&&!o.dataPagamento)o.dataPagamento=TODAY;return o},
  filt:r=>(!C.finMes||r.competencia===C.finMes)&&(!C.finIm||r.imovel===C.finIm),
  cols:[['Competência',r=>`<b>${fm(r.competencia)}</b>`],['Imóvel',r=>`<b>${esc(nome('imoveis',r.imovel))}</b><div class="meta">${esc(nome('pessoas',r.inquilino))}</div>`],
    ['Vencimento',r=>fd(r.vencimento)],['Total',M$('total'),1],['Repasse',M$('repasse'),1],
    ['Situação',r=>{const s=finStatus(r);return B(s)+(s==='Atrasado'?` <span class="meta">${-days(r.vencimento)} d</span>`:s==='Pago'?` <span class="meta">${fd(r.dataPagamento)}</span>`:'')}]],
  acts:r=>r.status!=='Pago'?`<button class="icon-btn" data-pagar="${esc(r.id)}" title="Registrar recebimento" aria-label="Registrar recebimento">${ICON.cash}</button>`:'',
  tools:()=>filtros()+`<button class="btn" data-gerar>Gerar aluguéis do mês</button>`,
  foot:list=>{const t=sum(list,'total'),pg=sum(list.filter(r=>r.status==='Pago'),'total'),at=sum(list.filter(r=>finStatus(r)==='Atrasado'),'total');
    return `Total <b class="num">${fmt(t)}</b> · recebido <b class="num pos">${fmt(pg)}</b> · a receber <b class="num">${fmt(t-pg-at)}</b> · em atraso <b class="num neg">${fmt(at)}</b> · taxa de administração <b class="num">${fmt(sum(list,'taxaAdm'))}</b>`}},
despesas:{nome:'Despesas',sing:'despesa',novo:'Nova despesa',salvo:'Despesa salva.',title:r=>r.descricao||'Despesa',
  defaults:()=>({data:TODAY,status:'Pago',categoria:'Outros',pagoPor:'Locador',rec:'unica',imovel:C.finIm||undefined}),
  prep:v=>{if(!v.rec)v.rec='unica';return v},
  sort:(a,b)=>(b.data||'').localeCompare(a.data||''),
  fields:[{k:'imovel',l:'Imóvel',t:'ref',ref:'imoveis',req:1,full:1},{k:'descricao',l:'Descrição',t:'text',req:1,full:1},
    {k:'categoria',l:'Categoria',t:'sel',opt:OPT.catDesp},{k:'pagoPor',l:'Pago por',t:'sel',opt:OPT.pagoPor},
    {t:'sec',l:'Valor e repetição'},
    {k:'rec',l:'Repetição',t:'sel',opt:[['unica','Só uma vez'],['mensal','Mensal (todo mês)'],['recorrente','Recorrente (a cada X meses)'],['parcelada','Parcelada']],req:1},
    {k:'valor',l:'Valor (R$) · do mês ou da parcela',t:'money',req:1},
    {k:'data',l:'Data (1º vencimento)',t:'date',req:1},
    {k:'parcelas',l:'Nº de parcelas',t:'num',show:v=>v.rec==='parcelada'},
    {k:'intervalo',l:'Repete a cada',t:'sel',opt:[['2','2 meses (bimestral)'],['3','3 meses (trimestral)'],['4','4 meses'],['6','6 meses (semestral)'],['12','12 meses (anual)']],show:v=>v.rec==='recorrente'},
    {k:'fim',l:'Termina em (mês, opcional)',t:'month',show:v=>v.rec==='mensal'||v.rec==='recorrente'},
    {k:'status',l:'Situação',t:'sel',opt:['Pago','A pagar'],show:v=>!v.rec||v.rec==='unica',hint:'Nas despesas que se repetem, marque cada mês como paga na lista.'},
    {t:'calc'},{k:'obs',l:'Observações',t:'text',full:1}],
  calc:v=>{if(!v.rec||v.rec==='unica')return '';const n=num(v.parcelas),val=num(v.valor);
    return `<div class="calc"><span>${v.rec==='parcelada'?(n?`${n} parcelas de ${fmt(val)}`:'Informe o nº de parcelas'):v.rec==='mensal'?'Todo mês':'A cada '+(v.intervalo||'?')+' meses'}</span><span class="num">${v.rec==='parcelada'&&n?'total '+fmt(val*n):fmt(val)+' por vez'}</span></div><div class="meta" style="margin-top:6px">Aparece no Financeiro e na previsão em cada mês em que vence. Alterar aqui muda todos os meses dessa despesa.</div>`},
  beforeSave:o=>{if(o.rec==='unica'){delete o.parcelas;delete o.intervalo;delete o.fim}else{if(o.status==='Pago'&&o.data)o.pagos={...(o.pagos||{}),[o.data.slice(0,7)]:true};delete o.status;if(o.rec!=='parcelada')delete o.parcelas;if(o.rec!=='recorrente')delete o.intervalo;if(o.rec==='parcelada')delete o.fim}
    if(o.rec==='parcelada')o.parcelas=Math.max(2,Math.round(num(o.parcelas)||2));return o},
  rowsFn:()=>despRows().filter(r=>C.finMes||!r._k||r._k<=addComp(CUR,1)),
  extra:()=>rows('manutencao').filter(m=>num(m.custo)>0).map(m=>({id:'mn-'+m.id,_src:'manutencao',_id:m.id,imovel:m.imovel,descricao:m.descricao,categoria:'Manutenção',data:m.conclusao||m.abertura,valor:num(m.custo),pagoPor:m.pagoPor||'Locador',status:m.status==='Concluído'?'Pago':'A pagar'})),
  filt:r=>(!C.finMes||compOf(r)===C.finMes)&&(!C.finIm||r.imovel===C.finIm),
  cols:[['Data',r=>fd(r.data)],['Despesa',r=>`<b>${esc(r.descricao)}</b><div class="meta">${esc(nome('imoveis',r.imovel))}</div>`],
    ['Categoria',r=>(r._src==='manutencao'?bdg('Manutenção','info'):esc(r.categoria||'—'))+(r._rec?` ${bdg(r._rec,'')}`:'')],['Pago por',r=>esc(r.pagoPor||'—')],['Valor',M$('valor'),1],['Situação',r=>B(r.status)+(r.status!=='Pago'&&r.data&&r.data<TODAY?' '+bdg('vencida','bad'):'')]],
  acts:r=>r._k?`<button class="icon-btn" data-dpago="${esc(r._id)}|${esc(r._k)}" title="${r.status==='Pago'?'Marcar como a pagar':'Marcar como paga'}" aria-label="Marcar como paga">${ICON.check}</button>`:'',
  tools:()=>filtros(),
  foot:list=>{const d=list.filter(doDono);return `Despesas do proprietário <b class="num neg">${fmt(sum(d,'valor'))}</b> (pagas ${fmt(sum(d.filter(r=>r.status==='Pago'),'valor'))} · a pagar ${fmt(sum(d.filter(r=>r.status!=='Pago'),'valor'))}) · pagas pelo inquilino ${fmt(sum(list.filter(r=>!doDono(r)),'valor'))}. Custos de manutenção entram aqui automaticamente.${C.finMes?'':' Despesas que se repetem aparecem até o mês que vem; filtre por mês para ver as futuras.'}`}},
manutencao:{nome:'Manutenção',sing:'chamado',novo:'Abrir chamado',salvo:'Chamado salvo.',title:r=>r.descricao||'Chamado',
  defaults:()=>({abertura:TODAY,status:'Aberto',prioridade:'Média',pagoPor:'Locador',categorias:[]}),
  prep:v=>{if(!Array.isArray(v.categorias))v.categorias=v.categoria?[v.categoria]:[];return v},
  beforeSave:o=>{delete o.categoria;return o},
  sort:(a,b)=>(a.status==='Concluído'?1:0)-(b.status==='Concluído'?1:0)||(PRIO[a.prioridade]??9)-(PRIO[b.prioridade]??9)||(b.abertura||'').localeCompare(a.abertura||''),
  fields:[{k:'imovel',l:'Imóvel',t:'ref',ref:'imoveis',req:1,full:1},{k:'descricao',l:'O que precisa ser feito',t:'text',req:1,full:1},
    {k:'abertura',l:'Abertura do chamado',t:'date',req:1},{k:'prioridade',l:'Prioridade',t:'sel',opt:OPT.prioridade},
    {k:'categorias',l:'O que vai ser feito (marque um ou mais)',t:'multi',opt:OPT.catManut,full:1,req:1},{k:'responsavel',l:'Responsável / prestador',t:'text',full:1},
    {k:'custo',l:'Custo (R$)',t:'money',hint:'Vai para as despesas do imóvel no Financeiro.'},{k:'pagoPor',l:'Pago por',t:'sel',opt:OPT.pagoPor},
    {k:'status',l:'Situação',t:'sel',opt:OPT.statusManut},{k:'conclusao',l:'Concluído em',t:'date'},{k:'obs',l:'Observações',t:'area',full:1},
    {k:'midia',l:'Fotos e vídeos do chamado (problema, orçamento, serviço pronto)',t:'media',full:1}],
  onChange:(k,v,set)=>{if(k==='status'&&v.status==='Concluído'&&!v.conclusao)set('conclusao',TODAY)},
  cols:[['Abertura',r=>fd(r.abertura)],['Chamado',r=>`<b>${esc(r.descricao)}</b><div class="meta">${esc(nome('imoveis',r.imovel))}</div><div class="cats">${catsOf(r).map(c=>`<span class="badge info">${esc(c)}</span>`).join('')}</div>${Array.isArray(r.midia)&&r.midia.length?`<button class="btn sm" style="margin-top:4px" data-galm="${esc(r.id)}">${ICON.cam} ${r.midia.length} ${r.midia.length===1?'foto':'fotos'}</button>`:''}`],
    ['Prioridade',r=>B(r.prioridade)],['Custo',M$('custo'),1],['Pago por',r=>esc(r.pagoPor||'—')],['Situação',r=>B(r.status)+(r.conclusao?` <span class="meta">${fd(r.conclusao)}</span>`:'')]],
  filt:r=>(!C.mnCat||catsOf(r).includes(C.mnCat))&&(!C.mnSt||(C.mnSt==='abertos'?r.status!=='Concluído':r.status==='Concluído')),
  tools:()=>`<select id="mnCat" class="search" style="width:auto" aria-label="Filtrar por serviço"><option value="">Todos os serviços</option>${OPT.catManut.map(c=>`<option ${C.mnCat===c?'selected':''}>${esc(c)}</option>`).join('')}</select><select id="mnSt" class="search" style="width:auto" aria-label="Filtrar por situação"><option value="">Todas as situações</option><option value="abertos" ${C.mnSt==='abertos'?'selected':''}>Em aberto</option><option value="concluidos" ${C.mnSt==='concluidos'?'selected':''}>Concluídos</option></select>`},
estoque:{nome:'Estoque de materiais',sing:'item',novo:'Novo item',salvo:'Item salvo.',title:r=>r.item||'Item',
  defaults:()=>({unidade:'un',quantidade:0,minimo:0}),sort:(a,b)=>((num(a.quantidade)<=num(a.minimo))?0:1)-((num(b.quantidade)<=num(b.minimo))?0:1)||(a.item||'').localeCompare(b.item||''),
  fields:[{k:'item',l:'Material',t:'text',req:1,full:1},{k:'categoria',l:'Categoria',t:'text',ph:'Ex.: Elétrica'},{k:'unidade',l:'Unidade',t:'sel',opt:OPT.unidade},
    {k:'quantidade',l:'Quantidade em estoque',t:'num'},{k:'minimo',l:'Estoque mínimo',t:'num',hint:'Avisa no painel quando chegar nesse número.'},
    {k:'custoUnit',l:'Custo unitário (R$)',t:'money'},{k:'local',l:'Onde fica guardado',t:'text'},{k:'obs',l:'Observações',t:'area',full:1}],
  cols:[['Material',r=>`<b>${esc(r.item)}</b><div class="meta">${esc(r.categoria||'')}${r.local?' · '+esc(r.local):''}</div>`],
    ['Quantidade',r=>`<span class="num">${num(r.quantidade).toLocaleString('pt-BR')} ${esc(r.unidade||'')}</span> ${num(r.quantidade)<=num(r.minimo)?bdg('baixo','bad'):''}`],
    ['Mínimo',r=>`<span class="num">${num(r.minimo).toLocaleString('pt-BR')}</span>`],['Custo unit.',M$('custoUnit'),1],
    ['Valor em estoque',r=>`<span class="num">${fmt(num(r.quantidade)*num(r.custoUnit))}</span>`,1]],
  acts:r=>`<button class="icon-btn" data-dec="${esc(r.id)}" title="Retirar 1" aria-label="Retirar 1">${ICON.minus}</button><button class="icon-btn" data-inc="${esc(r.id)}" title="Adicionar 1" aria-label="Adicionar 1">${ICON.plus}</button>`}
};
MODS.precad={...MODS.pessoas,nome:'Pré-cadastros',sing:'pré-cadastro',novo:'Novo pré-cadastro',salvo:'Salvo no pré-cadastro.',
  fields:MODS.pessoas.fields.map(f=>f.k==='tipo'?{...f,l:'Classificação (quando for para Pessoas)'}:f),
  defaults:()=>({tipo:'Inquilino',recebidoEm:TODAY}),afterSave:async()=>{C.npResp=''}};
const NAV=[['painel','Painel'],['novapessoa','Nova pessoa (WhatsApp)'],['pessoas'],['imoveis'],['contratos'],['vistorias'],['financeiro','Financeiro'],['manutencao'],['estoque'],['relatorios','Planilhas'],['config','Configurações']];
function filtros(){
  const ims=rows('imoveis').sort(MODS.imoveis.sort);
  return `<input type="month" id="finMes" class="search" style="width:auto" value="${esc(C.finMes)}" aria-label="Filtrar por mês" title="Filtrar por mês">
  <select id="finIm" class="search" style="width:auto;max-width:220px" aria-label="Filtrar por imóvel"><option value="">Todos os imóveis</option>${ims.map(i=>`<option value="${esc(i.id)}" ${C.finIm===i.id?'selected':''}>${esc(MODS.imoveis.title(i))}</option>`).join('')}</select>`;
}

/* ---------- contrato modelo ---------- */
const MODELO=`CONTRATO DE LOCAÇÃO DE IMÓVEL Nº {{contrato.numero}}

LOCADOR(A): {{locador.nome}}, {{locador.nacionalidade}}, {{locador.estadoCivil}}, {{locador.profissao}}, portador(a) do RG nº {{locador.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{locador.doc}}, residente e domiciliado(a) em {{locador.endereco}}.

LOCATÁRIO(A): {{inquilino.nome}}, {{inquilino.nacionalidade}}, {{inquilino.estadoCivil}}, {{inquilino.profissao}}, portador(a) do RG nº {{inquilino.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{inquilino.doc}}, residente e domiciliado(a) em {{inquilino.endereco}}.
{{#fiador}}
FIADOR(A): {{fiador.nome}}, {{fiador.nacionalidade}}, {{fiador.estadoCivil}}, {{fiador.profissao}}, portador(a) do RG nº {{fiador.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{fiador.doc}}, residente e domiciliado(a) em {{fiador.endereco}}.
{{/fiador}}
Pelo presente instrumento, e na melhor forma de direito, as partes contratantes acima qualificadas e designadas têm, entre si, justo e acertado o presente Contrato de Locação de bem imóvel residencial, que se regerá pelas cláusulas seguintes, estabelecidas em comum acordo, e pela Lei nº 8.245/1991 (Lei do Inquilinato).

CLÁUSULA 1ª – DO OBJETO
O objeto deste contrato é a locação do imóvel ({{imovel.tipo}}) situado em {{imovel.endereco}}, assim descrito: {{imovel.descricao}}.

CLÁUSULA 2ª – DO PRAZO
A locação terá prazo de {{contrato.prazo}} meses, com início em {{contrato.inicio}} e término em {{contrato.fim}}, data em que o(a) LOCATÁRIO(A) se obriga a restituir o imóvel livre e desocupado, nas condições em que o recebeu, salvo renovação por escrito.

CLÁUSULA 3ª – DO ALUGUEL E DO PAGAMENTO
O aluguel mensal é de {{contrato.aluguel}} ({{contrato.aluguelExtenso}}), a ser pago até o dia {{contrato.diaVenc}} de cada mês, em local ou conta indicados pelo(a) LOCADOR(A).
Parágrafo único. O atraso no pagamento implicará multa de {{config.multa}} sobre o valor devido, acrescida de juros de mora de {{config.jurosMes}} ao mês e correção monetária.

CLÁUSULA 4ª – DO REAJUSTE
O aluguel será reajustado a cada período de {{contrato.periodoReajusteExtenso}}, com base na variação acumulada do índice {{contrato.indice}}, ou de outro que legalmente o substitua.

CLÁUSULA 5ª – DOS ENCARGOS E DESPESAS
Todas as despesas diretamente ligadas à conservação e ao uso do imóvel, tais como água e esgoto (CAERN), energia elétrica (COSERN), IPTU, gás, telefone, taxas ordinárias de condomínio e outras ligadas ao imóvel, bem como as multas decorrentes do não pagamento ou do atraso dessas quantias e os tributos e despesas feitos em órgãos públicos relativos ao imóvel durante a locação, ficarão sob a responsabilidade do(a) LOCATÁRIO(A).
Parágrafo primeiro. O(A) LOCATÁRIO(A) deverá efetuar, logo após o recebimento das chaves, a troca de titularidade junto à Companhia Energética do Rio Grande do Norte (COSERN) e à Companhia de Águas e Esgotos do Rio Grande do Norte (CAERN) para o seu nome, ficando responsável pelo pagamento das contas de consumo desses serviços.
Parágrafo segundo. O(A) LOCATÁRIO(A) deverá guardar os respectivos comprovantes de pagamento e apresentá-los ao(à) LOCADOR(A) sempre que solicitados.

CLÁUSULA 6ª – DO ATRASO NO PAGAMENTO
Em caso de atraso no pagamento do aluguel ou dos encargos por período superior a 30 (trinta) dias, o(a) LOCATÁRIO(A) será notificado(a) pelos meios legais e o contrato poderá ser rescindido por infração, com a propositura da ação de despejo por falta de pagamento (arts. 9º, III, e 62 da Lei nº 8.245/1991), sem prejuízo da cobrança dos valores devidos e sem direito a qualquer indenização por parte do(a) LOCADOR(A).
Parágrafo único. Não configurarão novação ou alteração das cláusulas deste instrumento os atos de mera tolerância do(a) LOCADOR(A) quanto ao atraso no pagamento do aluguel ou de quaisquer tributos e despesas.

CLÁUSULA 7ª – DA GARANTIA
Em garantia das obrigações deste contrato, fica estabelecida a modalidade: {{contrato.garantia}}.{{#caucao}} O valor da caução é de {{contrato.caucao}} ({{contrato.caucaoExtenso}}), a ser devolvido ao final da locação, descontados eventuais débitos.{{/caucao}}{{#fiador}} O(A) FIADOR(A) acima qualificado(a) responde solidariamente por todas as obrigações deste contrato até a efetiva entrega das chaves, renunciando ao benefício de ordem previsto no art. 827 do Código Civil.{{/fiador}}

CLÁUSULA 8ª – DA MANUTENÇÃO E DOS REPAROS
Quanto a qualquer situação de reforma, manutenção ou eventual problema que venha a ocorrer no imóvel, o(a) LOCATÁRIO(A) comunicará o fato ao(à) LOCADOR(A) e solicitará uma visita presencial ao imóvel, em data e hora previamente acordadas, para que o(a) LOCADOR(A) tome conhecimento e verifique a situação antes de qualquer providência.
Parágrafo único. Os reparos de danos causados pelo(a) LOCATÁRIO(A), seus familiares, dependentes, prepostos ou visitantes, e os pequenos reparos decorrentes do uso, ficam a cargo do(a) LOCATÁRIO(A); os reparos de defeitos estruturais ou anteriores à locação, que não tenham sido causados pelo(a) LOCATÁRIO(A), ficam a cargo do(a) LOCADOR(A), nos termos dos arts. 22 e 23 da Lei nº 8.245/1991.

CLÁUSULA 9ª – DO DIREITO DE PREFERÊNCIA E DAS VISTORIAS ESPORÁDICAS
O(A) LOCATÁRIO(A) permitirá ao(à) LOCADOR(A), ou a seus representantes, realizar vistorias no imóvel em dia e hora previamente combinados, podendo verificar o funcionamento de todas as instalações, acessórios e equipamentos de segurança. Constatado algum dano causado pelo uso inadequado ou pela falta de conservação que possa afetar a estrutura física do imóvel, o(a) LOCATÁRIO(A) deverá realizar o conserto no prazo de até 30 (trinta) dias. Não ocorrendo o conserto, o(a) LOCADOR(A) poderá rescindir o contrato por infração contratual, sem prejuízo do recebimento dos aluguéis e encargos devidos.
Parágrafo primeiro. Em caso de venda, promessa de venda, cessão de direitos ou dação em pagamento do imóvel, o(a) LOCADOR(A) deverá notificar o(a) LOCATÁRIO(A) para que exerça seu direito de preferência na aquisição, em igualdade de condições com terceiros (arts. 27 a 34 da Lei nº 8.245/1991). Para exercer a preferência, o(a) LOCATÁRIO(A) deverá responder à notificação, de maneira inequívoca, no prazo de 30 (trinta) dias.
Parágrafo segundo. Não havendo interesse na aquisição, o(a) LOCATÁRIO(A) deverá permitir que os interessados na compra visitem o imóvel em dias e horários combinados entre LOCATÁRIO(A) e LOCADOR(A).

CLÁUSULA 10ª – DAS BENFEITORIAS
Nenhuma obra ou modificação poderá ser feita no imóvel sem autorização prévia e por escrito do(a) LOCADOR(A). As benfeitorias realizadas incorporam-se ao imóvel, sem direito a indenização ou retenção, salvo ajuste escrito.

CLÁUSULA 11ª – DA CESSÃO E SUBLOCAÇÃO
É vedado ao(à) LOCATÁRIO(A) ceder, sublocar ou emprestar o imóvel, no todo ou em parte, sem consentimento prévio e escrito do(a) LOCADOR(A).

CLÁUSULA 12ª – DA DESTINAÇÃO
O imóvel destina-se exclusivamente a fins {{contrato.finalidade}}, não podendo ter sua destinação alterada sem autorização por escrito do(a) LOCADOR(A).

CLÁUSULA 13ª – DA VISTORIA E DA DEVOLUÇÃO DO IMÓVEL FINDO O PRAZO DA LOCAÇÃO
O(A) LOCATÁRIO(A) declara receber o imóvel nas condições descritas no laudo de vistoria de entrega das chaves e obriga-se a conservá-lo e a restituí-lo, ao final da locação, nas mesmas condições em que o recebeu: pintado com tinta na cor original da data da entrega, com as instalações elétricas, hidráulicas e acessórios em perfeitas condições de funcionamento, ressalvadas as deteriorações decorrentes do uso normal e habitual do imóvel.
Parágrafo primeiro. Os laudos de vistoria inicial (entrega das chaves) e final (recebimento das chaves) fazem parte deste contrato e conterão a assinatura dos contratantes e de 2 (duas) testemunhas.
Parágrafo segundo. Caso o imóvel não seja devolvido nessas condições e o(a) LOCADOR(A), por esse motivo, não o receba, o(a) LOCATÁRIO(A) continuará obrigado(a) a pagar os aluguéis e encargos que forem vencendo até a regularização do imóvel e a quitação de todos os débitos a ele referentes.

CLÁUSULA 14ª – DA RESCISÃO E DA MULTA
Ocorrerá a rescisão do presente contrato, independentemente de indenização por parte do(a) LOCADOR(A), nas seguintes hipóteses: descumprimento de quaisquer das cláusulas e condições deste contrato; perturbação do sossego, da ordem ou emissão de ruído excessivo; inadimplência do(a) LOCATÁRIO(A); ou abandono do imóvel, a qualquer época.
Parágrafo primeiro. A infração de qualquer cláusula deste contrato sujeitará a parte infratora à multa equivalente a 3 (três) aluguéis vigentes à época da infração. Caso o(a) LOCATÁRIO(A) devolva o imóvel antes do término do prazo, pagará a multa proporcionalmente ao período restante, nos termos do art. 4º da Lei nº 8.245/1991.
Parágrafo segundo. Constatado o abandono do imóvel, na presença de 2 (duas) testemunhas, o(a) LOCADOR(A) ou seu procurador poderá retomar a posse na forma da lei (art. 66 da Lei nº 8.245/1991), correndo por conta do(a) LOCATÁRIO(A) todas as despesas decorrentes, inclusive a remoção e a taxa de armazenamento dos móveis e objetos deixados no imóvel.

CLÁUSULA 15ª – DO FORO
Fica eleito o foro da comarca de {{imovel.cidade}} para dirimir quaisquer questões oriundas deste contrato.

E, por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.

{{imovel.cidade}}, {{hoje}}.

_______________________________________
LOCADOR(A)

_______________________________________
LOCATÁRIO(A)
{{#fiador}}

_______________________________________
FIADOR(A)
{{/fiador}}

_______________________________________
TESTEMUNHA 1
Nome: ______________________________
CPF: ____________________

_______________________________________
TESTEMUNHA 2
Nome: ______________________________
CPF: ____________________`;
const MODELO_COM=`CONTRATO DE LOCAÇÃO DE IMÓVEL COMERCIAL Nº {{contrato.numero}}

LOCADOR(A): {{locador.nome}}, {{locador.nacionalidade}}, {{locador.estadoCivil}}, {{locador.profissao}}, portador(a) do RG nº {{locador.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{locador.doc}}, com endereço em {{locador.endereco}}.

LOCATÁRIO(A): {{inquilino.nome}}, inscrito(a) no CPF/CNPJ sob o nº {{inquilino.doc}}, com endereço em {{inquilino.endereco}}, neste ato representado(a) por quem de direito.
{{#fiador}}
FIADOR(A): {{fiador.nome}}, {{fiador.nacionalidade}}, {{fiador.estadoCivil}}, {{fiador.profissao}}, portador(a) do RG nº {{fiador.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{fiador.doc}}, residente e domiciliado(a) em {{fiador.endereco}}.
{{/fiador}}
Pelo presente instrumento, e na melhor forma de direito, as partes contratantes acima qualificadas e designadas têm, entre si, justo e acertado o presente Contrato de Locação de bem imóvel comercial (locação não residencial), que se regerá pelas cláusulas seguintes, estabelecidas em comum acordo, e pela Lei nº 8.245/1991 (Lei do Inquilinato).

CLÁUSULA 1ª – DO OBJETO
O objeto deste contrato é a locação do imóvel ({{imovel.tipo}}) situado em {{imovel.endereco}}, assim descrito: {{imovel.descricao}}.

CLÁUSULA 2ª – DA DESTINAÇÃO
O imóvel destina-se exclusivamente ao exercício da atividade de {{contrato.atividade}}, sendo vedada a alteração da destinação sem autorização prévia e por escrito do(a) LOCADOR(A).

CLÁUSULA 3ª – DO PRAZO
A locação terá prazo de {{contrato.prazo}} meses, com início em {{contrato.inicio}} e término em {{contrato.fim}}, quando o imóvel deverá ser restituído livre e desocupado, ressalvado o direito à renovação nos termos dos arts. 51 e seguintes da Lei nº 8.245/1991, quando cabível.

CLÁUSULA 4ª – DO ALUGUEL E DO PAGAMENTO
O aluguel mensal é de {{contrato.aluguel}} ({{contrato.aluguelExtenso}}), a ser pago até o dia {{contrato.diaVenc}} de cada mês, em local ou conta indicados pelo(a) LOCADOR(A).
Parágrafo único. O atraso no pagamento implicará multa de {{config.multa}} sobre o valor devido, acrescida de juros de mora de {{config.jurosMes}} ao mês e correção monetária.

CLÁUSULA 5ª – DO REAJUSTE
O aluguel será reajustado a cada período de {{contrato.periodoReajusteExtenso}}, com base na variação acumulada do índice {{contrato.indice}}, ou de outro que legalmente o substitua.

CLÁUSULA 6ª – DOS ENCARGOS, TRIBUTOS E DESPESAS
Todas as despesas diretamente ligadas à conservação e ao uso do imóvel, tais como água e esgoto (CAERN), energia elétrica (COSERN), IPTU, gás, telefone, taxas ordinárias de condomínio, tributos e tarifas incidentes sobre a atividade exercida no imóvel e outras ligadas ao imóvel, bem como as multas decorrentes do não pagamento ou do atraso dessas quantias e os tributos e despesas feitos em órgãos públicos relativos ao imóvel durante a locação, ficarão sob a responsabilidade do(a) LOCATÁRIO(A).
Parágrafo primeiro. O(A) LOCATÁRIO(A) deverá efetuar, logo após o recebimento das chaves, a troca de titularidade junto à Companhia Energética do Rio Grande do Norte (COSERN) e à Companhia de Águas e Esgotos do Rio Grande do Norte (CAERN) para o seu nome, ficando responsável pelo pagamento das contas de consumo desses serviços.
Parágrafo segundo. O(A) LOCATÁRIO(A) deverá guardar os respectivos comprovantes de pagamento e apresentá-los ao(à) LOCADOR(A) sempre que solicitados.

CLÁUSULA 7ª – DO ATRASO NO PAGAMENTO
Em caso de atraso no pagamento do aluguel ou dos encargos por período superior a 30 (trinta) dias, o(a) LOCATÁRIO(A) será notificado(a) pelos meios legais e o contrato poderá ser rescindido por infração, com a propositura da ação de despejo por falta de pagamento (arts. 9º, III, e 62 da Lei nº 8.245/1991), sem prejuízo da cobrança dos valores devidos e sem direito a qualquer indenização por parte do(a) LOCADOR(A).
Parágrafo único. Não configurarão novação ou alteração das cláusulas deste instrumento os atos de mera tolerância do(a) LOCADOR(A) quanto ao atraso no pagamento do aluguel ou de quaisquer tributos e despesas.

CLÁUSULA 8ª – DAS LICENÇAS E ALVARÁS
Compete exclusivamente ao(à) LOCATÁRIO(A) obter e manter em dia os alvarás, licenças e autorizações necessárias ao funcionamento de sua atividade, respondendo por multas e sanções decorrentes de sua falta.

CLÁUSULA 9ª – DA GARANTIA
Em garantia das obrigações deste contrato, fica estabelecida a modalidade: {{contrato.garantia}}.{{#caucao}} O valor da caução é de {{contrato.caucao}} ({{contrato.caucaoExtenso}}), a ser devolvido ao final da locação, descontados eventuais débitos.{{/caucao}}{{#fiador}} O(A) FIADOR(A) acima qualificado(a) responde solidariamente por todas as obrigações deste contrato até a efetiva entrega das chaves, renunciando ao benefício de ordem previsto no art. 827 do Código Civil.{{/fiador}}

CLÁUSULA 10ª – DAS OBRAS, BENFEITORIAS E FACHADA
Nenhuma obra, adaptação, instalação de letreiro, placa ou alteração de fachada poderá ser feita sem autorização prévia e por escrito do(a) LOCADOR(A). As benfeitorias incorporam-se ao imóvel, sem direito a indenização ou retenção, salvo ajuste escrito.

CLÁUSULA 11ª – DO SEGURO
O(A) LOCATÁRIO(A) obriga-se a contratar e manter, durante toda a locação, seguro contra incêndio do imóvel, tendo o(a) LOCADOR(A) como beneficiário(a).

CLÁUSULA 12ª – DA MANUTENÇÃO E DOS REPAROS
Quanto a qualquer situação de reforma, manutenção ou eventual problema que venha a ocorrer no imóvel, o(a) LOCATÁRIO(A) comunicará o fato ao(à) LOCADOR(A) e solicitará uma visita presencial ao imóvel, em data e hora previamente acordadas, para que o(a) LOCADOR(A) tome conhecimento e verifique a situação antes de qualquer providência.
Parágrafo único. Os reparos de danos causados pelo(a) LOCATÁRIO(A), seus familiares, dependentes, prepostos ou visitantes, e os pequenos reparos decorrentes do uso, ficam a cargo do(a) LOCATÁRIO(A); os reparos de defeitos estruturais ou anteriores à locação, que não tenham sido causados pelo(a) LOCATÁRIO(A), ficam a cargo do(a) LOCADOR(A), nos termos dos arts. 22 e 23 da Lei nº 8.245/1991.

CLÁUSULA 13ª – DO DIREITO DE PREFERÊNCIA E DAS VISTORIAS ESPORÁDICAS
O(A) LOCATÁRIO(A) permitirá ao(à) LOCADOR(A), ou a seus representantes, realizar vistorias no imóvel em dia e hora previamente combinados, podendo verificar o funcionamento de todas as instalações, acessórios e equipamentos de segurança. Constatado algum dano causado pelo uso inadequado ou pela falta de conservação que possa afetar a estrutura física do imóvel, o(a) LOCATÁRIO(A) deverá realizar o conserto no prazo de até 30 (trinta) dias. Não ocorrendo o conserto, o(a) LOCADOR(A) poderá rescindir o contrato por infração contratual, sem prejuízo do recebimento dos aluguéis e encargos devidos.
Parágrafo primeiro. Em caso de venda, promessa de venda, cessão de direitos ou dação em pagamento do imóvel, o(a) LOCADOR(A) deverá notificar o(a) LOCATÁRIO(A) para que exerça seu direito de preferência na aquisição, em igualdade de condições com terceiros (arts. 27 a 34 da Lei nº 8.245/1991). Para exercer a preferência, o(a) LOCATÁRIO(A) deverá responder à notificação, de maneira inequívoca, no prazo de 30 (trinta) dias.
Parágrafo segundo. Não havendo interesse na aquisição, o(a) LOCATÁRIO(A) deverá permitir que os interessados na compra visitem o imóvel em dias e horários combinados entre LOCATÁRIO(A) e LOCADOR(A).

CLÁUSULA 14ª – DA CESSÃO E SUBLOCAÇÃO
É vedado ao(à) LOCATÁRIO(A) ceder, sublocar ou transferir a locação, no todo ou em parte, inclusive por alteração do controle societário, sem consentimento prévio e escrito do(a) LOCADOR(A).

CLÁUSULA 15ª – DA VISTORIA E DA DEVOLUÇÃO DO IMÓVEL FINDO O PRAZO DA LOCAÇÃO
O(A) LOCATÁRIO(A) declara receber o imóvel nas condições descritas no laudo de vistoria de entrega das chaves e obriga-se a conservá-lo e a restituí-lo, ao final da locação, nas mesmas condições em que o recebeu: pintado com tinta na cor original da data da entrega, com as instalações elétricas, hidráulicas e acessórios em perfeitas condições de funcionamento, ressalvadas as deteriorações decorrentes do uso normal e habitual do imóvel.
Parágrafo primeiro. Os laudos de vistoria inicial (entrega das chaves) e final (recebimento das chaves) fazem parte deste contrato e conterão a assinatura dos contratantes e de 2 (duas) testemunhas.
Parágrafo segundo. Caso o imóvel não seja devolvido nessas condições e o(a) LOCADOR(A), por esse motivo, não o receba, o(a) LOCATÁRIO(A) continuará obrigado(a) a pagar os aluguéis e encargos que forem vencendo até a regularização do imóvel e a quitação de todos os débitos a ele referentes.

CLÁUSULA 16ª – DA RESCISÃO E DA MULTA
Ocorrerá a rescisão do presente contrato, independentemente de indenização por parte do(a) LOCADOR(A), nas seguintes hipóteses: descumprimento de quaisquer das cláusulas e condições deste contrato; perturbação do sossego, da ordem ou emissão de ruído excessivo; inadimplência do(a) LOCATÁRIO(A); ou abandono do imóvel, a qualquer época.
Parágrafo primeiro. A infração de qualquer cláusula deste contrato sujeitará a parte infratora à multa equivalente a 3 (três) aluguéis vigentes à época da infração. A devolução antecipada do imóvel sujeitará o(a) LOCATÁRIO(A) ao pagamento da multa proporcional ao período restante (art. 4º da Lei nº 8.245/1991).
Parágrafo segundo. Constatado o abandono do imóvel, na presença de 2 (duas) testemunhas, o(a) LOCADOR(A) ou seu procurador poderá retomar a posse na forma da lei (art. 66 da Lei nº 8.245/1991), correndo por conta do(a) LOCATÁRIO(A) todas as despesas decorrentes, inclusive a remoção e a taxa de armazenamento dos móveis e objetos deixados no imóvel.

CLÁUSULA 17ª – DO FORO
Fica eleito o foro da comarca de {{imovel.cidade}} para dirimir quaisquer questões oriundas deste contrato.

E, por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.

{{imovel.cidade}}, {{hoje}}.

_______________________________________
LOCADOR(A)

_______________________________________
LOCATÁRIO(A)
{{#fiador}}

_______________________________________
FIADOR(A)
{{/fiador}}

_______________________________________
TESTEMUNHA 1
Nome: ______________________________
CPF: ____________________

_______________________________________
TESTEMUNHA 2
Nome: ______________________________
CPF: ____________________`;
const MODELO_TEMP=`CONTRATO DE LOCAÇÃO POR TEMPORADA Nº {{contrato.numero}}

LOCADOR(A): {{locador.nome}}, {{locador.nacionalidade}}, {{locador.estadoCivil}}, {{locador.profissao}}, portador(a) do RG nº {{locador.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{locador.doc}}, residente e domiciliado(a) em {{locador.endereco}}.

LOCATÁRIO(A): {{inquilino.nome}}, {{inquilino.nacionalidade}}, {{inquilino.estadoCivil}}, {{inquilino.profissao}}, portador(a) do RG nº {{inquilino.rg}}, inscrito(a) no CPF/CNPJ sob o nº {{inquilino.doc}}, residente e domiciliado(a) em {{inquilino.endereco}}.

Pelo presente instrumento, e na melhor forma de direito, as partes contratantes acima qualificadas e designadas têm, entre si, justo e acertado o presente Contrato de Locação de bem imóvel por temporada, que se regerá pelas cláusulas seguintes, estabelecidas em comum acordo, e pela Lei nº 8.245/1991, especialmente os arts. 48 a 50.

CLÁUSULA 1ª – DO OBJETO
O objeto deste contrato é a locação, para fins de temporada, do imóvel ({{imovel.tipo}}) situado em {{imovel.endereco}}, assim descrito, inclusive quanto aos móveis e utensílios que o guarnecem: {{imovel.descricao}}.

CLÁUSULA 2ª – DO PRAZO
A locação terá início em {{contrato.inicio}} e término em {{contrato.fim}}, não podendo exceder 90 (noventa) dias, devendo o imóvel ser desocupado ao final do prazo, independentemente de notificação.

CLÁUSULA 3ª – DO VALOR E DO PAGAMENTO
O valor da locação é de {{contrato.aluguel}} ({{contrato.aluguelExtenso}}), que poderá ser pago antecipadamente, de uma só vez, conforme autoriza o art. 49 da Lei nº 8.245/1991.

CLÁUSULA 4ª – DA UTILIZAÇÃO
O imóvel destina-se exclusivamente à residência temporária do(a) LOCATÁRIO(A) e de seus acompanhantes, sendo vedada a sublocação ou cessão a terceiros, bem como a realização de eventos sem autorização do(a) LOCADOR(A).

CLÁUSULA 5ª – DOS ENCARGOS E DESPESAS
Salvo se incluídas no valor da temporada, conforme ajuste entre as partes, as despesas de consumo ligadas ao uso do imóvel durante a estada, tais como água e esgoto (CAERN), energia elétrica (COSERN), gás e telefone, bem como as multas decorrentes do não pagamento ou do atraso dessas quantias, ficarão sob a responsabilidade do(a) LOCATÁRIO(A), que deverá guardar os respectivos comprovantes de pagamento e apresentá-los ao(à) LOCADOR(A) quando solicitados.
Parágrafo único. Pela curta duração da locação, fica dispensada a troca de titularidade das contas junto à COSERN e à CAERN, permanecendo o(a) LOCATÁRIO(A) responsável pelo consumo do período.

CLÁUSULA 6ª – DO ATRASO NO PAGAMENTO
O não pagamento do valor da locação, ou de qualquer parcela dele, na data combinada autoriza o(a) LOCADOR(A) a notificar o(a) LOCATÁRIO(A) pelos meios legais e a considerar rescindido o contrato, com a desocupação do imóvel na forma da lei, sem prejuízo da cobrança dos valores devidos e sem direito a qualquer indenização por parte do(a) LOCADOR(A).
Parágrafo único. Não configurarão novação ou alteração das cláusulas deste instrumento os atos de mera tolerância do(a) LOCADOR(A) quanto ao atraso no pagamento do aluguel ou de quaisquer tributos e despesas.

CLÁUSULA 7ª – DA GARANTIA
Fica estabelecida a garantia na modalidade: {{contrato.garantia}}.{{#caucao}} O valor da caução é de {{contrato.caucao}} ({{contrato.caucaoExtenso}}), a ser devolvido após a vistoria de recebimento das chaves, descontados eventuais danos.{{/caucao}}

CLÁUSULA 8ª – DA MANUTENÇÃO E DOS REPAROS
Quanto a qualquer situação de reforma, manutenção ou eventual problema que venha a ocorrer no imóvel, o(a) LOCATÁRIO(A) comunicará o fato ao(à) LOCADOR(A) e solicitará uma visita presencial ao imóvel, em data e hora previamente acordadas, para que o(a) LOCADOR(A) tome conhecimento e verifique a situação antes de qualquer providência.
Parágrafo único. Os reparos de danos causados pelo(a) LOCATÁRIO(A), seus familiares, dependentes, prepostos ou visitantes, e os pequenos reparos decorrentes do uso, ficam a cargo do(a) LOCATÁRIO(A); os reparos de defeitos estruturais ou anteriores à locação, que não tenham sido causados pelo(a) LOCATÁRIO(A), ficam a cargo do(a) LOCADOR(A), nos termos dos arts. 22 e 23 da Lei nº 8.245/1991.

CLÁUSULA 9ª – DO DIREITO DE PREFERÊNCIA E DAS VISTORIAS ESPORÁDICAS
O(A) LOCATÁRIO(A) permitirá ao(à) LOCADOR(A), ou a seus representantes, realizar vistorias no imóvel em dia e hora previamente combinados, podendo verificar o funcionamento de todas as instalações, acessórios e equipamentos de segurança. Constatado algum dano causado pelo uso inadequado ou pela falta de conservação que possa afetar a estrutura física do imóvel, o(a) LOCATÁRIO(A) deverá realizar o conserto no prazo de até 30 (trinta) dias. Não ocorrendo o conserto, o(a) LOCADOR(A) poderá rescindir o contrato por infração contratual, sem prejuízo do recebimento dos aluguéis e encargos devidos.
Parágrafo primeiro. Em caso de venda, promessa de venda, cessão de direitos ou dação em pagamento do imóvel, o(a) LOCADOR(A) deverá notificar o(a) LOCATÁRIO(A) para que exerça seu direito de preferência na aquisição, em igualdade de condições com terceiros (arts. 27 a 34 da Lei nº 8.245/1991). Para exercer a preferência, o(a) LOCATÁRIO(A) deverá responder à notificação, de maneira inequívoca, no prazo de 30 (trinta) dias.
Parágrafo segundo. Não havendo interesse na aquisição, o(a) LOCATÁRIO(A) deverá permitir que os interessados na compra visitem o imóvel em dias e horários combinados entre LOCATÁRIO(A) e LOCADOR(A).

CLÁUSULA 10ª – DA VISTORIA, DOS DANOS E DA DEVOLUÇÃO DO IMÓVEL FINDO O PRAZO DA LOCAÇÃO
O(A) LOCATÁRIO(A) declara receber o imóvel, os móveis e os utensílios nas condições descritas no laudo de vistoria de entrega das chaves e obriga-se a conservá-lo e a restituí-lo, ao final da locação, nas mesmas condições em que o recebeu: pintado com tinta na cor original da data da entrega, com as instalações elétricas, hidráulicas e acessórios em perfeitas condições de funcionamento, ressalvadas as deteriorações decorrentes do uso normal e habitual do imóvel.
Parágrafo primeiro. Os laudos de vistoria inicial (entrega das chaves) e final (recebimento das chaves) fazem parte deste contrato e conterão a assinatura dos contratantes e de 2 (duas) testemunhas.
Parágrafo segundo. Caso o imóvel não seja devolvido nessas condições e o(a) LOCADOR(A), por esse motivo, não o receba, o(a) LOCATÁRIO(A) continuará obrigado(a) a pagar os aluguéis e encargos que forem vencendo até a regularização do imóvel e a quitação de todos os débitos a ele referentes.
Parágrafo terceiro. O(A) LOCATÁRIO(A) responde por quaisquer danos causados ao imóvel, aos móveis e aos utensílios durante a estada.

CLÁUSULA 11ª – DA RESCISÃO E DA MULTA
Ocorrerá a rescisão do presente contrato, independentemente de indenização por parte do(a) LOCADOR(A), nas seguintes hipóteses: descumprimento de quaisquer das cláusulas e condições deste contrato; perturbação do sossego, da ordem ou emissão de ruído excessivo; inadimplência do(a) LOCATÁRIO(A); ou abandono do imóvel, a qualquer época.
Parágrafo primeiro. A infração de qualquer cláusula deste contrato sujeitará a parte infratora à multa equivalente a 10% (dez por cento) do valor total da locação, sem prejuízo da reparação de eventuais danos.
Parágrafo segundo. Constatado o abandono do imóvel, na presença de 2 (duas) testemunhas, o(a) LOCADOR(A) ou seu procurador poderá retomar a posse na forma da lei (art. 66 da Lei nº 8.245/1991), correndo por conta do(a) LOCATÁRIO(A) todas as despesas decorrentes, inclusive a remoção e a taxa de armazenamento dos móveis e objetos deixados no imóvel.

CLÁUSULA 12ª – DO FORO
Fica eleito o foro da comarca de {{imovel.cidade}} para dirimir quaisquer questões oriundas deste contrato.

E, por estarem assim justos e contratados, firmam o presente instrumento em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.

{{imovel.cidade}}, {{hoje}}.

_______________________________________
LOCADOR(A)

_______________________________________
LOCATÁRIO(A)

_______________________________________
TESTEMUNHA 1
Nome: ______________________________
CPF: ____________________

_______________________________________
TESTEMUNHA 2
Nome: ______________________________
CPF: ____________________`;
const MODELOS_DEF=[{nome:'Residencial',texto:MODELO},{nome:'Comercial',texto:MODELO_COM},{nome:'Temporada',texto:MODELO_TEMP}];
const mdl=i=>{const s=(C.config.modelos||[])[i]||{};return {nome:s.nome||MODELOS_DEF[i].nome,texto:s.texto||(i===0&&C.config.modelo)||MODELOS_DEF[i].texto}};
const mdlOf=c=>{const m=parseInt(c.modelo,10);return m>=0&&m<3?m:(c.finalidade==='comerciais'?1:0)};
const CAMPOS=[['locador.nome','nome do locador'],['locador.doc','CPF/CNPJ do locador'],['locador.rg','RG do locador'],['locador.dataNasc','nascimento do locador'],['locador.nacionalidade','nacionalidade do locador'],['locador.estadoCivil','estado civil do locador'],['locador.profissao','profissão do locador'],['locador.endereco','endereço do locador'],
  ['inquilino.nome','nome do inquilino'],['inquilino.doc','CPF/CNPJ do inquilino'],['inquilino.rg','RG do inquilino'],['inquilino.rgExpedicao','expedição do RG do inquilino'],['inquilino.dataNasc','nascimento do inquilino'],['inquilino.nomeMae','mãe do inquilino'],['inquilino.nacionalidade','nacionalidade do inquilino'],['inquilino.estadoCivil','estado civil do inquilino'],['inquilino.profissao','profissão do inquilino'],['inquilino.endereco','endereço do inquilino'],
  ['fiador.nome','nome do fiador'],['fiador.doc','CPF/CNPJ do fiador'],['fiador.endereco','endereço do fiador'],
  ['imovel.endereco','endereço do imóvel'],['imovel.descricao','descrição do imóvel'],['imovel.tipo','tipo do imóvel'],['imovel.cidade','cidade do imóvel'],
  ['contrato.numero','número do contrato'],['contrato.inicio','data de início'],['contrato.fim','data de término'],['contrato.prazo','prazo em meses'],['contrato.aluguel','valor do aluguel'],['contrato.aluguelExtenso','aluguel por extenso'],
  ['contrato.diaVenc','dia do vencimento'],['contrato.indice','índice de reajuste'],['contrato.periodoReajusteExtenso','período do reajuste'],['contrato.garantia','garantia'],['contrato.caucao','valor da caução'],['contrato.finalidade','finalidade'],['contrato.atividade','ramo de atividade'],
  ['config.multa','multa por atraso'],['config.jurosMes','juros ao mês'],['hoje','data de hoje por extenso']];
const LBL=Object.fromEntries(CAMPOS);
function extenso(v){v=Math.round(num(v)*100)/100;const r=Math.floor(v),c=Math.round((v-r)*100);
  const U=['','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const D=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
  const Cn=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
  const a999=n=>{if(!n)return '';if(n===100)return 'cem';const c=Math.floor(n/100),d=n%100,p=[];if(c)p.push(Cn[c]);if(d)p.push(d<20?U[d]:D[Math.floor(d/10)]+(d%10?' e '+U[d%10]:''));return p.join(' e ')};
  const inteiro=n=>{const mi=Math.floor(n/1e6),mil=Math.floor(n%1e6/1000),rest=n%1000,parts=[];
    if(mi)parts.push(mi===1?'um milhão':a999(mi)+' milhões');if(mil)parts.push(mil===1?'mil':a999(mil)+' mil');if(rest)parts.push(a999(rest));
    if(parts.length>1){const last=parts.pop();return parts.join(' ')+((rest<100||rest%100===0)?' e ':' ')+last}return parts[0]||'zero'};
  let s='';if(r)s=inteiro(r)+(r===1?' real':(r>=1e6&&r%1e6===0?' de reais':' reais'));
  if(c)s+=(s?' e ':'')+a999(c)+(c===1?' centavo':' centavos');return s||'zero reais'}
function ctxOf(c){
  const P=p=>p?{nome:p.nome,nacionalidade:p.nacionalidade,estadoCivil:p.estadoCivil,profissao:p.profissao,doc:p.doc,rg:[p.rg,p.rgOrgao].filter(Boolean).join(' '),rgExpedicao:p.rgExpedicao?fd(p.rgExpedicao):'',dataNasc:p.dataNasc?fd(p.dataNasc):'',nomeMae:p.nomeMae,endereco:endereco(p),email:p.email,telefone:p.telefone}:null;
  const IM=get('imoveis',c.imovel);
  return {locador:P(get('pessoas',c.locador)),inquilino:P(get('pessoas',c.inquilino)),fiador:P(get('pessoas',c.fiador)),caucao:num(c.caucao)>0?true:null,
    imovel:IM?{endereco:endereco(IM),descricao:IM.descricao,tipo:IM.tipo,codigo:IM.codigo,cidade:IM.cidade}:{},
    contrato:{numero:c.numero,inicio:c.inicio?fd(c.inicio):'',fim:c.fim?fd(c.fim):'',prazo:c.prazo?String(c.prazo):'',aluguel:c.aluguel?fmt(c.aluguel):'',aluguelExtenso:c.aluguel?extenso(c.aluguel):'',
      diaVenc:c.diaVenc?String(c.diaVenc):'',indice:c.indice,periodoReajusteExtenso:(n=>n?n+' ('+({6:'seis',12:'doze',18:'dezoito',24:'vinte e quatro',30:'trinta',36:'trinta e seis'}[n]||n)+') meses':'')(perReaj(c)),garantia:c.garantia,caucao:num(c.caucao)?fmt(c.caucao):'',caucaoExtenso:num(c.caucao)?extenso(c.caucao):'',finalidade:c.finalidade||'residenciais',atividade:c.atividade},
    config:{multa:pct(C.config.multa),jurosMes:pct(C.config.jurosMes),empresa:C.config.empresa},hoje:dataExtenso(TODAY)};
}
function fillDoc(tpl,cx){
  tpl=tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,(m,k,inner)=>cx[k]?inner:'');
  const miss=new Set();
  const val=p=>{const v=p.split('.').reduce((o,k)=>o==null?o:o[k],cx);return v==null||v===''?null:String(v)};
  const text=tpl.replace(/\{\{([\w.]+)\}\}/g,(m,p)=>{const v=val(p);if(v==null){miss.add(LBL[p]||p);return '['+(LBL[p]||p)+']'}return v});
  const fillH=s=>esc(s).replace(/\{\{([\w.]+)\}\}/g,(m,p)=>{const v=val(p);return v==null?`<mark>[${esc(LBL[p]||p)}]</mark>`:`<span class="fill">${esc(v)}</span>`});
  const sigHtml=t=>{const out=[];let b=null;const fecha=()=>{if(!b)return;let [n,...r]=b;const mm=n&&n.match(/^([A-ZÀ-Ú() ]{4,})\s*:\s*(.+)$/);if(mm){n=mm[2];r=[mm[1],...r]}
      out.push(`<div class="sigb"><div class="sigl"></div>${n!=null?`<div class="sign">${fillH(n)}</div>`:''}${r.map(x=>`<div class="sigr">${fillH(x)}</div>`).join('')}</div>`);b=null};
    t.split('\n').forEach(l=>{l=l.trim();if(/^_{5,}$/.test(l)){fecha();b=[];return}if(b)b.push(l);else if(l)out.push(`<p>${fillH(l)}</p>`)});fecha();return out.join('')};
  const html=tpl.split(/\n{2,}/).map(par=>{const t=par.trim();if(!t)return '';
    if(/^_{5,}\s*$/m.test(t)&&t.split('\n').some(l=>/^_{5,}$/.test(l.trim())))return sigHtml(t);
    const inner=fillH(t).replace(/\n/g,'<br>');
    const cls=/^CONTRATO DE/.test(t)?'h':/^CLÁUSULA/.test(t)?'cl':/^_{5,}/.test(t)?'sig':'';
    return `<p${cls?` class="${cls}"`:''}>${inner}</p>`}).join('');
  return {text,html,miss:[...miss]};
}
function gerarDoc(id,mi){
  const c=get('contratos',id);if(!c)return;if(mi==null)mi=mdlOf(c);const {text,html,miss}=fillDoc(mdl(mi).texto,ctxOf(c));
  const fname=`Contrato ${c.numero||''} - ${nome('pessoas',c.inquilino)}`.replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim();
  modal(`<div class="wide"></div><h3>Contrato preenchido</h3><div class="subtabs" style="margin:10px 18px 0" role="tablist" aria-label="Modelo">${[0,1,2].map(i=>`<button role="tab" data-mdl="${i}" aria-selected="${i===mi}">Modelo ${i+1} · ${esc(mdl(i).nome)}</button>`).join('')}</div>
  ${miss.length?`<p class="warnbox">Faltam ${miss.length} dado(s), marcados em amarelo: ${esc(miss.join(', '))}. Complete em Pessoas, Imóveis ou no próprio contrato e gere de novo.</p>`:'<p>Todos os campos foram preenchidos com os cadastros.</p>'}
  <style>.doc{font-size:13px;line-height:1.55} .doc p.h{font-size:14px} .doc .sigb{width:65%;margin:2.8em auto 0;text-align:center;page-break-inside:avoid;break-inside:avoid} .doc .sigl{border-top:1px solid #111;margin-bottom:.35em} .doc .sign{font-weight:bold} .doc .sigr{font-size:.92em}</style><div class="body"><div class="doc" id="docv">${html}</div></div>
  <div class="sheet-f"><button class="btn" data-x>Fechar</button><button class="btn" data-copy>Copiar texto</button>${C.downloads?'<button class="btn" data-dl>Baixar contrato (.html)</button>':''}<button class="btn primary" data-prt>${ICON.print} Imprimir contrato</button></div>`,(el,close)=>{
    el.querySelector('[data-x]').onclick=close;
    el.querySelectorAll('[data-mdl]').forEach(b=>b.onclick=()=>{close();gerarDoc(id,+b.dataset.mdl)});
    el.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('Texto copiado. Cole no Word ou no Google Docs.')}catch(e){const r=document.createRange();r.selectNodeContents(el.querySelector('#docv'));const s=getSelection();s.removeAllRanges();s.addRange(r);toast('Texto selecionado. Use Ctrl+C / Cmd+C para copiar.')}};
    const dl=el.querySelector('[data-dl]');const prt=el.querySelector('[data-prt]');
    if(prt)prt.onclick=async()=>{if(window.MIDIA||window.__sb){try{const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);f.srcdoc=pagina();f.onload=()=>setTimeout(()=>{try{f.contentWindow.print()}catch(x){}setTimeout(()=>f.remove(),60000)},300);return}catch(x){}}
      if(C.downloads){try{await C.downloads.save({filename:fname+'.html',data:pagina()});toast('Contrato salvo. Abra o arquivo no navegador e imprima (ou salve em PDF).')}catch(e){if(e&&e.code!=='declined')toast('Não foi possível imprimir aqui. Use “Copiar texto”.')}}else{try{const w=window.open('','_blank');w.document.write(pagina());w.document.close();setTimeout(()=>w.print(),400)}catch(e){toast('Não foi possível imprimir aqui. Use “Copiar texto”.')}}};
    const pagina=()=>{
      const page=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(fname)}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}body{font-family:Georgia,'Times New Roman',serif;font-size:10.5pt;line-height:1.45;color:#111;background:#e9e9e9}#src{max-width:17cm;margin:2cm auto;background:#fff}p{margin:0 0 .9em;text-align:justify}p.h{text-align:center;font-weight:bold;font-size:11.5pt;margin-bottom:1.2em}p.cl{margin-top:1.2em}p.cl:first-line{font-weight:bold}p.clt{font-weight:bold;margin:1.2em 0 0}p.cont{margin-top:0}mark{background:#ffe58a}.sigb{width:65%;margin:2.8em auto 0;text-align:center;break-inside:avoid}.sigl{border-top:1px solid #111;margin-bottom:.35em}.sign{font-weight:bold}.sigr{font-size:.92em}.pg{width:210mm;height:296mm;box-sizing:border-box;padding:10mm 20mm 8mm;display:flex;flex-direction:column;background:#fff;margin:0 auto 6mm;overflow:hidden;break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}.hd{display:flex;justify-content:space-between;font-size:8.5pt;color:#555;height:9mm;flex:none}.ct{flex:1;overflow:hidden;min-height:0}.ct>:first-child{margin-top:0}.ft{height:14mm;flex:none;display:flex;align-items:flex-end;justify-content:flex-end}.ft span{display:block;width:6cm;border-top:1px solid #111}@media print{body{background:#fff}.pg{margin:0}}</style></head><body><div id="src">${html.replace(/<span class="fill">(.*?)<\/span>/g,'$1')}</div>
<script>(function(){var D="${new Date().toLocaleDateString('pt-BR')}",src=document.getElementById('src'),bl=[];
Array.prototype.slice.call(src.children).forEach(function(el){if(el.tagName==='P'&&el.innerHTML.indexOf('<br>')>=0){var ps=el.innerHTML.split('<br>');ps.forEach(function(h,k){var p=document.createElement('p');p.innerHTML=h;p.className=k===0?(el.className==='cl'?'clt':el.className):'cont';if(k<ps.length-1)p.style.marginBottom='0';bl.push(p)})}else bl.push(el)});
src.parentNode.removeChild(src);var pgs=[];
function nova(){var g=document.createElement('div');g.className='pg';g.innerHTML='<div class="hd"></div><div class="ct"></div><div class="ft"><span></span></div>';document.body.appendChild(g);pgs.push(g);return g.querySelector('.ct')}
var ct=nova();
for(var i=0;i<bl.length;i++){var b=bl[i],nx=((b.className==='clt'||b.className==='h')&&bl[i+1])?bl[i+1]:null;ct.appendChild(b);if(nx)ct.appendChild(nx);
if(ct.scrollHeight>ct.clientHeight+1&&ct.children.length>(nx?2:1)){ct=nova();ct.appendChild(b);if(nx)ct.appendChild(nx)}if(nx)i++}
pgs.length})()<\/script></body></html>`;
      return page};
    if(dl)dl.onclick=async()=>{const page=pagina();
      try{await C.downloads.save({filename:fname+'.html',data:page});toast('Contrato salvo. Abra no Word ou no navegador para imprimir.')}catch(e){if(e&&e.code!=='declined')toast('Não foi possível baixar aqui. Use “Copiar texto”.')}};
  });
}

/* ---------- nova pessoa via WhatsApp ---------- */
const MSG_DEF=`Olá! Tudo bem? Para fazer seu cadastro de locação{{imovel}}, por favor responda esta mensagem copiando e preenchendo cada item:

Nome completo: 
Nacionalidade: 
CPF: 
Data de nascimento: 
Nome da mãe: 
RG: 
Órgão emissor: 
Data de expedição do RG: 
Estado civil: 
Profissão: 
Telefone: 
E-mail: 
Endereço atual (rua, número, bairro, cidade/UF, CEP): 

E envie também 2 fotos da sua identidade (RG ou CNH):
1ª foto: FRENTE do documento
2ª foto: VERSO do documento

Autorizo a consulta do meu CPF no Serasa/SPC e de antecedentes criminais (Sim/Não): 
Se puder, envie também a Certidão de Antecedentes Criminais da Polícia Federal (emitida grátis em gov.br).

Obrigado!{{empresa}}`;
const msgTxt=()=>{const im=get('imoveis',C.npIm);return (C.config.msgCadastro||MSG_DEF).replace('{{imovel}}',im?` para o imóvel ${MODS.imoveis.title(im)}`:'').replace('{{empresa}}',C.config.empresa?'\n'+C.config.empresa:'')};
function parseResposta(t){
  const o={},lines=String(t).split(/\r?\n/);
  const MAP=[[/^nome da mae|^mae|^filiacao/,'nomeMae'],[/nascimento|^nascido/,'dataNasc'],[/expedi|emissao/,'rgExpedicao'],[/^orgao|emissor/,'rgOrgao'],[/^nome/,'nome'],[/^nacional/,'nacionalidade'],[/^(cpf|cnpj)/,'doc'],[/^(rg|identidade|carteira)/,'rg'],[/^estado\s*civil/,'estadoCivil'],[/^profiss|^ocupa/,'profissao'],[/^(telefone|celular|whats|fone|contato)/,'telefone'],[/^e-?mail/,'email'],[/^endere/,'endereco'],[/^autorizo|autoriza|consulta do/,'consentimento']];
  for(const ln of lines){const m=ln.match(/^\s*[\-\*•\d.)]*\s*([^:]{2,140}):\s*(.+?)\s*$/);if(!m)continue;
    const lab=m[1].normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();const hit=MAP.find(([re])=>re.test(lab));const val=m[2].replace(/\*/g,'').trim();if(hit){if(!o[hit[1]])o[hit[1]]=val}else(o._extra=o._extra||[]).push(m[1].trim()+': '+val)}
  if(o.estadoCivil){const e=o.estadoCivil.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
    o.estadoCivil=/uniao|estavel/.test(e)?'União estável':/casad/.test(e)?'Casado(a)':/divorc/.test(e)?'Divorciado(a)':/separad/.test(e)?'Separado(a)':/viuv/.test(e)?'Viúvo(a)':/solteir/.test(e)?'Solteiro(a)':''}
  if(o.endereco){let a=o.endereco;const cep=a.match(/\b\d{5}-?\d{3}\b/);if(cep){o.cep=cep[0].replace(/^(\d{5})(\d{3})$/,'$1-$2');a=a.replace(cep[0],'')}
    const uf=a.match(/(?:\/|-|,|\s)\s*([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/);if(uf&&UF.includes(uf[1])){o.uf=uf[1];a=a.replace(new RegExp('[/,\\-\\s]*'+uf[1]+'\\b'),'')}
    const parts=a.split(',').map(x=>x.replace(/\bCEP\b:?/i,'').trim()).filter(Boolean);
    if(parts.length>=4){o.logradouro=parts[0];o.numero=parts[1];o.bairro=parts[2];o.cidade=parts.slice(3).join(', ')}
    else if(parts.length===3){o.logradouro=parts[0];o.numero=parts[1];o.cidade=parts[2]}else o.logradouro=parts.join(', ');
    delete o.endereco}
  const toISO=x=>{const m=String(x).match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);if(!m)return undefined;let y=+m[3];if(y<100)y+=y>30?1900:2000;return y+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0')};
  ['dataNasc','rgExpedicao'].forEach(k=>{if(o[k]){const v=toISO(o[k]);if(v)o[k]=v;else delete o[k]}});
  if(o.rg&&!o.rgOrgao){const m=o.rg.match(/^\s*([\dxX.\-]+)\s*[-–/,]?\s*([A-Za-zÀ-ú]{2,}.*)$/);if(m){o.rg=m[1];o.rgOrgao=m[2].trim()}}
  if(o.doc)o.doc=maskDoc(o.doc);
  if(o.consentimento){const c=o.consentimento.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();o.consentimento=/^s/.test(c)?'Sim':/^n/.test(c)?'Não':'Não informado'}
  if(o.telefone)o.telefone=o.telefone.replace(/[^\d()+\-\s]/g,'').trim();
  if(o._extra){o._extra='Outras respostas:\n'+o._extra.join('\n')}
  return o;
}
function renderNovaPessoa(){
  const pcs=rows('precad').sort((a,b)=>(b.recebidoEm||'').localeCompare(a.recebidoEm||''));
  const ims=rows('imoveis').filter(i=>i.status!=='Alugado').sort(MODS.imoveis.sort);const txt=msgTxt();
  const tel=(C.npTel||'').replace(/\D/g,''),wa='https://wa.me/'+(tel?(tel.length<=11?'55'+tel:tel):'')+'?text='+encodeURIComponent(txt);
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Nova pessoa</h1><div class="meta">Cadastro rápido de quem quer alugar, pelo WhatsApp</div></div></div>
  <div class="steps">
  <div class="card"><div class="card-h"><h2><span class="stepn">1</span> Enviar as perguntas</h2></div><div style="padding:16px;display:grid;gap:12px">
    <div class="fgrid"><div class="field"><label for="npIm">Imóvel de interesse (opcional)</label><select id="npIm"><option value="">Nenhum</option>${ims.map(i=>`<option value="${esc(i.id)}" ${C.npIm===i.id?'selected':''}>${esc(MODS.imoveis.title(i))}</option>`).join('')}</select></div>
    <div class="field"><label for="npTel">WhatsApp da pessoa (opcional)</label><input id="npTel" inputmode="tel" placeholder="(84) 99999-9999" value="${esc(C.npTel||'')}"></div></div>
    <div class="field"><label for="npMsg">Mensagem que será enviada <span class="meta" style="display:inline">· pode mudar aqui só para esta pessoa</span></label><textarea id="npMsg" class="mdtxt" style="min-height:300px;font-family:var(--body);font-size:14px">${esc(txt)}</textarea></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between"><button class="btn" id="npEdit">${ICON.edit} Editar texto padrão</button>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn" id="npCopy">Copiar mensagem</button><a class="btn primary" id="npWa" href="${esc(wa)}" target="_blank" rel="noopener">Abrir no WhatsApp</a></div></div>
    <div class="meta">Copie e cole no WhatsApp da pessoa, ou use “Abrir no WhatsApp”. Se o botão não abrir, use “Copiar mensagem”.</div></div></div>
  <div class="card"><div class="card-h"><h2><span class="stepn">2</span> Colar a resposta</h2></div><div style="padding:16px;display:grid;gap:12px">
    <div class="meta">Quando a pessoa responder, copie a mensagem dela no WhatsApp e cole aqui. O app preenche o cadastro sozinho.</div>
    <textarea id="npResp" class="mdtxt" style="min-height:220px;font-family:var(--body);font-size:14px" placeholder="Nome completo: Maria da Silva&#10;CPF: 123.456.789-00&#10;…" aria-label="Resposta da pessoa">${esc(C.npResp||'')}</textarea>
    <div class="fgrid"><div class="field"><label for="npTipo">Cadastrar como</label><select id="npTipo">${OPT.tipoPessoa.map(t=>`<option ${t===(C.npTipo||'Inquilino')?'selected':''}>${t}</option>`).join('')}</select></div></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end"><button class="btn" id="npDirect">Cadastrar direto em Pessoas</button><button class="btn primary" id="npFill">Salvar no pré-cadastro</button></div></div></div>
  <div class="card" id="pcList"><div class="card-h"><h2><span class="stepn">3</span> Pré-cadastros recebidos</h2><span class="meta">${pcs.length}</span></div>
  ${pcs.length?`<ul class="plist">${pcs.map(r=>{const fotos=(r.docFrente?1:0)+(r.docVerso?1:0),dup=r.doc&&rows('pessoas').find(p=>p.doc&&p.doc.replace(/\D/g,'')===r.doc.replace(/\D/g,''));
    return `<li class="pcrow"><div style="min-width:0"><b>${esc(r.nome||'Sem nome')}</b><div class="meta">${esc([r.doc&&'CPF '+r.doc,r.telefone,r.profissao].filter(Boolean).join(' · ')||'—')}</div>
      <div class="meta">Recebido ${fd(r.recebidoEm)}${r.interesse&&get('imoveis',r.interesse)?' · interesse: '+esc(MODS.imoveis.title(get('imoveis',r.interesse))):''} · ${fotos===2?bdg('RG frente e verso','ok'):fotos===1?bdg('falta 1 foto do RG','warn'):bdg('sem fotos do RG','')}${dup?' '+bdg('CPF já está em Pessoas','warn'):''}${r.consentimento?' '+bdg('Autorizou consultas: '+r.consentimento,r.consentimento==='Sim'?'ok':''):''} ${consBadges(r)}</div></div>
      <div class="pcact"><div class="pcf"><label for="pcd-${esc(r.id)}">Carregar os dados em</label><select id="pcd-${esc(r.id)}" class="search" data-pcdest="${esc(r.id)}">${pcDestOpts(r)}</select></div><div class="pcf"><label for="pct-${esc(r.id)}">Classificação</label><select id="pct-${esc(r.id)}" class="search" style="width:auto" data-pctipo="${esc(r.id)}">${OPT.tipoPessoa.map(t=>`<option ${t===(r.tipo||'Inquilino')?'selected':''}>${t}</option>`).join('')}</select></div>
      <button class="btn sm" data-col="precad" data-edit="${esc(r.id)}">${ICON.edit} Conferir / fotos</button><button class="btn sm primary" data-pctrans="${esc(r.id)}">Transferir para Pessoas</button></div></li>`}).join('')}</ul>`:'<div class="empty">Nenhum pré-cadastro. Cole a resposta de uma pessoa acima e clique em “Salvar no pré-cadastro”.</div>'}
  <div class="note">Confira os dados, anexe as fotos da identidade (frente e verso), registre as consultas (Serasa e antecedentes), escolha a classificação e transfira. A pessoa sai daqui e entra em Pessoas, pronta para o contrato.</div></div>
  <div class="card"><div class="card-h"><h2><span class="stepn">4</span> Consultas de Serasa e antecedentes</h2></div><div style="padding:16px">${CONSULTAS_HTML()}<div class="meta" style="margin-top:8px">O resultado de cada consulta é registrado no cadastro da pessoa (botão “Conferir / fotos” ou em Pessoas → editar), na parte “Consultas”.</div></div></div>
  </div>`;
}
function editarMsg(){
  const cur=C.config.msgCadastro||MSG_DEF;
  modal(`<div class="wide"></div><h3>Editar a mensagem de cadastro</h3><p>Este texto é usado toda vez que você abrir “Nova pessoa”. Pode mudar a saudação, tirar ou incluir perguntas.</p>
  <div class="body" style="display:grid;gap:10px">
    <textarea id="emTxt" class="mdtxt" style="min-height:340px;font-family:var(--body);font-size:14px" aria-label="Texto padrão">${esc(cur)}</textarea>
    <div class="chips"><button type="button" class="chip" data-emins="{{imovel}}">{{imovel}} <span>imóvel de interesse</span></button><button type="button" class="chip" data-emins="{{empresa}}">{{empresa}} <span>nome da administradora</span></button><button type="button" class="chip" data-emq>+ Incluir pergunta</button></div>
    <div class="meta">Escreva cada pergunta numa linha terminando com dois-pontos (ex.: “Renda mensal:”). Assim o app entende a resposta ao colar. Perguntas que não são do cadastro vão para as Observações da pessoa.</div>
  </div>
  <div class="sheet-f"><button class="btn" data-def style="margin-right:auto">Restaurar texto original</button><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Salvar texto</button></div>`,(el,close)=>{
    const ta=el.querySelector('#emTxt');const ins=t=>{const a=ta.selectionStart,b=ta.selectionEnd;ta.value=ta.value.slice(0,a)+t+ta.value.slice(b);ta.focus();ta.selectionStart=ta.selectionEnd=a+t.length};
    el.querySelectorAll('[data-emins]').forEach(b=>b.onclick=()=>ins(b.dataset.emins));
    el.querySelector('[data-emq]').onclick=()=>{const i=ta.value.indexOf('\n\nE envie');const q='\nNova pergunta: ';if(i>0){ta.value=ta.value.slice(0,i)+q+ta.value.slice(i);ta.focus();ta.selectionStart=i+1;ta.selectionEnd=i+q.length-2}else ins(q)};
    el.querySelector('[data-def]').onclick=()=>{ta.value=MSG_DEF;ta.focus()};
    el.querySelector('[data-x]').onclick=close;
    el.querySelector('[data-ok]').onclick=async()=>{const tx=ta.value;if(!tx.trim()){ta.focus();return}close();await put('config','geral',{...C.config,msgCadastro:tx.trim()===MSG_DEF.trim()?'':tx});toast('Mensagem de cadastro salva.')};
  });
}
const normN=x=>String(x||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function pcMatch(r){const d=(r.doc||'').replace(/\D/g,'');const ps=rows('pessoas');
  return (d&&ps.find(p=>(p.doc||'').replace(/\D/g,'')===d))||(r.nome&&ps.find(p=>normN(p.nome)===normN(r.nome)))||null}
function pcDestOpts(r){const cur=r.destino!==undefined?r.destino:((pcMatch(r)||{}).id||'');
  const ps=rows('pessoas').sort((a,b)=>(a.tipo||'').localeCompare(b.tipo||'')||(a.nome||'').localeCompare(b.nome||''));
  return `<option value="">+ Criar nova pessoa</option>`+OPT.tipoPessoa.map(t=>{const g=ps.filter(p=>p.tipo===t);return g.length?`<optgroup label="${t}s já cadastrados">${g.map(p=>`<option value="${esc(p.id)}" ${p.id===cur?'selected':''}>${esc(p.nome)}${p.doc?' · '+esc(p.doc):''}</option>`).join('')}</optgroup>`:''}).join('')}
async function transferirPc(id){
  const r=get('precad',id);if(!r)return;const sel=$('#pct-'+id);const tipo=sel?sel.value:(r.tipo||'Inquilino');
  const {id:_,recebidoEm,interesse,destino:_d,...dados}=r;dados.tipo=tipo;
  const dsel=$('#pcd-'+id),dest=dsel?dsel.value:'';const alvoP=dest&&get('pessoas',dest);
  dados.obs=[dados.obs,'Cadastro recebido pelo WhatsApp em '+fd(recebidoEm||TODAY)].filter(Boolean).join('\n');
  if(alvoP){const ok=await choose('Carregar os dados em '+alvoP.nome+'?','Os dados recebidos substituem os que estão no cadastro; o que não veio na resposta é mantido. Classificação: '+tipo+'.',[{label:'Carregar em '+alvoP.nome,value:1}]);if(!ok)return;
    const {id:__,...old}=alvoP;Object.keys(dados).forEach(k=>{if(dados[k]==null||dados[k]==='')delete dados[k]});if(old.obs&&dados.obs)dados.obs=old.obs+'\n'+dados.obs;
    await put('pessoas',alvoP.id,{...old,...dados});await del('precad',id);toast('Dados carregados em '+alvoP.nome+' ('+tipo+').');return}
  const m=pcMatch(r);
  const ok=await choose('Criar '+(dados.nome||'esta pessoa')+' em Pessoas?',(m?'Atenção: já existe “'+m.nome+'” com o mesmo '+(m.doc&&r.doc?'CPF':'nome')+'. Para atualizar esse cadastro, escolha-o em “Carregar os dados em”. ':'')+'Classificação: '+tipo+'.',[{label:'Criar nova pessoa como '+tipo,value:1}]);if(!ok)return;
  await put('pessoas',uid(),dados);await del('precad',id);toast((dados.nome||'Pessoa')+' cadastrado(a) em Pessoas como '+tipo+'.');
}
function verDocs(id){const p=get('pessoas',id);if(!p)return;const fs=[['Frente',p.docFrente],['Verso',p.docVerso]].filter(x=>x[1]);
  modal(`<div class="wide"></div><h3>Identidade · ${esc(p.nome)}</h3><div class="body"><div class="gal">${fs.map(([l,i])=>`<figure style="margin:0"><a href="${blob(i)}" target="_blank" rel="noopener" data-zoomlink><img src="${blob(i)}" alt="${l}" data-zoom style="aspect-ratio:auto;object-fit:contain;background:var(--surface-2)"></a><figcaption class="meta" style="text-align:center;margin-top:4px">${l}</figcaption></figure>`).join('')}</div></div><div class="sheet-f"><button class="btn" data-x>Fechar</button></div>`,(el,close)=>{el.querySelector('[data-x]').onclick=close})}

/* ---------- imprimir vistoria ---------- */
async function dataUrlDe(id){for(let i=0;i<50;i++){const s=blob(id);if(s&&!/#(m|sp)=/.test(s)){try{const b=await fetch(s).then(r=>{if(!r.ok)throw 0;return r.blob()});return await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>res('');fr.readAsDataURL(b)})}catch(e){return ''}}await new Promise(r=>setTimeout(r,200))}return ''}
function abrirJanelaImpressao(){if(!(window.MIDIA||window.__sb))return null;try{const w=window.open('','_blank');if(w){w.document.write('<!doctype html><meta charset="utf-8"><title>Preparando…</title><p style="font:16px system-ui;padding:30px">Preparando a vistoria para imprimir… (carregando as fotos)</p>')}return w}catch(e){return null}}
async function imprimirVistoria(id,w){
  const v0=get('vistorias',id);if(!v0){if(w)w.close();return}const v=MODS.vistorias.prep({...v0});
  toast('Preparando a vistoria com as fotos…');
  const im=get('imoveis',v.imovel)||{},ct=get('contratos',v.contrato);
  const loc=v.assLocadorNome||(ct?nome('pessoas',ct.locador):im.locador?nome('pessoas',im.locador):'');
  const inq=v.assInquilinoNome||(ct?nome('pessoas',ct.inquilino):'');
  const midia=(Array.isArray(v.midia)?v.midia:[]),fotos=midia.filter(m=>m.tipo!=='video'),nVid=midia.length-fotos.length;
  const [fImovel,fLoc,fInq,...fs]=await Promise.all([im.foto?dataUrlDe(im.foto):'',v.assLocadorFoto?dataUrlDe(v.assLocadorFoto):'',v.assInquilinoFoto?dataUrlDe(v.assInquilinoFoto):'',...fotos.map(f=>dataUrlDe(f.id))]);
  const e=esc,linha=(l,x)=>x?`<tr><th>${e(l)}</th><td>${e(x)}</td></tr>`:'';
  const assin=(tit,nm,ok,foto)=>`<div class="ass"><div class="asstit">${e(tit)}</div>${foto?`<img src="${foto}" alt="">`:'<div class="assph"></div>'}<div class="assl"></div><div class="assn">${e(nm||'Nome: ______________________________')}</div><div class="asss">${ok==='Sim'?'✔ Assinada':'Assinatura pendente'}</div></div>`;
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Vistoria ${e(v.tipo||'')} - ${e(MODS.imoveis.title(im)||'')} - ${fd(v.data)}</title>
<style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:11pt/1.45 Georgia,"Times New Roman",serif;color:#111;margin:0;padding:16px}
h1{font:700 17pt system-ui,sans-serif;margin:0;color:#1F5F6B}.sub{font:10pt system-ui,sans-serif;color:#555;margin:2px 0 14px}
h2{font:700 11.5pt system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#1F5F6B;border-bottom:1.5px solid #1F5F6B;padding-bottom:3px;margin:18px 0 8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid #ddd}th{width:30%;font:600 10pt system-ui,sans-serif;color:#444}
.top{display:flex;gap:14px;align-items:flex-start}.top img{width:190px;height:140px;object-fit:cover;border-radius:6px;border:1px solid #ccc}
.itens{white-space:pre-wrap;border:1px solid #ddd;border-radius:6px;padding:10px;min-height:60px}
.fotos{display:grid;grid-template-columns:1fr 1fr;gap:10px}.foto{break-inside:avoid;border:1px solid #ddd;border-radius:6px;padding:6px}.foto img{width:100%;height:230px;object-fit:contain;background:#f3f3f3;display:block}.foto div{font:9pt system-ui,sans-serif;color:#555;margin-top:4px}
.asss-wrap{display:grid;grid-template-columns:1fr 1fr;gap:24px;break-inside:avoid;margin-top:8px}.ass{text-align:center}.ass img{max-width:100%;height:120px;object-fit:contain;display:block;margin:0 auto 6px}.assph{height:70px}
.asstit{font:700 10pt system-ui,sans-serif;text-transform:uppercase;color:#444;margin-bottom:8px}.assl{border-top:1px solid #111;margin:0 10px}.assn{margin-top:4px;font-weight:700}.asss{font:9pt system-ui,sans-serif;color:#555}
.rod{margin-top:22px;font:9pt system-ui,sans-serif;color:#777;text-align:center}.bt{position:fixed;top:10px;right:10px;font:600 13px system-ui;padding:8px 14px;border:0;border-radius:8px;background:#1F5F6B;color:#fff;cursor:pointer}@media print{.bt{display:none}}</style></head><body>
<button class="bt" onclick="print()">Imprimir</button>
<h1>Laudo de Vistoria — ${e(v.tipo||'')}</h1><div class="sub">${e(C.config.empresa||'Chave Mestra')} · Vistoria realizada em ${fd(v.data)}</div>
<h2>Imóvel</h2><div class="top">${fImovel?`<img src="${fImovel}" alt="">`:''}<table>${linha('Imóvel',[im.codigo,im.tipo].filter(Boolean).join(' · '))}${linha('Endereço',endereco(im))}${linha('Descrição',im.descricao)}${linha('Área / cômodos',[im.area?im.area+' m²':'',im.quartos?im.quartos+' quarto(s)':'',im.banheiros?im.banheiros+' banheiro(s)':'',im.vagas?im.vagas+' vaga(s)':''].filter(Boolean).join(' · '))}</table></div>
<h2>Dados da vistoria</h2><table>${linha('Tipo',v.tipo)}${linha('Data',fd(v.data))}${linha('Responsável',v.responsavel)}${linha('Estado geral',v.estado)}${ct?linha('Contrato','Nº '+(ct.numero||'s/n')):''}${linha('Locador',loc)}${linha('Inquilino',inq)}</table>
<h2>Itens vistoriados e observações</h2><div class="itens">${e(v.itens||'Sem observações.')}</div>
<h2>Fotos (${fotos.length})${nVid?` · ${nVid} vídeo(s) disponível(is) no aplicativo`:''}</h2>${fotos.length?`<div class="fotos">${fs.map((s,i)=>`<div class="foto">${s?`<img src="${s}" alt="">`:'<div style="height:230px;display:grid;place-items:center;background:#f3f3f3">Foto indisponível</div>'}<div>Foto ${i+1}${fotos[i].nome?' · '+e(fotos[i].nome):''}</div></div>`).join('')}</div>`:'<p>Nenhuma foto anexada.</p>'}
<h2>Assinaturas</h2><p style="font-size:10pt">As partes declaram estar de acordo com as condições do imóvel descritas neste laudo.</p>
<div class="asss-wrap">${assin('Locador',loc,v.assLocador,fLoc)}${assin('Inquilino',inq,v.assInquilino,fInq)}</div>
<div class="rod">Documento gerado pelo Chave Mestra em ${fd(TODAY)}</div>
<script>window.addEventListener('load',()=>setTimeout(()=>print(),400))<\/script></body></html>`;
  const nomeArq=('Vistoria '+(v.tipo||'')+' - '+(MODS.imoveis.title(im)||'imovel')+' - '+fd(v.data).replace(/\//g,'-')).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[\\/:*?"<>|]/g,'-');
  if(w&&!w.closed){w.document.open();w.document.write(html);w.document.close();return}
  if(window.MIDIA||window.__sb){try{const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(f);f.srcdoc=html.replace(/<script>[\s\S]*?<\/script>/,'');f.onload=()=>{setTimeout(()=>{try{f.contentWindow.print()}catch(x){}setTimeout(()=>f.remove(),60000)},500)};return}catch(x){}}
  if(C.downloads){try{await C.downloads.save({filename:nomeArq+'.html',data:html});toast('Vistoria salva. Abra o arquivo no navegador e imprima (ou salve em PDF).')}catch(x){if(x&&x.code!=='declined')toast('Não foi possível gerar a vistoria aqui.')}}
}

/* ---------- ampliar fotos ---------- */
function lightbox(src){
  const o=document.createElement('div');o.className='lbx';o.setAttribute('role','dialog');o.setAttribute('aria-label','Foto ampliada');let rot=0,z=false;
  o.innerHTML=`<div class="lbx-bar"><button type="button" data-l="rot" title="Girar">⟳ Girar</button><button type="button" data-l="zoom" title="Aproximar">＋ Zoom</button><a href="${src}" target="_blank" rel="noopener">Abrir em nova aba</a><button type="button" data-l="x" title="Fechar">✕ Fechar</button></div><div class="lbx-img"><img src="${src}" alt="Foto ampliada"></div>`;
  const img=o.querySelector('img'),ap=()=>{img.style.transform=`rotate(${rot}deg) scale(${z?2:1})`;img.style.cursor=z?'zoom-out':'zoom-in'};
  const fechar=()=>{o.remove();document.removeEventListener('keydown',kd,true)};const kd=e=>{if(e.key==='Escape'){e.stopPropagation();fechar()}};
  o.addEventListener('click',e=>{const b=e.target.closest('[data-l]');if(b){if(b.dataset.l==='x')fechar();if(b.dataset.l==='rot'){rot=(rot+90)%360;ap()}if(b.dataset.l==='zoom'){z=!z;ap()}return}if(e.target===img){z=!z;ap();return}if(!e.target.closest('a'))fechar()});
  document.addEventListener('keydown',kd,true);document.body.appendChild(o);ap();
}
document.addEventListener('click',e=>{const im=e.target.closest('img[data-zoom]');if(!im)return;if(im.closest('.lbx'))return;e.preventDefault();e.stopPropagation();lightbox(im.currentSrc||im.src)},true);

/* ---------- media ---------- */
const MEDIA_OK=['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/webm'];
function toJpeg(file,max){return new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();
  im.onload=()=>{let w=im.naturalWidth,h=im.naturalHeight;const s=Math.min(1,max/Math.max(w,h));w=Math.round(w*s);h=Math.round(h*s);const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(im,0,0,w,h);URL.revokeObjectURL(u);cv.toBlob(b=>b?res(b):rej({code:'unsupported_type'}),'image/jpeg',.8)};
  im.onerror=()=>{URL.revokeObjectURL(u);rej({code:'unsupported_type'})};im.src=u})}
async function uploadFile(file){
  if(!C.assets)throw {code:'not_granted'};
  let b=file,type=file.type||'',tipo='image';
  if(type.startsWith('video/')){tipo='video';if(!MEDIA_OK.includes(type))throw {code:'unsupported_type'}}
  else if(type==='application/pdf'){tipo='pdf'}
  else if(type!=='image/gif'){b=await toJpeg(file,1600);type='image/jpeg'}
  const r=await C.assets.upload(b,{type});return {id:r.id,tipo,nome:file.name};
}
const upErr=e=>({unsupported_type:'Formato não aceito. Use fotos JPG/PNG ou vídeos MP4.',too_large:'Arquivo maior que 20 MB. Grave um vídeo mais curto ou envie em partes.',quota_or_state:'O espaço de arquivos acabou.',quota_exceeded:'O limite gratuito do banco de dados foi atingido hoje. Tente amanhã.',unavailable:'Sem conexão com a internet. Tente de novo quando estiver on-line.',rate_limited:'Muitos envios seguidos. Espere um pouco e tente de novo.',not_granted:'Você não tem permissão para enviar arquivos aqui.'}[e&&e.code]||'Não foi possível enviar o arquivo. Tente de novo.');
function drawMedia(el,f){
  const box=el.querySelector(`[data-media="${f.k}"] .mlist`);if(!box)return;const arr=el._media[f.k];
  box.innerHTML=arr.map((m,i)=>`<div class="mitem">${m.tipo==='pdf'?`<a class="mpdf" href="${blob(m.id)}" target="_blank" rel="noopener"><b>PDF</b><span>${esc(m.nome||'documento')}</span></a>`:m.tipo==='video'?`<video src="${blob(m.id)}" muted preload="metadata"></video><span class="vtag">${ICON.play}</span>`:`<img src="${blob(m.id)}" alt="" data-zoom title="Clique para ampliar">`}<button type="button" class="mdel" data-mdel="${f.k}:${i}" aria-label="Remover">${ICON.x}</button></div>`).join('');
}
function galeriaManut(id){
  const r=get('manutencao',id);if(!r)return;const m=Array.isArray(r.midia)?r.midia:[];
  modal(`<div class="wide"></div><h3>${esc(r.descricao||'Chamado')}</h3><p>${esc(nome('imoveis',r.imovel))} · aberto em ${fd(r.abertura)} · ${esc(r.status||'')}</p>
  <div class="body"><div class="gal">${m.map(x=>x.tipo==='video'?`<video src="${blob(x.id)}" controls preload="metadata"></video>`:`<img data-zoom src="${blob(x.id)}" alt="${esc(x.nome||'')}">`).join('')}</div>
  ${r.obs?`<div class="meta" style="white-space:pre-wrap;margin-top:10px">${esc(r.obs)}</div>`:''}</div><div class="sheet-f"><button class="btn" data-ed>Editar chamado</button><button class="btn" data-x>Fechar</button></div>`,(el,close)=>{el.querySelector('[data-x]').onclick=close;el.querySelector('[data-ed]').onclick=()=>{close();openForm('manutencao',get('manutencao',id))}});
}
function gallery(id){
  const v=get('vistorias',id);if(!v)return;const m=Array.isArray(v.midia)?v.midia:[];
  modal(`<div class="wide"></div><h3>${esc(MODS.vistorias.title(MODS.vistorias.prep({...v})))}</h3><p>${esc(nome('imoveis',v.imovel))} · ${esc(endereco(get('imoveis',v.imovel)))}</p>
  <div class="body"><div class="gal">${m.map(x=>x.tipo==='video'?`<video src="${blob(x.id)}" controls preload="metadata"></video>`:`<a href="${blob(x.id)}" target="_blank" rel="noopener" data-zoomlink><img data-zoom src="${blob(x.id)}" alt="${esc(x.nome||'')}"></a>`).join('')}</div>
  ${v.itens?`<div class="meta" style="white-space:pre-wrap;margin-top:10px">${esc(v.itens)}</div>`:''}</div><div class="sheet-f"><button class="btn" data-pv>${ICON.print} Imprimir vistoria</button><button class="btn" data-x>Fechar</button></div>`,(el,close)=>{el.querySelector('[data-x]').onclick=close;el.querySelector('[data-pv]').onclick=()=>{const w=abrirJanelaImpressao();imprimirVistoria(id,w)}});
}

/* ---------- forms ---------- */
function fieldHtml(f,v,pre){
  if(f.t==='sec')return `<div class="full fsec">${esc(f.l)}</div>`;
  if(f.t==='calc')return `<div class="full" id="cmcalc"></div>`;
  if(f.t==='html')return `<div class="full">${f.html()}</div>`;
  const id=(pre||'cmf-')+f.k,cls='field'+(f.full?' full':'');let input;const fw=f.show?` data-fw="${f.k}"`:'';
  if(f.t==='sel')input=`<select id="${id}" data-k="${f.k}"><option value="">—</option>${(typeof f.opt==='function'?f.opt():f.opt).map(o=>{const [ov,ol]=Array.isArray(o)?o:[o,o];return `<option value="${esc(ov)}" ${String(ov)===String(v??'')?'selected':''}>${esc(ol)}</option>`}).join('')}</select>`;
  else if(f.t==='ref'){const T=MODS[f.ref].title;let list=rows(f.ref).filter(f.filter||(()=>true)).sort((a,b)=>T(a).localeCompare(T(b)));
    const cur=get(f.ref,v);if(cur&&!list.some(r=>r.id===v))list.unshift(cur);
    const opt=r=>`<option value="${esc(r.id)}" ${r.id===v?'selected':''}>${esc(T(r))}</option>`;
    const body=f.groupBy?[...OPT.tipoPessoa,''].map(g=>{const it=list.filter(r=>g?r[f.groupBy]===g:!OPT.tipoPessoa.includes(r[f.groupBy]));return it.length?`<optgroup label="${esc(g?g+(g.endsWith('r')?'es':'s'):'Sem tipo')}">${it.map(opt).join('')}</optgroup>`:''}).join(''):list.map(opt).join('');
    input=`<select id="${id}" data-k="${f.k}"><option value="">${list.length?'Selecione…':'Nenhum cadastrado ainda'}</option>${body}</select>`}
  else if(f.t==='multi'){const sel=Array.isArray(v)?v:(v?[v]:[]);input=`<div class="mchips" id="${id}" role="group">${f.opt.map(o=>`<label class="mchk"><input type="checkbox" value="${esc(o)}" ${sel.includes(o)?'checked':''}><span>${esc(o)}</span></label>`).join('')}</div>`}
  else if(f.t==='area')input=`<textarea id="${id}" data-k="${f.k}" ${f.ph?`placeholder="${esc(f.ph)}"`:''}>${esc(v||'')}</textarea>`;
  else if(f.t==='photo'||f.t==='media')input=`<div class="media${f.t==='photo'?' mphoto':''}" data-media="${f.k}"><div class="mlist"></div>${C.assets?`<label class="btn upl">${ICON.cam} ${f.t==='photo'?(f.pdf?'Anexar foto ou PDF':'Escolher foto'):'Adicionar fotos ou vídeos'}<input type="file" id="${id}" data-mfile="${f.k}" accept="${f.t==='photo'?(f.pdf?'image/*,application/pdf':'image/*'):'image/*,video/mp4,video/webm'}" ${f.t==='media'?'multiple':''}></label>`:'<span class="meta">O envio de arquivos funciona no aplicativo publicado, para quem pode editar.</span>'}<span class="meta mstat"></span></div>`;
  else{const type=f.t==='date'?'date':f.t==='month'?'month':'text';
    const val=v==null||v===''?'':f.t==='money'?num(v).toFixed(2).replace('.',','):f.t==='num'?String(v).replace('.',','):v;
    input=`<input id="${id}" data-k="${f.k}" type="${type}" ${f.mask?`data-mask="${f.mask}" inputmode="numeric" maxlength="18"`:''} ${f.t==='money'||f.t==='num'?'inputmode="decimal"':''} value="${esc(val)}" ${f.ph?`placeholder="${esc(f.ph)}"`:''}>`}
  return `<div class="${cls}"${fw}><label for="${id}"${f.strong?' class="lstrong"':''}>${esc(f.l)}${f.req?' *':''}</label>${input}${f.hint?`<span class="meta">${esc(f.hint)}</span>`:''}</div>`;
}
function readFields(el,fields,pre){const o={};fields.forEach(f=>{if(!f.k)return;
  if(f.t==='photo'||f.t==='media'){const a=(el._media&&el._media[f.k])||[];if(f.t==='photo'){if(a[0]){o[f.k]=a[0].id;if(f.pdf){o[f.k+'Tipo']=a[0].tipo;if(a[0].nome)o[f.k+'Nome']=a[0].nome}}}else if(a.length)o[f.k]=a.slice();return}
  if(f.t==='multi'){const box=el.querySelector('#'+(pre||'cmf-')+f.k);const a=box?[...box.querySelectorAll('input:checked')].map(x=>x.value):[];if(a.length)o[f.k]=a;return}
  const e=el.querySelector('#'+(pre||'cmf-')+f.k);if(!e)return;const raw=e.value.trim();if(raw==='')return;o[f.k]=(f.t==='money'||f.t==='num')?parseMoney(raw):raw});return o}
function checkFields(o,fields){
  const miss=fields.filter(f=>f.req&&(o[f.k]==null||o[f.k]==='')).map(f=>f.l);if(miss.length)return 'Preencha: '+miss.join(', ')+'.';
  const dm=fields.find(f=>f.mask==='doc'&&o[f.k]&&![11,14].includes(String(o[f.k]).replace(/\D/g,'').length));if(dm)return 'O CPF precisa ter 11 números (ou o CNPJ 14 números).';
  const bad=fields.filter(f=>(f.t==='money'||f.t==='num')&&o[f.k]!=null&&!isFinite(o[f.k])).map(f=>f.l);if(bad.length)return 'Valor inválido em: '+bad.join(', ')+'. Use números como 1.250,00.';
  return '';
}
function openForm(c,row,pre){
  const M=MODS[c],editing=!!row;let v=row?{...row}:{...(M.defaults?M.defaults():{}),...(pre||{})};if(M.prep)v=M.prep(v);
  modal(`<div class="wide"></div><h3>${editing?'Editar '+M.sing:M.novo}</h3>
  <form id="cmform" novalidate><div class="fgrid">${M.fields.map(f=>fieldHtml(f,v[f.k])).join('')}</div><div class="meta" id="cmerr" style="color:var(--neg);margin-top:10px"></div></form>
  <div class="sheet-f">${editing?'<button class="btn danger" data-del style="margin-right:auto">Excluir</button>':''}<button class="btn" data-x>Cancelar</button>${c==='contratos'?'<button class="btn" data-okdoc>Salvar e gerar contrato</button>':''}<button class="btn primary" data-ok>${editing?'Salvar':'Cadastrar'}</button></div>`,(el,close)=>{
    const form=el.querySelector('#cmform');let busy=0;
    el._media={};M.fields.filter(f=>f.t==='photo'||f.t==='media').forEach(f=>{const cur=v[f.k];el._media[f.k]=f.t==='photo'?(cur?[{id:cur,tipo:v[f.k+'Tipo']||'image',nome:v[f.k+'Nome']}]:[]):(Array.isArray(cur)?cur.slice():[]);drawMedia(el,f)});
    const set=(k,val)=>{const f=M.fields.find(x=>x.k===k),e=el.querySelector('#cmf-'+k);if(!e||val==null)return;e.value=f&&f.t==='money'?num(val).toFixed(2).replace('.',','):val};
    const upd=()=>{const vals=readFields(el,M.fields);M.fields.forEach(f=>{if(!f.show)return;const w=el.querySelector(`[data-fw="${f.k}"]`);if(w)w.hidden=!f.show(vals)});const box=el.querySelector('#cmcalc');if(M.calc&&box)box.innerHTML=M.calc(vals)};
    form.addEventListener('change',async e=>{
      const mk=e.target.dataset.mfile;
      if(mk){const f=M.fields.find(x=>x.k===mk),files=[...e.target.files];e.target.value='';if(!files.length)return;
        const stat=el.querySelector(`[data-media="${mk}"] .mstat`);busy++;
        for(let i=0;i<files.length;i++){stat.textContent=`Enviando ${i+1} de ${files.length}…`;
          try{const m=await uploadFile(files[i]);if(f.t==='photo')el._media[mk]=[m];else el._media[mk].push(m);drawMedia(el,f)}catch(err){stat.textContent=files[i].name+': '+upErr(err);busy--;return}}
        stat.textContent='';busy--;upd();return}
      const k=e.target.dataset.k;if(k&&M.onChange)M.onChange(k,readFields(el,M.fields),set);upd()});
    form.addEventListener('click',e=>{const d=e.target.closest('[data-mdel]');if(!d)return;const [k,i]=d.dataset.mdel.split(':');el._media[k].splice(+i,1);drawMedia(el,M.fields.find(x=>x.k===k))});
    form.addEventListener('input',e=>{const t=e.target;if(t.dataset&&t.dataset.mask==='doc'){const pos=t.value.length===t.selectionStart;t.value=maskDoc(t.value);if(pos)t.selectionStart=t.selectionEnd=t.value.length}upd()});upd();
    el.querySelector('[data-x]').onclick=close;
    const d=el.querySelector('[data-del]');if(d)d.onclick=()=>{close();removeRow(c,row.id)};
    const ok=async doc=>{if(busy){el.querySelector('#cmerr').textContent='Aguarde terminar o envio dos arquivos.';return}
      let o=readFields(el,M.fields);const err=checkFields(o,M.fields);if(err){el.querySelector('#cmerr').textContent=err;return}
      const base=row?{...C.data[c][row.id]}:{};M.fields.forEach(f=>f.k&&delete base[f.k]);o={...base,...o};if(M.beforeSave)o=M.beforeSave(o);
      const id=row?row.id:uid();close();await put(c,id,o);if(M.afterSave)await M.afterSave(o,id);toast(M.salvo);if(doc)gerarDoc(id)};
    el.querySelector('[data-ok]').onclick=()=>ok(false);const od=el.querySelector('[data-okdoc]');if(od)od.onclick=()=>ok(true);
    form.addEventListener('submit',e=>{e.preventDefault();ok(false)});
  });
}
async function removeRow(c,id){
  const r=get(c,id);if(!r)return;let refs=0;
  for(const oc of COLS)for(const f of MODS[oc].fields)if(f.t==='ref'&&f.ref===c)refs+=rows(oc).filter(x=>x[f.k]===id).length;
  const ok=await choose('Excluir '+MODS[c].title(r)+'?',refs?`Está ligado a ${refs} outro(s) cadastro(s). Eles continuam, mas sem esse vínculo.`:'Esta ação não pode ser desfeita.',[{label:'Excluir',value:1,danger:true}]);
  if(!ok)return;await del(c,id);toast('Excluído.');
}
function reajuste(id){
  const c=get('contratos',id);if(!c)return;const {p,v}=sugestao(c),atual=num(c.aluguel),aniv=proxReaj(c);
  modal(`<div class="wide"></div><h3>Reajuste do aluguel · a cada ${perReaj(c)} meses</h3><p>${esc(MODS.contratos.title(c))} · ${esc(nome('pessoas',c.inquilino))}</p>
  <form id="rf" novalidate><div class="fgrid">
    <div class="field"><label>Aluguel atual</label><div class="calc"><span class="num">${fmt(atual)}</span></div></div>
    <div class="field"><label>Data do reajuste</label><div class="calc"><span>${fd(aniv)}</span>${prazoBadge(days(aniv))}</div></div>
    <div class="field"><label for="rf-p">Percentual (%) · ${esc(c.indice||'IGP-M')} configurado: ${pct(p)}</label><input id="rf-p" inputmode="decimal" value="${String(p).replace('.',',')}"></div>
    <div class="field"><label for="rf-v">Novo aluguel (R$)</label><input id="rf-v" inputmode="decimal" value="${v.toFixed(2).replace('.',',')}"></div>
    <div class="full meta" id="rf-d"></div></div></form>
  <div class="sheet-f"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Aplicar reajuste</button></div>`,(el,close)=>{
    const pI=el.querySelector('#rf-p'),vI=el.querySelector('#rf-v'),dI=el.querySelector('#rf-d');
    const show=()=>{const nv=parseMoney(vI.value);dI.textContent=isFinite(nv)?`Diferença de ${fmt(nv-atual)} por mês (${fmt((nv-atual)*12)} em 12 meses). O valor do imóvel também é atualizado.`:''};
    pI.oninput=()=>{const x=parseMoney(pI.value);if(isFinite(x))vI.value=(Math.round(atual*(1+x/100)*100)/100).toFixed(2).replace('.',',');show()};
    vI.oninput=()=>{const nv=parseMoney(vI.value);if(isFinite(nv)&&atual)pI.value=((nv/atual-1)*100).toFixed(2).replace('.',',');show()};show();
    el.querySelector('[data-x]').onclick=close;
    const ok=async()=>{const nv=parseMoney(vI.value);if(!(nv>0)){dI.textContent='Informe um valor válido.';return}
      const x=parseMoney(pI.value),raw={...C.data.contratos[id]};
      const hist=`${fd(TODAY)}: reajuste ${c.indice||'IGP-M'} ${pct(x)} — de ${fmt(atual)} para ${fmt(nv)}`;
      raw.aluguel=nv;raw.ultimoReajuste=aniv&&aniv<=addMon(TODAY,2)?aniv:TODAY;raw.obs=(raw.obs?raw.obs+'\n':'')+hist;
      close();await put('contratos',id,raw);
      const im=get('imoveis',c.imovel);if(im){const {id:iid,...ir}=im;await put('imoveis',iid,{...ir,aluguel:nv})}
      toast('Reajuste aplicado: '+fmt(nv)+'.')};
    el.querySelector('[data-ok]').onclick=ok;el.querySelector('#rf').addEventListener('submit',e=>{e.preventDefault();ok()});
  });
}
async function pagar(id){
  const f=get('financeiro',id);if(!f)return;const late=-(days(f.vencimento)||0),opts=[];
  if(late>0){const m=Math.round((num(f.aluguel)*num(C.config.multa)/100+num(f.aluguel)*num(C.config.jurosMes)/100*late/30)*100)/100;
    opts.push({label:'Receber com multa e juros',hint:`${late} dias de atraso · + ${fmt(m)} · total ${fmt(num(f.total)+m)}`,value:{m}});
    opts.push({label:'Receber sem multa',hint:'Total '+fmt(f.total),value:{m:0}})}
  else opts.push({label:'Confirmar recebimento hoje',hint:'Total '+fmt(f.total),value:{m:0}});
  const c=await choose('Receber aluguel de '+fm(f.competencia),nome('pessoas',f.inquilino)+' · '+nome('imoveis',f.imovel),opts);if(!c)return;
  const raw={...C.data.financeiro[id]};raw.multa=Math.round((num(raw.multa)+c.m)*100)/100;raw.status='Pago';raw.dataPagamento=TODAY;
  await put('financeiro',id,MODS.financeiro.beforeSave(raw));toast('Recebimento registrado.');
}
async function gerar(){
  const alvo=C.finMes||CUR,fin=rows('financeiro');
  const faltam=rows('contratos').filter(c=>c.status==='Ativo'&&!fin.some(f=>f.contrato===c.id&&f.competencia===alvo));
  if(!faltam.length){toast('Todos os contratos ativos já têm lançamento em '+fm(alvo)+'.');return}
  const ok=await choose('Gerar aluguéis de '+fm(alvo)+'?',`Cria ${faltam.length} recebimento(s) pendente(s) a partir dos contratos ativos, com vencimento no dia de cada contrato.`,[{label:'Gerar '+faltam.length+' recebimento(s)',value:1}]);if(!ok)return;
  for(const c of faltam){const i=get('imoveis',c.imovel)||{};
    await put('financeiro',uid(),MODS.financeiro.beforeSave({contrato:c.id,competencia:alvo,vencimento:vencOf(alvo,c.diaVenc),aluguel:num(c.aluguel),condominio:num(i.condominio)||undefined,iptu:num(i.iptu)||undefined,status:'Pendente'}))}
  toast(faltam.length+' recebimento(s) criado(s) em '+fm(alvo)+'.');
}
async function mexer(id,d){const r={...C.data.estoque[id]};r.quantidade=Math.max(0,num(r.quantidade)+d);await put('estoque',id,r)}

/* ---------- views ---------- */
function renderList(c,pre){
  const M=MODS[c];let list=M.rowsFn?M.rowsFn():rows(c).concat(M.extra?M.extra():[]);if(M.sort)list.sort(M.sort);
  if(M.filt)list=list.filter(M.filt);
  const q=C.q.trim().toLowerCase();
  let cells=list.map(r=>({r,h:M.cols.map(col=>col[1](r))}));
  if(q)cells=cells.filter(x=>x.h.join(' ').replace(/<[^>]+>/g,' ').toLowerCase().includes(q));
  const foot=M.foot&&list.length?`<div class="note">${M.foot(list)}</div>`:'';
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>${esc(pre?'Financeiro':M.nome)}</h1><div class="meta">${list.length} ${list.length===1?'registro':'registros'}${M.filt&&(C.finMes||C.finIm)?' no filtro':''}</div></div>
    <div class="tools">${M.tools?M.tools():''}<button class="btn" data-xlista="${c}" title="Baixar esta lista em Excel">${ICON.doc} Planilha</button><input class="search" id="cmq" type="search" placeholder="Buscar…" aria-label="Buscar" value="${esc(C.q)}"><button class="btn primary" data-new="${c}">${ICON.plus} ${esc(M.novo)}</button></div></div>
  ${pre||''}
  <div class="card">${cells.length?`<div class="tbl-wrap"><table class="cmt"><thead><tr>${M.cols.map(col=>`<th class="${col[2]?'r':''}">${esc(col[0])}</th>`).join('')}<th class="r"><span class="sr">Ações</span></th></tr></thead><tbody>
    ${cells.map(x=>`<tr>${x.h.map((h,i)=>`<td class="${M.cols[i][2]?'r':''}">${h}</td>`).join('')}<td class="act">${M.acts&&(!x.r._src||c==='despesas')?M.acts(x.r):''}<button class="icon-btn" data-col="${x.r._src||c}" data-edit="${esc(x.r._id||x.r.id)}" title="${x.r._src?'Abrir chamado de manutenção':'Editar'}" aria-label="Editar">${ICON.edit}</button></td></tr>`).join('')}
  </tbody></table></div>`:`<div class="empty">${q?'Nada encontrado para “'+esc(C.q)+'”.':'Nenhum registro'+(M.filt&&(C.finMes||C.finIm)?' neste filtro':'')+'. Use “'+esc(M.novo)+'” para começar.'}</div>`}${foot}</div>`;
}
const FTABS=[['receb','Recebimentos'],['desp','Despesas'],['imovel','Por imóvel'],['prev','Previsão']];
function renderFin(){
  const bar=`<div class="subtabs" role="tablist">${FTABS.map(([k,l])=>`<button role="tab" data-fintab="${k}" aria-selected="${C.finTab===k}">${l}</button>`).join('')}</div>`;
  if(C.finTab==='desp')renderList('despesas',bar);else if(C.finTab==='imovel')renderPorImovel(bar);else if(C.finTab==='prev')renderPrev(bar);else renderList('financeiro',bar);
}
function porImovel(Y,mes){
  const inP=k=>k&&k.startsWith(mes||Y);
  const fin=rows('financeiro').filter(f=>inP(f.competencia)),dsp=despRows().filter(d=>inP(compOf(d)));
  return rows('imoveis').sort(MODS.imoveis.sort).map(i=>{const f=fin.filter(x=>x.imovel===i.id),d=dsp.filter(x=>x.imovel===i.id);
    const rec=sum(f.filter(x=>x.status==='Pago'),'total'),atr=sum(f.filter(x=>finStatus(x)==='Atrasado'),'total'),pend=sum(f.filter(x=>finStatus(x)==='Pendente'),'total');
    const dd=sum(d.filter(doDono),'valor'),tx=sum(f.filter(x=>x.status==='Pago'),'taxaAdm');
    return {i,rec,atr,pend,desp:dd,tx,res:rec-dd,nAtr:f.filter(x=>finStatus(x)==='Atrasado').length}});
}
function renderPorImovel(bar){
  const Y=C.finAno;const yrs=new Set([CUR.slice(0,4)]);rows('financeiro').forEach(f=>f.competencia&&yrs.add(f.competencia.slice(0,4)));despRows().forEach(d=>d.data&&yrs.add(d.data.slice(0,4)));
  const data=porImovel(Y),T=k=>data.reduce((s,r)=>s+r[k],0);
  let det='';const sel=C.finSel&&get('imoveis',C.finSel);
  if(sel){const ms=[...Array(12)].map((_,i)=>Y+'-'+p2(i+1));
    const fin=rows('financeiro').filter(f=>f.imovel===sel.id),dsp=despRows().filter(d=>d.imovel===sel.id);
    const lines=ms.map(m=>{const f=fin.filter(x=>x.competencia===m),d=dsp.filter(x=>compOf(x)===m&&doDono(x));const rec=sum(f.filter(x=>x.status==='Pago'),'total'),ab=sum(f.filter(x=>x.status!=='Pago'),'total'),dd=sum(d,'valor');
      return `<tr><td>${fm(m)}</td><td class="r num pos">${fmt(rec)}</td><td class="r num ${f.some(x=>finStatus(x)==='Atrasado')?'neg':''}">${fmt(ab)}</td><td class="r num neg">${fmt(dd)}</td><td class="r num ${rec-dd>=0?'pos':'neg'}">${fmt(rec-dd)}</td></tr>`}).join('');
    const dl=dsp.filter(x=>compOf(x).startsWith(Y)).sort((a,b)=>(b.data||'').localeCompare(a.data||''));
    det=`<div class="card" style="margin-top:18px"><div class="card-h"><h2>${thumb(sel.foto)} ${esc(MODS.imoveis.title(sel))} · ${Y}</h2><button class="btn sm" data-finsel="">Fechar</button></div>
    <div class="tbl-wrap"><table class="cmt"><thead><tr><th>Mês</th><th class="r">Recebido</th><th class="r">Em aberto</th><th class="r">Despesas</th><th class="r">Resultado</th></tr></thead><tbody>${lines}</tbody></table></div>
    <div class="card-h" style="border-top:1px solid var(--line)"><h2>Despesas lançadas em ${Y}</h2><button class="btn sm" data-new="despesas" data-im="${esc(sel.id)}">${ICON.plus} Nova despesa</button></div>
    ${dl.length?`<ul class="plist">${dl.map(x=>`<li><div><b>${esc(x.descricao)}</b><div class="meta">${fd(x.data)} · ${esc(x.categoria)} · pago por ${esc(x.pagoPor)}</div></div><span class="num ${doDono(x)?'neg':''}">${fmt(x.valor)}</span></li>`).join('')}</ul>`:'<div class="empty">Nenhuma despesa neste ano.</div>'}</div>`}
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Financeiro</h1><div class="meta">Resultado de cada imóvel: recebimentos menos despesas do proprietário</div></div>
    <div class="tools"><select id="finAno" class="search" style="width:auto" aria-label="Ano">${[...yrs].sort().map(y=>`<option ${y===Y?'selected':''}>${y}</option>`).join('')}</select></div></div>${bar}
  <div class="summary" style="margin-bottom:18px"><div><span class="lbl">Recebido em ${Y}</span><span class="val num pos">${fmt(T('rec'))}</span><span class="sub">Taxa de adm. ${fmt(T('tx'))}</span></div>
    <div><span class="lbl">Em atraso</span><span class="val num ${T('atr')?'neg':''}">${fmt(T('atr'))}</span><span class="sub">A receber no prazo ${fmt(T('pend'))}</span></div>
    <div><span class="lbl">Despesas em ${Y}</span><span class="val num neg">${fmt(T('desp'))}</span><span class="sub">Manutenção e despesas lançadas</span></div>
    <div><span class="lbl">Resultado</span><span class="val num ${T('res')>=0?'pos':'neg'}">${fmt(T('res'))}</span><span class="sub">Recebido − despesas</span></div></div>
  <div class="card"><div class="tbl-wrap"><table class="cmt"><thead><tr><th>Imóvel</th><th class="r">Recebido</th><th class="r">A receber</th><th class="r">Em atraso</th><th class="r">Despesas</th><th class="r">Resultado</th><th></th></tr></thead><tbody>
  ${data.map(r=>`<tr><td><div class="withthumb">${thumb(r.i.foto)}<div><b>${esc(MODS.imoveis.title(r.i))}</b><div class="meta">${B(r.i.status)}</div></div></div></td><td class="r num pos">${fmt(r.rec)}</td><td class="r num">${fmt(r.pend)}</td><td class="r num ${r.atr?'neg':''}">${fmt(r.atr)}${r.nAtr?` <span class="meta">(${r.nAtr})</span>`:''}</td><td class="r num neg">${fmt(r.desp)}</td><td class="r num ${r.res>=0?'pos':'neg'}"><b>${fmt(r.res)}</b></td><td class="act"><button class="btn sm" data-finsel="${esc(r.i.id)}">Mês a mês</button></td></tr>`).join('')}
  </tbody></table></div>${data.length?'':'<div class="empty">Cadastre imóveis para ver o resultado de cada um.</div>'}<div class="note">Despesas pagas pelo inquilino não entram no resultado. Recebimentos contam pelo mês de competência; despesas pela data.</div></div>${det}`;
}
function forecast(N){
  const ms=[...Array(N)].map((_,i)=>addComp(CUR,i));
  const fin=rows('financeiro'),ativos=rows('contratos').filter(c=>c.status==='Ativo').sort((a,b)=>nome('imoveis',a.imovel).localeCompare(nome('imoveis',b.imovel)));
  const cell=(c,m)=>{if(!c.inicio||m<c.inicio.slice(0,7)||(c.fim&&m>c.fim.slice(0,7)))return null;
    const l=fin.find(f=>f.contrato===c.id&&f.competencia===m);if(l)return {v:num(l.total),st:finStatus(l)};
    const i=get('imoveis',c.imovel)||{},pr=proxReaj(c),reaj=pr&&m>=pr.slice(0,7);
    return {v:(reaj?sugestao(c).v:num(c.aluguel))+num(i.condominio)+num(i.iptu),st:'Previsto',reaj}};
  const grid=ativos.map(c=>({c,cells:ms.map(m=>cell(c,m))}));
  const dr=despRows().filter(doDono);
  const dPrev=m=>sum(dr.filter(d=>compOf(d)===m||(m===CUR&&d.status!=='Pago'&&compOf(d)<CUR)),'valor');
  const tot=ms.map((m,j)=>{const r=grid.reduce((s,g)=>s+(g.cells[j]?(g.cells[j].st==='Pago'?0:g.cells[j].v):0),0),rp=grid.reduce((s,g)=>s+(g.cells[j]&&g.cells[j].st==='Pago'?g.cells[j].v:0),0),d=dPrev(m);return {m,r,rp,d}});
  return {ms,fin,grid,tot};
}
function renderPrev(bar){
  const N=12,{ms,fin,grid,tot}=forecast(N);
  const atrAnt=sum(fin.filter(f=>finStatus(f)==='Atrasado'&&f.competencia<CUR),'total');
  const W=720,H=220,pl=60,pr=10,pt=12,pb=26,cw=(W-pl-pr)/N;let mx=Math.max(1,...tot.map(t=>Math.max(t.r+t.rp,t.d)));
  const st=(x=>{const p=Math.pow(10,Math.floor(Math.log10(x)));const f=x/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p})(mx/4);mx=Math.ceil(mx/st)*st;
  const y=v=>pt+(mx-v)/mx*(H-pt-pb);let g='';
  for(let v=0;v<=mx+1e-6;v+=st)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${v>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':v}</text>`;
  tot.forEach((t,i)=>{const cx=pl+cw*i+cw/2,bw=Math.min(16,cw/3);const R=t.r+t.rp;
    g+=`<rect x="${cx-bw-1}" y="${y(R)}" width="${bw}" height="${y(0)-y(R)}" rx="2" fill="var(--pos)"><title>${fm(t.m)} · recebimentos ${fmt(R)}</title></rect><rect x="${cx+1}" y="${y(t.d)}" width="${bw}" height="${y(0)-y(t.d)}" rx="2" fill="var(--neg)"><title>${fm(t.m)} · despesas ${fmt(t.d)}</title></rect><text x="${cx}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted)">${fms(t.m)}</text>`});
  const sR=tot.reduce((s,t)=>s+t.r+t.rp,0),sD=tot.reduce((s,t)=>s+t.d,0);
  const cc=x=>!x?'<td class="r meta">—</td>':`<td class="r num ${x.st==='Pago'?'pos':x.st==='Atrasado'?'neg':'muted'}" title="${x.st}${x.reaj?' · com reajuste estimado':''}">${fmt(x.v)}${x.reaj?'*':''}</td>`;
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Financeiro</h1><div class="meta">Previsão dos próximos 12 meses pelos contratos ativos</div></div></div>${bar}
  <div class="summary" style="margin-bottom:18px"><div><span class="lbl">Recebimentos previstos</span><span class="val num pos">${fmt(sR)}</span><span class="sub">${fms(ms[0])} a ${fms(ms[N-1])}</span></div>
    <div><span class="lbl">Despesas previstas</span><span class="val num neg">${fmt(sD)}</span><span class="sub">Despesas cadastradas e manutenção</span></div>
    <div><span class="lbl">Resultado previsto</span><span class="val num ${sR-sD>=0?'pos':'neg'}">${fmt(sR-sD)}</span><span class="sub">Média ${fmt((sR-sD)/N)}/mês</span></div>
    <div><span class="lbl">Atrasados de meses anteriores</span><span class="val num ${atrAnt?'neg':''}">${fmt(atrAnt)}</span><span class="sub">Não entram na previsão</span></div></div>
  <div class="card" style="margin-bottom:18px"><div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recebimentos e despesas previstos por mês">${g}</svg></div>
    <div class="legend"><span><i style="background:var(--pos)"></i>Recebimentos</span><span><i style="background:var(--neg)"></i>Despesas</span></div></div>
  <div class="card"><div class="card-h"><h2>Recebimentos por imóvel</h2><span class="meta"><span class="pos">verde</span> recebido · <span class="neg">vermelho</span> em atraso · cinza previsto</span></div>
  <div class="tbl-wrap"><table class="cmt"><thead><tr><th>Imóvel</th>${ms.map(m=>`<th class="r">${fms(m)}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
  ${grid.map(g=>`<tr><td><b>${esc(nome('imoveis',g.c.imovel))}</b><div class="meta">${esc(nome('pessoas',g.c.inquilino))}</div></td>${g.cells.map(cc).join('')}<td class="r num"><b>${fmt(g.cells.reduce((s,x)=>s+(x?x.v:0),0))}</b></td></tr>`).join('')}
  <tr><td><b>Despesas previstas</b></td>${tot.map(t=>`<td class="r num neg">${t.d?fmt(t.d):'—'}</td>`).join('')}<td class="r num neg"><b>${fmt(sD)}</b></td></tr>
  <tr><td><b>Resultado</b></td>${tot.map(t=>{const v=t.r+t.rp-t.d;return `<td class="r num ${v>=0?'pos':'neg'}"><b>${fmt(v)}</b></td>`}).join('')}<td class="r num"><b>${fmt(sR-sD)}</b></td></tr>
  </tbody></table></div>${grid.length?'':'<div class="empty">Nenhum contrato ativo.</div>'}
  <div class="note">* inclui o reajuste anual estimado pelo índice em Configurações. Meses já lançados usam o valor lançado; os demais usam aluguel + condomínio + IPTU do imóvel. Todos os lançamentos anteriores continuam guardados em Recebimentos.</div></div>`;
}
function chartSVG(o){
  // o: {labels, bars:[{name,color,vals}], line:{name,color,vals}}, W,H
  const W=o.W||760,H=o.H||260,pl=66,pr=12,pt=16,pb=30,N=o.labels.length,cw=(W-pl-pr)/N;
  const all=[0,...o.bars.flatMap(b=>b.vals),...(o.line?o.line.vals:[])];let mx=Math.max(...all),mn=Math.min(...all);if(mx===mn)mx=mn+1;
  const nice=x=>{const p=Math.pow(10,Math.floor(Math.log10(x)));const f=x/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p};
  const st=nice((mx-mn)/4);mx=Math.ceil(mx/st)*st;mn=Math.floor(mn/st)*st;
  const y=v=>pt+(mx-v)/(mx-mn)*(H-pt-pb);const lab=v=>Math.abs(v)>=1000?(v/1000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' mil':v.toLocaleString('pt-BR');
  let g='';for(let v=mn;v<=mx+1e-6;v+=st)g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" ${Math.abs(v)<1e-9?'stroke-width="1.6"':''}/><text x="${pl-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${lab(v)}</text>`;
  const nb=o.bars.length,bw=Math.min(18,cw*.7/nb);
  o.labels.forEach((L,i)=>{const cx=pl+cw*i+cw/2;
    o.bars.forEach((b,k)=>{const v=b.vals[i],x=cx-(nb*bw)/2+k*bw+k,top=y(Math.max(v,0)),h=Math.abs(y(v)-y(0));
      g+=`<rect x="${x}" y="${top}" width="${bw-1}" height="${Math.max(h,v?1:0)}" rx="2" fill="${b.color}"><title>${esc(L)} · ${esc(b.name)}: ${fmt(v)}</title></rect>`});
    g+=`<text x="${cx}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(L)}</text>`});
  if(o.line){const pts=o.line.vals.map((v,i)=>[pl+cw*i+cw/2,y(v)]);
    g+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${o.line.color}" stroke-width="2.5" stroke-linejoin="round"/>`+
      pts.map((p,i)=>`<circle cx="${p[0]}" cy="${p[1]}" r="${i===pts.length-1?4.5:3.2}" fill="var(--surface)" stroke="${o.line.color}" stroke-width="2"><title>${esc(o.labels[i])} · ${esc(o.line.name)}: ${fmt(o.line.vals[i])}</title></circle>`).join('')}
  const leg=[...o.bars.map(b=>`<span><i style="background:${b.color}"></i>${esc(b.name)}</span>`),o.line?`<span><i style="background:${o.line.color};height:3px"></i>${esc(o.line.name)}</span>`:''].join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria||'Gráfico')}">${g}</svg></div><div class="legend">${leg}</div>`;
}
const W_DEF=['k_recebido','k_areceber','k_atraso','k_despesas','k_resultado','k_ocupacao','k_contratos','k_prev12','g_prev','g_real','p_reajustes','p_atraso','p_terminando','p_manut','g_lucro','p_estoque'];
const WIDGETS=[
 {id:'k_pessoas',g:'Pessoas',l:'Total de pessoas (locadores, inquilinos, fiadores)',k:1,f:()=>{const p=rows('pessoas'),n=t=>p.filter(x=>x.tipo===t).length;return ['Pessoas',p.length,`${n('Locador')} locadores · ${n('Locatário')} locatários · ${n('Inquilino')} inquilinos · ${n('Fiador')} fiadores`]}},
 {id:'p_inquilinos',g:'Pessoas',l:'Lista de inquilinos com contato',f:()=>{const ids=new Set(rows('contratos').filter(c=>c.status==='Ativo').map(c=>c.inquilino));const l=rows('pessoas').filter(p=>ids.has(p.id)).sort(MODS.pessoas.sort);
   return ['Inquilinos ativos',l.length,LI(l,p=>`<li><div><b>${esc(p.nome)}</b><div class="meta">${esc(p.telefone||'')}${p.email?' · '+esc(p.email):''}</div></div><span class="meta">${esc(p.profissao||'')}</span></li>`,'Nenhum inquilino com contrato ativo.')]}},
 {id:'k_imoveis',g:'Imóveis',l:'Total de imóveis',k:1,f:()=>{const im=rows('imoveis');return ['Imóveis',im.length,`${im.filter(i=>i.status==='Alugado').length} alugados · ${im.filter(i=>i.status==='Disponível').length} disponíveis`]}},
 {id:'k_ocupacao',g:'Imóveis',l:'Taxa de ocupação',k:1,f:()=>{const im=rows('imoveis'),a=im.filter(i=>i.status==='Alugado').length;return ['Ocupação',(im.length?Math.round(a/im.length*100):0)+'%',`${a} de ${im.length} imóveis alugados`]}},
 {id:'p_disponiveis',g:'Imóveis',l:'Imóveis disponíveis para alugar',f:()=>{const l=rows('imoveis').filter(i=>i.status!=='Alugado');return ['Imóveis disponíveis',l.length,LI(l,i=>`<li><div class="withthumb">${thumb(i.foto)}<div><b>${esc(MODS.imoveis.title(i))}</b><div class="meta">${esc(i.status)} · ${esc(i.bairro||'')}</div></div></div><span class="num">${fmt(i.aluguel)}</span></li>`,'Todos os imóveis estão alugados.')]}},
 {id:'k_contratos',g:'Contratos',l:'Contratos ativos e vencendo',k:1,f:()=>{const a=rows('contratos').filter(c=>c.status==='Ativo');return ['Contratos ativos',a.length,`${a.filter(c=>c.fim&&days(c.fim)<=90).length} terminam em até 90 dias`]}},
 {id:'p_reajustes',g:'Contratos',l:'Reajustes anuais chegando',f:()=>{const jan=Math.max(60,num(C.config.alertaDias));const r=rows('contratos').filter(c=>c.status==='Ativo').map(c=>({c,d:proxReaj(c)})).filter(x=>x.d&&days(x.d)<=jan).sort((a,b)=>a.d.localeCompare(b.d));
   return ['Reajustes anuais',`próximos ${jan} dias`,LI(r,x=>{const s=sugestao(x.c);return `<li><div><b>${esc(nome('pessoas',x.c.inquilino))}</b><div class="meta">${esc(nome('imoveis',x.c.imovel))} · ${fd(x.d)} ${prazoBadge(days(x.d))||bdg('em '+days(x.d)+' d','info')}</div><div class="meta">${fmt(x.c.aluguel)} → <b class="num">${fmt(s.v)}</b> (${esc(x.c.indice||'IGP-M')} ${pct(s.p)})</div></div><button class="btn" data-reaj="${esc(x.c.id)}">Aplicar</button></li>`},'Nenhum reajuste nos próximos '+jan+' dias.')]}},
 {id:'p_terminando',g:'Contratos',l:'Contratos terminando (30/60/90 dias)',f:()=>{const l=rows('contratos').filter(c=>c.status==='Ativo'&&c.fim&&days(c.fim)<=90).sort((a,b)=>a.fim.localeCompare(b.fim));
   const n30=l.filter(c=>days(c.fim)<=30).length,n60=l.filter(c=>days(c.fim)>30&&days(c.fim)<=60).length;
   return ['Contratos terminando','',`<div class="trio"><div><b class="num ${n30?'neg':''}">${n30}</b><span>até 30 dias</span></div><div><b class="num">${n60}</b><span>31 a 60</span></div><div><b class="num">${l.length-n30-n60}</b><span>61 a 90</span></div></div>`+LI(l,c=>`<li><div><b>${esc(nome('pessoas',c.inquilino))}</b><div class="meta">${esc(nome('imoveis',c.imovel))}</div></div><span>${fd(c.fim)} ${bdg(days(c.fim)<0?'vencido':days(c.fim)+' d',days(c.fim)<=30?'bad':'warn')}</span></li>`,'Nenhum contrato termina nos próximos 90 dias.')]}},
 {id:'k_vistorias',g:'Vistorias',l:'Vistorias do ano e assinaturas pendentes',k:1,f:()=>{const v=rows('vistorias');return ['Vistorias em '+CUR.slice(0,4),v.filter(x=>(x.data||'').startsWith(CUR.slice(0,4))).length,`${v.filter(x=>x.assLocador!=='Sim'||x.assInquilino!=='Sim').length} com assinatura pendente`]}},
 {id:'p_vistorias',g:'Vistorias',l:'Últimas vistorias',f:()=>{const l=rows('vistorias').sort(MODS.vistorias.sort).slice(0,5);return ['Últimas vistorias','',LI(l,v=>{const m=Array.isArray(v.midia)?v.midia.length:0;return `<li><div><b>${esc(nome('imoveis',v.imovel))}</b><div class="meta">${fd(v.data)} · ${esc(MODS.vistorias.prep({...v}).tipo)}</div></div>${m?`<button class="btn sm" data-gal="${esc(v.id)}">${ICON.cam} ${m}</button>`:B(v.estado)}</li>`},'Nenhuma vistoria cadastrada.')]}},
 {id:'k_recebido',g:'Financeiro',l:'Recebido no mês',k:1,f:()=>{const m=rows('financeiro').filter(f=>f.competencia===CUR);return ['Recebido em '+fm(CUR),`<span class="pos">${fmt(sum(m.filter(f=>f.status==='Pago'),'total'))}</span>`,`de ${fmt(sum(m,'total'))} previstos`]}},
 {id:'k_areceber',g:'Financeiro',l:'A receber no mês',k:1,f:()=>{const m=rows('financeiro').filter(f=>f.competencia===CUR&&finStatus(f)==='Pendente');return ['A receber no mês',fmt(sum(m,'total')),`${m.length} dentro do prazo`]}},
 {id:'k_atraso',g:'Financeiro',l:'Aluguéis em atraso (valor)',k:1,f:()=>{const a=rows('financeiro').filter(f=>finStatus(f)==='Atrasado');return ['Em atraso',`<span class="${a.length?'neg':''}">${fmt(sum(a,'total'))}</span>`,`${a.length} ${a.length===1?'aluguel':'aluguéis'}`]}},
 {id:'k_despesas',g:'Financeiro',l:'Despesas do mês',k:1,f:()=>['Despesas do mês',`<span class="neg">${fmt(sum(despRows().filter(d=>doDono(d)&&compOf(d)===CUR),'valor'))}</span>`,'Contas e manutenção dos imóveis']},
 {id:'k_resultado',g:'Financeiro',l:'Resultado do mês (recebido − despesas)',k:1,f:()=>{const r=sum(rows('financeiro').filter(f=>f.competencia===CUR&&f.status==='Pago'),'total')-sum(despRows().filter(d=>doDono(d)&&compOf(d)===CUR),'valor');return ['Resultado do mês',`<span class="${r>=0?'pos':'neg'}">${fmt(r)}</span>`,'Recebido − despesas']}},
 {id:'k_taxa',g:'Financeiro',l:'Taxa de administração do mês',k:1,f:()=>['Taxa de administração',fmt(sum(rows('financeiro').filter(f=>f.competencia===CUR),'taxaAdm')),`${pct(C.config.taxaAdm)} dos aluguéis do mês`]},
 {id:'k_prev12',g:'Financeiro',l:'Lucro previsto em 12 meses',k:1,f:()=>{const {tot}=forecast(12),r=tot.reduce((s,t)=>s+t.r+t.rp-t.d,0);return ['Lucro previsto · 12 meses',`<span class="${r>=0?'pos':'neg'}">${fmt(r)}</span>`,`${fms(tot[0].m)} a ${fms(tot[11].m)}`]}},
 {id:'g_prev',g:'Financeiro',l:'Gráfico: previsão de recebimentos, despesas e lucro (12 meses)',wide:1,f:()=>{const {tot}=forecast(12);const R=tot.map(t=>t.r+t.rp),D=tot.map(t=>t.d),L=tot.map((t,i)=>R[i]-D[i]);
   return ['Previsão mês a mês · recebimentos × despesas',`lucro previsto ${fmt(L.reduce((a,b)=>a+b,0))}`,chartSVG({labels:tot.map(t=>fms(t.m)),bars:[{name:'Recebimentos previstos',color:'var(--pos)',vals:R},{name:'Despesas previstas',color:'var(--neg)',vals:D}],line:{name:'Lucro',color:'var(--accent)',vals:L},aria:'Previsão de recebimentos, despesas e lucro nos próximos 12 meses'})+
   `<div class="tbl-wrap"><table class="cmt mini"><thead><tr><th></th>${tot.map(t=>`<th class="r">${fms(t.m)}</th>`).join('')}</tr></thead><tbody><tr><td>Recebimentos</td>${R.map(v=>`<td class="r num pos">${fmt(v)}</td>`).join('')}</tr><tr><td>Despesas</td>${D.map(v=>`<td class="r num neg">${fmt(v)}</td>`).join('')}</tr><tr><td><b>Lucro</b></td>${L.map(v=>`<td class="r num ${v>=0?'pos':'neg'}"><b>${fmt(v)}</b></td>`).join('')}</tr></tbody></table></div>
   <div class="note">Recebimentos pelos contratos ativos (com reajuste estimado); despesas pelas contas cadastradas e custos de manutenção. Despesas pagas pelo inquilino não entram.</div>`]}},
 {id:'g_real',g:'Financeiro',l:'Gráfico: recebido × gastos dos últimos 6 meses',wide:1,f:()=>{const ms=[];for(let i=5;i>=0;i--)ms.push(addComp(CUR,-i));const fin=rows('financeiro'),dr=despRows().filter(doDono);
   const R=ms.map(m=>sum(fin.filter(f=>f.competencia===m&&f.status==='Pago'),'total')),D=ms.map(m=>sum(dr.filter(d=>compOf(d)===m),'valor'));
   return ['Realizado · últimos 6 meses','recebido × gastos',chartSVG({labels:ms.map(fms),bars:[{name:'Recebido',color:'var(--pos)',vals:R},{name:'Gastos',color:'var(--neg)',vals:D}],line:{name:'Resultado',color:'var(--accent)',vals:R.map((v,i)=>v-D[i])},aria:'Recebido e gastos nos últimos 6 meses'})]}},
 {id:'p_atraso',g:'Financeiro',l:'Lista de aluguéis em atraso',f:()=>{const a=rows('financeiro').filter(f=>finStatus(f)==='Atrasado').sort((x,y)=>(x.vencimento||'').localeCompare(y.vencimento||''));
   return ['Aluguéis em atraso',a.length,LI(a,f=>`<li><div><b>${esc(nome('pessoas',f.inquilino))}</b><div class="meta">${esc(nome('imoveis',f.imovel))} · ${fm(f.competencia)} · venceu ${fd(f.vencimento)} ${bdg(-days(f.vencimento)+' d','bad')}</div></div><div style="display:flex;align-items:center;gap:8px"><span class="num neg">${fmt(f.total)}</span><button class="btn" data-pagar="${esc(f.id)}">Receber</button></div></li>`,'Nenhum aluguel em atraso.')]}},
 {id:'p_apagar',g:'Financeiro',l:'Contas a pagar dos imóveis',f:()=>{const l=despRows().filter(d=>doDono(d)&&d.status!=='Pago'&&compOf(d)<=addComp(CUR,1)).sort((a,b)=>(a.data||'').localeCompare(b.data||''));
   return ['Contas a pagar',fmt(sum(l,'valor')),LI(l.slice(0,8),d=>`<li><div><b>${esc(d.descricao)}</b><div class="meta">${esc(nome('imoveis',d.imovel))} · ${fd(d.data)}${d._src?' · manutenção':''}</div></div><span class="num neg">${fmt(d.valor)}</span></li>`,'Nenhuma conta a pagar.')]}},
 {id:'g_lucro',g:'Financeiro',l:'Gráfico: lucro por imóvel no ano',f:()=>{const Y=CUR.slice(0,4),d=porImovel(Y).filter(r=>r.rec||r.desp);const mx=Math.max(1,...d.map(r=>Math.abs(r.res)));
   return ['Lucro por imóvel · '+Y,'',d.length?`<div class="cat">${d.map(r=>`<div class="cat-row"><span class="clamp" style="max-width:160px">${esc(MODS.imoveis.title(r.i))}</span><div class="bar"><i style="width:${(Math.abs(r.res)/mx*100).toFixed(1)}%;background:var(${r.res>=0?'--pos':'--neg'})"></i></div><span class="num ${r.res>=0?'pos':'neg'}">${fmt(r.res)}</span></div>`).join('')}</div>`:'<div class="empty">Sem movimento no ano.</div>']}},
 {id:'k_manut',g:'Manutenção',l:'Chamados em aberto e custo',k:1,f:()=>{const a=rows('manutencao').filter(m=>m.status!=='Concluído');return ['Manutenção em aberto',a.length,`custo previsto ${fmt(sum(a,'custo'))}`]}},
 {id:'p_manut',g:'Manutenção',l:'Lista de chamados em aberto',f:()=>{const a=rows('manutencao').filter(m=>m.status!=='Concluído').sort(MODS.manutencao.sort);
   return ['Manutenção em aberto',a.length,LI(a.slice(0,6),m=>`<li><div><b>${esc(m.descricao)}</b><div class="meta">${esc(nome('imoveis',m.imovel))} · ${esc(catsOf(m).join(', '))} · aberto ${fd(m.abertura)} · ${esc(m.status)}${num(m.custo)?' · '+fmt(m.custo)+' ('+esc(m.pagoPor||'')+')':''}</div></div>${B(m.prioridade)}</li>`,'Nenhum chamado em aberto.')]}},
 {id:'k_estoque',g:'Estoque de materiais',l:'Valor em estoque e itens baixos',k:1,f:()=>{const e=rows('estoque');return ['Estoque',fmt(e.reduce((s,x)=>s+num(x.quantidade)*num(x.custoUnit),0)),`${e.length} itens · ${e.filter(x=>num(x.quantidade)<=num(x.minimo)).length} abaixo do mínimo`]}},
 {id:'p_estoque',g:'Estoque de materiais',l:'Lista de materiais com estoque baixo',f:()=>{const b=rows('estoque').filter(e=>num(e.quantidade)<=num(e.minimo));
   return ['Estoque baixo',b.length,LI(b,e=>`<li><b>${esc(e.item)}</b><span class="num neg">${num(e.quantidade).toLocaleString('pt-BR')} ${esc(e.unidade||'')} <span class="meta">(mín. ${num(e.minimo)})</span></span></li>`,'Nenhum material abaixo do mínimo.')]}}
];
const LI=(a,f,empty)=>a.length?`<ul class="plist">${a.map(f).join('')}</ul>`:`<div class="empty">${empty}</div>`;
const painelSel=()=>Array.isArray(C.config.painel)?C.config.painel:W_DEF;
function renderPainel(){
  const on=new Set(painelSel()),ws=WIDGETS.filter(w=>on.has(w.id));
  const ks=ws.filter(w=>w.k),charts=ws.filter(w=>w.wide),pans=ws.filter(w=>!w.k&&!w.wide);
  const kHtml=ks.length?`<div class="summary k6">${ks.map(w=>{const [l,v,s]=w.f();return `<div><span class="lbl">${esc(l)}</span><span class="val num">${v}</span><span class="sub">${s}</span></div>`}).join('')}</div>`:'';
  const card=(w,full)=>{const [t,m,body]=w.f();return `<div class="card${full?' full':''}"><div class="card-h"><h2>${esc(t)}</h2><span class="meta">${m===''?'':esc(String(m))}</span></div>${body}</div>`};
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Painel</h1><div class="meta">${esc(C.config.empresa||'Gestão de aluguéis')} · ${fd(TODAY)}</div></div><div class="tools"><button class="btn" data-personalizar>Escolher o que aparece</button></div></div>
  ${ws.length?'':`<div class="card"><div class="empty">Nada marcado para aparecer. Clique em “Escolher o que aparece”.</div></div>`}
  ${kHtml}<div class="panels">${charts.map(w=>card(w,1)).join('')}${pans.map(w=>card(w)).join('')}</div>`;
}
const CFGF=[{k:'empresa',l:'Nome da administradora',t:'text',full:1},{k:'taxaAdm',l:'Taxa de administração (% do aluguel)',t:'num'},{k:'alertaDias',l:'Avisar reajuste com quantos dias',t:'num'},
  {k:'multa',l:'Multa por atraso (%)',t:'num'},{k:'jurosMes',l:'Juros de mora (% ao mês)',t:'num'},
  {k:'igpm',l:'IGP-M acumulado 12 meses (%)',t:'num'},{k:'ipca',l:'IPCA acumulado 12 meses (%)',t:'num'},{k:'inpc',l:'INPC acumulado 12 meses (%)',t:'num'}];
function renderConfig(){
  C.mDraft=C.mDraft||{};const mt=C.mTab||0;const md=i=>C.mDraft[i]||mdl(i);
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Configurações</h1><div class="meta">Parâmetros usados nos cálculos e no contrato</div></div></div>
  <div class="card"><form id="cfgf" novalidate style="padding:16px"><div class="fgrid">${CFGF.map(f=>fieldHtml(f,C.config[f.k],'cfg-')).join('')}</div>
  <div class="meta" id="cfgerr" style="color:var(--neg);margin-top:10px"></div><div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn primary" type="submit">Salvar configurações</button></div></form>
  <div class="note">Os índices mudam todo mês. Confira o acumulado dos últimos 12 meses (FGV para IGP-M, IBGE para IPCA e INPC) e atualize aqui — a sugestão de reajuste usa esses números.</div></div>
  <div class="card" style="margin-top:18px" id="cfgPainel"><div class="card-h"><h2>Tela principal (Painel)</h2><div class="tools"><button class="btn sm" id="pnAll">Marcar tudo</button><button class="btn sm" id="pnDef">Padrão</button></div></div>
  <div style="padding:16px;display:grid;gap:14px"><div class="meta">Marque o que você quer ver no Painel. Números aparecem no topo; listas e gráficos, abaixo.</div>
  <div class="pgroups">${[...new Set(WIDGETS.map(w=>w.g))].map(g=>`<fieldset class="pgroup"><legend>${esc(g)}</legend>${WIDGETS.filter(w=>w.g===g).map(w=>`<label class="chk-l"><input type="checkbox" id="pn-${w.id}" data-pn="${w.id}" ${painelSel().includes(w.id)?'checked':''}> <span>${esc(w.l)} <small class="meta">${w.k?'número':w.wide?'gráfico':w.id.startsWith('g_')?'gráfico':'lista'}</small></span></label>`).join('')}</fieldset>`).join('')}</div>
  <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn primary" id="pnSave">Salvar e ver o Painel</button></div></div></div>
  <div class="card" style="margin-top:18px"><div class="card-h"><h2>Mensagem de cadastro (Nova pessoa)</h2><button class="btn sm" id="cfgMsgEdit">Editar texto</button></div><div style="padding:16px"><div class="msgprev">${esc(C.config.msgCadastro||MSG_DEF)}</div></div></div>
  <div class="card" style="margin-top:18px" id="cfgModelo"><div class="card-h"><h2>Contratos modelo</h2><span class="meta">3 modelos</span></div>
  <div style="padding:16px;display:grid;gap:12px">
  <div class="subtabs" role="tablist" aria-label="Modelos">${[0,1,2].map(i=>`<button type="button" role="tab" data-mtab="${i}" aria-selected="${i===mt}">Modelo ${i+1} · ${esc(md(i).nome)}</button>`).join('')}</div>
  <div class="meta">Ao gerar um contrato você escolhe qual modelo usar. Os campos entre chaves são trocados pelos dados de Pessoas, Imóveis e do contrato. Trechos entre {{#fiador}} e {{/fiador}} só aparecem quando há fiador; entre {{#caucao}} e {{/caucao}}, quando há caução.</div>
  <div class="field" style="max-width:360px"><label for="mdNome">Nome do modelo ${mt+1}</label><input id="mdNome" value="${esc(md(mt).nome)}" placeholder="Ex.: Comercial"></div>
  <textarea id="mdTxt" class="mdtxt" aria-label="Texto do modelo ${mt+1}">${esc(md(mt).texto)}</textarea>
  <details><summary class="meta" style="cursor:pointer">Campos disponíveis</summary><div class="chips">${CAMPOS.map(([k,l])=>`<button type="button" class="chip" data-ins="{{${k}}}" title="Inserir no texto">{{${esc(k)}}} <span>${esc(l)}</span></button>`).join('')}</div></details>
  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px"><button class="btn" id="mdReset">Restaurar texto padrão deste modelo</button><button class="btn primary" id="mdSave">Salvar modelo ${mt+1}</button></div>
  <div class="meta">Os modelos padrão (residencial, comercial e temporada) são bases gerais conforme a Lei do Inquilinato. Vale revisar com um advogado antes de usar.</div></div></div>`;
  $('#cfgf').addEventListener('submit',async e=>{e.preventDefault();const o=readFields($('#cfgf'),CFGF,'cfg-');const err=checkFields(o,CFGF);if(err){$('#cfgerr').textContent=err;return}await put('config','geral',{...C.config,...o});toast('Configurações salvas.')});
  const pnSet=ids=>$('#cmMain').querySelectorAll('[data-pn]').forEach(b=>b.checked=ids.includes(b.dataset.pn));
  $('#pnAll').onclick=()=>pnSet(WIDGETS.map(w=>w.id));$('#pnDef').onclick=()=>pnSet(W_DEF);
  $('#pnSave').onclick=async()=>{const ids=[...$('#cmMain').querySelectorAll('[data-pn]:checked')].map(b=>b.dataset.pn);await put('config','geral',{...C.config,painel:ids});C.mod='painel';try{localStorage.setItem(LSK+'-mod','painel')}catch(e){};document.activeElement&&document.activeElement.blur&&document.activeElement.blur();render();window.scrollTo(0,0);toast('Painel atualizado.')};
  if(C._scrollPn){C._scrollPn=0;setTimeout(()=>{const e=$('#cfgPainel');e&&e.scrollIntoView({block:'start'})},0)}
  const keep=()=>{C.mDraft[mt]={nome:$('#mdNome').value,texto:$('#mdTxt').value}};
  $('#cmMain').querySelectorAll('[data-mtab]').forEach(b=>b.onclick=()=>{keep();C.mTab=+b.dataset.mtab;renderConfig();const e=$('#cfgModelo');e&&e.scrollIntoView({block:'start'})});
  const saveMs=async (i,nomeV,texto)=>{const ms=[0,1,2].map(j=>{const st=(C.config.modelos||[])[j]||{};return {nome:st.nome||'',texto:st.texto||(j===0?C.config.modelo||'':'')}});
    ms[i]={nome:nomeV.trim()===MODELOS_DEF[i].nome?'':nomeV.trim(),texto:texto.trim()===MODELOS_DEF[i].texto.trim()?'':texto};delete C.mDraft[i];
    await put('config','geral',{...C.config,modelos:ms,modelo:''});renderConfig();const e=$('#cfgModelo');e&&e.scrollIntoView({block:'start'})};
  $('#mdSave').onclick=async()=>{await saveMs(mt,$('#mdNome').value,$('#mdTxt').value);toast('Modelo '+(mt+1)+' salvo.')};
  $('#mdReset').onclick=async()=>{const ok=await choose('Restaurar o texto padrão do modelo '+(mt+1)+'?','O texto que você alterou neste modelo será substituído.',[{label:'Restaurar',value:1,danger:true}]);if(!ok)return;await saveMs(mt,$('#mdNome').value,MODELOS_DEF[mt].texto);toast('Texto padrão restaurado.')};
  $('#cmMain').querySelectorAll('[data-ins]').forEach(b=>b.onclick=()=>{const ta=$('#mdTxt'),s=ta.selectionStart,e=ta.selectionEnd;ta.value=ta.value.slice(0,s)+b.dataset.ins+ta.value.slice(e);ta.focus();ta.selectionStart=ta.selectionEnd=s+b.dataset.ins.length});
}
function render(){
  if(!C.ready)return;
  if(C._shown==='config'&&C.mod==='config'&&document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#cmMain'))return;
  C._shown=C.mod;
  const cnt={financeiro:rows('financeiro').filter(f=>finStatus(f)==='Atrasado').length,manutencao:rows('manutencao').filter(m=>m.status!=='Concluído').length,estoque:rows('estoque').filter(e=>num(e.quantidade)<=num(e.minimo)).length};
  $('#cmSide').innerHTML=NAV.map(([k,l])=>{const lab=l||MODS[k].nome;let extra='';if(k==='novapessoa'){const n=rows('precad').length;if(n)extra=`<span class="count warnc">${n}</span>`}
    if(MODS[k]){const alert=cnt[k];extra=alert?`<span class="count bad">${alert}</span>`:k==='financeiro'?'':`<span class="count">${rows(k).length}</span>`}
    return `<button data-mod="${k}" aria-current="${C.mod===k}">${esc(lab)}${extra}</button>`}).join('');
  $('#cmBanner').hidden=!COLS.some(c=>rows(c).some(r=>r.exemplo));
  if(C.mod==='painel')renderPainel();else if(C.mod==='config')renderConfig();else if(C.mod==='financeiro')renderFin();else if(C.mod==='novapessoa')renderNovaPessoa();else if(C.mod==='relatorios')renderRelatorios();else if(MODS[C.mod])renderList(C.mod);else{C.mod='painel';renderPainel()}
  $('#cmStatus').textContent=C.db?'Salvo automaticamente na nuvem.':'Salvo apenas neste navegador.';
}

/* ---------- app switch + events ---------- */
let APP='cm';try{APP=localStorage.getItem('app-atual')||'cm'}catch(e){}
function showApp(){$('#app-cm').hidden=APP!=='cm';$('#app-caixa').hidden=APP!=='caixa';document.querySelectorAll('[data-app]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.app===APP)))}
document.querySelectorAll('[data-app]').forEach(b=>b.onclick=()=>{APP=b.dataset.app;try{localStorage.setItem('app-atual',APP)}catch(e){};showApp();window.scrollTo(0,0)});
showApp();
$('#app-cm').addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t||t.closest('.overlay'))return;
  if(t.dataset.mod){C.mod=t.dataset.mod;C.q='';try{localStorage.setItem(LSK+'-mod',C.mod)}catch(e){};render();return}
  if(t.dataset.fintab){C.finTab=t.dataset.fintab;C.q='';try{localStorage.setItem(LSK+'-fin',C.finTab)}catch(e){};render();return}
  if(t.dataset.finsel!=null){C.finSel=t.dataset.finsel;render();return}
  if(t.dataset.new){if(t.dataset.im){const pv=C.finIm;C.finIm=t.dataset.im;openForm(t.dataset.new);C.finIm=pv}else openForm(t.dataset.new);return}
  if(t.dataset.edit){const col=t.dataset.col||C.mod,r=get(col,t.dataset.edit);if(r)openForm(col,r);return}
  if(t.hasAttribute('data-personalizar')){C.mod='config';C._scrollPn=1;render();return}
  if(t.dataset.dpago){const [id,k]=t.dataset.dpago.split('|'),raw={...C.data.despesas[id]};if(!raw)return;const pg={...(raw.pagos||{})};if(pg[k])delete pg[k];else pg[k]=true;put('despesas',id,{...raw,pagos:pg});toast(pg[k]?'Marcada como paga.':'Marcada como a pagar.');return}
  if(t.dataset.rel){relClick(t);return}
  if(t.dataset.xlista){gerarRel('lista',t.dataset.xlista);return}
  if(t.dataset.verdocs){verDocs(t.dataset.verdocs);return}
  if(t.id==='npCopy'){const tx=$('#npMsg').value;navigator.clipboard.writeText(tx).then(()=>toast('Mensagem copiada. Cole no WhatsApp da pessoa.'),()=>{const a=$('#npMsg');a.focus();a.select();toast('Texto selecionado. Use Ctrl+C / Cmd+C.')});return}
  if(t.id==='npEdit'||t.id==='cfgMsgEdit'){editarMsg();return}
  if(t.id==='npFill'||t.id==='npDirect'){const r=$('#npResp').value;C.npResp=r;const o=parseResposta(r);const n=Object.keys(o).length;if(!n){toast('Não encontrei respostas no texto. Cole a mensagem com “Nome completo: …”, “CPF: …”.');return}
    C.npTipo=$('#npTipo').value;const im=get('imoveis',C.npIm);const ex=o._extra;delete o._extra;const obs=[im?'Interessado no imóvel '+MODS.imoveis.title(im)+' ('+fd(TODAY)+')':'',ex||''].filter(Boolean).join('\n\n');
    const pre={...o,tipo:C.npTipo,obs:obs||undefined};
    if(t.id==='npDirect'){openForm('pessoas',null,pre);toast(n+' campos preenchidos. Confira e anexe as fotos.');return}
    const id=uid();await put('precad',id,{...pre,recebidoEm:TODAY,interesse:C.npIm||undefined});C.npResp='';render();toast('Salvo no pré-cadastro. Anexe as fotos e transfira quando quiser.');const e=$('#pcList');e&&e.scrollIntoView({block:'start'});return}
  if(t.dataset.pctrans){transferirPc(t.dataset.pctrans);return}
  if(t.dataset.reaj){reajuste(t.dataset.reaj);return}
  if(t.dataset.docc){gerarDoc(t.dataset.docc);return}
  if(t.dataset.printv){const w=abrirJanelaImpressao();imprimirVistoria(t.dataset.printv,w);return}
  if(t.dataset.galm){galeriaManut(t.dataset.galm);return}
  if(t.dataset.gal){gallery(t.dataset.gal);return}
  if(t.dataset.pagar){pagar(t.dataset.pagar);return}
  if(t.hasAttribute('data-gerar')){gerar();return}
  if(t.dataset.inc){mexer(t.dataset.inc,1);return}
  if(t.dataset.dec){mexer(t.dataset.dec,-1);return}
});
$('#app-cm').addEventListener('input',e=>{if(e.target.id==='npTel'){C.npTel=e.target.value;const tel=C.npTel.replace(/\D/g,''),a=$('#npWa');if(a)a.href='https://wa.me/'+(tel?(tel.length<=11?'55'+tel:tel):'')+'?text='+encodeURIComponent($('#npMsg').value);return}
  if(e.target.id==='npMsg'){const tel=(C.npTel||'').replace(/\D/g,''),a=$('#npWa');if(a)a.href='https://wa.me/'+(tel?(tel.length<=11?'55'+tel:tel):'')+'?text='+encodeURIComponent(e.target.value);return}
  if(e.target.id==='npResp'){C.npResp=e.target.value;return}
  if(e.target.id==='cmq'){C.q=e.target.value;const pos=e.target.selectionStart;render();const s=$('#cmq');if(s){s.focus();try{s.setSelectionRange(pos,pos)}catch(x){}}}});
$('#app-cm').addEventListener('change',e=>{const id=e.target.id;if(id==='finMes'){C.finMes=e.target.value;render()}else if(id==='finIm'){C.finIm=e.target.value;render()}else if(id==='finAno'){C.finAno=e.target.value;render()}else if(e.target.dataset&&e.target.dataset.pcdest){const pid=e.target.dataset.pcdest,raw=C.data.precad[pid];if(raw)put('precad',pid,{...raw,destino:e.target.value})}else if(e.target.dataset&&e.target.dataset.pctipo){const pid=e.target.dataset.pctipo,raw=C.data.precad[pid];if(raw)put('precad',pid,{...raw,tipo:e.target.value})}else if(id==='npIm'){C.npIm=e.target.value;render()}else if(id==='npTipo'){C.npTipo=e.target.value}else if(id==='mnCat'){C.mnCat=e.target.value;render()}else if(id==='mnSt'){C.mnSt=e.target.value;render()}});
$('#cmClear').onclick=async()=>{
  const ok=await choose('Apagar os cadastros de exemplo?','Os cadastros que você fez não são afetados.',[{label:'Apagar exemplos',value:1,danger:true}]);if(!ok)return;
  for(const c of COLS)for(const r of rows(c))if(r.exemplo)await del(c,r.id);toast('Exemplos apagados.');
};

/* ---------- planilhas (Excel) ---------- */
const XL_URL='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
let xlP=null;
function loadXL(){if(window.ExcelJS)return Promise.resolve(window.ExcelJS);return xlP||(xlP=new Promise((res,rej)=>{const s=document.createElement('script');s.src=XL_URL;s.onload=()=>res(window.ExcelJS);s.onerror=()=>{xlP=null;rej(new Error('lib'))};document.head.appendChild(s)}))}
const XD=s=>{if(!s)return null;const [y,m,d]=String(s).split('-').map(Number);return new Date(Date.UTC(y,(m||1)-1,d||1))};
const FMT={money:'"R$" #,##0.00;[Red]-"R$" #,##0.00',date:'dd/mm/yyyy',num:'#,##0.##',pct:'0.0%',month:'mmm/yyyy'};
const PETROL='FF1F5F6B',PSOFT='FFDCEBEC',ZEBRA='FFF4F6F3';
function xlSheet(wb,name,title,sub,cols,data,opt={}){
  const ws=wb.addWorksheet(name.slice(0,31).replace(/[\\/?*[\]:]/g,'-'),{views:[{state:'frozen',ySplit:4}],properties:{defaultRowHeight:18}});
  ws.columns=cols.map(c=>({key:c.k,width:c.w||(c.t==='money'?16:c.t==='date'?13:18)}));
  ws.mergeCells(1,1,1,Math.max(2,cols.length));const t=ws.getCell(1,1);t.value=title;t.font={bold:true,size:14,color:{argb:PETROL}};ws.getRow(1).height=24;
  ws.mergeCells(2,1,2,Math.max(2,cols.length));const s=ws.getCell(2,1);s.value=sub;s.font={size:10,color:{argb:'FF5F6F72'}};
  const h=ws.getRow(4);cols.forEach((c,i)=>{const cell=h.getCell(i+1);cell.value=c.h;cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:PETROL}};cell.alignment={vertical:'middle',horizontal:c.t==='money'||c.t==='num'||c.t==='pct'?'right':'left',wrapText:true}});h.height=22;
  data.forEach((r,ri)=>{const row=ws.getRow(5+ri);cols.forEach((c,i)=>{const cell=row.getCell(i+1);let v=r[c.k];if(c.t==='date'||c.t==='month')v=v?XD(c.t==='month'?v+'-01':v):null;else if(c.t==='money'||c.t==='num')v=v===''||v==null?null:Number(v)||0;else if(c.t==='pct')v=v==null?null:Number(v);cell.value=v;if(FMT[c.t])cell.numFmt=FMT[c.t];if(ri%2)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:ZEBRA}};cell.alignment={vertical:'top',wrapText:c.t==='text'||!c.t}});
    if(r._bold)row.font={bold:true};if(r._cor)row.getCell(r._corCol||cols.length).font={color:{argb:r._cor},bold:true}});
  const last=4+data.length;
  if(data.length)ws.autoFilter={from:{row:4,column:1},to:{row:last,column:cols.length}};
  if(opt.total!==false&&data.length&&cols.some(c=>c.t==='money'&&c.sum!==false)){const tr=ws.getRow(last+1);tr.getCell(1).value='TOTAL';cols.forEach((c,i)=>{const cell=tr.getCell(i+1);if(c.t==='money'&&c.sum!==false){const L=ws.getColumn(i+1).letter;cell.value={formula:`SUBTOTAL(9,${L}5:${L}${last})`};cell.numFmt=FMT.money}cell.font={bold:true};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:PSOFT}};cell.border={top:{style:'thin',color:{argb:PETROL}}}})}
  if(!data.length){ws.getCell(5,1).value='Sem registros para este filtro.';ws.getCell(5,1).font={italic:true,color:{argb:'FF5F6F72'}}}
  ws.pageSetup={orientation:cols.length>7?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9};
  return ws;
}
function xlKV(wb,name,title,sub,pairs){
  return xlSheet(wb,name,title,sub,[{h:'Indicador',k:'a',w:42},{h:'Valor',k:'b',w:22,t:'raw'}],pairs.map(([a,b,t])=>({a,b,_t:t})),{total:false});
}
async function xlSave(wb,nome){
  const buf=await wb.xlsx.writeBuffer();const fname=nome.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\\/:*?"<>|]/g,'-')+'.xlsx';
  const data=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  if(C.downloads){try{await C.downloads.save({filename:fname,data});toast('Planilha pronta: '+fname)}catch(e){if(e&&e.code!=='declined')toast('Não foi possível baixar a planilha aqui.')}}
  else{const a=document.createElement('a');a.href=URL.createObjectURL(data);a.download=fname;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);toast('Planilha pronta: '+fname)}
}
function fixKV(ws){ws.eachRow((row,n)=>{if(n<5)return;const c=row.getCell(2);const t=(row.getCell(1).value||'');if(typeof c.value==='number'&&!/imóveis|contratos|quantidade|chamados|pessoas|itens|nº/i.test(t))c.numFmt=/ocupa|%/i.test(t)?'0%':FMT.money;c.alignment={horizontal:'right'}})}
const empresa=()=>C.config.empresa||'Chave Mestra';
const geradoEm=()=>'Gerado em '+fd(TODAY)+' · '+empresa();
async function wbNovo(){const X=await loadXL();const wb=new X.Workbook();wb.creator='Chave Mestra';wb.created=new Date();return wb}
const REL={
  async geral(){const wb=await wbNovo();
    const im=rows('imoveis'),ct=rows('contratos'),fin=rows('financeiro'),mes=fin.filter(f=>f.competencia===CUR),dm=despRows().filter(d=>doDono(d)&&compOf(d)===CUR);
    const rec=sum(mes.filter(f=>f.status==='Pago'),'total'),atr=fin.filter(f=>finStatus(f)==='Atrasado'),{tot}=forecast(12);
    fixKV(xlKV(wb,'Resumo','Resumo geral',geradoEm(),[
      ['Imóveis cadastrados',im.length],['Imóveis alugados',im.filter(i=>i.status==='Alugado').length],['Ocupação',im.length?im.filter(i=>i.status==='Alugado').length/im.length:0],
      ['Contratos ativos',ct.filter(c=>c.status==='Ativo').length],['Recebido em '+fm(CUR),rec],['A receber em '+fm(CUR),sum(mes.filter(f=>finStatus(f)==='Pendente'),'total')],
      ['Em atraso (todos os meses)',sum(atr,'total')],['Quantidade de aluguéis em atraso',atr.length],['Despesas de '+fm(CUR),sum(dm,'valor')],['Resultado de '+fm(CUR)+' (recebido − despesas)',rec-sum(dm,'valor')],
      ['Taxa de administração de '+fm(CUR),sum(mes,'taxaAdm')],['Lucro previsto nos próximos 12 meses',tot.reduce((s,t)=>s+t.r+t.rp-t.d,0)],['Chamados de manutenção em aberto',rows('manutencao').filter(m=>m.status!=='Concluído').length]]));
    xlSheet(wb,'Imóveis','Imóveis',geradoEm(),[{h:'Código',k:'codigo',w:10},{h:'Tipo',k:'tipo',w:14},{h:'Endereço',k:'end',w:44},{h:'Locador',k:'loc',w:26},{h:'Aluguel',k:'aluguel',t:'money'},{h:'Condomínio',k:'condominio',t:'money'},{h:'IPTU',k:'iptu',t:'money'},{h:'Situação',k:'status',w:14},{h:'Quartos',k:'quartos',t:'num',w:9},{h:'Área (m²)',k:'area',t:'num',w:10},{h:'Descrição',k:'descricao',w:50}],
      im.sort(MODS.imoveis.sort).map(i=>({...i,end:endereco(i),loc:nome('pessoas',i.locador)})));
    xlSheet(wb,'Pessoas','Pessoas',geradoEm(),[{h:'Nome',k:'nome',w:30},{h:'Tipo',k:'tipo',w:11},{h:'CPF/CNPJ',k:'doc',w:18},{h:'RG',k:'rg',w:14},{h:'Órgão emissor',k:'rgOrgao',w:12},{h:'Expedição RG',k:'rgExpedicao',t:'date'},{h:'Nascimento',k:'dataNasc',t:'date'},{h:'Nome da mãe',k:'nomeMae',w:28},{h:'Estado civil',k:'estadoCivil',w:14},{h:'Profissão',k:'profissao',w:18},{h:'Telefone',k:'telefone',w:16},{h:'E-mail',k:'email',w:26},{h:'Endereço',k:'end',w:44}],
      rows('pessoas').sort(MODS.pessoas.sort).map(p=>({...p,end:endereco(p)})));
    xlSheet(wb,'Contratos','Contratos',geradoEm(),[{h:'Nº',k:'numero',w:10},{h:'Imóvel',k:'im',w:30},{h:'Inquilino',k:'inq',w:26},{h:'Locador',k:'loc',w:26},{h:'Início',k:'inicio',t:'date'},{h:'Término',k:'fim',t:'date'},{h:'Aluguel',k:'aluguel',t:'money'},{h:'Índice',k:'indice',w:9},{h:'Próx. reajuste',k:'prox',t:'date'},{h:'Garantia',k:'garantia',w:16},{h:'Situação',k:'status',w:11}],
      ct.sort(MODS.contratos.sort).map(c=>({...c,im:nome('imoveis',c.imovel),inq:nome('pessoas',c.inquilino),loc:nome('pessoas',c.locador),prox:proxReaj(c)})));
    xlSheet(wb,'Recebimentos','Recebimentos de aluguel',geradoEm(),COLS_REC,fin.sort(MODS.financeiro.sort).map(recRow));
    xlSheet(wb,'Despesas','Despesas dos imóveis (inclui manutenção)',geradoEm()+' · até '+fm(addComp(CUR,1)),COLS_DESP,despRows().filter(d=>compOf(d)<=addComp(CUR,1)).sort((a,b)=>(b.data||'').localeCompare(a.data||'')).map(despRow));
    xlSheet(wb,'Manutenção','Manutenção',geradoEm(),[{h:'Abertura',k:'abertura',t:'date'},{h:'Imóvel',k:'im',w:28},{h:'Chamado',k:'descricao',w:34},{h:'Serviços',k:'cats',w:30},{h:'Prioridade',k:'prioridade',w:11},{h:'Custo',k:'custo',t:'money'},{h:'Pago por',k:'pagoPor',w:14},{h:'Situação',k:'status',w:13},{h:'Concluído em',k:'conclusao',t:'date'}],
      rows('manutencao').sort(MODS.manutencao.sort).map(m=>({...m,im:nome('imoveis',m.imovel),cats:catsOf(m).join(', ')})));
    xlSheet(wb,'Estoque','Estoque de materiais',geradoEm(),[{h:'Material',k:'item',w:30},{h:'Categoria',k:'categoria',w:16},{h:'Quantidade',k:'quantidade',t:'num',w:11},{h:'Unidade',k:'unidade',w:9},{h:'Mínimo',k:'minimo',t:'num',w:9},{h:'Custo unit.',k:'custoUnit',t:'money',sum:false},{h:'Valor em estoque',k:'vt',t:'money'},{h:'Situação',k:'sit',w:12}],
      rows('estoque').sort(MODS.estoque.sort).map(e=>({...e,vt:num(e.quantidade)*num(e.custoUnit),sit:num(e.quantidade)<=num(e.minimo)?'Abaixo do mínimo':'OK'})));
    xlSheet(wb,'Vistorias','Vistorias',geradoEm(),[{h:'Data',k:'data',t:'date'},{h:'Imóvel',k:'im',w:30},{h:'Tipo',k:'tipo',w:22},{h:'Estado',k:'estado',w:10},{h:'Responsável',k:'responsavel',w:20},{h:'Fotos/vídeos',k:'nm',t:'num',w:12},{h:'Ass. locador',k:'assLocador',w:12},{h:'Ass. inquilino',k:'assInquilino',w:13},{h:'Observações',k:'itens',w:50}],
      rows('vistorias').sort(MODS.vistorias.sort).map(v=>({...MODS.vistorias.prep({...v}),im:nome('imoveis',v.imovel),nm:Array.isArray(v.midia)?v.midia.length:0})));
    await xlSave(wb,'Chave Mestra - Relatório geral '+fd(TODAY).replace(/\//g,'-'));
  },
  async gastos(imId,Y){const wb=await wbNovo();const im=get('imoveis',imId);const alvo=im?MODS.imoveis.title(im):'Todos os imóveis';
    const ds=despRows().filter(d=>compOf(d).startsWith(Y)&&(!imId||d.imovel===imId)).sort((a,b)=>(a.data||'').localeCompare(b.data||''));
    xlSheet(wb,'Gastos','Gastos · '+alvo+' · '+Y,geradoEm(),COLS_DESP,ds.map(despRow));
    const cats={};ds.filter(doDono).forEach(d=>{const c=d._src==='manutencao'?'Manutenção':(d.categoria||'Outros');cats[c]=(cats[c]||0)+num(d.valor)});
    xlSheet(wb,'Por categoria','Gastos por categoria · '+alvo+' · '+Y,'Somente despesas do proprietário',[{h:'Categoria',k:'c',w:28},{h:'Total',k:'v',t:'money'},{h:'% do total',k:'p',t:'pct',w:11}],(()=>{const t=Object.values(cats).reduce((a,b)=>a+b,0)||1;return Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>({c,v,p:v/t}))})());
    const fin=rows('financeiro').filter(f=>(!imId||f.imovel===imId));
    xlSheet(wb,'Mês a mês','Receitas × gastos mês a mês · '+alvo+' · '+Y,geradoEm(),[{h:'Mês',k:'m',t:'month',w:12},{h:'Recebido',k:'r',t:'money'},{h:'Em aberto',k:'a',t:'money'},{h:'Gastos',k:'d',t:'money'},{h:'Resultado',k:'s',t:'money'}],
      [...Array(12)].map((_,i)=>{const m=Y+'-'+p2(i+1),f=fin.filter(x=>x.competencia===m),r=sum(f.filter(x=>x.status==='Pago'),'total'),d=sum(ds.filter(x=>doDono(x)&&compOf(x)===m),'valor');return {m,r,a:sum(f.filter(x=>x.status!=='Pago'),'total'),d,s:r-d}}));
    await xlSave(wb,'Gastos - '+alvo+' - '+Y);
  },
  async resultado(Y){const wb=await wbNovo();const data=porImovel(Y);
    xlSheet(wb,'Resultado','Resultado por imóvel · '+Y,geradoEm()+' · recebido − despesas do proprietário',[{h:'Imóvel',k:'im',w:36},{h:'Situação',k:'st',w:13},{h:'Recebido',k:'rec',t:'money'},{h:'A receber',k:'pend',t:'money'},{h:'Em atraso',k:'atr',t:'money'},{h:'Despesas',k:'desp',t:'money'},{h:'Taxa adm.',k:'tx',t:'money'},{h:'Resultado',k:'res',t:'money'}],data.map(r=>({...r,im:MODS.imoveis.title(r.i),st:r.i.status})));
    const ms=[...Array(12)].map((_,i)=>Y+'-'+p2(i+1)),fin=rows('financeiro');
    xlSheet(wb,'Recebido por mês','Recebido por imóvel, mês a mês · '+Y,geradoEm(),[{h:'Imóvel',k:'im',w:32},...ms.map(m=>({h:fms(m),k:m,t:'money',w:12})),{h:'Total',k:'t',t:'money'}],
      rows('imoveis').sort(MODS.imoveis.sort).map(i=>{const o={im:MODS.imoveis.title(i)};let t=0;ms.forEach(m=>{const v=sum(fin.filter(f=>f.imovel===i.id&&f.competencia===m&&f.status==='Pago'),'total');o[m]=v;t+=v});o.t=t;return o}));
    await xlSave(wb,'Resultado por imóvel - '+Y);
  },
  async recebimentos(mes){const wb=await wbNovo();const fin=rows('financeiro').filter(f=>!mes||f.competencia===mes).sort(MODS.financeiro.sort);const sub=(mes?fm(mes):'Todos os meses')+' · '+geradoEm();
    xlSheet(wb,'Recebimentos','Recebimentos de aluguel',sub,COLS_REC,fin.map(recRow));
    const at=rows('financeiro').filter(f=>finStatus(f)==='Atrasado').sort((a,b)=>(a.vencimento||'').localeCompare(b.vencimento||''));
    xlSheet(wb,'Em atraso','Aluguéis em atraso (todos os meses)',geradoEm(),[{h:'Inquilino',k:'inq',w:28},{h:'Telefone',k:'tel',w:16},{h:'Imóvel',k:'im',w:30},{h:'Competência',k:'competencia',t:'month',w:12},{h:'Vencimento',k:'vencimento',t:'date'},{h:'Dias de atraso',k:'dias',t:'num',w:12},{h:'Valor',k:'total',t:'money'}],
      at.map(f=>{const p=get('pessoas',f.inquilino)||{};return {...f,inq:p.nome||'—',tel:p.telefone||'',im:nome('imoveis',f.imovel),dias:-days(f.vencimento)}}));
    await xlSave(wb,'Recebimentos - '+(mes?fm(mes).replace('/','-'):'todos'));
  },
  async previsao(){const wb=await wbNovo();const {ms,grid,tot}=forecast(12);
    xlSheet(wb,'Previsão','Previsão dos próximos 12 meses',geradoEm()+' · contratos ativos, com reajuste estimado',[{h:'Mês',k:'m',t:'month',w:12},{h:'Recebimentos',k:'r',t:'money'},{h:'Despesas',k:'d',t:'money'},{h:'Lucro',k:'l',t:'money'}],tot.map(t=>({m:t.m,r:t.r+t.rp,d:t.d,l:t.r+t.rp-t.d})));
    xlSheet(wb,'Por imóvel','Recebimentos previstos por imóvel',geradoEm(),[{h:'Imóvel',k:'im',w:30},{h:'Inquilino',k:'inq',w:24},...ms.map(m=>({h:fms(m),k:m,t:'money',w:12})),{h:'Total',k:'t',t:'money'}],
      grid.map(g=>{const o={im:nome('imoveis',g.c.imovel),inq:nome('pessoas',g.c.inquilino)};let t=0;ms.forEach((m,j)=>{const v=g.cells[j]?g.cells[j].v:null;o[m]=v;t+=v||0});o.t=t;return o}));
    await xlSave(wb,'Previsão 12 meses - '+fd(TODAY).replace(/\//g,'-'));
  },
  async lista(c){const M=MODS[c];const wb=await wbNovo();let list=M.rowsFn?M.rowsFn():rows(c).concat(M.extra?M.extra():[]);if(M.sort)list.sort(M.sort);if(M.filt)list=list.filter(M.filt);
    const txt=h=>{const d=document.createElement('div');d.innerHTML=String(h).replace(/<div/g,' · <div');return d.textContent.replace(/\s+/g,' ').replace(/^ · /,'').trim()};
    const mon=h=>{const t=txt(h).replace(/[^\d,.\-]/g,'').replace(/\./g,'').replace(',','.');const v=parseFloat(t);return isFinite(v)?v:null};
    xlSheet(wb,M.nome,M.nome,geradoEm()+(c==='financeiro'||c==='despesas'?' · '+(C.finMes?fm(C.finMes):'todos os meses')+(C.finIm?' · '+nome('imoveis',C.finIm):''):''),M.cols.map((col,i)=>({h:col[0],k:'c'+i,t:col[2]?'money':'text',w:col[2]?15:28})),
      list.map(r=>{const o={};M.cols.forEach((col,i)=>{o['c'+i]=col[2]?mon(col[1](r)):txt(col[1](r))});return o}));
    await xlSave(wb,M.nome+' - '+fd(TODAY).replace(/\//g,'-'));
  },
  async caixaMes(k){const X=window.CX&&window.CX.cx;if(!X)return;const wb=await wbNovo();const ls=X.linhas(k),t=X.totais(k);
    fixKV(xlKV(wb,'Resumo','Fluxo de caixa · '+X.label(k),geradoEm(),[['Receitas do mês',t.r],['Recebido',t.rp],['Despesas do mês',t.d],['Pago',t.dp],['Saldo do mês',t.s],['Saldo acumulado',X.acumulado(k)]]));
    const cols=[{h:'Tipo',k:'tipo',w:10},{h:'Descrição',k:'descricao',w:32},{h:'Categoria',k:'categoria',w:18},{h:'Repetição',k:'rep',w:16},{h:'Entrada',k:'ent',t:'money'},{h:'Saída',k:'sai',t:'money'},{h:'Situação',k:'sit',w:12}];
    xlSheet(wb,'Lançamentos','Lançamentos · '+X.label(k),geradoEm(),cols,[...ls.filter(l=>l.tipo==='receita'),...ls.filter(l=>l.tipo==='despesa')].map(l=>({tipo:l.tipo==='receita'?'Receita':'Despesa',descricao:l.descricao,categoria:l.categoria,rep:X.recLabel(l),ent:l.tipo==='receita'?l.valor:null,sai:l.tipo==='despesa'?l.valor:null,sit:l.pago?(l.tipo==='receita'?'Recebido':'Pago'):(l.tipo==='receita'?'A receber':'A pagar')})));
    const cats={};ls.filter(l=>l.tipo==='despesa').forEach(l=>cats[l.categoria]=(cats[l.categoria]||0)+l.valor);
    xlSheet(wb,'Despesas por categoria','Despesas por categoria · '+X.label(k),geradoEm(),[{h:'Categoria',k:'c',w:26},{h:'Total',k:'v',t:'money'},{h:'% das despesas',k:'p',t:'pct',w:14}],Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>({c,v,p:t.d?v/t.d:0})));
    await xlSave(wb,'Fluxo de caixa - '+X.label(k));
  },
  async caixaAno(Y){const X=window.CX&&window.CX.cx;if(!X)return;const wb=await wbNovo();const ms=[...Array(12)].map((_,i)=>Y+'-'+p2(i+1));
    xlSheet(wb,'Resumo do ano','Fluxo de caixa · '+Y,geradoEm(),[{h:'Mês',k:'m',t:'month',w:12},{h:'Receitas',k:'r',t:'money'},{h:'Despesas',k:'d',t:'money'},{h:'Saldo do mês',k:'s',t:'money'},{h:'Saldo acumulado',k:'a',t:'money',sum:false},{h:'Situação',k:'st',w:12}],
      ms.map(m=>{const t=X.totais(m),st=X.statusOf(m);return {m,r:t.r,d:t.d,s:t.s,a:X.acumulado(m),st:st==='closed'?'Arquivado':st==='future'?'Previsto':'Aberto'}}));
    for(const tipo of ['despesa','receita']){const cats={};ms.forEach((m,j)=>X.linhas(m).filter(l=>l.tipo===tipo).forEach(l=>{(cats[l.categoria]=cats[l.categoria]||Array(12).fill(0))[j]+=l.valor}));
      xlSheet(wb,tipo==='despesa'?'Despesas por categoria':'Receitas por categoria',(tipo==='despesa'?'Despesas':'Receitas')+' por categoria · '+Y,geradoEm(),[{h:'Categoria',k:'c',w:24},...ms.map((m,j)=>({h:fms(m),k:'m'+j,t:'money',w:12})),{h:'Total',k:'t',t:'money'}],
        Object.entries(cats).map(([c,a])=>{const o={c,t:a.reduce((x,y)=>x+y,0)};a.forEach((v,j)=>o['m'+j]=v);return o}).sort((a,b)=>b.t-a.t))}
    await xlSave(wb,'Fluxo de caixa - '+Y);
  }
};
const COLS_REC=[{h:'Competência',k:'competencia',t:'month',w:12},{h:'Imóvel',k:'im',w:28},{h:'Inquilino',k:'inq',w:24},{h:'Vencimento',k:'vencimento',t:'date'},{h:'Aluguel',k:'aluguel',t:'money'},{h:'Condomínio',k:'condominio',t:'money'},{h:'IPTU',k:'iptu',t:'money'},{h:'Outros',k:'outros',t:'money'},{h:'Desconto',k:'desconto',t:'money'},{h:'Multa/juros',k:'multa',t:'money'},{h:'Total',k:'total',t:'money'},{h:'Taxa adm.',k:'taxaAdm',t:'money'},{h:'Repasse',k:'repasse',t:'money'},{h:'Situação',k:'sit',w:11},{h:'Pago em',k:'dataPagamento',t:'date'}];
const recRow=f=>({...f,im:nome('imoveis',f.imovel),inq:nome('pessoas',f.inquilino),sit:finStatus(f)});
const COLS_DESP=[{h:'Data',k:'data',t:'date'},{h:'Imóvel',k:'im',w:28},{h:'Descrição',k:'descricao',w:32},{h:'Categoria',k:'cat',w:16},{h:'Repetição',k:'rep',w:12},{h:'Pago por',k:'pagoPor',w:14},{h:'Valor',k:'valor',t:'money'},{h:'Situação',k:'status',w:10}];
const despRow=d=>({...d,im:nome('imoveis',d.imovel),cat:d._src==='manutencao'?'Manutenção':(d.categoria||'Outros'),rep:d._rec||'única'});
window.RELAT=REL;window.RELAT_run=(...a)=>gerarRel(...a);
async function gerarRel(fn,...a){toast('Montando a planilha…');try{await REL[fn](...a)}catch(e){console.error(e);toast(e&&e.message==='lib'?'Não consegui carregar o gerador de planilhas. Verifique a internet e tente de novo.':'Erro ao montar a planilha.')}}
function renderRelatorios(){
  const ims=rows('imoveis').sort(MODS.imoveis.sort);const Y=CUR.slice(0,4);
  const anos=new Set([Y,String(+Y-1),String(+Y+1)]);rows('financeiro').forEach(f=>f.competencia&&anos.add(f.competencia.slice(0,4)));
  const anoSel=id=>`<select id="${id}" class="search" style="width:auto">${[...anos].sort().map(a=>`<option ${a===Y?'selected':''}>${a}</option>`).join('')}</select>`;
  const card=(t,d,ctrl,btn)=>`<div class="card rcard"><div class="rbody"><h2>${t}</h2><div class="meta">${d}</div>${ctrl?`<div class="tools" style="margin-top:10px">${ctrl}</div>`:''}</div><div class="rfoot"><button class="btn primary" ${btn}>${ICON.doc} Baixar planilha (.xlsx)</button></div></div>`;
  $('#cmMain').innerHTML=`<div class="modh"><div><h1>Planilhas</h1><div class="meta">Relatórios prontos em Excel, formatados e com totais. Também abrem no Google Planilhas.</div></div></div>
  <div class="fsec" style="border:0;margin-bottom:8px">Aluguéis</div>
  <div class="rgrid">
    ${card('Relatório geral','Uma planilha com tudo: resumo, imóveis, pessoas, contratos, recebimentos, despesas, manutenção, estoque e vistorias — uma aba para cada.','','data-rel="geral"')}
    ${card('Gastos por imóvel','Todas as despesas e manutenções do imóvel no ano, total por categoria e receitas × gastos mês a mês.',`<select id="relIm" class="search" style="width:auto;max-width:240px"><option value="">Todos os imóveis</option>${ims.map(i=>`<option value="${esc(i.id)}">${esc(MODS.imoveis.title(i))}</option>`).join('')}</select>${anoSel('relImAno')}`,'data-rel="gastos"')}
    ${card('Resultado por imóvel','Recebido, a receber, em atraso, despesas e lucro de cada imóvel no ano, mais o recebido mês a mês.',anoSel('relResAno'),'data-rel="resultado"')}
    ${card('Recebimentos e inadimplência','Aluguéis do mês (ou todos) com situação e repasse, e uma aba com quem está em atraso, dias e telefone.',`<input type="month" id="relRecMes" class="search" style="width:auto" value="${CUR}" title="Deixe vazio para todos os meses">`,'data-rel="recebimentos"')}
    ${card('Previsão 12 meses','Recebimentos, despesas e lucro previstos mês a mês, e a previsão de cada imóvel.','','data-rel="previsao"')}
  </div>
  <div class="fsec" style="border:0;margin:18px 0 8px">Caixa Mensal</div>
  <div class="rgrid">
    ${card('Fluxo de caixa do mês','Receitas e despesas do mês com situação, resumo com saldo e despesas por categoria.',`<input type="month" id="relCxMes" class="search" style="width:auto" value="${CUR}">`,'data-rel="caixaMes"')}
    ${card('Fluxo de caixa do ano','Janeiro a dezembro: receitas, despesas, saldo e acumulado, mais receitas e despesas por categoria mês a mês.',anoSel('relCxAno'),'data-rel="caixaAno"')}
  </div>
  <div class="note" style="margin-top:14px;background:transparent">Dica: em cada lista (Pessoas, Imóveis, Contratos, Financeiro…) também há o botão “Planilha” que baixa exatamente o que está na tela, com os filtros aplicados.</div>`;
}
function relClick(t){const r=t.dataset.rel;
  if(r==='geral')gerarRel('geral');else if(r==='gastos')gerarRel('gastos',$('#relIm').value,$('#relImAno').value);else if(r==='resultado')gerarRel('resultado',$('#relResAno').value);
  else if(r==='recebimentos')gerarRel('recebimentos',$('#relRecMes').value);else if(r==='previsao')gerarRel('previsao');
  else if(r==='caixaMes')gerarRel('caixaMes',$('#relCxMes').value||CUR);else if(r==='caixaAno')gerarRel('caixaAno',$('#relCxAno').value)}

/* ---------- boot ---------- */
(async()=>{
  let db=null;try{db=window.claude&&window.claude.use?await window.claude.use('db'):null}catch(e){db=null}
  if(!db){lsLoad();C.ready=true;render();return}
  C.db=db;const got=new Set();const need=COLS.length+1;
  const arrive=k=>{got.add(k);if(!C.ready&&got.size>=need)C.ready=true;render()};
  const copy=d=>JSON.parse(JSON.stringify(d.data()));
  COLS.forEach(c=>db.collection('cm_'+c).onSnapshot(s=>{const o={};s.docs.forEach(d=>o[d.id]=copy(d));C.data[c]=o;arrive(c)},()=>{}));
  db.doc('cm_config/geral').onSnapshot(s=>{if(s.exists)C.config={...DEF_CFG,...copy(s)};arrive('config')},()=>{});
  try{C.assets=await window.claude.use('assets')}catch(e){C.assets=null}
  try{C.downloads=await window.claude.use('downloads')}catch(e){C.downloads=null}
  render();
})();
})();
