/* Chave Mestra — login, contas, conta mestra e ligação com o Firebase.
   O app (app.js) só é carregado depois do login. Ele usa window.claude.use('db' | 'assets' | 'downloads' | 'user'),
   que aqui é implementado em cima do Firebase (Auth + Firestore). */
(function(){
'use strict';
const CFG=window.CHAVE_CONFIG||{};
const APP_VER='1';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}};
const COLS=['itens','meses','transf','config','cm_precad','cm_pessoas','cm_imoveis','cm_contratos','cm_vistorias','cm_financeiro','cm_despesas','cm_manutencao','cm_estoque','cm_config'];
const MAX_ARQ=20*1024*1024, PARTE=750000;
const fData=d=>{try{return d?new Date(d).toLocaleDateString('pt-BR'):''}catch(e){return ''}};
const tsData=t=>t&&t.toDate?fData(t.toDate()):typeof t==='string'?fData(t):'';

const SH={user:null,admin:false,alvo:null,alvoPerfil:null,fs:null,auth:null,started:false,saindo:false,unsubAcesso:null,pendingNome:''};
let readyRes;const READY=new Promise(r=>readyRes=r);

/* ---------- ponte usada pelo app ---------- */
window.claude={use:async name=>{await READY;
  if(name==='db')return DB;if(name==='assets')return ASSETS;if(name==='downloads')return DOWNLOADS;
  if(name==='user')return {can:async()=>true,id:SH.user&&SH.user.uid};
  throw {code:'not_granted'}}};
const baseRef=()=>SH.fs.collection('contas').doc(SH.alvo);
function mapErr(e){const c=e&&e.code;return {code:c==='permission-denied'?'invalid_argument':c==='resource-exhausted'?'quota_exceeded':c==='unavailable'?'unavailable':(c||'unknown'),message:e&&e.message}}
const DB={
  collection:name=>({onSnapshot:(next,err)=>baseRef().collection(name).onSnapshot(next,e=>{console.warn(e);err&&err(mapErr(e))})}),
  doc:path=>{const [c,id]=String(path).split('/');const ref=()=>baseRef().collection(c).doc(id);
    return {set:d=>ref().set(d).catch(e=>{throw mapErr(e)}),delete:()=>ref().delete().catch(e=>{throw mapErr(e)}),
      onSnapshot:(next,err)=>ref().onSnapshot(next,e=>{console.warn(e);err&&err(mapErr(e))})}}
};

/* ---------- fotos e vídeos (guardados em partes no Firestore) ---------- */
const PH='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const cacheM=new Map();
const hexId=()=>{const a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')};
const b64Of=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]||'');r.onerror=()=>rej({code:'unsupported_type'});r.readAsDataURL(blob)});
function blobDe(b64,mime){const bin=atob(b64);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);return new Blob([u8],{type:mime||'application/octet-stream'})}
async function gravarMidia(base,id,b64,mime,tam){
  const ref=base.collection('midia').doc(id);const n=Math.max(1,Math.ceil(b64.length/PARTE));
  for(let i=0;i<n;i++)await ref.collection('partes').doc(String(i)).set({d:b64.slice(i*PARTE,(i+1)*PARTE)});
  await ref.set({mime:mime||'application/octet-stream',tam:tam||Math.round(b64.length*3/4),partes:n,criadoEm:new Date().toISOString()});
}
async function lerMidia(base,id){
  const ref=base.collection('midia').doc(id);const m=await ref.get();if(!m.exists)return null;
  const ps=await ref.collection('partes').get();
  return {mime:m.data().mime,tam:m.data().tam,b64:ps.docs.slice().sort((a,b)=>+a.id-+b.id).map(x=>x.data().d||'').join('')};
}
async function carregar(id){
  const ent={};cacheM.set(id,ent);
  try{const m=await lerMidia(baseRef(),id);if(!m)throw 0;ent.url=URL.createObjectURL(blobDe(m.b64,m.mime))}catch(e){ent.err=true}
  resolver();
}
function resolver(){
  document.querySelectorAll('img[src*="#m="],video[src*="#m="],a[href*="#m="]').forEach(el=>{
    const at=el.tagName==='A'?'href':'src',id=(el.getAttribute(at)||'').split('#m=')[1];if(!id)return;
    const c=cacheM.get(id);if(!c){carregar(id);return}if(c.url)el.setAttribute(at,c.url)});
}
window.MIDIA={src(id){if(!id)return '';const c=cacheM.get(id);if(c&&c.url)return c.url;if(!c&&SH.alvo)carregar(id);return PH+'#m='+id}};
let rq=0;new MutationObserver(()=>{if(!rq)rq=requestAnimationFrame(()=>{rq=0;resolver()})}).observe(document.body,{childList:true,subtree:true});
const ASSETS={async upload(blob,opt){
  if(!blob||blob.size>MAX_ARQ)throw {code:'too_large'};
  const id=hexId(),type=(opt&&opt.type)||blob.type;
  try{await gravarMidia(baseRef(),id,await b64Of(blob),type,blob.size)}catch(e){throw e&&e.code&&!e.message?e:mapErr(e)}
  cacheM.set(id,{url:URL.createObjectURL(blob)});return {id}}};

