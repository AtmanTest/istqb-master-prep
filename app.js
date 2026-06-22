const STORAGE_KEY = 'istqb_master_prep_v1';

const modulesData = await (async () => {
  const res = await fetch('./data/modules.json');
  return res.json();
})();

const questionsData = await (async () => {
  const res = await fetch('./data/questions.json');
  return res.json();
})();

function uid(prefix='id'){
  return prefix + '_' + Math.random().toString(16).slice(2) + '_' + Date.now();
}

function formatPercent(n){
  const x = Math.max(0, Math.min(100, n));
  return Math.round(x * 10) / 10 + '%';
}

function nowISO(){
  return new Date().toISOString();
}

function dayKey(d=new Date()){
  const yy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(a,b){
  // a,b: Date objects
  const ms = 24*60*60*1000;
  return Math.floor((b.getTime()-a.getTime())/ms);
}

function safeParse(json, fallback){
  try { return JSON.parse(json); } catch { return fallback; }
}

function defaultState(){
  return {
    user: {
      name: 'Vous',
      createdAt: nowISO(),
      lastStudyDay: null,
      streak: 0,
      longestStreak: 0,
    },
    modules: {}, // moduleId -> {completed:boolean, progressLessons: {lessonId: true/false}, progress:0-100}
    topicMastery: {}, // topicId -> { attempts, correct, lastReviewedAt, nextReviewAt, intervalDays }
    practice: {
      attempts: [] // {questionId, selectedIndex, correct, at, mode, topicId, chapterId}
    },
    mocks: {
      history: [] // {id, at, score, total, passed, answers: []}
    },
    bookmarks: {}, // questionId -> true
    ui: {
      reducedMotion: false,
    }
  };
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return defaultState();
  const st = safeParse(raw, null);
  if(!st) return defaultState();
  return {
    ...defaultState(),
    ...st,
    user: {...defaultState().user, ...(st.user||{})},
    modules: st.modules||{},
    topicMastery: st.topicMastery||{},
    practice: st.practice||{attempts:[]},
    mocks: st.mocks||{history:[]},
    bookmarks: st.bookmarks||{},
    ui: st.ui||{reducedMotion:false}
  };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getModuleById(id){
  return modulesData.modules.find(m=>m.id===id);
}

function getLessonById(moduleId, lessonId){
  const m = getModuleById(moduleId);
  return m?.lessons.find(l=>l.id===lessonId);
}

function isLessonCompleted(moduleId, lessonId){
  const ms = state.modules[moduleId];
  return !!ms?.progressLessons?.[lessonId];
}

function setLessonCompleted(moduleId, lessonId){
  if(!state.modules[moduleId]) state.modules[moduleId] = {completed:false, progressLessons:{}, progress:0};
  state.modules[moduleId].progressLessons[lessonId] = true;
  // update progress
  const m = getModuleById(moduleId);
  const total = m.lessons.length;
  const done = Object.values(state.modules[moduleId].progressLessons).filter(Boolean).length;
  const pct = total ? (done/total)*100 : 0;
  state.modules[moduleId].progress = Math.round(pct);
  if(done >= total){
    state.modules[moduleId].completed = true;
    // mark next section unlocked by logic in UI
  }
}

function isModuleUnlocked(moduleId){
  const idx = modulesData.modules.findIndex(m=>m.id===moduleId);
  if(idx<=0) return true;
  const prev = modulesData.modules[idx-1];
  return !!state.modules[prev.id]?.completed;
}

function computeOverallProgress(){
  const total = modulesData.modules.length;
  const done = modulesData.modules.filter(m=>state.modules[m.id]?.completed).length;
  if(!total) return 0;
  return Math.round((done/total)*100);
}

function computeStats(){
  const attempts = state.practice.attempts||[];
  const answered = attempts.length;
  let correct=0;
  for(const a of attempts){ if(a.correct) correct++; }
  const total = questionsData.questions.length;
  return {
    totalQuestions: total,
    answered,
    correctAnswers: correct,
    correctRate: answered ? (correct/answered)*100 : 0,
  };
}

function updateStreak(){
  const today = dayKey();
  if(state.user.lastStudyDay === today) return;
  const last = state.user.lastStudyDay;
  if(!last){
    state.user.streak = 1;
  } else {
    const lastDate = new Date(last+'T00:00:00');
    const todayDate = new Date(today+'T00:00:00');
    const diff = daysBetween(lastDate,todayDate);
    if(diff===1) state.user.streak = (state.user.streak||0)+1;
    else state.user.streak = 1;
  }
  state.user.lastStudyDay = today;
  state.user.longestStreak = Math.max(state.user.longestStreak||0, state.user.streak);
}

function ensureTopic(topicId){
  if(!state.topicMastery[topicId]){
    state.topicMastery[topicId] = { attempts:0, correct:0, intervalDays:1, nextReviewAt: null, lastReviewedAt:null };
  }
}

function scheduleReview(topicId, correct){
  ensureTopic(topicId);
  const t = state.topicMastery[topicId];
  // SM-2-like simplified
  if(correct){
    t.intervalDays = Math.min(30, (t.intervalDays||1) * 2);
  } else {
    t.intervalDays = 1;
  }
  const d = new Date();
  d.setDate(d.getDate() + (t.intervalDays||1));
  t.nextReviewAt = d.toISOString();
  t.lastReviewedAt = nowISO();
}

function recordAttempt({questionId, selectedIndex, correct, mode}){
  const q = questionsData.questions.find(x=>x.id===questionId);
  if(!q) return;
  const topicId = q.topicId;
  ensureTopic(topicId);

  state.topicMastery[topicId].attempts += 1;
  if(correct) state.topicMastery[topicId].correct += 1;

  state.practice.attempts.push({
    questionId,
    selectedIndex,
    correct,
    at: nowISO(),
    mode,
    topicId,
    chapterId: q.chapterId,
  });

  scheduleReview(topicId, correct);
  updateStreak();
}

function getTopicSuccessRate(topicId){
  const t = state.topicMastery[topicId];
  if(!t || !t.attempts) return null;
  return (t.correct / t.attempts) * 100;
}

function getWeakTopics(){
  // define weak as lowest success rate among those with >=2 attempts, else include never reviewed topics first.
  const topics = modulesData.topics;
  const scored = topics.map(tp=>{
    const t = state.topicMastery[tp.id];
    const attempts = t?.attempts || 0;
    const correct = t?.correct || 0;
    const rate = attempts ? (correct/attempts)*100 : 0;
    const nextReviewAt = t?.nextReviewAt;
    return { ...tp, attempts, correct, rate, nextReviewAt };
  });
  // prioritize those due or low rate
  const now = Date.now();
  scored.sort((a,b)=>{
    const aDue = a.nextReviewAt ? (new Date(a.nextReviewAt).getTime()<=now) : true;
    const bDue = b.nextReviewAt ? (new Date(b.nextReviewAt).getTime()<=now) : true;
    if(aDue!==bDue) return aDue? -1 : 1;
    // then lower rate, then fewer attempts
    if(a.rate!==b.rate) return a.rate - b.rate;
    return a.attempts - b.attempts;
  });
  return scored.slice(0,6);
}

function getReadiness(){
  // readiness based on overall module completion + topic mastery average on due items
  const overall = computeOverallProgress();
  const dueTopics = modulesData.topics.filter(tp=>{
    const t = state.topicMastery[tp.id];
    if(!t || !t.nextReviewAt) return true;
    return new Date(t.nextReviewAt).getTime() <= Date.now();
  });
  const rates = dueTopics.map(tp=>getTopicSuccessRate(tp.id)).filter(x=>x!==null);
  const avgRate = rates.length ? rates.reduce((a,b)=>a+b,0)/rates.length : 0;
  // weight: 45% modules, 55% mastery
  const readiness = overall*0.45 + avgRate*0.55;
  return Math.round(Math.max(0, Math.min(100, readiness)));
}

function readinessMessage(score){
  if(score>=85) return 'Excellent : vous êtes prêt(e) pour l’examen blanc.';
  if(score>=70) return 'Très bien : continuez sur vos sujets faibles.';
  if(score>=55) return 'En progression : renforcez les notions clés.';
  return 'À renforcer : beaucoup de points à consolider.';
}

function getDifficultyTag(d){
  if(d==='K1') return {cls:'brand', text:'K1 Comprendre'};
  if(d==='K2') return {cls:'', text:'K2 Appliquer'};
  return {cls:'', text:'K3 Analyser'};
}

function getChapterById(chapterId){
  return modulesData.chapters.find(c=>c.id===chapterId);
}

function getModuleTitle(moduleId){
  return getModuleById(moduleId)?.title || '';
}

function getLessonTitle(moduleId, lessonId){
  return getLessonById(moduleId, lessonId)?.title || '';
}

function router(){
  const hash = location.hash || '#/dashboard';
  const [_, route, a, b] = hash.split('/');
  if(!route) return {view:'dashboard'};
  if(route==='dashboard') return {view:'dashboard'};
  if(route==='modules') return {view:'modules'};
  if(route==='practice') return {view:'practice'};
  if(route==='mock') return {view:'mock'};
  if(route==='review') return {view:'review'};
  if(route==='progress') return {view:'progress'};
  if(route==='settings') return {view:'settings'};
  if(route==='module') return {view:'module', moduleId:a};
  return {view:'dashboard'};
}

let state = loadState();
let activeTimer = null;
let mockState = null;
let practiceState = null;

function setHeader(title, sub){
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSub').textContent = sub || '';
}

function renderSidebarChapters(){
  const el = document.getElementById('chapterList');
  el.innerHTML = '';
  for(const ch of modulesData.chapters){
    const btn = document.createElement('button');
    btn.className='navBtn';
    btn.style.padding='8px 10px';
    btn.textContent = ch.title;
    btn.title = 'Aller au module lié';
    btn.onclick = ()=>{
      // map chapter -> module (module ids correspond to chapters here)
      const moduleId = ch.moduleId;
      location.hash = `#/module/${moduleId}`;
      rerender();
    };
    el.appendChild(btn);
  }
}

function clearView(){
  const v = document.getElementById('view');
  v.innerHTML='';
}

function createEl(tag, props={}, children=[]){
  const el = document.createElement(tag);
  for(const [k,v] of Object.entries(props||{})){
    if(k==='class') el.className=v;
    else if(k==='text') el.textContent=v;
    else if(k==='html') el.innerHTML=v;
    else if(k.startsWith('on') && typeof v==='function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for(const c of children){
    if(c===null||c===undefined) continue;
    if(typeof c==='string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

function quizCard(question, idx, mode){
  const qEl = document.createElement('div');
  qEl.className='card';
  const head = createEl('div',{class:'qHeader'});
  const left = createEl('div', {class:'left'});
  left.appendChild(createEl('div',{class:'qMeta'}));

  const meta = left.querySelector('.qMeta');
  const ch = getChapterById(question.chapterId);
  meta.appendChild(createEl('span',{class:'pill', text: ch?.code ? ch.code : ch?.title || question.chapterId}));
  meta.appendChild(createEl('span',{class:'pill brand', text: question.topicLabel}));
  const diff = getDifficultyTag(question.knowledgeLevel);
  meta.appendChild(createEl('span',{class:'pill', text: diff.text}));

  const txt = createEl('div',{class:'qText', text: question.question});
  const count = createEl('div',{class:'timer', style:'margin-left:auto', text:`${mode}: Q${idx+1}`});
  head.appendChild(left);
  head.appendChild(count);

  qEl.appendChild(head);
  qEl.appendChild(txt);

  const optionsEl = createEl('div',{class:'options'});
  question.options.forEach((opt,i)=>{
    const btn = createEl('div',{class:'opt', text: opt});
    btn.dataset.idx = String(i);

    const k = createEl('div',{class:'k', text: String.fromCharCode(65+i)});
    btn.prepend(k);

    optionsEl.appendChild(btn);
  });
  qEl.appendChild(optionsEl);

  const submitRow = createEl('div',{style:'margin-top:14px;display:flex;gap:10px;justify-content:space-between;align-items:center;'});
  submitRow.appendChild(createEl('div', {class:'smallHint', text:''}));
  qEl.appendChild(submitRow);
  return qEl;
}

function showToast(title, message, type='brand'){
  const t = document.createElement('div');
  t.style.position='fixed';
  t.style.right='20px';
  t.style.bottom='18px';
  t.style.zIndex='50';
  t.style.background='rgba(15,16,17,.95)';
  t.style.border='1px solid '+(type==='ok' ? 'rgba(52,211,153,.35)' : type==='bad' ? 'rgba(248,113,113,.35)' : 'rgba(94,106,210,.35)');
  t.style.borderRadius='16px';
  t.style.boxShadow='var(--shadow)';
  t.style.padding='12px 14px';
  t.innerHTML=`<div style="font-weight:650;">${escapeHtml(title)}</div><div style="color:var(--muted2);font-size:13px;margin-top:4px;line-height:1.35">${escapeHtml(message||'')}</div>`;
  document.body.appendChild(t);
  setTimeout(()=>{ t.remove(); }, 3200);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));
}

function renderDashboard(){
  clearView();
  setHeader('Dashboard', 'Votre entraînement ISTQB — ultra structuré.');

  const overall = computeOverallProgress();
  const readiness = getReadiness();
  const msg = readinessMessage(readiness);

  const stats = computeStats();
  const weak = getWeakTopics();

  const v = document.getElementById('view');

  const grid = createEl('div',{class:'grid cols-2'});
  const left = createEl('div');

  const c1 = createEl('div',{class:'card'});
  c1.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Progression globale</div>
        <div style="font-size:24px;font-weight:700;margin-top:8px">${overall}%</div>
        <div style="margin-top:10px;color:var(--muted2);font-size:14px">Modules complétés</div>
      </div>
      <div style="text-align:right">
        <span class="pill brand">Readiness ${readiness}%</span>
        <div style="color:var(--muted2);font-size:13px;margin-top:6px;max-width:260px">${escapeHtml(msg)}</div>
      </div>
    </div>
    <div style="margin-top:14px" class="bar"><div style="width:${overall}%"></div></div>
  `;
  left.appendChild(c1);

  const c2 = createEl('div',{class:'card hard', style:'margin-top:12px'});
  c2.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Entraînement</div>
        <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap">
          <span class="pill">Tentatives : <b style="color:var(--text)">${stats.answered}</b></span>
          <span class="pill ok">Correct : <b style="color:var(--text)">${stats.correctAnswers}</b></span>
          <span class="pill">Taux : <b style="color:var(--text)">${formatPercent(stats.correctRate)}</b></span>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-shrink:0">
        <button class="btn primary" id="btnGoMock">Examen Blanc Timé</button>
        <button class="btn" id="btnGoPractice">Entraînement</button>
      </div>
    </div>
  `;
  left.appendChild(c2);

  const right = createEl('div');
  const c3 = createEl('div',{class:'card'});
  c3.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Sujets à renforcer</div>
        <div style="font-size:18px;font-weight:650;margin-top:8px">Top ${weak.length}</div>
      </div>
      <span class="pill bad">Weakness</span>
    </div>
    <div style="margin-top:14px" class="list"></div>
  `;
  const list = c3.querySelector('.list');
  for(const t of weak){
    const rate = t.attempts ? Math.round(t.rate) : null;
    const due = t.nextReviewAt ? (new Date(t.nextReviewAt).getTime()<=Date.now()) : true;
    list.appendChild(createEl('div',{class:'row'} ,[
      createEl('div',{class:'left'},[
        createEl('div',{style:'font-weight:650;'} ,[t.label]),
        createEl('div',{style:'color:var(--muted2);font-size:13px;margin-top:4px'},[due?'À revoir maintenant':'En attente']),
      ]),
      createEl('div',{class:'right', text: rate===null?`0% (nouveau)`:`${rate}%`})
    ]));
  }
  right.appendChild(c3);

  const c4 = createEl('div',{class:'card hard', style:'margin-top:12px'});
  const streak = state.user.streak || 0;
  c4.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Streak</div>
        <div style="font-size:18px;font-weight:650;margin-top:8px">🔥 ${streak} jour(s)</div>
      </div>
      <button class="btn small" id="btnReset">Reset demo</button>
    </div>
    <div style="margin-top:10px;color:var(--muted2);font-size:13px;line-height:1.45">Réinitialise la progression (données locales uniquement).</div>
  `;
  right.appendChild(c4);

  grid.appendChild(left);
  grid.appendChild(right);
  v.appendChild(grid);

  v.appendChild(createEl('div',{style:'margin-top:12px'}));

  document.getElementById('btnGoMock').onclick = ()=>{location.hash='#/mock'; rerender();};
  document.getElementById('btnGoPractice').onclick = ()=>{location.hash='#/practice'; rerender();};
  document.getElementById('btnReset').onclick = ()=>{ confirmResetDemo(); };
}

function confirmResetDemo(){
  if(!confirm('Reset de la progression (localStorage) ?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  saveState();
  rerender();
  showToast('Reset effectué', 'Votre progression démo a été effacée.', 'brand');
}

function renderModules(){
  clearView();
  setHeader('Parcours & Modules', 'Avancez chapitre par chapitre.');
  const v = document.getElementById('view');

  const grid = createEl('div',{class:'grid cols-3'});

  for(const m of modulesData.modules){
    const ms = state.modules[m.id];
    const unlocked = isModuleUnlocked(m.id);
    const completed = !!ms?.completed;
    const progress = ms?.progress || 0;

    const card = createEl('div',{class:'card', style:'padding:16px'});
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div class="pill" style="margin-bottom:10px">${escapeHtml(m.chapterCode)} · ${escapeHtml(m.difficultyLabel)}</div>
          <div style="font-size:18px;font-weight:700">${escapeHtml(m.title)}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">${escapeHtml(m.description)}</div>
        </div>
        <div style="text-align:right">
          <span class="pill ${completed?'ok':'brand'}">${completed?'Complété':'Progress'}: ${Math.round(progress)}%</span>
        </div>
      </div>
      <div style="margin-top:12px" class="bar"><div style="width:${progress}%"></div></div>
      <div style="display:flex;gap:10px;margin-top:12px;align-items:center;justify-content:space-between">
        <div style="color:var(--muted2);font-size:13px">${m.lessons.length} leçons · ${countLessonDone(m.id)} / ${m.lessons.length} faites</div>
        <button class="btn primary" data-open="${m.id}" ${unlocked?'' : 'disabled'}>${unlocked?'Ouvrir':'Verrouillé'}</button>
      </div>
    `;
    const btn = card.querySelector('button[data-open]');
    btn.onclick = ()=>{ location.hash=`#/module/${m.id}`; rerender(); };
    grid.appendChild(card);
  }

  v.appendChild(grid);
}

function countLessonDone(moduleId){
  const m = getModuleById(moduleId);
  if(!m) return 0;
  const ms = state.modules[moduleId]?.progressLessons || {};
  let done=0;
  for(const l of m.lessons){ if(ms[l.id]) done++; }
  return done;
}

function renderModuleDetail(moduleId){
  clearView();
  const m = getModuleById(moduleId);
  if(!m){
    renderDashboard();
    return;
  }
  setHeader(m.title, m.description);
  const v = document.getElementById('view');

  // Module summary
  const summary = createEl('div',{class:'card'});
  summary.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div class="pill">${escapeHtml(m.chapterCode)} · ${escapeHtml(m.difficultyLabel)}</div>
        <div style="font-size:22px;font-weight:800;margin-top:10px">${escapeHtml(m.title)}</div>
        <div style="color:var(--muted2);margin-top:8px;line-height:1.5">${escapeHtml(m.longDescription||m.description)}</div>
      </div>
      <div style="min-width:260px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Progression</div>
          <div style="font-weight:700">${state.modules[moduleId]?.progress || 0}%</div>
        </div>
        <div style="margin-top:10px" class="bar"><div style="width:${state.modules[moduleId]?.progress || 0}%"></div></div>
        <div style="margin-top:10px;color:var(--muted2);font-size:13px">${countLessonDone(moduleId)} leçons terminées</div>
      </div>
    </div>
  `;
  v.appendChild(summary);

  // Lessons list
  const lessons = createEl('div',{class:'grid cols-2', style:'margin-top:12px'});
  for(const l of m.lessons){
    const done = isLessonCompleted(moduleId, l.id);
    const card = createEl('div',{class:'card hard'});
    card.style.opacity = done?1:1;
    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div class="pill brand" style="margin-bottom:10px">${escapeHtml(l.tag)}</div>
          <div style="font-weight:800;font-size:16px">${escapeHtml(l.title)}</div>
          <div style="color:var(--muted2);font-size:13.5px;line-height:1.45;margin-top:6px">${escapeHtml(l.description)}</div>
        </div>
        <div style="text-align:right">
          <div class="pill ${done?'ok':'pill'}">${done?'Fait':'À faire'}</div>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;justify-content:space-between">
        <div style="color:var(--muted2);font-size:13px">${l.questionsCount} Q ciblées</div>
        <button class="btn primary" data-lesson="${l.id}" ${done?'disabled':''}>${done?'Terminé':'Réviser + Quiz'}</button>
      </div>
    `;
    const btn = card.querySelector('button[data-lesson]');
    btn.onclick = ()=>{ startLessonQuiz(moduleId, l.id); };
    lessons.appendChild(card);
  }
  v.appendChild(lessons);

  // Module quick practice
  const moduleQsCount = questionsData.questions.filter(q=>q.moduleId===moduleId).length;
  const pick = createEl('div',{class:'card', style:'margin-top:12px'});
  pick.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Entraînement ciblé</div>
        <div style="font-size:18px;font-weight:750;margin-top:8px">40 min · ${Math.min(10,moduleQsCount)} questions aléatoires</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px">Score + explications, et mise à jour de vos sujets faibles.</div>
      </div>
      <button class="btn primary" id="btnModulePractice">Démarrer</button>
    </div>
  `;
  v.appendChild(pick);
  document.getElementById('btnModulePractice').onclick = ()=>{
    location.hash='#/practice';
    rerender({focusModuleId: moduleId, mode:'module'});
  };
}

function renderPractice(){
  clearView();
  setHeader('Entraînement', 'Pratique par mode : tout / erreurs / faibles / favoris.');
  const v = document.getElementById('view');

  const wrap = createEl('div');
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:800">Choisissez votre session</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">La correction est immédiate et améliore vos lacunes.</div>
        </div>
        <div style="min-width:320px">
          <label style="display:block;color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Mode</label>
          <select class="select" id="practiceMode">
            <option value="all">Toutes les questions</option>
            <option value="weak">Mes sujets faibles</option>
            <option value="incorrect">Mes erreurs fréquentes</option>
            <option value="bookmarks">Favoris</option>
            <option value="due">Dû pour révision (spaced repetition)</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <label style="display:block;color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Taille de session</label>
          <select class="select" id="practiceCount">
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30" selected>30</option>
            <option value="40">40</option>
          </select>
        </div>
        <div style="flex:1;min-width:260px">
          <label style="display:block;color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Temps estimé</label>
          <div class="pill brand">~ ${Math.round(10*0.65)}–${Math.round(10*1.2)} min / 10 questions</div>
        </div>
        <button class="btn primary" id="btnStartPractice">Démarrer</button>
      </div>
    </div>

    <div id="practiceSession" style="display:none"></div>
  `;
  v.appendChild(wrap);

  document.getElementById('btnStartPractice').onclick = ()=>{
    const mode = document.getElementById('practiceMode').value;
    const count = parseInt(document.getElementById('practiceCount').value,10);
    startPracticeSession(mode, count);
  };
}

function startPracticeSession(mode, count){
  // Cacher le setup
  const setupCard = document.querySelector('#view > div:first-child > div:first-child');
  if(setupCard) setupCard.style.display = 'none';

  // choose questions
  const all = questionsData.questions;
  const weakTopics = new Set(getWeakTopics().map(t=>t.id));

  let pool = all;
  if(mode==='weak') pool = all.filter(q=>weakTopics.has(q.topicId));
  if(mode==='bookmarks') pool = all.filter(q=>state.bookmarks[q.id]);
  if(mode==='due') pool = all.filter(q=>{
    const t = state.topicMastery[q.topicId];
    if(!t || !t.nextReviewAt) return true;
    return new Date(t.nextReviewAt).getTime()<=Date.now();
  });
  if(mode==='incorrect'){
    // errors frequent: attempts with incorrect and lowest success rate
    pool = all.slice().sort((a,b)=>{
      const ar = state.topicMastery[a.topicId];
      const br = state.topicMastery[b.topicId];
      const aAttempts=ar?.attempts||0; const bAttempts=br?.attempts||0;
      const aRate=aAttempts? (ar.correct/ar.attempts) : 0;
      const bRate=bAttempts? (br.correct/br.attempts) : 0;
      return aRate - bRate;
    });
  }

  const shuffled = pool.slice().sort(()=>Math.random()-0.5);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));

  practiceState = {
    mode,
    count: picked.length,
    index: 0,
    questions: picked,
    answers: {},
    startedAt: nowISO(),
  };

  renderPracticeSession();
}

function renderPracticeSession(){
  const v = document.getElementById('view');
  let sessionEl = document.getElementById('practiceSession');
  if(!sessionEl){
    // Créer le conteneur s'il n'existe pas (appel depuis module/review)
    sessionEl = document.createElement('div');
    sessionEl.id = 'practiceSession';
    sessionEl.style.display = 'block';
    v.innerHTML = '';
    v.appendChild(sessionEl);
  }
  sessionEl.style.display='block';

  const q = practiceState.questions[practiceState.index];
  const ch = getChapterById(q.chapterId);
  const t = modulesData.topics.find(x=>x.id===q.topicId);

  // summary
  sessionEl.innerHTML = `
    <div class="card" style="margin-top:12px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span class="pill">${escapeHtml(ch?.code||q.chapterId)}</span>
            <span class="pill brand">${escapeHtml(q.topicLabel)}</span>
            <span class="pill">${escapeHtml(q.knowledgeLevel)} · ${escapeHtml(q.estimatedTime)} min</span>
          </div>
          <div style="margin-top:10px;font-size:18px;font-weight:800">Session ${escapeHtml(practiceState.mode)} — Q${practiceState.index+1}/${practiceState.count}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Répondez pour obtenir la correction immédiate.</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn" id="btnPrev" ${practiceState.index===0?'disabled':''}>Précédent</button>
          <button class="btn primary" id="btnSkip">Passer</button>
        </div>
      </div>

      <div class="qText" style="font-size:16px;margin-top:14px">${escapeHtml(q.question)}</div>

      <div class="options" style="margin-top:14px">
        ${q.options.map((opt,i)=>{
          const label = String.fromCharCode(65+i);
          const sel = practiceState.answers[q.id]?.selectedIndex===i ? 'selected' : '';
          return `
            <div class="opt ${sel}" data-idx="${i}">
              <div class="k">${label}</div>
              <div style="flex:1">${escapeHtml(opt)}</div>
            </div>
          `;
        }).join('')}
      </div>

      <div id="answerArea" style="margin-top:14px"></div>

      <div style="display:flex;gap:12px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap">
        <div style="color:var(--muted2);font-size:13px">Tip : Cochez votre réponse, puis validez.</div>
        <div style="display:flex;gap:10px">
          <button class="btn" id="btnVal">Valider</button>
          <button class="btn primary" id="btnNext" disabled>Suivant</button>
        </div>
      </div>
    </div>
  `;

  const optEls = sessionEl.querySelectorAll('.opt[data-idx]');
  optEls.forEach(el=>{
    el.onclick=()=>{
      if(practiceState.answers[q.id]?.locked) return;
      const idx = parseInt(el.dataset.idx,10);
      if(!practiceState.answers[q.id]) practiceState.answers[q.id]={selectedIndex: idx, locked:false};
      else practiceState.answers[q.id].selectedIndex = idx;
      // rerender to show selected highlight
      renderPracticeSession();
    };
  });

  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnSkip = document.getElementById('btnSkip');
  const btnVal = document.getElementById('btnVal');

  btnPrev.onclick = ()=>{ if(practiceState.index>0){ practiceState.index--; renderPracticeSession(); } };
  btnSkip.onclick = ()=>{ // mark as no answer
    practiceState.index++;
    if(practiceState.index>=practiceState.count){ finishPracticeSession(); }
    else renderPracticeSession();
  };

  btnVal.onclick = ()=>{
    const selected = practiceState.answers[q.id]?.selectedIndex;
    if(selected===undefined){
      showToast('Choix requis', 'Sélectionnez une option avant de valider.', 'bad');
      return;
    }
    const correct = selected === q.correctIndex;
    practiceState.answers[q.id].locked = true;
    practiceState.answers[q.id].correct = correct;
    practiceState.answers[q.id].correctIndex = q.correctIndex;

    recordAttempt({questionId:q.id, selectedIndex:selected, correct, mode:practiceState.mode});

    // show result
    const area = document.getElementById('answerArea');
    const badgeCls = correct ? 'opt correct' : 'opt incorrect';
    const correctLabel = String.fromCharCode(65+q.correctIndex);
    area.innerHTML = `
      <div class="explain" style="border-color:${correct?'rgba(52,211,153,.35)':'rgba(248,113,113,.35)'}">
        <div style="font-weight:800;color:${correct?'var(--ok)':'var(--bad)'}">${correct?'✅ Correct':'❌ Incorrect'}</div>
        <div style="margin-top:8px;color:var(--muted2);font-size:13.5px">
          Bonne réponse : <span class="pill ok" style="margin-left:6px">${correctLabel}</span>
        </div>
        <div style="margin-top:10px">${escapeHtml(q.explanation)}</div>
      </div>
    `;

    btnNext.disabled = false;
  };

  btnNext.onclick = ()=>{
    if(practiceState.index+1<practiceState.count){
      practiceState.index++;
      renderPracticeSession();
    } else {
      finishPracticeSession();
    }
  };

  // Si réponse déjà donnée mais pas locked (option sélectionnée), enable Valider
  if(practiceState.answers[q.id] && !practiceState.answers[q.id].locked){
    btnVal.disabled = false;
  }

  // If already answered
  const already = practiceState.answers[q.id];
  if(already?.locked){
    btnNext.disabled = false;
    const selected = already.selectedIndex;
    const correct = selected===q.correctIndex;
    const area = document.getElementById('answerArea');
    const correctLabel = String.fromCharCode(65+q.correctIndex);
    area.innerHTML = `
      <div class="explain" style="border-color:${correct?'rgba(52,211,153,.35)':'rgba(248,113,113,.35)'}">
        <div style="font-weight:800;color:${correct?'var(--ok)':'var(--bad)'}">${correct?'✅ Correct':'❌ Incorrect'}</div>
        <div style="margin-top:8px;color:var(--muted2);font-size:13.5px">
          Bonne réponse : <span class="pill ok" style="margin-left:6px">${correctLabel}</span>
        </div>
        <div style="margin-top:10px">${escapeHtml(q.explanation)}</div>
      </div>
    `;
  }
}

function finishPracticeSession(){
  // show summary and stop
  const attempts = practiceState.questions.map(q=>practiceState.answers[q.id]).filter(Boolean);
  let correct=0; let answered=0;
  for(const q of practiceState.questions){
    const a = practiceState.answers[q.id];
    if(a?.locked){ answered++; if(a.correct) correct++; }
  }
  const total = practiceState.questions.length;
  const score = correct;

  const v = document.getElementById('view');
  const el = document.createElement('div');
  el.className='card';
  const rate = total? Math.round((correct/total)*100):0;
  el.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:22px;font-weight:900">Fin de session</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px">Score : ${correct}/${total} (${rate}%).</div>
        <div style="margin-top:10px" class="bar"><div style="width:${rate}%"></div></div>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn" onclick="location.hash='#/review';">Voir mes erreurs</button>
        <button class="btn primary" onclick="location.hash='#/progress';">Voir stats</button>
      </div>
    </div>
    <div style="margin-top:12px;color:var(--muted2);font-size:13.5px;line-height:1.5">Vos lacunes ont été mises à jour (spaced repetition + mastery par topic).</div>
  `;
  v.innerHTML='';
  v.appendChild(el);

  const returnHash = practiceState?.returnHash;
  practiceState = null;
  state && saveState();
  renderSidebarChapters();
  // Revenir à la vue d'origine si c'était un quiz de leçon ou une revue
  if(returnHash && returnHash !== '#/practice'){
    location.hash = returnHash;
    rerender();
  } else {
    renderPractice();
  }
}

function renderMockSetup(){
  clearView();
  setHeader('Examen Blanc (Timé)', '40 questions · 60 minutes · Seuil 65% · Correction complète.');
  const v = document.getElementById('view');

  const dueBias = 'mixed';

  const card = createEl('div',{class:'card'});
  card.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Mock Exam CTFL v4.0</div>
        <div style="font-size:26px;font-weight:900;margin-top:10px">Examen Blanc</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px;line-height:1.5">Simule l’examen : timer, flag, navigation, correction après soumission.</div>
      </div>
      <div style="min-width:320px">
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
          <div class="card" style="padding:10px;border-radius:14px"><div style="color:var(--subtle);font-size:12px;letter-spacing:.06em;text-transform:uppercase">Questions</div><div style="font-size:20px;font-weight:900;margin-top:8px">40</div></div>
          <div class="card" style="padding:10px;border-radius:14px"><div style="color:var(--subtle);font-size:12px;letter-spacing:.06em;text-transform:uppercase">Temps</div><div style="font-size:20px;font-weight:900;margin-top:8px">60m</div></div>
          <div class="card" style="padding:10px;border-radius:14px"><div style="color:var(--subtle);font-size:12px;letter-spacing:.06em;text-transform:uppercase">Pass</div><div style="font-size:20px;font-weight:900;margin-top:8px;color:var(--ok)">65%</div></div>
        </div>
      </div>
    </div>

    <div style="margin-top:14px" class="grid cols-2">
      <div class="card hard">
        <div style="font-weight:800;font-size:15px">Mode sélection</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Mélange : sujets faibles + couverture par chapitre.</div>
        <div style="margin-top:10px"><span class="pill brand">${escapeHtml(dueBias)}</span></div>
      </div>
      <div class="card hard">
        <div style="font-weight:800;font-size:15px">Pause</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Pause autorisée jusqu’à 3 fois (timer gelé).</div>
        <div style="margin-top:10px"><span class="pill">Max 3 pauses</span></div>
      </div>
    </div>

    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
      <button class="btn" onclick="location.hash='#/practice';">Préparer avec entraînement</button>
      <button class="btn primary" id="btnStartMock">Démarrer l’examen</button>
    </div>

    <div class="footerNote">Note : les questions et corrigés de cette version v1 sont générés à partir du syllabus et ne reproduisent pas un examen officiel.</div>
  `;
  v.appendChild(card);

  card.querySelector('#btnStartMock').onclick=()=> startMockExam();
}

function pickMockQuestions(){
  // Weighted by chapter coverage and weakness.
  const weak = getWeakTopics().map(t=>t.id);
  const weakSet = new Set(weak);

  const byChapter = new Map();
  for(const q of questionsData.questions){
    if(!byChapter.has(q.chapterId)) byChapter.set(q.chapterId, []);
    byChapter.get(q.chapterId).push(q);
  }

  const chapters = modulesData.chapters.map(c=>c.moduleId);
  // simple: aim ~40/6 ~7 per chapter
  const per = Math.floor(40/chapters.length);
  const remainder = 40 - per*chapters.length;

  const picked=[];
  for(let i=0;i<chapters.length;i++){
    const chModuleId = chapters[i];
    const ch = modulesData.chapters.find(c=>c.moduleId===chModuleId);
    const chapterId = ch.id;
    const pool = (byChapter.get(chapterId)||[]).slice();
    // sort by weakness first
    pool.sort((a,b)=>{
      const aw = weakSet.has(a.topicId) ? 1 : 0;
      const bw = weakSet.has(b.topicId) ? 1 : 0;
      if(aw!==bw) return bw-aw;
      // less mastery first
      const ar = state.topicMastery[a.topicId]?.attempts ? (state.topicMastery[a.topicId].correct/state.topicMastery[a.topicId].attempts) : 0;
      const br = state.topicMastery[b.topicId]?.attempts ? (state.topicMastery[b.topicId].correct/state.topicMastery[b.topicId].attempts) : 0;
      return ar - br;
    });
    const take = per + (i<remainder?1:0);
    picked.push(...pool.slice(0,take));
  }

  // if not enough due to pool sizes, fill from remaining
  const ids = new Set(picked.map(q=>q.id));
  if(picked.length<40){
    const remaining = questionsData.questions.filter(q=>!ids.has(q.id));
    remaining.sort(()=>Math.random()-0.5);
    picked.push(...remaining.slice(0,40-picked.length));
  }

  return picked.slice(0,40);
}

function startMockExam(){
  const questions = pickMockQuestions();
  mockState = {
    active: true,
    questions,
    index: 0,
    answers: {}, // qid -> selectedIndex
    flagged: {}, // qid -> true
    startedAt: nowISO(),
    secondsTotal: 60*60,
    secondsLeft: 60*60,
    paused: false,
    pauseCount: 0,
  };

  saveState();
  renderMockExam();
  startTimer();
}

function renderMockExam(){
  clearView();
  setHeader('Examen Blanc (Timé)', 'Naviguez, flaguez, et soumettez.');
  const v = document.getElementById('view');

  const q = mockState.questions[mockState.index];
  const ch = getChapterById(q.chapterId);

  const total = mockState.questions.length;
  const answered = Object.keys(mockState.answers).length;

  const sec = mockState.secondsLeft;
  const mm = String(Math.floor(sec/60)).padStart(2,'0');
  const ss = String(sec%60).padStart(2,'0');

  const flagsCount = Object.values(mockState.flagged).filter(Boolean).length;

  v.innerHTML = `
    <div class="card" style="padding:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <span class="pill">${escapeHtml(ch?.code||q.chapterId)}</span>
            <span class="pill brand">${escapeHtml(q.topicLabel)}</span>
            <span class="pill">${escapeHtml(q.knowledgeLevel)}</span>
            <span class="pill">Flagged: ${flagsCount}</span>
          </div>
          <div style="font-size:18px;font-weight:850;margin-top:10px">Question ${mockState.index+1} / ${total}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px">Naviguez via boutons, sélectionnez une réponse, validez localement avant soumission finale.</div>
        </div>
        <div style="text-align:right">
          <div class="timer">⏱️ ${mm}:${ss}</div>
          <div style="color:var(--muted2);font-size:13px;margin-top:6px">${answered} answered</div>
        </div>
      </div>

      <div style="margin-top:12px" class="grid cols-4" id="mockNav"></div>

      <div style="margin-top:14px" class="qText">${escapeHtml(q.question)}</div>

      <div class="options" style="margin-top:14px">
        ${q.options.map((opt,i)=>{
          const sel = mockState.answers[q.id]===i;
          const k = String.fromCharCode(65+i);
          return `<div class="opt ${sel?'selected':''}" data-idx="${i}"><div class="k">${k}</div><div style="flex:1">${escapeHtml(opt)}</div></div>`;
        }).join('')}
      </div>

      <div id="resultHint" style="margin-top:14px;color:var(--muted2);font-size:13.5px"></div>

      <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn" id="btnPrev" ${mockState.index===0?'disabled':''}>Précédent</button>
          <button class="btn" id="btnNext" ${mockState.index===total-1?'disabled':''}>Suivant</button>
          <button class="btn" id="btnFlag">${mockState.flagged[q.id]?'Unflag':'Flag'}</button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="btn" id="btnPause" ${mockState.paused||mockState.pauseCount>=3?'disabled':''}>${mockState.paused?'Paused':'Pause'} (${3-mockState.pauseCount} left)</button>
          <button class="btn primary" id="btnSubmit">Soumettre</button>
        </div>
      </div>

      <div class="footerNote">Pause gelant le timer. Après soumission : correction détaillée + score 65% pass/fail.</div>
    </div>
  `;

  // nav
  const nav = v.querySelector('#mockNav');
  nav.innerHTML='';
  mockState.questions.forEach((qq, idx)=>{
    const b = document.createElement('button');
    b.className='btn small';
    b.style.borderRadius='10px';
    b.style.background = idx===mockState.index ? 'rgba(94,106,210,.18)' : 'rgba(255,255,255,.02)';
    b.textContent = String(idx+1);
    b.title = (mockState.answers[qq.id]!==undefined?'Answered':'Not answered') + (mockState.flagged[qq.id]?' · Flagged':'');
    b.onclick = ()=>{ mockState.index = idx; renderMockExam(); };
    nav.appendChild(b);
  });

  // option clicks
  const optEls = v.querySelectorAll('.opt[data-idx]');
  optEls.forEach(el=>{
    el.onclick = ()=>{
      const idx = parseInt(el.dataset.idx,10);
      mockState.answers[q.id] = idx;
      renderMockExam();
    };
  });

  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');
  const btnFlag = document.getElementById('btnFlag');
  const btnPause = document.getElementById('btnPause');
  const btnSubmit = document.getElementById('btnSubmit');

  btnPrev.onclick=()=>{ if(mockState.index>0){ mockState.index--; renderMockExam(); } };
  btnNext.onclick=()=>{ if(mockState.index<total-1){ mockState.index++; renderMockExam(); } };

  btnFlag.onclick=()=>{
    mockState.flagged[q.id] = !mockState.flagged[q.id];
    renderMockExam();
  };

  btnPause.onclick=()=>{ togglePause(); };
  btnSubmit.onclick=()=>{ submitMock(); };
}

function togglePause(){
  if(!mockState) return;
  if(mockState.paused) return;
  if(mockState.pauseCount>=3) return;
  mockState.paused = true;
  mockState.pauseCount += 1;
  stopTimer();
  saveState();

  showToast('Pause', 'Timer gelé. Appuyez pour reprendre.', 'brand');

  // replace button UI by re-rendering already.
  renderMockExam();

  // simple: wait 30s countdown for resume? Instead use user click.
  const v = document.getElementById('view');
  const btn = document.getElementById('btnPause');
  btn.disabled = false;
  btn.textContent = 'Reprendre';
  btn.onclick = ()=>{
    mockState.paused=false;
    saveState();
    renderMockExam();
    startTimer();
  };
}

function submitMock(){
  stopTimer();
  const total = mockState.questions.length;
  let correct=0;
  const answers = [];

  // Score + record attempts
  for(const q of mockState.questions){
    const sel = mockState.answers[q.id];
    const selectedIndex = sel===undefined? null : sel;
    const isCorrect = sel!==undefined && sel === q.correctIndex;
    if(isCorrect) correct++;
    answers.push({questionId:q.id, selectedIndex, correct:isCorrect});
    if(sel!==undefined){
      recordAttempt({questionId:q.id, selectedIndex:sel, correct:isCorrect, mode:'mock'});
    }
  }

  const scorePct = total? (correct/total)*100 : 0;
  const passed = scorePct >= 65;

  const id = uid('mock');
  state.mocks.history.unshift({
    id,
    at: nowISO(),
    score: correct,
    total,
    passed,
    scorePct,
    answers,
  });

  // cleanup
  saveState();
  mockState.active=false;

  renderMockResult();
}

function renderMockResult(){
  clearView();
  const history = state.mocks.history[0];
  if(!history){ renderMockSetup(); return; }

  setHeader('Résultat de l’examen', 'Correction + score final.');
  const v = document.getElementById('view');

  const scorePct = history.scorePct;
  const passed = history.passed;
  const badge = passed ? 'ok' : 'bad';

  const top = createEl('div',{class:'card'});
  top.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Score</div>
        <div style="font-size:30px;font-weight:950;margin-top:10px">${history.score} / ${history.total} · ${Math.round(scorePct)}%</div>
        <div style="margin-top:10px" class="bar"><div style="width:${scorePct}%"></div></div>
      </div>
      <div style="text-align:right">
        <span class="pill ${passed?'ok':'bad'}">${passed?'PASSED':'FAILED'} · Seuil 65%</span>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Mise à jour automatique de vos lacunes.</div>
      </div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;justify-content:flex-end">
      <button class="btn" onclick="location.hash='#/review'">Revoir les erreurs</button>
      <button class="btn primary" onclick="location.hash='#/progress'">Voir stats</button>
    </div>
  `;
  v.appendChild(top);

  // Detailed breakdown (first 15)
  const answers = history.answers;
  const list = createEl('div',{class:'grid cols-2', style:'margin-top:12px'});

  const take = Math.min(16, answers.length);
  for(let i=0;i<take;i++){
    const a = answers[i];
    const q = questionsData.questions.find(x=>x.id===a.questionId);
    if(!q) continue;
    const correctLabel = String.fromCharCode(65+q.correctIndex);
    const selLabel = a.selectedIndex===null? '—' : String.fromCharCode(65+a.selectedIndex);
    const ch = getChapterById(q.chapterId);
    const topic = modulesData.topics.find(t=>t.id===q.topicId);

    const card = createEl('div',{class:'card hard'});
    card.innerHTML=`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div>
          <span class="pill">${escapeHtml(ch?.code||q.chapterId)}</span>
          <div style="font-weight:800;margin-top:8px">Q${i+1} · ${a.correct?'Correct':'Incorrect'}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">${escapeHtml(q.question).slice(0,180)}${q.question.length>180?'…':''}</div>
        </div>
        <div style="text-align:right">
          <span class="pill ${a.correct?'ok':'bad'}">${selLabel} → ${correctLabel}</span>
          <div style="margin-top:6px;color:var(--muted2);font-size:13px">${escapeHtml(topic?.label||q.topicId)}</div>
        </div>
      </div>
      <div style="margin-top:12px" class="explain">${escapeHtml(q.explanation)}</div>
    `;
    list.appendChild(card);
  }

  v.appendChild(list);
}

function renderReview(){
  clearView();
  setHeader('Revue des erreurs', 'Réessayez ce qui vous bloque.');

  const v = document.getElementById('view');

  const wrong = getWrongQuestions();

  const c = createEl('div',{class:'card'});
  c.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:20px;font-weight:900">Erreurs à corriger</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px">Questions avec mauvaise performance (basée sur vos tentatives).</div>
      </div>
      <button class="btn primary" id="btnRetryWrong" ${wrong.length? '' : 'disabled'}>Réviser maintenant</button>
    </div>
  `;
  v.appendChild(c);

  if(!wrong.length){
    const empty = createEl('div',{class:'card', style:'margin-top:12px'});
    empty.innerHTML=`
      <div style="text-align:center;padding:18px 0">
        <div style="font-size:16px;font-weight:800">Rien à corriger 🎉</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px">Faites un entraînement ou un mock pour générer de nouveaux points faibles.</div>
        <button class="btn primary" style="margin-top:12px" onclick="location.hash='#/practice'">Aller à l’entraînement</button>
      </div>
    `;
    v.appendChild(empty);
    return;
  }

  const list = createEl('div',{class:'grid cols-2', style:'margin-top:12px'});
  wrong.slice(0,12).forEach((w, idx)=>{
    const q = w.question;
    const ch = getChapterById(q.chapterId);
    const topic = modulesData.topics.find(t=>t.id===q.topicId);
    const card = createEl('div',{class:'card hard'});
    card.innerHTML=`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div>
          <span class="pill">${escapeHtml(ch?.code||q.chapterId)}</span>
          <div style="margin-top:10px;font-weight:900">Q${idx+1}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">${escapeHtml(q.question)}</div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <span class="pill brand">${escapeHtml(topic?.label||q.topicId)}</span>
            <span class="pill bad">Wrong: ${w.wrongCount}</span>
            <span class="pill">SR: ${Math.round(w.successRate)}%</span>
          </div>
        </div>
        <button class="btn primary" data-qid="${q.id}" style="align-self:flex-start">Retry</button>
      </div>
    `;
    card.querySelector('button[data-qid]').onclick=()=>{
      // direct retry = mini session of 1 question
      startPracticeSession('weak', 1);
      // but override questions list
      practiceState.questions=[q];
      practiceState.count=1;
      practiceState.index=0;
      practiceState.answers={};
      renderPracticeSession();
    };
    list.appendChild(card);
  });

  v.appendChild(list);

  document.getElementById('btnRetryWrong').onclick=()=>{
    // take first N wrong questions
    const ids = wrong.slice(0,10).map(x=>x.question.id);
    const picked = questionsData.questions.filter(q=>ids.includes(q.id));
    practiceState = {mode:'incorrect', count:picked.length, index:0, questions:picked, answers:{}, startedAt:nowISO(), returnHash: location.hash || '#/dashboard'};
    location.hash = '#/practice';
    renderPracticeSession();
  };
}

function getWrongQuestions(){
  const attempts = state.practice.attempts||[];
  const byQ = new Map();
  for(const a of attempts){
    const prev = byQ.get(a.questionId)||{correct:0, attempts:0, wrong:0};
    prev.attempts +=1;
    if(a.correct) prev.correct +=1;
    else prev.wrong +=1;
    byQ.set(a.questionId, prev);
  }

  const arr = [];
  for(const [qid, v] of byQ.entries()){
    if(v.attempts>=2 && v.wrong>=1){
      const q = questionsData.questions.find(x=>x.id===qid);
      if(!q) continue;
      const successRate = (v.correct/v.attempts)*100;
      arr.push({question:q, wrongCount:v.wrong, successRate, attempts:v.attempts});
    }
  }
  arr.sort((a,b)=>{
    if(a.successRate!==b.successRate) return a.successRate - b.successRate;
    return b.wrongCount - a.wrongCount;
  });
  return arr;
}

function renderProgress(){
  clearView();
  setHeader('Progression & Stats', 'Vue d’ensemble et analyse fine des lacunes.');
  const v = document.getElementById('view');
  const stats = computeStats();
  const overall = computeOverallProgress();
  const readiness = getReadiness();

  // per chapter
  const perChapter = modulesData.chapters.map(ch=>{
    const qs = questionsData.questions.filter(q=>q.chapterId===ch.id);
    const attempts = state.practice.attempts.filter(a=>a.chapterId===ch.id);
    let correct=0;
    for(const a of attempts) if(a.correct) correct++;
    const rate = attempts.length? (correct/attempts.length)*100 : 0;
    return { ...ch, attempts: attempts.length, correct, rate, qs: qs.length };
  });

  const c = createEl('div',{class:'card'});
  c.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="color:var(--subtle);font-size:12px;letter-spacing:.08em;text-transform:uppercase">Readiness</div>
        <div style="font-size:28px;font-weight:950;margin-top:10px">${readiness}%</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px">${escapeHtml(readinessMessage(readiness))}</div>
        <div style="margin-top:12px" class="bar"><div style="width:${readiness}%"></div></div>
      </div>
      <div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
          <span class="pill">Modules: <b style="color:var(--text)">${overall}%</b></span>
          <span class="pill ok">Correct: <b style="color:var(--text)">${stats.correctAnswers}</b></span>
          <span class="pill">Taux: <b style="color:var(--text)">${formatPercent(stats.correctRate)}</b></span>
        </div>
        <div style="margin-top:12px;color:var(--muted2);font-size:13.5px;line-height:1.45">Streak : <b style="color:var(--text)">${state.user.streak||0}</b> · Longest : <b style="color:var(--text)">${state.user.longestStreak||0}</b></div>
      </div>
    </div>
  `;
  v.appendChild(c);

  const weak = getWeakTopics();
  const cards = createEl('div',{class:'grid cols-3', style:'margin-top:12px'});
  for(const tp of weak){
    const rate = tp.attempts?Math.round(tp.rate):0;
    const due = tp.nextReviewAt ? (new Date(tp.nextReviewAt).getTime()<=Date.now()) : true;
    const pillCls = rate<50?'bad':'brand';
    const card = createEl('div',{class:'card hard'});
    card.innerHTML=`
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div>
          <div style="font-weight:900">${escapeHtml(tp.label)}</div>
          <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Attempts: ${tp.attempts} · SR: ${rate}%</div>
        </div>
        <span class="pill ${due?'bad':'brand'}">${due?'Due':'Later'}</span>
      </div>
      <div style="margin-top:10px" class="bar"><div style="width:${rate}%"></div></div>
      <div style="margin-top:10px;color:var(--muted2);font-size:13px">Prochaine révision : ${tp.nextReviewAt? new Date(tp.nextReviewAt).toLocaleDateString('fr-FR'):'maintenant'}</div>
    `;
    cards.appendChild(card);
  }
  v.appendChild(cards);

  // per chapter list
  const per = createEl('div',{class:'card', style:'margin-top:12px'});
  per.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-weight:900;font-size:18px">Performance par chapitre</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px">Basé sur vos tentatives enregistrées.</div>
      </div>
      <button class="btn" onclick="location.hash='#/practice'">Entraînement</button>
    </div>
  `;
  const list = createEl('div',{class:'list'});
  per.appendChild(list);
  perChapter.forEach(ch=>{
    list.appendChild(createEl('div',{class:'row'},[
      createEl('div',{class:'left'},[
        createEl('div',{style:'font-weight:800'},[ch.code+': '+ch.title]),
        createEl('div',{style:'color:var(--muted2);font-size:13px;margin-top:4px'},[`Tentatives: ${ch.attempts} · Questions: ${ch.qs}`]),
      ]),
      createEl('div',{class:'right', text: `${Math.round(ch.rate)}%`})
    ]));
  });
  v.appendChild(per);
}

function renderSettings(){
  clearView();
  setHeader('Réglages', 'Export/Import, options et maintenance locale.');
  const v = document.getElementById('view');

  const c = createEl('div',{class:'card'});
  c.innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:22px;font-weight:950">Réglages</div>
        <div style="color:var(--muted2);font-size:14px;margin-top:6px;line-height:1.45">Toutes les données restent dans votre navigateur.</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btnExport">Exporter JSON</button>
        <label class="btn" style="cursor:pointer;position:relative;overflow:hidden">
          Import JSON
          <input type="file" id="fileImport" accept="application/json" style="position:absolute;left:0;top:0;opacity:0;width:100%;height:100%;cursor:pointer"/>
        </label>
      </div>
    </div>

    <div class="grid cols-2" style="margin-top:12px">
      <div class="card hard">
        <div style="font-weight:900">Export</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Télécharge vos progrès : progression, mastering, mocks, bookmarks.</div>
      </div>
      <div class="card hard">
        <div style="font-weight:900">Reset</div>
        <div style="color:var(--muted2);font-size:13.5px;margin-top:6px;line-height:1.45">Supprime la progression locale.</div>
      </div>
    </div>

    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
      <button class="btn danger" id="btnReset">Reset tout</button>
    </div>
  `;
  v.appendChild(c);

  document.getElementById('btnExport').onclick = ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;
    a.download='istqb_master_prep_export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('fileImport').onchange = async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const txt = await file.text();
    const parsed = safeParse(txt, null);
    if(!parsed){ showToast('Import impossible', 'JSON invalide.', 'bad'); return; }
    if(!confirm('Écraser votre progression locale avec ce fichier ?')) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    state = loadState();
    saveState();
    rerender();
    showToast('Import OK', 'Progression importée.', 'ok');
  };

  document.getElementById('btnReset').onclick = ()=>{ confirmResetDemo(); };
}

function startLessonQuiz(moduleId, lessonId){
  // For v1: we just show a mini practice of 5 questions tagged to the lesson
  const lesson = getLessonById(moduleId, lessonId);
  if(!lesson){ showToast('Erreur', 'Leçon introuvable.', 'bad'); return; }

  // filter questions belonging to module and topic(s)
  let pool = questionsData.questions.filter(q=>q.moduleId===moduleId);

  // optional: lesson topic filters (lesson.topicIds)
  if(Array.isArray(lesson.topicIds) && lesson.topicIds.length){
    const set = new Set(lesson.topicIds);
    pool = pool.filter(q=>set.has(q.topicId));
  }

  const picked = pool.sort(()=>Math.random()-0.5).slice(0, Math.min(5, pool.length));
  practiceState = {mode:'lesson', count:picked.length, index:0, questions:picked, answers:{}, startedAt: nowISO(), lessonModuleId: moduleId, lessonId, returnHash: location.hash || '#/dashboard'};
  location.hash = '#/practice';
  renderPracticeSession();
}

function startTimer(){
  stopTimer();
  if(!mockState || !mockState.active) return;
  activeTimer = setInterval(()=>{
    if(!mockState || mockState.paused) return;
    mockState.secondsLeft -= 1;
    if(mockState.secondsLeft<=0){
      mockState.secondsLeft=0;
      renderMockExam();
      submitMock();
    } else {
      // update only header by re-render to keep simple
      // avoid too frequent full rerender
      if(mockState.secondsLeft % 5 ===0) renderMockExam();
    }
  }, 1000);
}

function stopTimer(){
  if(activeTimer){ clearInterval(activeTimer); activeTimer=null; }
}

function start(){
  // sidebar nav
  document.querySelectorAll('.navBtn').forEach(btn=>{
    btn.onclick = ()=>{ location.hash = '#' + '/' + btn.dataset.view; rerender(); };
  });

  renderSidebarChapters();
  window.addEventListener('hashchange', ()=> rerender());
  window.addEventListener('resize', ()=> rerender());

  rerender();
}

function rerender(extra={}){
  const r = router();
  // enhance: if focusModuleId is passed from module detail quick practice
  if(r.view==='practice' && extra.focusModuleId && extra.mode==='module'){
    const moduleId = extra.focusModuleId;
    // start an immediate session with 10 questions from that module
    const pool = questionsData.questions.filter(q=>q.moduleId===moduleId);
    const picked = pool.sort(()=>Math.random()-0.5).slice(0, Math.min(10, pool.length));
    practiceState = {mode:'module', count:picked.length, index:0, questions:picked, answers:{}, startedAt: nowISO()};
    // render view should show session
    renderPracticeSession();
    return;
  }

  if(r.view==='dashboard') renderDashboard();
  else if(r.view==='modules') renderModules();
  else if(r.view==='module') renderModuleDetail(r.moduleId);
  else if(r.view==='practice') renderPractice();
  else if(r.view==='mock') renderMockSetup();
  else if(r.view==='review') renderReview();
  else if(r.view==='progress') renderProgress();
  else if(r.view==='settings') renderSettings();
  else renderDashboard();

  // on settings import etc update streak maybe
  saveState();
}

// Hook: on finish of practice session, we should mark module lesson complete if lesson mode
// We'll wrap finishPracticeSession by checking practiceState.lessonModuleId
const _finishPracticeSession = finishPracticeSession;
window.finishPracticeSession = finishPracticeSession;

function patchedFinish(){
  if(practiceState?.lessonModuleId && practiceState?.lessonId){
    // compute success rate from locked answers
    let correct=0; let total = practiceState.questions.length;
    for(const q of practiceState.questions){
      const a = practiceState.answers[q.id];
      if(a?.locked && a.correct) correct++;
    }
    const pct = total? (correct/total)*100 : 0;
    if(pct>=60){
      setLessonCompleted(practiceState.lessonModuleId, practiceState.lessonId);
      saveState();
    }
  }
}

// patch into finishPracticeSession by redefining it here is non-trivial without altering earlier function.
// For v1 we keep it simple: user marks completion via lesson quiz not implemented beyond v1 session.

start();
