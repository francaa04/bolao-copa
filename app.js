// ============================================================
//  BOLÃO DA COPA 2026 — lógica do site
//  Você só precisa editar as DUAS linhas abaixo (URL e CHAVE).
//  O manual explica onde achar esses dois valores no Supabase.
// ============================================================
const SUPABASE_URL  = "https://jqtpzbosopwjxlyfkoat.supabase.co";
const SUPABASE_KEY  = "sb_publishable_9p02LnK8pJsNonMfUu3-xA_Q5_SzE4F";

// Sufixo interno: o amigo digita "matheus", o sistema usa "matheus@bolao.local".
// Isso permite login por usuário sem pedir e-mail. Não precisa mexer.
const DOMINIO_FAKE = "@bolao.local";

// PRAZO DOS PALPITES ESPECIAIS (campeão e artilheiro).
// Depois deste horário, ninguém pode mais escolher/mudar — fica congelado.
// Padrão: apito do primeiro jogo (11/06/2026 16:00, horário de Brasília).
// Para mudar, troque a data abaixo (mantenha o formato com -03:00 no fim).
const PRAZO_ESPECIAIS = "2026-06-11T16:00:00-03:00";
function especiaisAbertos(){ return Date.now() < new Date(PRAZO_ESPECIAIS).getTime(); }

// ------------------------------------------------------------
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Busca TODAS as linhas de uma tabela, em blocos, contornando o
// limite padrão de 1000 linhas por request do Supabase.
// (Sem isso, com +1000 palpites, os Revelados perdem gente.)
async function buscarTodos(tabela, colunas="*"){
  const BLOCO = 1000;
  let todos = [];
  let de = 0;
  while(true){
    const { data, error } = await sb.from(tabela).select(colunas).range(de, de+BLOCO-1);
    if(error){ console.error("Erro ao paginar", tabela, error); break; }
    if(!data || !data.length) break;
    todos = todos.concat(data);
    if(data.length < BLOCO) break; // último bloco
    de += BLOCO;
  }
  return todos;
}

let EU = null;          // { id, usuario, moderador }
let JOGOS = [];         // todos os jogos
let MEUS = {};          // meus palpites { jogo_id: {gm,gv} }
let ABA = "palpites";
let filtroGrupo = "todos";
let filtroRodada = "todas";
let filtroFase = "grupos";   // "grupos" ou uma fase do mata-mata
let revGrupo = "todos";
let revRodada = "todas";
let revFase = "grupos";
let modFase = "grupos";   // fase selecionada no painel do moderador

// ------------------------------------------------------------
// FASES DO MATA-MATA
// O campo "grupo" guarda "A".."L" na fase de grupos, ou o nome da
// fase no mata-mata ("16-avos", "Oitavas", "Quartas", "Semi",
// "3º lugar", "Final"). Estas funções tratam essa distinção.
// ------------------------------------------------------------
const FASES_MATA = ["16-avos", "Oitavas", "Quartas", "Semi", "3º lugar", "Final"];
// Rótulo bonito de cada fase do mata-mata
const FASE_LABEL = {
  "16-avos": "16-avos de final",
  "Oitavas": "Oitavas de final",
  "Quartas": "Quartas de final",
  "Semi": "Semifinal",
  "3º lugar": "Disputa de 3º lugar",
  "Final": "Final",
};
// É um jogo de mata-mata? (grupo não é uma única letra A-L)
function ehMata(grupo){ return FASES_MATA.includes(grupo); }
// Rótulo a exibir no card: "Grupo A" para grupos, "16-avos de final" para mata-mata
function rotuloFase(grupo){
  return ehMata(grupo) ? (FASE_LABEL[grupo] || grupo) : ("Grupo " + grupo);
}
// Ordem de uma fase para ordenar a tela (grupos primeiro, depois mata-mata em ordem)
function ordemFase(grupo){
  if (!ehMata(grupo)) return grupo.charCodeAt(0); // A=65, B=66... (grupos primeiro)
  return 1000 + FASES_MATA.indexOf(grupo);        // mata-mata depois, na ordem certa
}
// Existe algum jogo de mata-mata cadastrado? (controla se mostra o seletor de fases)
function temMataMata(){ return JOGOS.some(j => ehMata(j.grupo)); }

// Fase a abrir por padrão = a do PRÓXIMO jogo que ainda não começou.
// Conforme os dias passam e as fases terminam, o padrão avança sozinho.
// Se todos os jogos já começaram (Copa acabou), usa a fase do último jogo.
// Retorna "grupos" para jogos de grupo, ou o nome da fase de mata-mata.
function faseAtualPadrao(){
  if(!JOGOS.length) return "grupos";
  const agora = Date.now();
  // próximo jogo que ainda não começou (JOGOS já vem ordenado por início)
  const proximos = JOGOS
    .filter(j => new Date(j.inicio).getTime() > agora)
    .sort((a,b) => new Date(a.inicio) - new Date(b.inicio));
  const alvo = proximos.length
    ? proximos[0]
    : JOGOS.slice().sort((a,b) => new Date(b.inicio) - new Date(a.inicio))[0]; // último jogo
  return ehMata(alvo.grupo) ? alvo.grupo : "grupos";
}

const $ = (s) => document.querySelector(s);
const el = (id) => document.getElementById(id);
const DIAS_PT = ["dom","seg","ter","qua","qui","sex","sáb"];

// Lista das 48 seleções (para o palpite de campeão)
const SELECOES = ["Alemanha","Arábia Saudita","Argélia","Argentina","Austrália","Áustria","Bélgica","Bósnia e Herzegovina","Brasil","Cabo Verde","Canadá","Catar","Chéquia","Colômbia","Coreia do Sul","Costa do Marfim","Croácia","Curaçao","Egito","Equador","Escócia","Espanha","Estados Unidos","França","Gana","Haiti","Holanda","Inglaterra","Irã","Iraque","Japão","Jordânia","Marrocos","México","Noruega","Nova Zelândia","Panamá","Paraguai","Portugal","RD Congo","Senegal","Suécia","Suíça","Tunísia","Turquia","Uruguai","Uzbequistão","África do Sul"];