/* ---------- downloads ---------- */
function baixar(filename,data){
  const b=data instanceof Blob?data:new Blob([data],{type:/\.html?$/i.test(filename)?'text/html;charset=utf-8':/\.json$/i.test(filename)?'application/json':'application/octet-stream'});
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}
const DOWNLOADS={async save({filename,data}){baixar(filename,data)}};

/* ---------- modal e aviso ---------- */
function modal(html,onMount){
  const root=$('#modalRoot');root.innerHTML=`<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov=root.firstElementChild;const close=()=>{root.innerHTML='';document.removeEventListener('keydown',kd)};
  const kd=e=>{if(e.key==='Escape')close()};document.addEventListener('keydown',kd);
  ov.addEventListener('mousedown',e=>{if(e.target===ov)close()});
  onMount&&onMount(ov.firstElementChild,close);return close;
}
function choose(title,text,opts){return new Promise(res=>{
  modal(`<h3>${esc(title)}</h3>${text?`<p>${esc(text)}</p>`:''}<div class="choices">${opts.map((o,i)=>`<button data-i="${i}" class="${o.danger?'danger':''}"><b>${esc(o.label)}</b>${o.hint?`<small>${esc(o.hint)}</small>`:''}</button>`).join('')}</div><div class="sheet-f"><button class="btn" data-x>Cancelar</button></div>`,
  (el,close)=>{el.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-x')){close();res(null)}else if(b.dataset.i!=null){close();res(opts[+b.dataset.i].value)}})})})}
function toast(msg){const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),3200)}

/* ---------- telas de entrada ---------- */
const ERR={'auth/invalid-credential':'E-mail ou senha incorretos.','auth/wrong-password':'E-mail ou senha incorretos.','auth/user-not-found':'Não existe conta com este e-mail. Use “Criar conta”.',
  'auth/invalid-login-credentials':'E-mail ou senha incorretos.','auth/email-already-in-use':'Já existe uma conta com este e-mail. Use “Entrar”.','auth/weak-password':'A senha precisa ter pelo menos 6 caracteres.',
  'auth/invalid-email':'E-mail inválido. Confira se digitou certo.','auth/missing-email':'Informe o e-mail.','auth/missing-password':'Informe a senha.','auth/too-many-requests':'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  'auth/network-request-failed':'Sem conexão com a internet. Tente de novo.','auth/operation-not-allowed':'O login por e-mail e senha não está ativado no Firebase (Authentication → Método de login).',
  'auth/user-disabled':'Esta conta foi desativada.'};
const errMsg=e=>ERR[e&&e.code]||('Não deu certo'+(e&&e.code?' ('+e.code+')':'')+'. Tente de novo.');
function authShow(html){$('#appWrap').hidden=true;$('#auth').hidden=false;$('#authBody').innerHTML=html;const f=$('#authBody input');f&&f.focus()}
function telaCarregando(msg){authShow(`<div class="auth-wait" role="status"><span class="spin" aria-hidden="true"></span>${esc(msg||'Carregando…')}</div>`)}
function telaLogin(msgOk){
  authShow(`<h1>Entrar</h1><p class="muted">Aluguéis e caixa mensal, cada um na sua conta.</p>${msgOk?`<div class="aok">${esc(msgOk)}</div>`:''}
  <form id="fLogin" novalidate>
    <div class="field"><label for="lEmail">E-mail</label><input id="lEmail" type="email" autocomplete="username" inputmode="email" value="${esc(LS.get('cm-ultimo-email')||'')}"></div>
    <div class="field"><label for="lSenha">Senha</label><input id="lSenha" type="password" autocomplete="current-password"></div>
    <div class="aerr" id="aErr" role="alert"></div>
    <button class="btn primary big" type="submit">Entrar</button>
  </form>
  <div class="alinks"><button type="button" class="link" data-go="reset">Esqueci minha senha</button><button type="button" class="link" data-go="signup">Criar conta</button></div>`);
  if($('#lEmail').value)$('#lSenha').focus();
  $('#fLogin').onsubmit=async e=>{e.preventDefault();const em=$('#lEmail').value.trim(),pw=$('#lSenha').value,btn=e.target.querySelector('button[type=submit]');
    if(!em||!pw){$('#aErr').textContent='Preencha e-mail e senha.';return}
    btn.disabled=true;$('#aErr').textContent='';LS.set('cm-ultimo-email',em);
    try{await SH.auth.signInWithEmailAndPassword(em,pw)}catch(err){$('#aErr').textContent=errMsg(err);btn.disabled=false}};
}
function telaCadastro(){
  authShow(`<h1>Criar conta</h1><p class="muted">Depois de criar, a conta mestra libera o seu acesso.</p>
  <form id="fCad" novalidate>
    <div class="field"><label for="cNome">Seu nome</label><input id="cNome" autocomplete="name"></div>
    <div class="field"><label for="cEmail">E-mail</label><input id="cEmail" type="email" autocomplete="username" inputmode="email"></div>
    <div class="field"><label for="cSenha">Senha (mínimo 6 caracteres)</label><input id="cSenha" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="cSenha2">Repita a senha</label><input id="cSenha2" type="password" autocomplete="new-password"></div>
    <div class="aerr" id="aErr" role="alert"></div>
    <button class="btn primary big" type="submit">Criar conta</button>
  </form>
  <div class="alinks"><button type="button" class="link" data-go="login">Já tenho conta · Entrar</button></div>`);
  $('#fCad').onsubmit=async e=>{e.preventDefault();const nome=$('#cNome').value.trim(),em=$('#cEmail').value.trim(),pw=$('#cSenha').value,pw2=$('#cSenha2').value,er=$('#aErr'),btn=e.target.querySelector('button[type=submit]');
    if(!nome){er.textContent='Informe seu nome.';return}if(!em){er.textContent='Informe o e-mail.';return}
    if(pw.length<6){er.textContent='A senha precisa ter pelo menos 6 caracteres.';return}if(pw!==pw2){er.textContent='As duas senhas não são iguais.';return}
    btn.disabled=true;er.textContent='';SH.pendingNome=nome;LS.set('cm-ultimo-email',em);
    try{const cred=await SH.auth.createUserWithEmailAndPassword(em,pw);
      try{await cred.user.updateProfile({displayName:nome})}catch(x){}
      try{await cred.user.sendEmailVerification()}catch(x){}
    }catch(err){er.textContent=errMsg(err);btn.disabled=false}};
}
function telaSenha(){
  authShow(`<h1>Esqueci minha senha</h1><p class="muted">Enviamos um link para você criar uma senha nova.</p>
  <form id="fRes" novalidate><div class="field"><label for="rEmail">E-mail da conta</label><input id="rEmail" type="email" autocomplete="username" inputmode="email" value="${esc(LS.get('cm-ultimo-email')||'')}"></div>
  <div class="aerr" id="aErr" role="alert"></div><button class="btn primary big" type="submit">Enviar link</button></form>
  <div class="alinks"><button type="button" class="link" data-go="login">Voltar para Entrar</button></div>`);
  $('#fRes').onsubmit=async e=>{e.preventDefault();const em=$('#rEmail').value.trim();if(!em){$('#aErr').textContent='Informe o e-mail.';return}
    try{await SH.auth.sendPasswordResetEmail(em);telaLogin('Se existir uma conta com '+em+', o link para trocar a senha chegou no e-mail. Confira também o spam.')}catch(err){$('#aErr').textContent=errMsg(err)}};
}
function telaEspera(u,erro){
  authShow(`<h1>Quase lá</h1><p>A conta <b>${esc(u.email)}</b> foi criada. Falta a conta mestra liberar o seu acesso — avise quem te passou o link.</p>
  <p class="muted">Esta tela abre o app sozinha assim que o acesso for liberado.</p>${erro?`<div class="aerr">${esc(erro)}</div>`:''}
  ${u.emailVerified?'':`<div class="abox"><b>É a conta mestra?</b> Primeiro confirme o seu e-mail pelo link que enviamos (confira o spam). Depois clique em “Já confirmei”.
    <div class="alinks" style="margin-top:8px"><button type="button" class="link" data-go="verif">Reenviar o e-mail</button><button type="button" class="btn" data-go="jaconf">Já confirmei</button></div></div>`}
  <button type="button" class="btn big" data-go="sair">Sair</button>`);
}
function telaConfig(){
  authShow(`<h1>Falta configurar</h1><p>Este site ainda não está ligado a um projeto do Firebase. Abra o arquivo <b>config.js</b> e cole a configuração do seu projeto — o passo a passo está no README do repositório.</p>`);
}
function telaErro(msg){authShow(`<h1>Não foi possível abrir</h1><p>${esc(msg)}</p><button type="button" class="btn primary big" onclick="location.reload()">Tentar de novo</button>`)}

document.addEventListener('click',async e=>{
  const g=e.target.closest('[data-go]');if(!g||!$('#auth').contains(g))return;const go=g.dataset.go;
  if(go==='login')telaLogin();else if(go==='signup')telaCadastro();else if(go==='reset')telaSenha();
  else if(go==='sair')sair();
  else if(go==='verif'){try{await SH.user.sendEmailVerification();toast('E-mail de confirmação enviado para '+SH.user.email+'.')}catch(err){toast(errMsg(err))}}
  else if(go==='jaconf'){try{await SH.user.reload();await SH.user.getIdToken(true)}catch(err){}
    if(!SH.auth.currentUser.emailVerified){toast('Ainda não aparece confirmado. Abra o link do e-mail e tente de novo.');return}
    if(SH.unsubAcesso){SH.unsubAcesso();SH.unsubAcesso=null}entrar(SH.auth.currentUser)}
});

/* ---------- depois do login ---------- */
async function souMestre(u){
  try{await SH.fs.collection('acesso').limit(1).get({source:'server'});LS.set('cm-mestre-'+u.uid,'1');return true}
  catch(e){if(e&&e.code==='unavailable')return LS.get('cm-mestre-'+u.uid)==='1';LS.set('cm-mestre-'+u.uid,null);return false}
}
async function entrar(u){
  telaCarregando('Abrindo sua conta…');
  const perfil={email:u.email,ultimoAcesso:firebase.firestore.FieldValue.serverTimestamp(),criadoEm:u.metadata&&u.metadata.creationTime||null};
  const nome=u.displayName||SH.pendingNome;if(nome)perfil.nome=nome;
  SH.fs.collection('contas').doc(u.uid).set(perfil,{merge:true}).catch(e=>console.warn('perfil',e));
  SH.admin=await souMestre(u);
  if(!SH.admin){
    await new Promise(res=>{
      let feito=false;const t=setTimeout(()=>{if(!feito)telaEspera(u)},7000);
      SH.unsubAcesso=SH.fs.collection('acesso').doc(u.uid).onSnapshot(s=>{if(s.exists){feito=true;clearTimeout(t);res()}else if(!s.metadata.fromCache){clearTimeout(t);telaEspera(u)}},
        err=>{clearTimeout(t);telaEspera(u,err&&err.code==='unavailable'?'Sem conexão com a internet.':'')});
    });
    if(SH.unsubAcesso){SH.unsubAcesso();SH.unsubAcesso=null}
  }
  let alvo=u.uid;SH.alvoPerfil=null;
  const pedido=SH.admin?LS.get('cm-alvo'):null;
  if(pedido&&pedido!==u.uid){try{const s=await SH.fs.collection('contas').doc(pedido).get();if(s.exists){alvo=pedido;SH.alvoPerfil=s.data()}else LS.set('cm-alvo',null)}catch(e){LS.set('cm-alvo',null)}}
  SH.alvo=alvo;abrirApp();
}
function abrirApp(){
  const u=SH.user,outro=SH.alvo!==u.uid;
  $('#auth').hidden=true;$('#appWrap').hidden=false;
  $('#acctNome').textContent=u.displayName||SH.pendingNome||u.email;
  const b=$('#alvoBanner');b.hidden=!outro;
  if(outro){const p=SH.alvoPerfil||{};b.innerHTML=`<span>Você está vendo a conta de <b>${esc(p.nome||p.email||'outra pessoa')}</b>${p.email&&p.nome?' · '+esc(p.email):''}. As mudanças ficam salvas na conta dessa pessoa.</span><button class="btn" data-a="minha">Voltar para a minha conta</button>`}
  if(SH.started)return;SH.started=true;readyRes();
  const s=document.createElement('script');s.src='app.js?v='+APP_VER;s.onerror=()=>telaErro('Não consegui carregar o app. Verifique a internet.');document.body.appendChild(s);
}
async function sair(){
  SH.saindo=true;try{if(SH.auth)await SH.auth.signOut()}catch(e){}
  try{if(SH.fs){await SH.fs.terminate();await SH.fs.clearPersistence()}}catch(e){}
  LS.set('cm-alvo',null);location.reload();
}
function trocarConta(uid){LS.set('cm-alvo',uid&&uid!==SH.user.uid?uid:null);location.reload()}

/* ---------- minha conta, backup e contas (mestra) ---------- */
function nomeAlvo(){if(SH.alvo===SH.user.uid)return 'sua conta';const p=SH.alvoPerfil||{};return 'conta de '+(p.nome||p.email||'outra pessoa')}
function contaModal(){
  const u=SH.user;
  modal(`<div class="wide"></div><h3>Minha conta</h3><p>${esc(u.displayName||SH.pendingNome||'')}${u.displayName||SH.pendingNome?' · ':''}${esc(u.email)}${SH.admin?' · <span class="badge info">conta mestra</span>':''}</p>
  <div class="body">
    ${SH.alvo!==u.uid?`<div class="warnbox" style="margin:0!important">Aberta agora: <b>${esc(nomeAlvo())}</b>. O backup e a importação usam esta conta.</div>`:''}
    <div class="acts">
      <button class="btn" data-a="exportar">Baixar backup (.json)</button>
      <label class="btn upl">Importar backup<input type="file" accept=".json,application/json" data-a="importar" aria-label="Importar backup"></label>
      <button class="btn" data-a="senha">Trocar senha</button>
      <button class="btn danger" data-a="sair">Sair</button>
    </div>
    <div class="meta">O backup guarda tudo desta conta (aluguéis, caixa, fotos) num arquivo. Guarde de vez em quando no computador ou no Drive.</div>
    ${u.emailVerified?'':`<div class="meta">Seu e-mail ainda não foi confirmado. <button type="button" class="link" data-a="verif">Reenviar confirmação</button></div>`}
  </div>
  ${SH.admin?`<h3 style="padding-top:8px">Contas</h3><p>Libere quem pode usar o app e abra a conta de cada pessoa para acompanhar os aluguéis dela.</p><div class="body" id="contasList"><div class="meta">Carregando…</div></div>`:''}
  <div class="sheet-f"><button class="btn" data-x>Fechar</button></div>`,(el,close)=>{
    el.querySelector('[data-x]').onclick=close;
    el.addEventListener('change',e=>{const f=e.target.closest('[data-a="importar"]');if(f&&f.files&&f.files[0]){const file=f.files[0];f.value='';close();importar(file)}});
    el.addEventListener('click',async e=>{const b=e.target.closest('[data-a]');if(!b||b.tagName==='INPUT')return;const a=b.dataset.a;
      if(a==='exportar'){close();exportar()}
      else if(a==='senha'){try{await SH.auth.sendPasswordResetEmail(u.email);toast('Enviamos um link para '+u.email+' para trocar a senha.')}catch(err){toast(errMsg(err))}}
      else if(a==='sair'){close();sair()}
      else if(a==='verif'){try{await u.sendEmailVerification();toast('E-mail de confirmação enviado.')}catch(err){toast(errMsg(err))}}
      else if(a==='abrir'){close();trocarConta(b.dataset.uid)}
      else if(a==='liberar'){b.disabled=true;try{await SH.fs.collection('acesso').doc(b.dataset.uid).set({email:b.dataset.email||'',liberadoEm:firebase.firestore.FieldValue.serverTimestamp(),por:u.email});toast('Acesso liberado.')}catch(err){toast('Não foi possível liberar ('+(err&&err.code||'erro')+').')}listarContas(el)}
      else if(a==='bloquear'){const ok=await choose('Bloquear o acesso?','A pessoa não consegue mais abrir o app até você liberar de novo. Os dados dela continuam guardados.',[{label:'Bloquear acesso',value:1,danger:true}]);
        if(!ok){contaModal();return}try{await SH.fs.collection('acesso').doc(b.dataset.uid).delete();toast('Acesso bloqueado.')}catch(err){toast('Não foi possível bloquear.')}contaModal()}
    });
    if(SH.admin)listarContas(el);
  });
}
async function listarContas(el){
  const box=el.querySelector('#contasList');if(!box)return;
  try{
    const [cs,as]=await Promise.all([SH.fs.collection('contas').get(),SH.fs.collection('acesso').get()]);
    const lib=new Set(as.docs.map(d=>d.id)),me=SH.user.uid;
    const lista=cs.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>(a.uid===me?-1:b.uid===me?1:0)||(lib.has(a.uid)?0:-1)-(lib.has(b.uid)?0:-1)||String(a.nome||a.email).localeCompare(String(b.nome||b.email)));
    box.innerHTML=lista.length?`<ul class="plist contas">${lista.map(c=>{const eu=c.uid===me,ok=eu||lib.has(c.uid),aberta=c.uid===SH.alvo;
      return `<li><div style="min-width:0"><b>${esc(c.nome||c.email||'Sem nome')}</b> ${eu?'<span class="badge info">você · mestra</span>':ok?'<span class="badge ok">liberada</span>':'<span class="badge warn">aguardando liberação</span>'}${aberta&&!eu?' <span class="badge">aberta agora</span>':''}
        <div class="meta">${esc(c.email||'')}${tsData(c.ultimoAcesso)?' · último acesso '+tsData(c.ultimoAcesso):''}</div></div>
        <div class="tools">${aberta?'':`<button class="btn sm" data-a="abrir" data-uid="${esc(c.uid)}">${eu?'Abrir a minha':'Abrir conta'}</button>`}
        ${eu?'':ok?`<button class="btn sm danger" data-a="bloquear" data-uid="${esc(c.uid)}">Bloquear</button>`:`<button class="btn sm primary" data-a="liberar" data-uid="${esc(c.uid)}" data-email="${esc(c.email||'')}">Liberar acesso</button>`}</div></li>`}).join('')}</ul>`
      :'<div class="meta">Nenhuma conta ainda.</div>';
    box.insertAdjacentHTML('beforeend',`<div class="meta" style="margin-top:8px">Para um amigo usar: mande o link do site, ele clica em “Criar conta” e aparece aqui para você liberar.</div>`);
  }catch(err){box.innerHTML=`<div class="aerr">Não consegui carregar as contas (${esc(err&&err.code||'erro')}).</div>`}
}
async function exportar(){
  toast('Preparando o backup…');
  try{
    const base=baseRef(),out={app:'chave-mestra',versao:1,exportadoEm:new Date().toISOString(),conta:SH.alvo===SH.user.uid?SH.user.email:((SH.alvoPerfil||{}).email||''),colecoes:{},midia:{}};
    for(const c of COLS){const s=await base.collection(c).get();if(s.size){out.colecoes[c]={};s.docs.forEach(d=>out.colecoes[c][d.id]=d.data())}}
    const ms=await base.collection('midia').get();
    for(const d of ms.docs){const m=await lerMidia(base,d.id);if(m)out.midia[d.id]=m}
    const n=Object.values(out.colecoes).reduce((s,o)=>s+Object.keys(o).length,0),nm=Object.keys(out.midia).length;
    const who=(out.conta||'conta').split('@')[0].replace(/[^\w.-]/g,'');
    baixar('chave-mestra-backup-'+who+'-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(out));
    toast('Backup baixado: '+n+' registros'+(nm?' e '+nm+' arquivos':'')+'.');
  }catch(err){console.error(err);toast('Não foi possível gerar o backup ('+(err&&err.code||'erro')+').')}
}
const idOk=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!/[\/]/.test(id)&&id!=='.'&&id!=='..';
async function importar(file){
  let j;try{j=JSON.parse(await file.text())}catch(e){toast('Este arquivo não é um backup válido.');return}
  if(!j||j.app!=='chave-mestra'||typeof j.colecoes!=='object'){toast('Este arquivo não é um backup do Chave Mestra.');return}
  const ops=[];for(const c of COLS){const o=j.colecoes[c];if(!o||typeof o!=='object')continue;for(const [id,d] of Object.entries(o))if(idOk(id)&&d&&typeof d==='object')ops.push([c,id,d])}
  const mids=Object.entries(j.midia||{}).filter(([id,m])=>idOk(id)&&m&&typeof m.b64==='string');
  if(!ops.length&&!mids.length){toast('O backup está vazio.');return}
  const ok=await choose('Importar para '+nomeAlvo()+'?',ops.length+' registros'+(mids.length?' e '+mids.length+' arquivos':'')+(j.conta?' do backup de '+j.conta:'')+'. Registros com o mesmo código são substituídos; os demais continuam como estão.',[{label:'Importar agora',value:1}]);
  if(!ok)return;
  toast('Importando…');
  try{
    const base=baseRef();
    for(let i=0;i<ops.length;i+=400){const b=SH.fs.batch();ops.slice(i,i+400).forEach(([c,id,d])=>b.set(base.collection(c).doc(id),d));await b.commit()}
    for(const [id,m] of mids){await gravarMidia(base,id,m.b64,m.mime,m.tam);cacheM.delete(id)}
    toast('Backup importado: '+ops.length+' registros'+(mids.length?' e '+mids.length+' arquivos':'')+'.');
  }catch(err){console.error(err);toast('A importação parou no meio ('+(err&&err.code||'erro')+'). Tente de novo — o que já entrou fica salvo.')}
}
document.addEventListener('click',e=>{
  if(e.target.closest('#acctBtn')){contaModal();return}
  const m=e.target.closest('[data-a="minha"]');if(m&&$('#alvoBanner').contains(m))trocarConta(null);
});

/* ---------- início ---------- */
function iniciar(){
  const fb=CFG.firebase||{};
  if(!fb.apiKey||/COLE_AQUI/.test(fb.apiKey+fb.projectId)){telaConfig();return}
  if(!window.firebase||!firebase.initializeApp){telaErro('Não consegui carregar o Firebase. Verifique a internet e tente de novo.');return}
  telaCarregando();
  try{firebase.initializeApp(fb)}catch(e){telaErro('A configuração do Firebase em config.js parece errada.');return}
  SH.auth=firebase.auth();try{SH.auth.useDeviceLanguage()}catch(e){}
  SH.fs=firebase.firestore();
  const go=()=>SH.auth.onAuthStateChanged(u=>{
    if(SH.saindo)return;
    if(SH.started&&(!u||!SH.user||u.uid!==SH.user.uid)){location.reload();return}
    SH.user=u;
    if(!u){if(SH.unsubAcesso){SH.unsubAcesso();SH.unsubAcesso=null}telaLogin();return}
    entrar(u).catch(err=>{console.error(err);telaErro('Algo deu errado ao abrir a conta ('+(err&&err.code||'erro')+').')});
  });
  SH.fs.enablePersistence({synchronizeTabs:true}).catch(()=>{}).then(go);
}
iniciar();
})();