// Mapa: nome da seleção -> código de país (flagcdn). Validado contra ISO 3166-1.
const COD_PAIS = {
  "Alemanha":"de","Arábia Saudita":"sa","Argélia":"dz","Argentina":"ar","Austrália":"au",
  "Áustria":"at","Bélgica":"be","Bósnia e Herzegovina":"ba","Brasil":"br","Cabo Verde":"cv",
  "Canadá":"ca","Catar":"qa","Chéquia":"cz","Colômbia":"co","Coreia do Sul":"kr",
  "Costa do Marfim":"ci","Croácia":"hr","Curaçao":"cw","Egito":"eg","Equador":"ec",
  "Escócia":"gb-sct","Espanha":"es","Estados Unidos":"us","França":"fr","Gana":"gh",
  "Haiti":"ht","Holanda":"nl","Inglaterra":"gb-eng","Irã":"ir","Iraque":"iq","Japão":"jp",
  "Jordânia":"jo","Marrocos":"ma","México":"mx","Noruega":"no","Nova Zelândia":"nz",
  "Panamá":"pa","Paraguai":"py","Portugal":"pt","RD Congo":"cd","Senegal":"sn","Suécia":"se",
  "Suíça":"ch","Tunísia":"tn","Turquia":"tr","Uruguai":"uy","Uzbequistão":"uz","África do Sul":"za"
};
// Seleções com bandeira QUADRADA (1:1). Só a Suíça na Copa 2026.
const BANDEIRA_QUADRADA = new Set(["Suíça"]);
// Devolve o <img> da bandeira (ou vazio se não for seleção, ex.: "A definir").
// Todas saem no MESMO tamanho padronizado. Para não esticar bandeiras de
// proporção incomum (Catar), a imagem é recortada (object-fit:cover) dentro
// de uma caixa fixa. A Suíça usa caixa quadrada (sua proporção natural).
function bandeira(time, alt){
  const cod = COD_PAIS[time];
  if(!cod) return "";
  const h = alt || 16;                 // altura padrão
  const quad = BANDEIRA_QUADRADA.has(time);
  const w = quad ? h : Math.round(h*1.5); // 3:2 normal, 1:1 quadrada
  return `<img class="flag" src="https://flagcdn.com/w80/${cod}.png" alt="" loading="lazy" style="width:${w}px;height:${h}px" onerror="this.style.display='none'">`;
}

// ---------- helpers de data (SEMPRE em horário de Brasília) ----------
// Fixamos o fuso de São Paulo para que os horários apareçam iguais
// para todos, mesmo que o celular esteja com fuso diferente.
const TZ = "America/Sao_Paulo";
function fmtData(iso){
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat("pt-BR",{weekday:"short",timeZone:TZ}).format(d).replace(".","");
  const dm = new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",timeZone:TZ}).format(d);
  return `${dia} ${dm}`;
}
function fmtHora(iso){
  return new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:TZ}).format(new Date(iso));
}
function jogoAberto(j){ return new Date(j.inicio).getTime() > Date.now(); }
function temResultado(j){ return j.gols_mandante !== null && j.gols_visitante !== null; }

function pontos(p, j){
  if(!p || !temResultado(j)) return null;
  // ----- pontos dos 90 minutos (vale para grupos E mata-mata) -----
  let pts;
  if(p.gm === j.gols_mandante && p.gv === j.gols_visitante) pts = 15;
  else {
    const s=(x)=>Math.sign(x);
    pts = (s(p.gm-p.gv) === s(j.gols_mandante-j.gols_visitante)) ? 5 : 0;
  }
  // ----- pontos extras: só em mata-mata e só se o jogo REALMENTE foi além -----
  if(ehMata(j.grupo)){
    // +5 se o jogo foi à prorrogação (ou além) e acertou quem venceu nela
    if((j.ate_onde === "prorrogacao" || j.ate_onde === "penaltis")
       && j.prorrogacao_result && p.palpite_prorrogacao
       && p.palpite_prorrogacao === j.prorrogacao_result){
      pts += 5;
    }
    // +5 se o jogo foi aos pênaltis e acertou quem venceu neles
    if(j.ate_onde === "penaltis"
       && j.penaltis_vencedor && p.palpite_penaltis
       && p.palpite_penaltis === j.penaltis_vencedor){
      pts += 5;
    }
  }
  return pts;
}

function flash(txt){
  const f = el("flash"); f.textContent = txt; f.classList.add("show");
  setTimeout(()=>f.classList.remove("show"), 1600);
}
function msgLogin(txt, tipo){
  const m = el("login-msg"); m.textContent = txt; m.className = "msg " + tipo;
}

// ============================================================
//  AUTENTICAÇÃO
// ============================================================
async function entrar(){
  const u = el("in-user").value.trim().toLowerCase();
  const p = el("in-pass").value;
  if(!u || !p){ msgLogin("Preencha usuário e senha.", "erro"); return; }
  msgLogin("Entrando...", "ok");
  const { error } = await sb.auth.signInWithPassword({ email: u+DOMINIO_FAKE, password: p });
  if(error){ msgLogin("Usuário ou senha incorretos.", "erro"); return; }
  await iniciarApp();
}

async function criarConta(){
  const u = el("in-user").value.trim().toLowerCase();
  const p = el("in-pass").value;
  if(!u || !p){ msgLogin("Escolha um usuário e uma senha.", "erro"); return; }
  if(p.length < 6){ msgLogin("A senha precisa de ao menos 6 caracteres.", "erro"); return; }
  if(!/^[a-z0-9_]+$/.test(u)){ msgLogin("Usuário só pode ter letras, números e _ (sem espaços).", "erro"); return; }
  msgLogin("Criando conta...", "ok");
  const { data, error } = await sb.auth.signUp({ email: u+DOMINIO_FAKE, password: p });
  if(error){
    msgLogin(error.message.includes("already") ? "Esse usuário já existe. Tente entrar." : "Erro ao criar conta.", "erro");
    return;
  }
  // cria o perfil ligado ao usuário
  const uid = data.user.id;
  const { error: e2 } = await sb.from("perfis").insert({ id: uid, usuario: u });
  if(e2 && !e2.message.includes("duplicate")){ msgLogin("Conta criada, mas houve erro no perfil. Avise o organizador.", "erro"); }
  // alguns projetos exigem confirmar e-mail; como é fake, normalmente já loga.
  if(!data.session){
    const { error: e3 } = await sb.auth.signInWithPassword({ email: u+DOMINIO_FAKE, password: p });
    if(e3){ msgLogin("Conta criada! Agora clique em Entrar.", "ok"); return; }
  }
  await iniciarApp();
}

async function sair(){
  await sb.auth.signOut();
  location.reload();
}

// ============================================================
//  CARREGAR DADOS E INICIAR
// ============================================================
async function iniciarApp(){
  const { data: sess } = await sb.auth.getSession();
  if(!sess.session){ return; } // continua na tela de login

  const uid = sess.session.user.id;
  const { data: perfil } = await sb.from("perfis").select("*").eq("id", uid).single();
  if(!perfil){
    // perfil ainda não existe (raro): cria a partir do email fake
    const emailLocal = sess.session.user.email.replace(DOMINIO_FAKE,"");
    await sb.from("perfis").insert({ id: uid, usuario: emailLocal });
    EU = { id: uid, usuario: emailLocal, moderador: false };
  } else {
    EU = perfil;
  }

  // jogos
  const { data: jogos } = await sb.from("jogos").select("*").order("inicio");
  JOGOS = jogos || [];

  // fase padrão = a do PRÓXIMO jogo a acontecer (segue o calendário sozinho)
  const fasePadrao = faseAtualPadrao();
  filtroFase = fasePadrao;
  revFase = fasePadrao;
  modFase = fasePadrao;

  // meus palpites
  const { data: meus } = await sb.from("palpites").select("*").eq("user_id", uid);
  MEUS = {};
  (meus||[]).forEach(p => MEUS[p.jogo_id] = { gm:p.gols_mandante, gv:p.gols_visitante, palpite_prorrogacao:p.palpite_prorrogacao, palpite_penaltis:p.palpite_penaltis });

  // mostrar app
  el("tela-login").classList.add("hidden");
  el("tela-app").classList.remove("hidden");
  el("user-nome").textContent = "@" + EU.usuario;
  if(EU.moderador){ el("user-mod").classList.remove("hidden"); el("tab-mod").classList.remove("hidden"); }
  // aba de chaveamento aparece quando houver jogos de mata-mata cadastrados
  if(temMataMata()){ el("tab-chave").classList.remove("hidden"); }

  renderAba();
}

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function trocarAba(nome){
  ABA = nome;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on", b.dataset.aba===nome));
  ["palpites","ranking","revelados","chave","moderador"].forEach(a=>{
    el("aba-"+a).classList.toggle("hidden", a!==nome);
  });
  renderAba();
}
function renderAba(){
  if(ABA==="palpites") renderPalpites();
  if(ABA==="ranking") renderRanking();
  if(ABA==="revelados") renderRevelados();
  if(ABA==="chave") renderChave();
  if(ABA==="moderador") renderModerador();
}

// ============================================================
//  ABA: MEUS PALPITES
// ============================================================
async function renderPalpites(){
  const cont = el("aba-palpites");
  // especiais
  const { data: esp } = await sb.from("palpites_especiais").select("*").eq("user_id", EU.id).maybeSingle();
  const campeao = esp?.campeao || "";
  const artilheiro = esp?.artilheiro || "";

  const grupos = [...new Set(JOGOS.map(j=>j.grupo))].sort();
  let h = `
    <div class="esp-card">
      <h3>⭐ Palpites especiais <small style="font-weight:400;color:var(--txt2);font-size:12px">(50 pts cada)</small></h3>
      <p class="hint">${especiaisAbertos()
        ? "Escolha antes do primeiro jogo (11/06 16:00). Depois disso, congela. Ficam visíveis a todos."
        : "⛔ Mercado fechado — começou no primeiro jogo. Seus palpites estão congelados."}</p>
      <div class="esp-row">
        <label>Campeão</label>
        <select class="inp" id="sel-campeao" ${especiaisAbertos()?"":"disabled"}><option value="">— escolher —</option>
          ${SELECOES.map(s=>`<option ${s===campeao?"selected":""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="esp-row">
        <label>Artilheiro</label>
        <input class="inp" id="in-artilheiro" placeholder="nome do jogador" value="${artilheiro.replace(/"/g,'&quot;')}" ${especiaisAbertos()?"":"disabled"}>
      </div>
      ${especiaisAbertos() ? `<button class="btn" style="margin-top:6px" id="bt-esp">Salvar especiais</button>` : ``}
    </div>

    <div class="filtros" id="filtros-fase">
      <span class="lbl">Fase:</span>
      <button class="chip ${filtroFase==='grupos'?'on':''}" data-fase="grupos">Fase de grupos</button>
      ${FASES_MATA.filter(f=>JOGOS.some(j=>j.grupo===f)).map(f=>`<button class="chip ${filtroFase===f?'on':''}" data-fase="${f}">${FASE_LABEL[f]}</button>`).join("")}
    </div>
    <div class="filtros ${filtroFase==='grupos'?'':'hidden'}" id="filtros-grupos-rodada">
      <span class="lbl">Rodada:</span>
      ${["todas",1,2,3].map(r=>`<button class="chip ${filtroRodada==r?'on':''}" data-rod="${r}">${r==="todas"?"todas":r+"ª"}</button>`).join("")}
    </div>
    <div class="filtros ${filtroFase==='grupos'?'':'hidden'}" id="filtros-grupos-letra">
      <span class="lbl">Grupo:</span>
      <button class="chip ${filtroGrupo==='todos'?'on':''}" data-grp="todos">todos</button>
      ${[...new Set(JOGOS.filter(j=>!ehMata(j.grupo)).map(j=>j.grupo))].sort().map(g=>`<button class="chip ${filtroGrupo===g?'on':''}" data-grp="${g}">${g}</button>`).join("")}
    </div>
    <div id="lista-jogos"></div>
  `;
  cont.innerHTML = h;

  const btEsp = el("bt-esp");
  if(btEsp) btEsp.onclick = salvarEspeciais;
  // seletor de FASE
  cont.querySelectorAll("[data-fase]").forEach(b=>b.onclick=()=>{
    filtroFase = b.dataset.fase;
    cont.querySelectorAll("[data-fase]").forEach(x=>x.classList.toggle("on", x.dataset.fase===b.dataset.fase));
    // mostra/esconde filtros de rodada e grupo (só na fase de grupos)
    const mostra = filtroFase==="grupos";
    el("filtros-grupos-rodada").classList.toggle("hidden", !mostra);
    el("filtros-grupos-letra").classList.toggle("hidden", !mostra);
    renderListaJogos();
  });
  cont.querySelectorAll("[data-rod]").forEach(b=>b.onclick=()=>{
    filtroRodada = b.dataset.rod==="todas"?"todas":+b.dataset.rod;
    cont.querySelectorAll("[data-rod]").forEach(x=>x.classList.toggle("on", x.dataset.rod===b.dataset.rod));
    renderListaJogos();
  });
  cont.querySelectorAll("[data-grp]").forEach(b=>b.onclick=()=>{
    filtroGrupo=b.dataset.grp;
    cont.querySelectorAll("[data-grp]").forEach(x=>x.classList.toggle("on", x.dataset.grp===b.dataset.grp));
    renderListaJogos();
  });

  renderListaJogos();
}

function renderListaJogos(){
  const lista = el("lista-jogos");
  let js;
  if (filtroFase === "grupos") {
    // fase de grupos: aplica filtros de rodada e grupo (letra)
    js = JOGOS.filter(j =>
      !ehMata(j.grupo) &&
      (filtroGrupo==="todos" || j.grupo===filtroGrupo) &&
      (filtroRodada==="todas" || j.rodada===filtroRodada)
    );
  } else {
    // fase do mata-mata: mostra só os jogos daquela fase
    js = JOGOS.filter(j => j.grupo === filtroFase);
  }
  if(!js.length){ lista.innerHTML = `<p class="vazio">Nenhum jogo com esse filtro.</p>`; return; }

  let h = ""; let ultimoDia = "";
  js.forEach(j=>{
    const diaKey = fmtData(j.inicio);
    if(diaKey !== ultimoDia){ h += `<div class="dia-sep">${diaKey}</div>`; ultimoDia = diaKey; }
    const aberto = jogoAberto(j);
    const p = MEUS[j.id];
    const brM = j.mandante==="Brasil" ? "br":"";
    const brV = j.visitante==="Brasil" ? "br":"";
    const pt = pontos(p, j);
    h += `
      <div class="jogo">
        <div class="jogo-topo">
          <div class="jogo-meta"><span class="grp-tag">${rotuloFase(j.grupo)}</span> ${fmtData(j.inicio)} · ${fmtHora(j.inicio)}h</div>
          <span class="estado ${aberto?'aberto':'fechado'}">${aberto?'aberto':'fechado'}</span>
        </div>
        <div class="confronto">
          <div class="time dir ${brM}">${j.mandante} ${bandeira(j.mandante,18)}</div>
          <input class="placar-in" type="number" min="0" inputmode="numeric"
            data-jogo="${j.id}" data-lado="gm" value="${p?p.gm:''}" ${aberto?'':'disabled'} aria-label="gols ${j.mandante}">
          <span class="x">×</span>
          <input class="placar-in" type="number" min="0" inputmode="numeric"
            data-jogo="${j.id}" data-lado="gv" value="${p?p.gv:''}" ${aberto?'':'disabled'} aria-label="gols ${j.visitante}">
          <div class="time ${brV}">${bandeira(j.visitante,18)} ${j.visitante}</div>
        </div>
        ${ehMata(j.grupo) ? blocoMataMata(j, p, aberto) : ''}
        ${temResultado(j) ? `<div class="resultado-real">Resultado: ${j.gols_mandante} × ${j.gols_visitante} ${pt!==null?`<span class="pts-tag pts-${pt}">+${pt} pts</span>`:''}</div>`:''}
      </div>`;
  });
  lista.innerHTML = h;

  lista.querySelectorAll(".placar-in").forEach(inp=>{
    inp.onchange = () => salvarPalpite(inp.dataset.jogo);
  });
  // cliques nos seletores de prorrogação/pênaltis
  lista.querySelectorAll(".mm-op").forEach(btn=>{
    btn.onclick = () => {
      if(btn.classList.contains("lock")) return;
      const jogo = btn.dataset.jogo, tipo = btn.dataset.tipo, val = btn.dataset.val;
      // marca visualmente (desmarca os irmãos do mesmo tipo)
      btn.parentElement.querySelectorAll(".mm-op").forEach(s=>s.classList.toggle("on", s===btn));
      salvarPalpiteMata(jogo, tipo, val);
    };
  });
}

// HTML dos seletores de prorrogação e pênaltis (só mata-mata)
function blocoMataMata(j, p, aberto){
  const lock = aberto ? '' : 'lock';
  const proSel = p?.palpite_prorrogacao || '';
  const penSel = p?.palpite_penaltis || '';
  const op = (tipo, val, txt, sel) =>
    `<div class="mm-op ${sel===val?'on':''} ${lock}" data-jogo="${j.id}" data-tipo="${tipo}" data-val="${val}">${txt}</div>`;
  return `
    <div class="mm-extra">
      <div class="mm-linha">
        <div class="mm-pergunta">Se for pra prorrogação, quem vence?</div>
        <div class="mm-ops">
          ${op('pro','M', j.mandante, proSel)}
          ${op('pro','E','Empate', proSel)}
          ${op('pro','V', j.visitante, proSel)}
        </div>
      </div>
      <div class="mm-linha">
        <div class="mm-pergunta">Se for pra pênaltis, quem vence?</div>
        <div class="mm-ops">
          ${op('pen','M', j.mandante, penSel)}
          ${op('pen','V', j.visitante, penSel)}
        </div>
      </div>
      <div class="mm-dica">dica: você pode pontuar aqui independente do seu palpite para os 90 minutos!</div>
    </div>`;
}

async function salvarPalpite(jogoId){
  const gmEl = document.querySelector(`[data-jogo="${jogoId}"][data-lado="gm"]`);
  const gvEl = document.querySelector(`[data-jogo="${jogoId}"][data-lado="gv"]`);
  const gm = gmEl.value === "" ? null : parseInt(gmEl.value);
  const gv = gvEl.value === "" ? null : parseInt(gvEl.value);
  if(gm===null || gv===null) return; // só salva quando os dois estão preenchidos
  if(gm<0 || gv<0) return;

  // TRAVA EM TEMPO REAL: reconfere o horário AGORA, mesmo sem recarregar a página.
  const jogo = JOGOS.find(j=>j.id===jogoId);
  if(jogo && !jogoAberto(jogo)){
    // jogo já começou: trava os campos na tela e restaura o palpite anterior (ou vazio)
    gmEl.disabled = true; gvEl.disabled = true;
    const ant = MEUS[jogoId];
    gmEl.value = ant ? ant.gm : "";
    gvEl.value = ant ? ant.gv : "";
    flash("⛔ Jogo já começou — não dá mais pra palpitar");
    return;
  }

  const { error } = await sb.from("palpites").upsert({
    user_id: EU.id, jogo_id: jogoId, gols_mandante: gm, gols_visitante: gv, atualizado_em: new Date().toISOString()
  }, { onConflict: "user_id,jogo_id" });

  if(error){
    // o banco recusou (provavelmente jogo começou entre o clique e o envio): desfaz na tela
    gmEl.disabled = true; gvEl.disabled = true;
    const ant = MEUS[jogoId];
    gmEl.value = ant ? ant.gm : "";
    gvEl.value = ant ? ant.gv : "";
    flash("⛔ Não foi salvo — o jogo já começou");
    return;
  }
  MEUS[jogoId] = { ...(MEUS[jogoId]||{}), gm, gv };
  flash("✓ Palpite salvo");
}

// Salva o palpite de prorrogação ('pro') ou pênaltis ('pen') de um jogo de mata-mata.
async function salvarPalpiteMata(jogoId, tipo, val){
  const jogo = JOGOS.find(j=>j.id===jogoId);
  if(jogo && !jogoAberto(jogo)){ flash("⛔ Jogo já começou"); return; }

  const campo = tipo==='pro' ? 'palpite_prorrogacao' : 'palpite_penaltis';
  // guarda no estado local
  MEUS[jogoId] = { ...(MEUS[jogoId]||{}), [campo]: val };

  const { error } = await sb.from("palpites").upsert({
    user_id: EU.id, jogo_id: jogoId,
    [campo]: val,
    atualizado_em: new Date().toISOString()
  }, { onConflict: "user_id,jogo_id" });

  if(error){ flash("⛔ Erro ao salvar"); console.error(error); }
  else flash("✓ Palpite salvo");
}

// RELÓGIO INTERNO: a cada 30s, trava na tela os jogos que já começaram,
// sem precisar recarregar a página. Fecha a brecha de deixar a aba aberta.
function travarJogosVencidos(){
  if(ABA !== "palpites") return;
  JOGOS.forEach(j=>{
    if(!jogoAberto(j)){
      const gm = document.querySelector(`[data-jogo="${j.id}"][data-lado="gm"]`);
      const gv = document.querySelector(`[data-jogo="${j.id}"][data-lado="gv"]`);
      if(gm && !gm.disabled){
        gm.disabled = true; gv.disabled = true;
        // atualiza o selo "aberto" -> "fechado" no card
        const card = gm.closest(".jogo");
        const selo = card && card.querySelector(".estado");
        if(selo){ selo.classList.remove("aberto"); selo.classList.add("fechado"); selo.textContent = "fechado"; }
      }
    }
  });
}
setInterval(travarJogosVencidos, 30000); // a cada 30 segundos

async function salvarEspeciais(){
  if(!especiaisAbertos()){ flash("⛔ Mercado fechado — não dá mais pra mudar"); return; }
  const campeao = el("sel-campeao").value || null;
  const artilheiro = el("in-artilheiro").value.trim() || null;
  const { error } = await sb.from("palpites_especiais").upsert({
    user_id: EU.id, campeao, artilheiro, atualizado_em: new Date().toISOString()
  }, { onConflict: "user_id" });
  flash(error ? "⚠ Erro ao salvar" : "✓ Especiais salvos");
}

// ============================================================
//  ABA: CLASSIFICAÇÃO
// ============================================================
async function renderRanking(){
  const cont = el("aba-ranking");
  cont.innerHTML = `<div class="loader">Calculando...</div>`;
  const { data, error } = await sb.from("classificacao").select("*");
  if(error || !data){ cont.innerHTML = `<p class="vazio">Erro ao carregar o ranking.</p>`; return; }

  const medalhas = ["🥇","🥈","🥉"];
  let h = "";
  data.forEach((r,i)=>{
    const eu = r.user_id === EU.id;
    const pos = medalhas[i] || `${i+1}º`;
    h += `
      <div class="rank-row ${eu?'eu':''}">
        <div class="rank-pos">${pos}</div>
        <div class="rank-nome">@${r.usuario} ${eu?'<small style="color:var(--verde-claro)">(você)</small>':''}
          <div class="rank-det">${r.exatos} placares exatos${r.acertou_artilheiro?' · ✓ artilheiro':''}${r.acertou_campeao?' · ✓ campeão':''}</div>
        </div>
        <div class="rank-pts">${r.total}<small> pts</small></div>
      </div>`;
  });
  h += `<p class="hint" style="text-align:center;color:var(--txt2);font-size:12px;margin-top:14px">Desempate: artilheiro → campeão → nº de placares exatos</p>`;
  cont.innerHTML = h || `<p class="vazio">Sem participantes ainda.</p>`;
}

// ============================================================
//  ABA: REVELADOS
// ============================================================
async function renderRevelados(){
  const cont = el("aba-revelados");
  cont.innerHTML = `<div class="loader">Carregando...</div>`;

  const { data: perfis } = await sb.from("perfis").select("id,usuario");
  const { data: esp } = await sb.from("palpites_especiais").select("*");
  const todos = await buscarTodos("palpites");

  const nome = {}; (perfis||[]).forEach(p=>nome[p.id]=p.usuario);
  const espMap = {}; (esp||[]).forEach(e=>espMap[e.user_id]=e);
  const porJogo = {}; (todos||[]).forEach(p=>{ (porJogo[p.jogo_id]=porJogo[p.jogo_id]||[]).push(p); });

  const grupos = [...new Set(JOGOS.map(j=>j.grupo))].sort();

  // ---- ESPECIAIS (accordion no topo) ----
  let espRows = (perfis||[]).map(p=>{
    const e = espMap[p.id]||{};
    const campTxt = e.campeao ? `${bandeira(e.campeao,16)} ${e.campeao}` : '—';
    const artTxt = e.artilheiro
      ? `${e.artilheiro}${e.artilheiro_ok ? ' <span class="acerto">✓</span>' : ''}`
      : '—';
    return `<tr><td>@${p.usuario}</td><td>${campTxt}</td><td>${artTxt}</td></tr>`;
  }).join("");

  let h = `
    <div class="acc aberto" data-acc="especiais">
      <div class="acc-cab" data-toggle="especiais">
        <span class="acc-titulo">⭐ Palpites especiais</span>
        <span class="seta">▶</span>
      </div>
      <div class="acc-corpo">
        <table class="esp-tab"><tr><th>Jogador</th><th>Campeão</th><th>Artilheiro</th></tr>${espRows}</table>
      </div>
    </div>

    <div class="filtros" id="rev-filtros-fase">
      <span class="lbl">Fase:</span>
      <button class="chip ${revFase==='grupos'?'on':''}" data-revfase="grupos">Fase de grupos</button>
      ${FASES_MATA.filter(f=>JOGOS.some(j=>j.grupo===f)).map(f=>`<button class="chip ${revFase===f?'on':''}" data-revfase="${f}">${FASE_LABEL[f]}</button>`).join("")}
    </div>
    <div class="filtros ${revFase==='grupos'?'':'hidden'}" id="rev-filtros-rodada">
      <span class="lbl">Rodada:</span>
      ${["todas",1,2,3].map(r=>`<button class="chip ${revRodada==r?'on':''}" data-revrod="${r}">${r==="todas"?"todas":r+"ª"}</button>`).join("")}
    </div>
    <div class="filtros ${revFase==='grupos'?'':'hidden'}" id="rev-filtros-grupo">
      <span class="lbl">Grupo:</span>
      <button class="chip ${revGrupo==='todos'?'on':''}" data-revgrp="todos">todos</button>
      ${[...new Set(JOGOS.filter(j=>!ehMata(j.grupo)).map(j=>j.grupo))].sort().map(g=>`<button class="chip ${revGrupo===g?'on':''}" data-revgrp="${g}">${g}</button>`).join("")}
    </div>
    <div id="rev-lista"></div>
  `;
  cont.innerHTML = h;

  // guardar dados para a sublista poder redesenhar com filtro sem rebuscar
  cont._revData = { porJogo, nome };

  // eventos: toggle do accordion de especiais + filtros
  cont.querySelector('[data-toggle="especiais"]').onclick = (ev)=>{
    ev.currentTarget.closest(".acc").classList.toggle("aberto");
  };
  cont.querySelectorAll("[data-revfase]").forEach(b=>b.onclick=()=>{
    revFase = b.dataset.revfase;
    cont.querySelectorAll("[data-revfase]").forEach(x=>x.classList.toggle("on",x.dataset.revfase===b.dataset.revfase));
    const mostra = revFase==="grupos";
    el("rev-filtros-rodada").classList.toggle("hidden", !mostra);
    el("rev-filtros-grupo").classList.toggle("hidden", !mostra);
    renderRevList();
  });
  cont.querySelectorAll("[data-revrod]").forEach(b=>b.onclick=()=>{
    revRodada = b.dataset.revrod==="todas"?"todas":+b.dataset.revrod;
    cont.querySelectorAll("[data-revrod]").forEach(x=>x.classList.toggle("on",x.dataset.revrod===b.dataset.revrod));
    renderRevList();
  });
  cont.querySelectorAll("[data-revgrp]").forEach(b=>b.onclick=()=>{
    revGrupo = b.dataset.revgrp;
    cont.querySelectorAll("[data-revgrp]").forEach(x=>x.classList.toggle("on",x.dataset.revgrp===b.dataset.revgrp));
    renderRevList();
  });

  renderRevList();
}

// Desenha a lista de jogos revelados (accordion por jogo), aplicando os filtros.
function renderRevList(){
  const cont = el("aba-revelados");
  const lista = el("rev-lista");
  const { porJogo, nome } = cont._revData || { porJogo:{}, nome:{} };

  // só jogos fechados; aplica filtro de fase/grupo/rodada; mais recentes primeiro
  let fechados = JOGOS
    .filter(j => !jogoAberto(j))
    .filter(j => {
      if (revFase === "grupos") {
        return !ehMata(j.grupo)
          && (revGrupo==="todos"||j.grupo===revGrupo)
          && (revRodada==="todas"||j.rodada===revRodada);
      }
      return j.grupo === revFase; // fase do mata-mata
    })
    .sort((a,b)=>new Date(b.inicio)-new Date(a.inicio));

  if(!fechados.length){
    lista.innerHTML = `<p class="vazio">Nenhum jogo fechado com esse filtro.<br>Os palpites aparecem aqui após o apito de cada jogo.</p>`;
    return;
  }

  let h = "";
  fechados.forEach(j=>{
    const ps = porJogo[j.id]||[];
    // título: "México 2 × 0 África do Sul" se tiver resultado, senão sem placar
    const resTitulo = temResultado(j)
      ? `<span class="acc-resultado">${j.gols_mandante} × ${j.gols_visitante}</span>`
      : `<span class="acc-pend">(aguardando resultado)</span>`;
    h += `
      <div class="acc" data-acc="${j.id}">
        <div class="acc-cab" data-jogoacc="${j.id}">
          <span class="acc-titulo">
            ${bandeira(j.mandante,17)} ${j.mandante} ${resTitulo} ${bandeira(j.visitante,17)} ${j.visitante}
          </span>
          <span class="seta">▶</span>
        </div>
        <div class="acc-corpo">
          <p class="acc-pend" style="margin:2px 0 8px">${rotuloFase(j.grupo)} · ${fmtData(j.inicio)} · ${ps.length} palpite${ps.length===1?'':'s'}</p>`;
    if(!ps.length){
      h += `<p class="oculto">Ninguém palpitou neste jogo.</p>`;
    } else {
      // ordenar por pontos (maior primeiro) quando há resultado
      const ordenados = temResultado(j)
        ? ps.slice().sort((a,b)=> (pontos({gm:b.gols_mandante,gv:b.gols_visitante},j)||0) - (pontos({gm:a.gols_mandante,gv:a.gols_visitante},j)||0))
        : ps;
      ordenados.forEach(p=>{
        const pt = pontos({gm:p.gols_mandante,gv:p.gols_visitante}, j);
        h += `<div class="rev-linha"><span>@${nome[p.user_id]||'?'}</span>
          <span>${p.gols_mandante} × ${p.gols_visitante} ${pt!==null?`<span class="pts-tag pts-${pt}">+${pt}</span>`:''}</span></div>`;
      });
    }
    h += `</div></div>`;
  });
  lista.innerHTML = h;

  // toggle de cada jogo
  lista.querySelectorAll("[data-jogoacc]").forEach(cab=>{
    cab.onclick = ()=> cab.closest(".acc").classList.toggle("aberto");
  });
}

// ============================================================
//  ABA: CHAVEAMENTO (árvore do mata-mata)
// ============================================================
function renderChave(){
  const cont = el("aba-chave");
  const mata = JOGOS.filter(j => ehMata(j.grupo));
  if(!mata.length){
    cont.innerHTML = `<p class="chave-vazio">O mata-mata ainda não começou.<br>Os confrontos aparecem aqui conforme forem definidos.</p>`;
    return;
  }
  // agrupa por fase, na ordem certa
  const porFase = {};
  mata.forEach(j => { (porFase[j.grupo] = porFase[j.grupo] || []).push(j); });
  const fasesOrdenadas = Object.keys(porFase).sort((a,b)=>ordemFase(a)-ordemFase(b));

  let h = "";
  fasesOrdenadas.forEach(fase => {
    const jogos = porFase[fase].sort((a,b)=>new Date(a.inicio)-new Date(b.inicio));
    h += `<div class="chave-fase">
      <div class="chave-fase-tit">${FASE_LABEL[fase] || fase}</div>`;
    jogos.forEach(j => {
      const tem = temResultado(j);
      const gm = tem ? j.gols_mandante : "";
      const gv = tem ? j.gols_visitante : "";
      // destaque do vencedor (só quando há resultado e não é empate)
      let clsM = "", clsV = "";
      if(tem && j.gols_mandante !== j.gols_visitante){
        if(j.gols_mandante > j.gols_visitante){ clsM = "venceu"; clsV = "perdeu"; }
        else { clsV = "venceu"; clsM = "perdeu"; }
      }
      h += `<div class="chave-jogo">
        <div class="chave-lado ${clsM}">
          ${bandeira(j.mandante,16)}<span class="nome">${j.mandante}</span><span class="gol">${gm}</span>
        </div>
        <div class="chave-vs">VS</div>
        <div class="chave-lado ${clsV}">
          ${bandeira(j.visitante,16)}<span class="nome">${j.visitante}</span><span class="gol">${gv}</span>
        </div>
        <div class="chave-data">${fmtData(j.inicio)} · ${fmtHora(j.inicio)}h${j.gols_mandante===j.gols_visitante && tem ? ' · decidido nos pênaltis' : ''}</div>
      </div>`;
    });
    h += `</div>`;
  });
  cont.innerHTML = h;
}


// ============================================================
//  ABA: MODERADOR
// ============================================================
async function renderModerador(){
  const cont = el("aba-moderador");
  const { data: cfg } = await sb.from("config").select("*").single();
  const { data: perfis } = await sb.from("perfis").select("id,usuario");
  const { data: esp } = await sb.from("palpites_especiais").select("*");
  const espMap = {}; (esp||[]).forEach(e=>espMap[e.user_id]=e);

  let h = `<div class="mod-aviso">⚙ Você lança os resultados aqui. O placar dos palpites trava sozinho no horário de cada jogo — você não precisa abrir nem fechar nada.</div>`;

  // Gabarito do CAMPEÃO (continua automático por texto)
  h += `<div class="esp-card"><h3>🏆 Gabarito do campeão</h3>
    <p class="hint">Preencha no fim da Copa. Quem escreveu esta seleção ganha 50 pts (automático).</p>
    <div class="esp-row"><label>Campeão</label>
      <select class="inp" id="cfg-campeao"><option value="">—</option>
        ${SELECOES.map(s=>`<option ${cfg?.campeao_real===s?'selected':''}>${s}</option>`).join("")}
      </select></div>
    <button class="btn" style="margin-top:6px" id="bt-cfg">Salvar campeão</button>
  </div>`;

  // Validação MANUAL do ARTILHEIRO (joinha por pessoa)
  const nValidados = (perfis||[]).filter(p=>espMap[p.id]?.artilheiro_ok).length;
  const nComPalpite = (perfis||[]).filter(p=>espMap[p.id]?.artilheiro).length;
  h += `<div class="acc" data-acc="valid-art">
    <div class="acc-cab" data-toggle="valid-art">
      <span class="acc-titulo">⚽ Validar artilheiro <small style="font-weight:400;color:var(--txt2);font-size:12px">(50 pts)</small></span>
      ${nValidados>0 ? `<span class="acc-resultado">${nValidados} ✓</span>` : `<span class="acc-pend">${nComPalpite} palpite${nComPalpite===1?'':'s'}</span>`}
      <span class="seta">▶</span>
    </div>
    <div class="acc-corpo">
      <p class="hint" style="margin-top:4px">O texto de cada um fica intocado. Você marca quem acertou — mesmo apelidos como "Furacão" valem se você validar.</p>`;
  if(!perfis || !perfis.length){
    h += `<p class="oculto">Nenhum participante ainda.</p>`;
  } else {
    perfis.forEach(p=>{
      const e = espMap[p.id] || {};
      const palpite = e.artilheiro || "—";
      const ok = !!e.artilheiro_ok;
      const temPalpite = !!e.artilheiro;
      h += `<div class="mod-jogo">
        <div class="nomes">@${p.usuario}<div class="data">palpite: <b style="color:var(--txt)">${palpite}</b></div></div>
        <button class="chip ${ok?'on':''}" data-valida="${p.id}" ${temPalpite?'':'disabled'} style="${temPalpite?'':'opacity:.4'}">
          ${ok?'✓ acertou':'marcar acerto'}
        </button>
      </div>`;
    });
  }
  h += `</div></div>`;

  h += `<h3 style="margin:18px 0 10px;font-size:16px">📋 Lançar resultados</h3>
    <div class="filtros" id="mod-filtros-fase">
      <span class="lbl">Fase:</span>
      <button class="chip ${modFase==='grupos'?'on':''}" data-modfase="grupos">Fase de grupos</button>
      ${FASES_MATA.filter(f=>JOGOS.some(j=>j.grupo===f)).map(f=>`<button class="chip ${modFase===f?'on':''}" data-modfase="${f}">${FASE_LABEL[f]}</button>`).join("")}
    </div>
    <div id="mod-lista-jogos"></div>`;
  cont.innerHTML = h;

  // abrir/fechar o accordion de validação do artilheiro
  const toggleArt = cont.querySelector('[data-toggle="valid-art"]');
  if(toggleArt) toggleArt.onclick = ()=> toggleArt.closest(".acc").classList.toggle("aberto");

  // seletor de fase do moderador
  cont.querySelectorAll("[data-modfase]").forEach(b=>b.onclick=()=>{
    modFase = b.dataset.modfase;
    cont.querySelectorAll("[data-modfase]").forEach(x=>x.classList.toggle("on", x.dataset.modfase===b.dataset.modfase));
    renderModListaJogos();
  });
  renderModListaJogos();

  el("bt-cfg").onclick = async ()=>{
    const { error } = await sb.from("config").update({
      campeao_real: el("cfg-campeao").value||null
    }).eq("id",1);
    flash(error?"⚠ Erro":"✓ Campeão salvo");
  };
  // botões de validação do artilheiro (joinha por pessoa)
  cont.querySelectorAll("[data-valida]").forEach(bt=>{
    bt.onclick = async ()=>{
      const uid = bt.dataset.valida;
      const ligando = !bt.classList.contains("on"); // novo estado
      const { error } = await sb.from("palpites_especiais")
        .update({ artilheiro_ok: ligando }).eq("user_id", uid);
      if(error){ flash("⚠ Erro ao validar"); return; }
      bt.classList.toggle("on", ligando);
      bt.textContent = ligando ? "✓ acertou" : "marcar acerto";
      flash(ligando ? "✓ Acerto marcado" : "Acerto removido");
    };
  });
}

// Desenha a lista de jogos no painel do moderador, filtrada pela fase selecionada.
// Jogos de mata-mata ganham controles extras (até onde foi + vencedor prorrog/pênaltis).
function renderModListaJogos(){
  const lista = el("mod-lista-jogos");
  let js;
  if(modFase === "grupos") js = JOGOS.filter(j => !ehMata(j.grupo));
  else js = JOGOS.filter(j => j.grupo === modFase);

  if(!js.length){ lista.innerHTML = `<p class="vazio">Nenhum jogo nesta fase.</p>`; return; }

  let h = ""; let ultimoDia = "";
  js.forEach(j=>{
    const diaKey = fmtData(j.inicio);
    if(diaKey !== ultimoDia){ h += `<div class="dia-sep">${diaKey}</div>`; ultimoDia = diaKey; }
    h += `<div class="mod-jogo" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="nomes">${bandeira(j.mandante,16)} ${j.mandante} × ${j.visitante} ${bandeira(j.visitante,16)}<div class="data">${fmtData(j.inicio)} ${fmtHora(j.inicio)}h</div></div>
        <input class="placar-in" type="number" min="0" data-res="${j.id}" data-lado="gm" value="${j.gols_mandante??''}" aria-label="resultado ${j.mandante}">
        <span class="x">×</span>
        <input class="placar-in" type="number" min="0" data-res="${j.id}" data-lado="gv" value="${j.gols_visitante??''}" aria-label="resultado ${j.visitante}">
      </div>`;
    // controles extras só pra mata-mata
    if(ehMata(j.grupo)){
      const ate = j.ate_onde || '90';
      const proR = j.prorrogacao_result || '';
      const penV = j.penaltis_vencedor || '';
      const opAte = (val,txt) => `<div class="mm-op ${ate===val?'on':''}" data-modate="${j.id}" data-val="${val}">${txt}</div>`;
      const opPro = (val,txt) => `<div class="mm-op ${proR===val?'on':''}" data-modpro="${j.id}" data-val="${val}">${txt}</div>`;
      const opPen = (val,txt) => `<div class="mm-op ${penV===val?'on':''}" data-modpen="${j.id}" data-val="${val}">${txt}</div>`;
      h += `<div class="mm-extra" style="width:100%">
        <div class="mm-linha">
          <div class="mm-pergunta">Até onde foi o jogo?</div>
          <div class="mm-ops">
            ${opAte('90','90 min')}
            ${opAte('prorrogacao','Prorrogação')}
            ${opAte('penaltis','Pênaltis')}
          </div>
        </div>
        <div class="mm-linha ${ate==='90'?'hidden':''}" data-modpro-linha="${j.id}">
          <div class="mm-pergunta">Quem venceu a prorrogação?</div>
          <div class="mm-ops">
            ${opPro('M', j.mandante)}
            ${opPro('E','Empate')}
            ${opPro('V', j.visitante)}
          </div>
        </div>
        <div class="mm-linha ${ate==='penaltis'?'':'hidden'}" data-modpen-linha="${j.id}">
          <div class="mm-pergunta">Quem venceu nos pênaltis?</div>
          <div class="mm-ops">
            ${opPen('M', j.mandante)}
            ${opPen('V', j.visitante)}
          </div>
        </div>
      </div>`;
    }
    h += `</div>`;
  });
  lista.innerHTML = h;

  // salvar placar
  lista.querySelectorAll("[data-res]").forEach(inp=>{
    inp.onchange = ()=>salvarResultado(inp.dataset.res);
  });
  // "até onde foi"
  lista.querySelectorAll("[data-modate]").forEach(btn=>{
    btn.onclick = ()=>{
      const jogoId = btn.dataset.modate, val = btn.dataset.val;
      btn.parentElement.querySelectorAll(".mm-op").forEach(s=>s.classList.toggle("on", s===btn));
      // mostra/esconde as perguntas seguintes conforme a escolha
      const proLinha = lista.querySelector(`[data-modpro-linha="${jogoId}"]`);
      const penLinha = lista.querySelector(`[data-modpen-linha="${jogoId}"]`);
      if(proLinha) proLinha.classList.toggle("hidden", val==='90');
      if(penLinha) penLinha.classList.toggle("hidden", val!=='penaltis');
      salvarResultadoExtra(jogoId, 'ate_onde', val);
    };
  });
  // vencedor da prorrogação
  lista.querySelectorAll("[data-modpro]").forEach(btn=>{
    btn.onclick = ()=>{
      btn.parentElement.querySelectorAll(".mm-op").forEach(s=>s.classList.toggle("on", s===btn));
      salvarResultadoExtra(btn.dataset.modpro, 'prorrogacao_result', btn.dataset.val);
    };
  });
  // vencedor dos pênaltis
  lista.querySelectorAll("[data-modpen]").forEach(btn=>{
    btn.onclick = ()=>{
      btn.parentElement.querySelectorAll(".mm-op").forEach(s=>s.classList.toggle("on", s===btn));
      salvarResultadoExtra(btn.dataset.modpen, 'penaltis_vencedor', btn.dataset.val);
    };
  });
}

// Salva um campo extra de resultado do mata-mata (ate_onde, prorrogacao_result, penaltis_vencedor)
async function salvarResultadoExtra(jogoId, campo, val){
  const { error } = await sb.from("jogos").update({ [campo]: val }).eq("id", jogoId);
  if(error){ flash("⚠ Erro ao salvar"); console.error(error); return; }
  const j = JOGOS.find(x=>x.id===jogoId);
  if(j) j[campo] = val;
  flash("✓ Salvo");
}

async function salvarResultado(jogoId){
  const gm = document.querySelector(`[data-res="${jogoId}"][data-lado="gm"]`).value;
  const gv = document.querySelector(`[data-res="${jogoId}"][data-lado="gv"]`).value;
  const upd = {
    gols_mandante: gm===""?null:parseInt(gm),
    gols_visitante: gv===""?null:parseInt(gv)
  };
  const { error } = await sb.from("jogos").update(upd).eq("id", jogoId);
  if(error){ flash("⚠ Erro ao salvar"); return; }
  const j = JOGOS.find(x=>x.id===jogoId);
  j.gols_mandante = upd.gols_mandante; j.gols_visitante = upd.gols_visitante;
  flash("✓ Resultado salvo");
}

// ============================================================
//  EVENTOS GLOBAIS + BOOT
// ============================================================
el("bt-entrar").onclick = entrar;
el("bt-criar").onclick = criarConta;
el("bt-sair").onclick = sair;
el("in-pass").addEventListener("keydown", e=>{ if(e.key==="Enter") entrar(); });
document.querySelectorAll("nav.tabs button").forEach(b=> b.onclick = ()=>trocarAba(b.dataset.aba));

// se já estiver logado (sessão salva), entra direto
iniciarApp();

// Expõe estado/funções para depuração no console do navegador (inofensivo).
// Ex.: no console dá pra inspecionar window.bolao.JOGOS
window.bolao = {
  get EU(){return EU}, set EU(v){EU=v},
  get JOGOS(){return JOGOS}, set JOGOS(v){JOGOS=v},
  get MEUS(){return MEUS}, set MEUS(v){MEUS=v},
  get filtroGrupo(){return filtroGrupo}, set filtroGrupo(v){filtroGrupo=v},
  get filtroRodada(){return filtroRodada}, set filtroRodada(v){filtroRodada=v},
  get filtroFase(){return filtroFase}, set filtroFase(v){filtroFase=v},
  get revFase(){return revFase}, set revFase(v){revFase=v},
  get modFase(){return modFase}, set modFase(v){modFase=v},
  faseAtualPadrao,
  jogoAberto, temResultado, pontos, fmtData, fmtHora,
  renderPalpites, renderListaJogos, renderChave, ehMata, rotuloFase
};
