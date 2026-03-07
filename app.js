/* z-wealth · merged scripts · auto-split */

/* ── LAZY LOAD PATCHES ── */

/* ── LAZY LOAD Firebase & WalletConnect ── */
(function(){
  'use strict';

  // Firebase: only load after user has logged in (enterApp is called)
  // We patch window to intercept enterApp
  var _origEnterApp = null;
  function patchEnterApp() {
    if (typeof window.enterApp === 'function' && !window.__firebaseLazyPatched) {
      window.__firebaseLazyPatched = true;
      _origEnterApp = window.enterApp;
      window.enterApp = async function(seed, data) {
        // Load Firebase if not yet loaded
        if (!window.firebase && !window.__firebaseLoading) {
          window.__firebaseLoading = true;
          await Promise.all([
            new Promise(function(res) {
              var s = document.createElement('script');
              s.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js';
              s.onload = res; s.onerror = res;
              document.head.appendChild(s);
            }),
          ]).then(function() {
            return new Promise(function(res) {
              var s = document.createElement('script');
              s.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js';
              s.onload = res; s.onerror = res;
              document.head.appendChild(s);
            });
          });
        }
        return _origEnterApp.apply(this, arguments);
      };
    }
  }

  // Poll until enterApp is defined (defined in app.js)
  var _patchTries = 0;
  function tryPatch() {
    _patchTries++;
    if (typeof window.enterApp === 'function') {
      patchEnterApp();
    } else if (_patchTries < 20) {
      setTimeout(tryPatch, 200);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryPatch);
  } else {
    tryPatch();
  }
})();


/* ── WalletConnect: load only on demand ── */
(function(){
  'use strict';
  var _wcLoaded = false;
  var _wcLoading = false;
  var _wcQueue = [];

  function loadWC(cb) {
    if (_wcLoaded) { cb(); return; }
    _wcQueue.push(cb);
    if (_wcLoading) return;
    _wcLoading = true;
    window.process = window.process || { env: { NODE_ENV: 'production' }, version: 'v16.0.0', browser: true };
    var s = document.createElement('script');
    s.src = '/wc.js';
    s.onload = function() {
      _wcLoaded = true;
      _wcLoading = false;
      _wcQueue.forEach(function(fn){ try{fn();}catch(e){} });
      _wcQueue = [];
    };
    s.onerror = function() {
      _wcLoading = false;
      console.warn('[WC] Failed to load /wc.js');
      _wcQueue = [];
    };
    document.head.appendChild(s);
  }

  // Patch openWalletModal to lazy-load WC
  var _patchWCTries = 0;
  function patchWC() {
    _patchWCTries++;
    if (typeof window.openWalletModal === 'function' && !window.__wcPatched) {
      window.__wcPatched = true;
      var _orig = window.openWalletModal;
      window.openWalletModal = function() {
        var args = arguments;
        loadWC(function() { _orig.apply(window, args); });
      };
    } else if (_patchWCTries < 20) {
      setTimeout(patchWC, 300);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchWC);
  } else {
    patchWC();
  }
})();

/* ── BLOCK 1 ── */
window.process = window.process || { env: { NODE_ENV: 'production' }, version: 'v16.0.0', browser: true };

/* ── BLOCK 2 ── */
/* ════════════════════════════════════════
   OB-SCREEN — Onboarding JS (splash → slides → seed → verify → app)
   ════════════════════════════════════════ */
(function(){
  const OB_KEY = 'zw_ob_done';

  /* ── Check if already done ── */
  function shouldShowOb(){
    return !localStorage.getItem(OB_KEY);
  }

  /* ── Particle canvas ── */
  function initParticles(){
    const canvas = document.getElementById('ob-canvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = Array.from({length:60},()=>({
      x:Math.random()*canvas.width,
      y:Math.random()*canvas.height,
      r:Math.random()*1.5+.3,
      dx:(Math.random()-.5)*.4,
      dy:(Math.random()-.5)*.4,
      a:Math.random()*.5+.1
    }));
    function draw(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      particles.forEach(p=>{
        ctx.beginPath();
        ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(0,229,255,${p.a})`;
        ctx.fill();
        p.x+=p.dx; p.y+=p.dy;
        if(p.x<0||p.x>canvas.width) p.dx*=-1;
        if(p.y<0||p.y>canvas.height) p.dy*=-1;
      });
      requestAnimationFrame(draw);
    }
    draw();
  }

  /* ── Step transitions ── */
  function showStep(id){
    ['ob-splash','ob-features','ob-seed-step','ob-verify-step'].forEach(s=>{
      const el=document.getElementById(s);
      if(el){ el.style.display='none'; el.classList.remove('show'); }
    });
    const target=document.getElementById(id);
    if(target){
      target.style.display='flex';
      requestAnimationFrame(()=>target.classList.add('show'));
    }
  }

  /* ── Splash → Features auto transition ── */
  function obStart(){
    if(!shouldShowOb()){ hideObScreen(); return; }
    const screen = document.getElementById('ob-screen');
    if(!screen){ return; }
    screen.style.display='flex';
    initParticles();
    // Show splash, then auto-advance to features after 2.4s
    showStep('ob-splash');
    setTimeout(()=>{ obShowFeatures(); }, 2400);
  }

  function obShowFeatures(){
    showStep('ob-features');
    obCurrentSlide = 0;
    updateDots();
    // Animate first slide bars
    setTimeout(()=>{
      document.querySelectorAll('#ob-bars .ob-bar').forEach((b,i)=>{
        setTimeout(()=>b.classList.add('show'), i*80);
      });
    }, 300);
    // Touch/swipe
    const wrap = document.getElementById('ob-slides-wrap');
    if(wrap){
      let tx=0;
      wrap.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;},{passive:true});
      wrap.addEventListener('touchend',e=>{
        const dx=e.changedTouches[0].clientX-tx;
        if(Math.abs(dx)>48){ if(dx<0) obNextSlide(); else obPrevSlide(); }
      },{passive:true});
    }
  }

  /* ── Slide navigation ── */
  const TOTAL_SLIDES = 5;
  let obCurrentSlide = 0;

  function updateSlidePos(){
    const slides = document.getElementById('ob-slides');
    if(slides) slides.style.transform=`translateX(-${obCurrentSlide*100}%)`;
  }

  function updateDots(){
    document.querySelectorAll('.ob-dots .ob-dot').forEach((d,i)=>{
      d.classList.toggle('active', i===obCurrentSlide);
    });
    const btn = document.getElementById('ob-btn-next');
    if(btn){
      if(obCurrentSlide===TOTAL_SLIDES-1){
        btn.innerHTML='Lanjut <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
        btn.onclick = obSkipToSeed;
      } else {
        btn.innerHTML='Selanjutnya <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>';
        btn.onclick = obNextSlide;
      }
    }
    // Slide-specific animations
    animateSlide(obCurrentSlide);
  }

  function animateSlide(idx){
    if(idx===1){
      // Donut already visible via SVG
    }
    if(idx===2){
      setTimeout(()=>{
        document.querySelectorAll('.ob-chat-bubble').forEach((b,i)=>{
          setTimeout(()=>b.classList.add('show'), i*300);
        });
      }, 200);
    }
    if(idx===3){
      setTimeout(()=>{
        const p=document.getElementById('ob-ai-prompt');
        const r=document.getElementById('ob-ai-response');
        if(p) p.classList.add('show');
        if(r) setTimeout(()=>r.classList.add('show'), 600);
      }, 200);
    }
  }

  window.obNextSlide = function(){
    if(obCurrentSlide<TOTAL_SLIDES-1){
      obCurrentSlide++;
      updateSlidePos();
      updateDots();
    } else {
      obSkipToSeed();
    }
  };

  window.obPrevSlide = function(){
    if(obCurrentSlide>0){
      obCurrentSlide--;
      updateSlidePos();
      updateDots();
    }
  };

  window.obGoToSlide = function(i){
    obCurrentSlide = i;
    updateSlidePos();
    updateDots();
  };

  window.obSkipToSeed = function(){
    showStep('ob-seed-step');
    obRegenSeed();
  };

  window.obSkipToLogin = function(){
    hideObScreen();
  };

  /* ── Seed generation ── */
  // Word list (uses W from main app if available, otherwise fallback)
  const FALLBACK_WORDS = ['abadi','awal','bijak','cahaya','damai','elang','fajar','gagah','harum','ilmu',
    'jiwa','karya','lestari','mahir','nyata','obat','pohon','ramah','sabar','tabah',
    'tenang','utama','vital','waktu','zaman','kuat','maju','merdeka','terang','sinar'];

  let obCurrentSeed = [];

  window.obRegenSeed = function(){
    const words = (typeof W !== 'undefined' && W.length > 10) ? W : FALLBACK_WORDS;
    obCurrentSeed = [];
    while(obCurrentSeed.length < 3){
      const w = words[Math.floor(Math.random()*words.length)];
      if(!obCurrentSeed.includes(w)) obCurrentSeed.push(w);
    }
    obCurrentSeed.forEach((w,i)=>{
      const card = document.getElementById('ob-sc'+i);
      const wordEl = document.getElementById('ob-sw'+i);
      if(card) card.classList.remove('revealed');
      if(wordEl) wordEl.textContent = '···';
      setTimeout(()=>{
        if(wordEl) wordEl.textContent = w;
        if(card){ card.classList.add('revealed'); }
      }, i*150 + 100);
    });
    const procBtn = document.getElementById('ob-proceed-btn');
    if(procBtn) procBtn.disabled = false;
  };

  window.obGoToVerify = function(){
    showStep('ob-verify-step');
    obSetupVerify();
  };

  /* ── Verify seed ── */
  function obSetupVerify(){
    // Pick random word index to verify
    const idx = Math.floor(Math.random()*3);
    const correct = obCurrentSeed[idx];
    const qText = document.getElementById('ob-q-text');
    if(qText) qText.textContent = `Pilih kata ke-${idx+1} dari seed phrase kamu`;

    // Generate 4 choices (1 correct + 3 random)
    const words = (typeof W !== 'undefined' && W.length > 10) ? W : FALLBACK_WORDS;
    const choices = [correct];
    while(choices.length < 4){
      const w = words[Math.floor(Math.random()*words.length)];
      if(!choices.includes(w) && w !== correct) choices.push(w);
    }
    // Shuffle
    choices.sort(()=>Math.random()-.5);

    const container = document.getElementById('ob-choices');
    if(!container) return;
    container.innerHTML = '';
    choices.forEach(w=>{
      const btn = document.createElement('button');
      btn.className = 'ob-choice';
      btn.textContent = w;
      btn.onclick = ()=>{
        if(w === correct){
          btn.classList.add('correct');
          container.querySelectorAll('.ob-choice').forEach(b=>b.disabled=true);
          setTimeout(()=>{
            document.getElementById('ob-verify-q').style.display='none';
            document.getElementById('ob-verify-ok').style.display='flex';
          }, 600);
        } else {
          btn.classList.add('wrong');
          setTimeout(()=>btn.classList.remove('wrong'), 500);
        }
      };
      container.appendChild(btn);
    });

    // Reset success state
    const vq = document.getElementById('ob-verify-q');
    const vok = document.getElementById('ob-verify-ok');
    if(vq) vq.style.display='flex';
    if(vok) vok.style.display='none';
  }

  window.obEnterApp = async function(){
    localStorage.setItem(OB_KEY, '1');
    if(obCurrentSeed.length !== 3){ hideObScreen(); return; }

    const seed = obCurrentSeed.slice(); // copy

    // Show loading state
    const btn = document.getElementById('ob-enter-btn');
    if(btn){ btn.disabled = true; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:obRingSpin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg> Menyimpan...'; }

    try {
      // Try to save new account to cloud
      const fresh = { dca:[], port:[], cf:[], createdAt: new Date().toISOString() };
      try { await dbSet(seed, fresh); } catch(e){ console.warn('cloud save failed', e); }

      // Use the main app's enterApp() to properly initialize everything
      // This saves 'wo_cache' in the correct format
      hideObScreen();
      if(typeof enterApp === 'function'){
        await enterApp(seed, fresh);
      } else {
        // Fallback: save to wo_cache manually so boot() can find it
        localStorage.setItem('wo_cache', JSON.stringify({ seed, data: fresh }));
        hideObScreen();
        location.reload();
      }
    } catch(e) {
      console.error('obEnterApp error:', e);
      // Fallback: save to wo_cache and let boot handle it
      const fresh = { dca:[], port:[], cf:[] };
      localStorage.setItem('wo_cache', JSON.stringify({ seed, data: fresh }));
      hideObScreen();
    }
  };

  function hideObScreen(){
    const screen = document.getElementById('ob-screen');
    if(!screen) return;
    screen.classList.add('ob-exit');
    setTimeout(()=>{ screen.style.display='none'; }, 520);
  }

  /* ── Init ── */
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', obStart);
  } else {
    obStart();
  }
})();

/* ── BLOCK 3 ── */
(function() {
      const yr = new Date().getFullYear();
      const chip = document.getElementById('ai-chip-target');
      if (chip) {
        chip.dataset.prompt = 'Target harga Bitcoin ' + yr;
        document.getElementById('ai-chip-target-label').textContent = 'Target ' + yr;
      }
    })();

/* ── BLOCK 4 ── */
// Promise.any polyfill for older Android WebView
if(!Promise.any){Promise.any=function(ps){return new Promise((res,rej)=>{let n=ps.length,errs=[];if(!n)rej(new AggregateError([],'All promises rejected'));ps.forEach(p=>Promise.resolve(p).then(res).catch(e=>{errs.push(e);if(!--n)rej(new AggregateError(errs,'All promises rejected'))}))})}}
/* ══════════ WORD LIST ══════════ */
const W = [
'abadi','abah','abang','abdi','abon','absah','adat','adik','adil','agak','agar','agung','ahli','ajak','ajal','ajar','akal','akar','akhir','aktif',
'alam','alat','alim','amal','ambil','ampuh','aneh','angin','angka','angkat','anyam','apel','api','apik','arak','arang','arus','asah','asal','asap',
'asli','atas','awak','awal','awas','ayam','ayat','ayun','babi','badan','bagus','bahan','baik','baju','bakti','balok','bapak','baris','baru','basah',
'batas','batu','bawa','bawah','beban','bebas','bedil','benar','benih','berani','besar','bibit','bijak','biji','bintang','biru','bisa','bocah','bola','boleh',
'boros','buah','bubur','budi','bulan','bunga','buntut','buruk','busur','cabang','cahaya','cakap','cepat','cerah','cerdas','cermat','cinta','cocok','cuaca','cukup',
'curam','dagang','daging','dalam','damai','dapur','darah','darat','datang','daun','debat','debu','dengar','deras','dewa','diam','didik','dinding','diri','duduk',
'duri','dusta','ekor','elang','elok','embun','enak','erat','faham','fajar','fakta','fasih','fokus','gagah','gagal','gajah','ganas','garam','garis','gatal',
'gelap','gerak','getah','girang','gizi','gunung','guru','habis','hadap','harga','hari','harum','hasil','hati','hebat','hemat','hidup','hijau','hitam','hujan',
'hutan','ilmu','impian','ingin','istri','jaga','jalan','janji','jauh','jawab','jejak','jiwa','juara','jujur','juta','kabar','kain','kapal','karya','kata',
'kaya','keras','kuat','kudus','kulit','kunci','kursi','lahir','lapar','lapang','laut','lebah','lemah','lembu','lembut','lestari','lidah','lulus','lurus','mahir',
'maju','makan','malam','manis','mantap','mawar','merah','merdeka','mimpi','modal','mudah','murni','nafas','naga','nama','nalar','nyaman','nyata','nyawa','obat',
'otak','pagi','paham','pahit','panas','pandai','pantai','pohon','putih','raih','rakit','ramah','rasa','ringan','rumah','sabar','sakit','salam','segar','sehat',
'senja','setia','sigap','sinar','sukses','sunyi','tabah','tanah','teguh','tenang','tepat','terang','tunas','ulet','utama','utuh','vital','wajah','waktu','warga',
'warna','zaman','zakat','acak','acar','acara','acuh','adam','adas','aduh','aduk','agam','agen','ajeg','akan','akil','akta','akur','alas','alih',
'alir','alpa','amah','aman','ambang','amis','ampas','amuk','andam','andil','angkuh','angsur','antar','antara','anti','apung','arif','arit','arung','asam',
'asin','asri','atap','babu','bacok','badai','bajak','bakar','bakau','bakso','balik','balun','bambu','banda','bandel','banding','baret','baring','bata','batok',
'bawang','bayam','bayar','bebek','bekal','belah','belut','benda','bening','bentak','biasa','bicara','bidang','bimbang','binasa','bintik','birahi','bising','bodoh','bongkar',
'botol','budak','bugil','bujur','bukit','bulat','buluh','buncit','burai','burung','butir','cabai','cadas','cagak','cambuk','campak','canggih','candu','capai','capung',
'cara','cari','carum','catatan','cawat','cebol','cedal','cekam','cemas','cemara','cemberut','cendekia','cendol','cerewet','cicak','cidera','cium','coba','cobek','colong',
'comot','copet','cubit','cuci','cucuk','cucut','culik','culun','dadah','daki','dakwa','dampar','dandan','dangkal','dayung','dekat','dekil','delima','demam','dendam',
'dengki','depan','derap','desak','desir','desus','dikit','doa','dodol','domba','dongeng','doyong','durian','egois','elus','emak','embik','empang','empat','encik',
'engkau','esok','faedah','famili','fardu','fasik','firasat','fitnah','gabah','gabung','gada','gadai','gaib','gali','galuh','gambir','gampar','gampang','gancang','gandrung',
'gangguan','ganggu','gantung','garpu','garuda','gawat','gayung','gebuk','gemuk','genap','gendang','getir','gigih','golong','gondrong','gosong','gosip','gotong','gubuk','gugur',
'gulai','gulat','gulung','gusar','hadir','hakim','halal','halus','hambat','hamil','hancur','haram','heran','hijab','hina','hingga','hiruk','hormat','hutang','iblis',
'ikan','ikut','impi','indah','induk','ingat','ingkar','insaf','intai','ironi','jahat','jajak','jajal','jalang','jamak','janda','jaring','jatuh','jeli','jelma',
'jenaka','jerit','jungkir','kakak','kalong','kalung','kamar','kambuh','kambing','kampung','kasar','kasih','kawah','kawat','kawan','kecam','kecewa','kecut','kemah','kembang',
'kentut','kepala','kesat','kejar','kejam','kelam','kerap','kesal','ketam','ketok','kidal','kilas','kilat','kira','kobar','kolong','komplit','kompak','koyak','kubur',
'kukuh','kulak','kumis','kupas','kurang','labu','lacak','lacur','ladang','lagak','lagam','lahat','lahan','lalu','lancar','lancip','lantas','lapuk','larut','layak',
'lebur','lecak','lecet','lekat','lemas','lepas','licin','ligat','lihat','lilit','lipur','lomba','lorong','lubang','luber','lucah','lunak','luntur','lupa','lusuh',
'mangkuk','marah','masa','masak','mati','mayat','mekar','memar','merana','mewah','miang','minta','miris','miring','muat','mudik','mulia','munkar','musim','musuh',
'nampak','narik','nasib','nenas','ngeri','ngilu','nikah','nikmat','nista','numpang','nurut','nyaris','nyeri','obral','onar','ongkos','pacah','pacar','paduan','pagar',
'paha','paksa','palsu','palung','panggil','panjang','panik','pantun','papan','parasit','pasir','pasok','patah','patok','payah','pekan','pekat','pelik','peluk','penat',
'pening','perih','piara','pikir','pijak','pikul','pindah','pirang','pisang','polos','pondok','potong','pukul','pulang','punah','pusing','putus','racun','rajin','rakus',
'ramai','rampok','rancak','ranting','rapuh','rata','rawat','rebah','ribut','rimbun','rinci','riuh','roboh','roda','rohani','rosak','rusak','rusuh','sabun','sadar',
'sadis','sahih','salah','samun','sangar','sangka','santai','santun','sapa','sapu','sarung','sawah','sayap','sebab','sedang','sedih','segala','sempit','senang','sepi',
'serba','setan','singkat','sisik','soal','sodor','sogok','sopan','sorak','subur','sulit','sulur','sungguh','surut','susah','susu','susut','tabu','tahan','tajam',
'takut','tali','tampak','tanduk','tapak','taruh','tebal','tekad','tekun','tempuh','tendang','tepung','terus','tetak','tikam','tipu','tobat','tolak','tolong','topang',
'tugas','tulus','tumpul','tumpu','turun','tutup','ubah','ugal','ujian','ulah','ulang','umpan','undur','ungkit','untung','upah','urung','usaha','usul','utang',
'wajar','waras','warung','wasiat','wibawa','wujud','abrik','acuan','alun','ambal','ampai','ampel','anduh','angkut','anjung','ansar','arau','ardan','aruh','asak',
'asuh','awu','ayak','ayuk','bacem','bagian','balai','balar','balen','balur','bancar','banci','bantai','bantam','bantu','bapang','basmi','bawat','beduk','bekam',
'belaka','belang','belat','beliung','bengis','biang','bilas','bilur','bimbit','bocor','bolong','boneka','borok','bubut','bukan','bulang','bulung','bulut','bumbu','buntung',
'bursa','busuk','buyut','cabul','cakra','cala','calar','catat','cecah','cecar','cekat','ceking','celaka','celat','celik','cemoh','ceper','cergas','cicit','cilok',
'cingkir','ciprat','congkak','copot','coreng','cuap','cucur','culas','curah','dadap','dangau','datuk','dawat','dayang','debur','decak','dedah','delap','demit','denah',
'derai','derma','didam','didih','dilap','dimah','diram','dokar','dongkol','duit','empuk','empu','endap','endus','esem','gagap','galau','gamat','gangsa','gapaian',
'gapai','garuk','gayut','geger','gelang','geliat','gembur','gempar','gencet','gendut','genteng','geram','gertak','gilir','gombal','goyang','gubal','hambar','hampir','hayal',
'jagung','jambu','jambul','jentik','jepret','jingkrak','joget','jumawa','jumpa','kadang','kalau','kali','kalut','kancil','kandas','kapok','kawin','kayuh','kecoh','kelak',
'kelat','keling','kelip','keliru','kelopak','kencang','kenyal','kepak','kepung','kerat','kerja','keruh','kesah','kibar','kibas','kibul','kikis','kilap','kilir','kintal',
'kirim','kocak','kodok','kopiah','kopok','kuasa','kubu','kumat','kumpul','kurap','kutuk','laba','labrak','lahap','lain','lambat','lamban','lampai','langgam','langkah',
'langit','lanjut','larik','lasak','lawan','lebat','legak','lengah','lentur','lesap','lesu','licik','limbah','lincah','lingkung','lisut','lolong','loncat','luput','luyut',
'macam','macet','malah','maling','malun','mapan','miskin','mogok','mudar','mulur','muntah','murung','nakal','nampan','nangis','napas','narsis','ngambek','ngoceh','ngomel'
];

// ══════════════════════════════════════════════════════════════════
// SECURITY: Crypto functions
// ══════════════════════════════════════════════════════════════════

const _loginAttempts = {count:0, resetAt: Date.now() + 60000};
function checkRateLimit(){
  const now = Date.now();
  if(now > _loginAttempts.resetAt){
    _loginAttempts.count = 0;
    _loginAttempts.resetAt = now + 60000;
  }
  if(_loginAttempts.count >= 5){
    const wait = Math.ceil((_loginAttempts.resetAt - now)/1000);
    throw new Error(`Terlalu banyak percobaan. Tunggu ${wait} detik.`);
  }
  _loginAttempts.count++;
}

async function sha256(text){
  const buf = await crypto.subtle.digest(
    'SHA-256', 
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2,'0'))
    .join('');
}

function rnd3(){
  const arr = new Uint32Array(3);
  crypto.getRandomValues(arr);
  const a = arr[0] % W.length;
  let b = arr[1] % W.length;
  let c = arr[2] % W.length;
  // Ensure no duplicates
  while(b === a) b = (b + 1) % W.length;
  while(c === a || c === b) c = (c + 1) % W.length;
  return [W[a], W[b], W[c]];
}

function validateSeedWords(words){
  const wSet = new Set(W);
  return words.every(w => wSet.has(w));
}

async function seedKeyHash(a,b,c){
  const plain = `${a}-${b}-${c}`;
  return await sha256(plain);
}


/* ══════════════════════════════════════════════
   DATABASE: Supabase — query by seed_key
   Table: accounts (seed_key TEXT PK, data JSONB)
   REST API: /rest/v1/accounts?seed_key=eq.xxx
   Works dari semua device, deterministik
══════════════════════════════════════════════ */
const SB_URL  = 'https://kpikyqafapclyirpqflp.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c';
const SB_HEADERS = {
  'apikey': SB_ANON,
  'Authorization': 'Bearer '+SB_ANON,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function sbGet(seedKey){
  const url=`${SB_URL}/rest/v1/accounts?seed_key=eq.${encodeURIComponent(seedKey)}&select=data`;
  const r=await fetch(url,{headers:SB_HEADERS});
  if(!r.ok) throw new Error('sbGet failed '+r.status);
  const rows=await r.json();
  if(!rows||!rows.length) return null;
  return rows[0].data;
}

async function sbSet(seedKey, data){
  const url=`${SB_URL}/rest/v1/accounts`;
  const headers={...SB_HEADERS,'Prefer':'resolution=merge-duplicates,return=minimal'};
  const r=await fetch(url,{
    method:'POST',
    headers,
    body:JSON.stringify({seed_key:seedKey, data, updated_at:new Date().toISOString()})
  });
  if(!r.ok){
    const err=await r.text();
    throw new Error('sbSet failed '+r.status+': '+err);
  }
  return true;
}

async function sbDelete(seedKey){
  const url=`${SB_URL}/rest/v1/accounts?seed_key=eq.${encodeURIComponent(seedKey)}`;
  const r=await fetch(url,{method:'DELETE',headers:SB_HEADERS});
  if(!r.ok) throw new Error('sbDelete failed: '+r.status);
}

async function dbGet(seed){
  const key = await seedKeyHash(...seed);
  const data = await sbGet(key);
  if(!data) return null;
  return data;
}

// dbSet: simpan/update data akun ke Supabase (dengan hash key)
async function dbSet(seed, data){
  const key = await seedKeyHash(...seed);
  await sbSet(key, data);
}

/* ══════════ STATE ══════════ */
const S={btcPrice:null,btcPriceIDR:null,btcChange:null,usdIdr:16000,dca:[],port:[],cf:[]};
let curSeed=null, lastSync=null, syncTmr=null;

/* ── Wallet State (Read-Only, Multi-Token, Multi-Chain incl. BTC) ── */
const walletState = {
  // EVM (MetaMask / OKX / Phantom)
  connected: false,
  providerName: null,
  address: null,
  chainId: null,
  tokens: [],
  loading: false,
  refreshInterval: null,
  // BTC addresses (manual / auto dari OKX/Phantom)
  btcAddresses: [],
  btcRefreshInterval: null,
  btcPanelOpen: false,
};
const SVG_CLK='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;opacity:.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

/* ══════════ LOGIN ══════════ */
let genSeed=null, confirmed=false;

function switchTab(t){
  _activeTab=t;
  document.getElementById('tab-new').style.display=t==='new'?'block':'none';
  document.getElementById('tab-existing').style.display=t==='existing'?'block':'none';
  document.getElementById('ltab-new').className='ltab'+(t==='new'?' active':'');
  document.getElementById('ltab-existing').className='ltab'+(t==='existing'?' active':'');
  document.getElementById('lerr').style.display='none';
  document.getElementById('lloading').style.display='none';
}

function doGenerate(){
  genSeed=rnd3();
  document.getElementById('sw1').textContent=genSeed[0];
  document.getElementById('sw2').textContent=genSeed[1];
  document.getElementById('sw3').textContent=genSeed[2];
  // Reset konfirmasi saat seed baru di-generate
  confirmed=false;
  const b=document.getElementById('chk');
  b.className='check-box';b.textContent='';
  document.getElementById('btn-create').disabled=true;
}

function doToggleConfirm(){
  confirmed=!confirmed;
  const b=document.getElementById('chk');
  b.className='check-box'+(confirmed?' on':'');
  b.textContent=confirmed?'✓':'';
  document.getElementById('btn-create').disabled=!confirmed;
}

async function doCreate(){
  if(!genSeed){toast('Generate seed phrase dulu!',1);return}
  if(!confirmed){toast('Centang konfirmasi dulu!',1);return}
  showLL('Membuat akun...');
  try{
    let ex=null;
    try{ex=await dbGet(genSeed)}catch(e){}
    if(ex){hideLL();await enterApp(genSeed,ex);return}
    const fresh={dca:[],port:[],cf:[],createdAt:new Date().toISOString()};
    try{await dbSet(genSeed,fresh)}catch(e){console.warn('cloud save failed',e)}
    hideLL();
    await enterApp(genSeed,fresh);
  }catch(e){
    hideLL();
    await enterApp(genSeed,{dca:[],port:[],cf:[]});
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Mode offline — data lokal saja',1);
  }
}

async function doLogin(){
  const w1=document.getElementById('iw1').value.trim().toLowerCase();
  const w2=document.getElementById('iw2').value.trim().toLowerCase();
  const w3=document.getElementById('iw3').value.trim().toLowerCase();
  if(!w1||!w2||!w3){showLerr('Isi ketiga kata');return}
  // Rate limiting protection
  try{ checkRateLimit(); } catch(e){ showLerr(e.message); return; }
  // Validate words exist in word list (prevents enumeration attack)
  if(!validateSeedWords([w1,w2,w3])){
    showLerr('Kata tidak valid. Pastikan kata sesuai dengan daftar seed phrase.');
    return;
  }
  showLL('Mencari di cloud...');
  try{
    const data=await dbGet([w1,w2,w3]);
    if(!data){
      hideLL();
      showLerr('Akun tidak ditemukan. Pastikan seed phrase benar (huruf kecil, urutan tepat).');
      return;
    }
    hideLL();
    await enterApp([w1,w2,w3],data);
  }catch(e){
    hideLL();
    try{
      const raw=localStorage.getItem('wo_cache');
      if(raw){
        const {seed,data}=JSON.parse(raw);
        if(seed&&seed[0]===w1&&seed[1]===w2&&seed[2]===w3){
          await enterApp([w1,w2,w3],data);
          toast('Mode offline — data lokal');return;
        }
      }
    }catch(e2){}
    showLerr('Gagal terhubung. Cek koneksi internet.');
  }
}

async function enterApp(seed,data){
  curSeed=seed;
  S.dca=data.dca||data.dcaEntries||[];
  S.port=data.port||data.portfolioItems||[];
  // FIX: Migrasi & sync DCA → porto saat login/load
  // Dijalankan setelah harga BTC ada (~3 detik)
  setTimeout(() => {
    if (typeof _syncDCAToPorto !== 'function') return;
    if (S.dca.length === 0) return; // tidak ada data DCA, skip

    // Cek apakah sudah ada aset BTC di porto (input manual oleh user)
    const existingBTC = S.port.find(x => x.ticker && x.ticker.toLowerCase() === 'btc');

    if (!existingBTC) {
      // Belum ada aset BTC di porto sama sekali → buat otomatis dari DCA
      _syncDCAToPorto();
      saveState();
    } else if (existingBTC._dcaManaged === true) {
      // Sudah ada dan dikelola otomatis → update saja
      _syncDCAToPorto();
      saveState();
    } else if (existingBTC._dcaManaged === undefined) {
      // Ada aset BTC lama (input manual / dari sesi sebelumnya) → tanya user
      // Tandai sebagai managed agar sync bisa jalan
      existingBTC._dcaManaged = true;
      _syncDCAToPorto();
      saveState();
      // Toast info (tidak perlu konfirmasi, data DCA lebih akurat)
      setTimeout(() => toast('ℹ️ Aset Bitcoin di Porto diperbarui otomatis dari data DCA kamu.', 0, 4000), 500);
    }
    // existingBTC._dcaManaged === false → user sudah opt-out, jangan diubah
  }, 3000);
  S.cf=data.cf||data.cashflowItems||[];
  // Restore BTC addresses milik akun ini
  walletState.btcAddresses = [];
  const savedBtcAddrs = data.btcAddrs||data.btcAddresses||[];
  savedBtcAddrs.forEach(x=>{
    if(x&&x.address&&!walletState.btcAddresses.find(e=>e.address===x.address)){
      walletState.btcAddresses.push({address:x.address,btc:null,valueIDR:null,valueUSD:null,loading:true});
    }
  });
  // Juga load dari zw_btc_addrs jika ada (legacy/backward compat), lalu hapus
  try{
    const legacyRaw=localStorage.getItem('zw_btc_addrs');
    if(legacyRaw){
      JSON.parse(legacyRaw).forEach(x=>{
        if(x&&x.address&&!walletState.btcAddresses.find(e=>e.address===x.address)){
          walletState.btcAddresses.push({address:x.address,btc:null,valueIDR:null,valueUSD:null,loading:true});
        }
      });
      localStorage.removeItem('zw_btc_addrs'); // migrate ke cloud
    }
  }catch(e){}
  const btcAddrsSave = walletState.btcAddresses.map(x=>({address:x.address}));
  localStorage.setItem('wo_cache',JSON.stringify({seed,data:{dca:S.dca,port:S.port,cf:S.cf,btcAddrs:btcAddrsSave}}));
  // nav-acct shows "Akun" label (not seed phrase for privacy)
  const mob=document.getElementById('nav-acct-mob');if(mob)mob.textContent=seed.join(' · ');
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='block';
  document.getElementById('sync-bar').style.display='none';
  setSyncStatus('synced');
  lastSync=new Date();
  initApp();
  // Refresh BTC balances jika ada address yang di-restore
  if(walletState.btcAddresses.length>0){
    setTimeout(()=>{ try{refreshAllBTC();}catch(e){} },2000);
  }
  // Auto-load EVM wallet (read-only, tidak perlu popup wallet extension)
  const evmRestored = data.evmWallet;
  if(evmRestored && evmRestored.address){
    walletState.connected = true;
    walletState.providerName = 'Read-Only';
    walletState.address = evmRestored.address;
    walletState.chainId = evmRestored.chainId || 1;
    walletState.tokens = [];
    walletState.loading = true;
    updateWalletUI();
    setTimeout(async()=>{
      try{
        await fetchWalletTokens(walletState.address, walletState.chainId);
        // Setup auto-refresh
        if(walletState.refreshInterval) clearInterval(walletState.refreshInterval);
        walletState.refreshInterval = setInterval(()=>{
          if(walletState.connected) fetchWalletTokens(walletState.address, walletState.chainId);
        }, 60000);
      }catch(e){ walletState.loading=false; }
    }, 2500);
  }

  // ── Auto-init chat segera setelah login ──
  // Retry loop: coba sampai berhasil, max 5x dengan interval 2 detik
  let _chatAutoInitTries = 0;
  async function tryChatAutoInit() {
    _chatAutoInitTries++;
    try {
      if (!chatSB) {
        const lib = window.supabase || window.Supabase;
        if (lib) chatSB = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
      if (chatSB) {
        await chatBoot(); // chatBoot sudah memanggil loadDashChatPreview di akhir
        if (!window._globalNotifReady) {
          window._globalNotifReady = true;
          subscribeGlobalChatNotif();
        }
        return; // sukses, stop retry
      }
    } catch(e) { console.warn('Auto chat init attempt', _chatAutoInitTries, ':', e.message); }

    // Gagal: retry sampai 5x
    if (_chatAutoInitTries < 5) {
      setTimeout(tryChatAutoInit, 2000);
    } else {
      console.warn('[chat] Auto init gagal setelah 5 percobaan');
    }
  }
  setTimeout(tryChatAutoInit, 800); // mulai lebih cepat

  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => showNotifPermissionPrompt(), 3000);
  }

  // FIX: Mulai auto-refresh berita sejak login, bukan nunggu user buka Dashboard
  setTimeout(() => startNewsAutoRefresh(), 3000);
}

let _activeTab='new'; // track active tab for showLL/hideLL
function showLL(m){
  // Determine which tab is currently visible before hiding
  if(document.getElementById('tab-new').style.display!=='none') _activeTab='new';
  else if(document.getElementById('tab-existing').style.display!=='none') _activeTab='existing';
  document.getElementById('tab-new').style.display='none';
  document.getElementById('tab-existing').style.display='none';
  document.getElementById('lloading').style.display='flex';
  document.getElementById('lmsg').textContent=m;
}
function hideLL(){
  document.getElementById('lloading').style.display='none';
  // Restore the previously active tab only if login screen is still showing
  const loginScreen = document.getElementById('login-screen');
  if(loginScreen && loginScreen.style.display !== 'none'){
    if(_activeTab==='new') document.getElementById('tab-new').style.display='block';
    else document.getElementById('tab-existing').style.display='block';
  }
}
function showLerr(m){
  document.getElementById('lerr').innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:.3rem"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'+m;
  document.getElementById('lerr').style.display='block';
  document.getElementById('tab-existing').style.display='block';
}

function showAcct(){
  document.getElementById('acct-dca').textContent=S.dca.length;
  document.getElementById('acct-port').textContent=S.port.length;
  document.getElementById('acct-cf').textContent=S.cf.length;
  document.getElementById('acct-sync').innerHTML=lastSync?SVG_CLK+' '+lastSync.toLocaleString('id-ID'):'Belum sync';
  const row=document.getElementById('acct-seed-row');
  row.innerHTML=(curSeed||[]).map((w,i)=>`<div class="sw"><div class="sw-num">${i+1}</div>${w}</div>`).join('');
  const st=document.getElementById('acct-sync-cloud-status');
  if(st){st.style.display='none';st.textContent='';}
  openModal('modal-acct');
  // Update status notif di modal
  setTimeout(updateAcctNotifUI, 50);
}

async function doLogout(){
  if(!confirm('Logout? Pastikan sudah menyimpan seed phrase!'))return;
  try { await unsubscribePush(); } catch(e) {}
  // Clear any pending sync
  if(syncTmr){clearTimeout(syncTmr);syncTmr=null;}
  // Clear all intervals agar tidak leak
  if(_fetchBTCInterval){clearInterval(_fetchBTCInterval);_fetchBTCInterval=null;}
  if(_chartRefreshInterval){clearInterval(_chartRefreshInterval);_chartRefreshInterval=null;}
  // Unsubscribe chat realtime
  if(chatState?.msgSubscription && chatSB){
    try{chatSB.removeChannel(chatState.msgSubscription);}catch(e){}
    chatState.msgSubscription=null;
  }
  curSeed=null;lastSync=null;
  S.dca=[];S.port=[];S.cf=[];
  localStorage.removeItem('wo_cache');
  localStorage.removeItem('zw_btc_addrs'); // hapus BTC addrs global (legacy)
  // Reset walletState sepenuhnya agar tidak bocor ke akun lain
  walletState.connected=false;
  walletState.providerName=null;
  walletState.address=null;
  walletState.chainId=null;
  walletState.tokens=[];
  walletState.loading=false;
  walletState.btcAddresses=[];
  if(walletState.refreshInterval){clearInterval(walletState.refreshInterval);walletState.refreshInterval=null;}
  if(walletState.btcRefreshInterval){clearInterval(walletState.btcRefreshInterval);walletState.btcRefreshInterval=null;}
  // Reset chat identity agar akun baru dapat identitas baru
  localStorage.removeItem('chat_code');
  localStorage.removeItem('chat_color');
  // Clear posisi futures aktif agar tidak bocor ke akun lain
  Object.values(_sigActiveTrades).forEach(t => { if(t.intervalId) clearInterval(t.intervalId); });
  _sigActiveTrades = {};
  localStorage.removeItem('sig_active_trades');
  // Clear news auto-refresh interval
  if (_newsAutoRefreshInterval) { clearInterval(_newsAutoRefreshInterval); _newsAutoRefreshInterval = null; }
  // Clear dashboard feed subscription
  if (_dashFeedSub) { try { chatSB?.removeChannel(_dashFeedSub); } catch(e) {} _dashFeedSub = null; }
  if (_dashFeedInterval) { clearInterval(_dashFeedInterval); _dashFeedInterval = null; }
  // Reset chatState
  chatState.myCode = null;
  chatState.myColor = null;
  chatState.currentRoomId = null;
  chatState.currentRoomName = '';
  chatState.rooms = [];
  chatState.msgSubscription = null;
  // Unsubscribe semua channel supabase
  if (chatSB) {
    try { chatSB.removeAllChannels(); } catch(e) {}
  }
  closeModal('modal-acct');
  document.getElementById('app').style.display='none';
  document.getElementById('sync-bar').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('tab-new').style.display='block';
  document.getElementById('tab-existing').style.display='none';
  document.getElementById('iw1').value='';
  document.getElementById('iw2').value='';
  document.getElementById('iw3').value='';
  [cAlloc,cPNL,cDCA,cSim,cCF,cDCABTCLive].forEach(c=>{if(c)try{c.destroy()}catch(e){}});
  cAlloc=cPNL=cDCA=cSim=cCF=cDCABTCLive=null;
  doGenerate();
}

/* ══════════ SYNC ══════════ */
function setSyncStatus(st){
  const dot=document.getElementById('sdot'),txt=document.getElementById('stext');
  const bar=document.getElementById('sync-bar');
  dot.className='sdot';
  if(st==='syncing'){
    dot.classList.add('syncing');
    txt.textContent='Menyimpan...';
    // Tampilkan sync bar hanya saat syncing, kecuali di halaman chat
    const isOnChat = document.getElementById('page-chat')?.classList.contains('active');
    if(!isOnChat && bar) bar.style.display='flex';
  } else if(st==='synced'){
    txt.textContent='Tersimpan';
    // Auto-hide sync-bar setelah 2 detik saat sudah tersimpan
    if(bar) {
      clearTimeout(bar._hideTimer);
      bar._hideTimer = setTimeout(()=>{ bar.style.display='none'; }, 2000);
    }
  } else {
    dot.classList.add('err');
    txt.textContent='Gagal sync';
    // Tetap tampil saat error
    const isOnChat = document.getElementById('page-chat')?.classList.contains('active');
    if(!isOnChat && bar) bar.style.display='flex';
  }
}

async function saveState(){
  // Simpan btcAddresses per-akun (hanya address, bukan balance cache)
  const btcAddrsSave = walletState.btcAddresses.map(x=>({address:x.address}));
  // Simpan EVM address (public, aman) agar auto-load saat login kembali
  const evmSave = walletState.address ? { address:walletState.address, chainId:walletState.chainId||1 } : null;
  const payload={dca:S.dca,port:S.port,cf:S.cf,btcAddrs:btcAddrsSave,evmWallet:evmSave,updatedAt:new Date().toISOString()};
  localStorage.setItem('wo_cache',JSON.stringify({seed:curSeed,data:payload}));
  if(!curSeed)return;
  clearTimeout(syncTmr);setSyncStatus('syncing');
  syncTmr=setTimeout(async()=>{
    try{
      await dbSet(curSeed,payload);
      lastSync=new Date();setSyncStatus('synced');
    }catch(e){
      setSyncStatus('err');
      toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal sync cloud — data lokal aman',1);
    }
  },2000);
}

/* ══════════ NAV ══════════ */
function animateNavIndicator(activeBtn){
  const ind=document.getElementById('bnav-indicator');
  if(!ind||!activeBtn) return;
  const navItems=document.querySelector('.bnav-items');
  if(!navItems) return;
  const navRect=navItems.getBoundingClientRect();
  const btnRect=activeBtn.getBoundingClientRect();

  const targetW=btnRect.width*0.45;
  const targetL=(btnRect.left-navRect.left)+(btnRect.width-targetW)/2;

    const currentL=parseFloat(ind.style.left||targetL);
  const movingRight=targetL>currentL;
  const stretch=btnRect.width*0.65;
  const stretchL=movingRight?currentL:targetL-(stretch-targetW);

  ind.style.transition='left .15s ease-out, width .15s ease-out';
  ind.style.left=stretchL+'px';
  ind.style.width=stretch+'px';

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      ind.style.transition='left .4s cubic-bezier(.34,1.4,.64,1), width .35s cubic-bezier(.34,1.56,.64,1)';
      ind.style.left=targetL+'px';
      ind.style.width=targetW+'px';
    });
  });
}

function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const pageEl = document.getElementById('page-'+id);
  if(!pageEl){ console.warn('Page not found: page-'+id); return; }
  pageEl.classList.add('active');
  const tabs=document.querySelectorAll('.nav-tab');
  ['dashboard','dca','portfolio','simulation','cashflow','ai-chat'].forEach((p,i)=>{if(p===id&&tabs[i])tabs[i].classList.add('active')});
  // Bottom nav active + animate indicator
  let activeBtn=null;
  document.querySelectorAll('.bnav-item').forEach(b=>{
    const isActive=b.dataset.page===id;
    b.classList.toggle('active',isActive);
    if(isActive) activeBtn=b;
  });
  animateNavIndicator(activeBtn);

  // ── Bottom nav akan di-restore di blok ai-chat else di bawah ──

  // ── Auto-hide sync-bar saat di halaman chat ──
  const syncBar = document.getElementById('sync-bar');
  if(syncBar && id === 'chat'){
    syncBar.style.display = 'none';
  }

  // ── Chat: init + reset unread badge ──
  if(id === 'chat'){
    initChat();
    if(window.ChatNotif) ChatNotif.resetUnread();
  }

  if(id==='dashboard'){
    renderDash();
    fetchFearGreed();
    // Refresh chat feed setiap kali kembali ke home
    if (chatSB) setTimeout(() => renderDashFeed(), 300);
    else setTimeout(() => { if(chatSB) renderDashFeed(); }, 2000);
    // Load berita untuk widget sorotan di dashboard
    setTimeout(() => loadCryptoNews(), 500);
    startNewsAutoRefresh(); // Auto-refresh berita setiap 30 menit + trigger notif

  // ── Bitcoin Power Law ──
  } else if(id === 'btc-powerlaw'){
    setTimeout(loadPowerLaw, 150);

  // ── Crypto Calendar ──
  } else if(id === 'crypto-calendar'){
    setTimeout(loadCryptoCalendar, 150);
  }
  if(id==='dca')renderDCA();
  if(id==='portfolio')renderPort();
  if(id==='simulation'){syncSimInputs()}
  if(id==='cashflow')renderCF();
  if(id==='theme')initThemePage();
  if(id==='alerts'){initAlertsPage();}
  if(id==='news'){ setTimeout(()=>loadCryptoNews(), 100); }
  if(id==='ai-predict'){ setTimeout(()=>{ if(!predData) runBTCPrediction(); }, 100); }
  if(id==='ai-signal'){ /* signal page ready */ }
  if(id==='ai-chat'){
    setTimeout(()=>initAIChat(), 100);
    // Hide bottom nav saat di AI chat untuk full screen experience
    const bnav = document.getElementById('bottom-nav');
    if(bnav){ bnav.style.opacity='0'; bnav.style.pointerEvents='none'; setTimeout(()=>{ bnav.style.display='none'; },200); }
  } else {
    // Restore bottom nav saat keluar dari AI chat
    const bnav = document.getElementById('bottom-nav');
    if(bnav && window.innerWidth <= 640){
      bnav.style.display='block';
      bnav.style.opacity='1';
      bnav.style.pointerEvents='';
      bnav.classList.remove('bnav-hidden');
    }
  }
  window.scrollTo({top:0,behavior:'smooth'});
  // Update FAB visibility
  if (typeof updateFabVisibility === 'function') updateFabVisibility(id);
  // Tutup fitur popup jika terbuka
  closeFiturPopup();
}

function toggleSimParam(){
  const body=document.getElementById('sim-param-body');
  const arrow=document.getElementById('sim-param-arrow');
  if(!body||!arrow)return;
  const open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  arrow.style.transform=open?'rotate(-90deg)':'rotate(0deg)';
}

/* ══════════ MODAL ══════════ */
function openModal(id){const el=document.getElementById(id);el.classList.add('open');el.scrollTop=0;}
function closeModal(id){document.getElementById(id).classList.remove('open')}
document.addEventListener('click',e=>{
  if(e.target.classList.contains('overlay'))e.target.classList.remove('open');
});

/* ══════════ TOAST ══════════ */
function toast(m, err, dur) {
  const t = document.getElementById('toast');
  if (!t) return;
  // Truncate — keep toast short and readable
  const plain = m.replace(/<[^>]*>/g, '').trim();
  const display = plain.length > 90 ? plain.slice(0, 87) + '…' : plain;
  const isErr = !!err;
  const borderColor = isErr ? 'rgba(239,68,68,.45)' : 'rgba(255,255,255,.12)';
  const textColor   = isErr ? '#f87171' : 'var(--accent3)';
  const radius      = display.length > 40 ? '16px' : '99px';

  t.innerHTML = '';  // clear first
  const inner = document.createElement('div');
  inner.style.cssText = [
    'display:flex', 'align-items:flex-start', 'gap:.45rem',
    'padding:.7rem 1rem', `border-radius:${radius}`,
    'font-size:.8rem', 'font-weight:600', 'line-height:1.55',
    'letter-spacing:.01em', `color:${textColor}`,
    'background:rgba(10,16,30,.96)',
    'backdrop-filter:blur(20px)',
    '-webkit-backdrop-filter:blur(20px)',
    `border:1.5px solid ${borderColor}`,
    'box-shadow:0 8px 32px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.07)',
    'word-break:break-word', 'overflow-wrap:break-word',
    'white-space:normal', 'width:100%', 'box-sizing:border-box'
  ].join(';');
  inner.textContent = display;
  t.appendChild(inner);

  t.classList.add('show');
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => t.classList.remove('show'), dur || 3500);
}

/* ══════════ FORMAT ══════════ */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fmtIDR=n=>{
  n=Math.round(n);
  const abs=Math.abs(n), sign=n<0?'-':'';
  if(abs>=1e12)return sign+'Rp '+(abs/1e12).toFixed(2)+'T';
  if(abs>=1e9)return sign+'Rp '+(abs/1e9).toFixed(2)+'M';
  if(abs>=1e6)return sign+'Rp '+(abs/1e6).toFixed(2)+'jt';
  return sign+'Rp '+abs.toLocaleString('id-ID');
};
const fmtUSD=n=>'$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
const fmtBTC=n=>n.toFixed(8)+' BTC';
const fmtPct=n=>(n>=0?'+':'')+n.toFixed(2)+'%';

function fmtInput(el){
  let pos=el.selectionStart, oldLen=el.value.length;
  let raw=el.value.replace(/\./g,'').replace(/[^0-9]/g,'');
  if(!raw){el.value='';return;}
  let num=parseInt(raw,10);
  if(isNaN(num))return;
  let formatted=num.toLocaleString('id-ID');
  el.value=formatted;
  // Jaga posisi cursor
  let diff=formatted.length-oldLen;
  el.setSelectionRange(pos+diff,pos+diff);
}
function getRawVal(id){
  const el=document.getElementById(id);
  if(!el)return 0;
  return parseFloat(el.value.replace(/\./g,'').replace(',','.').replace(/[^0-9.]/g,''))||0;
}

/* ══════════ LIVE BTC ══════════ */
// ══════════════════════════════════════════════════
// REALTIME BTC PRICE ENGINE — WebSocket + REST fallback
// Priority: Binance WS → Bybit WS → REST polling
// ══════════════════════════════════════════════════
let _btcWS = null;
let _btcWSBybit = null;
let _btcWSRetries = 0;
let _btcLastWSMsg = 0;
let _btcWatchdog = null;
let _btcRestFallbackInterval = null;

function _applyBTCPrice(usd, change, usdIdr) {
  if (!usd || usd <= 0) return;
  S.btcPrice = usd;
  S.btcPriceIDR = usd * (usdIdr || S.usdIdr || 16300);
  if (change !== undefined && change !== null) S.btcChange = change;
  if (usdIdr && usdIdr > 10000 && usdIdr < 25000) S.usdIdr = usdIdr;
  _btcLastWSMsg = Date.now();
  // FIX: update currentPrice porto item yang bertipe BTC/Kripto agar Home tidak Rp 0
  const btcIDR = usd * (S.usdIdr || 16300);
  S.port.forEach(x => {
    if (x.ticker && x.ticker.toLowerCase() === 'btc') x.currentPrice = btcIDR;
  });
  updateBTCDisplay();
  updateChartsInPlace();
  updateBTCLiveDisplay();
  updateDCABTCDisplay();
  refreshDashStats();
  // Cek price alert setiap kali harga update (realtime WS)
  if (typeof checkPriceAlerts === 'function') checkPriceAlerts(usd);
}

async function _fetchUSDIDRRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,idr&include_24hr_change=true', {signal: AbortSignal.timeout(8000)});
    if (!r.ok) return;
    const d = await r.json();
    const usd = d.bitcoin.usd;
    const idr = d.bitcoin.idr;
    const change = d.bitcoin.usd_24h_change;
    const rate = Math.round(idr / usd);
    if (rate > 10000 && rate < 25000) S.usdIdr = rate;
    if (change !== undefined) S.btcChange = change;
    const wsAlive = (_btcWS && _btcWS.readyState === WebSocket.OPEN) ||
                    (_btcWSBybit && _btcWSBybit.readyState === WebSocket.OPEN);
    if (!wsAlive) _applyBTCPrice(usd, change, rate);
    else { updateBTCDisplay(); refreshDashStats(); }
  } catch(e) {}
}

function _startBinanceWS() {
  try {
    if (_btcWS) { try { _btcWS.close(); } catch(e){} }
    _btcWS = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@miniTicker');
    _btcWS.onopen = () => {
      _btcWSRetries = 0;
      if (_btcRestFallbackInterval) { clearInterval(_btcRestFallbackInterval); _btcRestFallbackInterval = null; }
    };
    _btcWS.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        const usd = parseFloat(d.c);
        const open24h = parseFloat(d.o);
        const change24h = open24h > 0 ? ((usd - open24h) / open24h * 100) : (S.btcChange || 0);
        _applyBTCPrice(usd, change24h, null);
      } catch(e) {}
    };
    _btcWS.onerror = () => {};
    _btcWS.onclose = () => {
      _btcWS = null;
      const delay = Math.min(2000 * Math.pow(1.5, _btcWSRetries), 30000);
      _btcWSRetries++;
      setTimeout(() => {
        if (_btcWSRetries <= 2) _startBinanceWS();
        else _startBybitWS();
      }, delay);
    };
  } catch(e) { _startBybitWS(); }
}

function _startBybitWS() {
  try {
    if (_btcWSBybit) { try { _btcWSBybit.close(); } catch(e){} }
    _btcWSBybit = new WebSocket('wss://stream.bybit.com/v5/public/spot');
    _btcWSBybit.onopen = () => {
      _btcWSBybit.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSDT'] }));
      _btcWSRetries = 0;
      if (_btcRestFallbackInterval) { clearInterval(_btcRestFallbackInterval); _btcRestFallbackInterval = null; }
    };
    _btcWSBybit.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.topic === 'tickers.BTCUSDT' && d.data) {
          const usd = parseFloat(d.data.lastPrice);
          const change24h = parseFloat(d.data.price24hPcnt) * 100;
          if (usd > 0) _applyBTCPrice(usd, isNaN(change24h) ? S.btcChange : change24h, null);
        }
      } catch(e) {}
    };
    _btcWSBybit.onerror = () => {};
    _btcWSBybit.onclose = () => { _btcWSBybit = null; _startRESTFallback(); };
  } catch(e) { _startRESTFallback(); }
}

function _startRESTFallback() {
  if (_btcRestFallbackInterval) return;
  async function _poll() {
    try {
      const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', {signal: AbortSignal.timeout(4000)});
      if (!r.ok) return;
      const d = await r.json();
      const t = d.result?.list?.[0];
      if (!t) return;
      _applyBTCPrice(parseFloat(t.lastPrice), parseFloat(t.price24hPcnt)*100, null);
    } catch(e) {}
  }
  _poll();
  _btcRestFallbackInterval = setInterval(_poll, 5000);
}

function _startWSWatchdog() {
  if (_btcWatchdog) clearInterval(_btcWatchdog);
  _btcWatchdog = setInterval(() => {
    const stale = Date.now() - _btcLastWSMsg > 12000;
    const wsAlive = (_btcWS && _btcWS.readyState === WebSocket.OPEN) ||
                    (_btcWSBybit && _btcWSBybit.readyState === WebSocket.OPEN);
    if (stale && !wsAlive) { _btcWSRetries = 0; _startBinanceWS(); }
  }, 10000);
}

async function fetchBTC() {
  _startBinanceWS();
  _startWSWatchdog();
  await _fetchUSDIDRRate();
}

function updateBTCDisplay(){
  const p=S.btcPrice,ch=S.btcChange||0;
  if(!p) return;
  const cs=(ch>=0?'+':'')+ch.toFixed(2)+'%';
  const cc=ch>=0?'var(--accent3)':'var(--danger)';
  const safe=(id,fn)=>{const el=document.getElementById(id);if(el)fn(el)};
  safe('nav-btc',e=>e.textContent='$'+p.toLocaleString('en-US',{maximumFractionDigits:1}));
  safe('nav-chg',e=>{e.textContent=cs;e.style.color=cc});
  safe('nav-btc-mob',e=>e.textContent=' $'+p.toLocaleString('en-US',{maximumFractionDigits:1}));
  safe('nav-chg-mob',e=>{e.textContent=' '+cs;e.style.color=cc});
  safe('d-btc',e=>e.textContent='$'+p.toLocaleString('en-US',{maximumFractionDigits:1}));
  safe('d-btc-chg',e=>{e.textContent=cs;e.style.color=cc});
  safe('s-live',e=>e.textContent='$'+p.toLocaleString('en-US',{maximumFractionDigits:1}));
}

/* ══════════ CHART DATA — Kraken OHLC (CORS terbuka penuh) ══════════ */

const TF_CONFIG = {
  '1D': { key:'1D',  krakenInterval:60,    krakenSince:()=>Math.floor(Date.now()/1000)-86400,                                                                                                                   label:'1 Hari',   fmt:(t)=>new Date(t*1000).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) },
  '1W': { key:'1W',  krakenInterval:240,   krakenSince:()=>Math.floor(Date.now()/1000)-7*86400,                                                                                                                  label:'1 Minggu', fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{weekday:'short',day:'numeric'}) },
  '1M': { key:'1M',  krakenInterval:1440,  krakenSince:()=>Math.floor(Date.now()/1000)-30*86400,                                                                                                                 label:'1 Bulan',  fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{day:'numeric',month:'short'}) },
  'YTD':{ key:'YTD', krakenInterval:1440,  krakenSince:()=>{ const s=new Date(new Date().getFullYear(),0,1); return Math.floor(s.getTime()/1000); },                                                            label:'YTD',      fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{day:'numeric',month:'short'}) },
  '1Y': { key:'1Y',  krakenInterval:1440,  krakenSince:()=>Math.floor(Date.now()/1000)-365*86400,                                                                                                                label:'1 Tahun',  fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{month:'short',year:'2-digit'}) },
  '3Y': { key:'3Y',  krakenInterval:10080, krakenSince:()=>Math.floor(Date.now()/1000)-3*365*86400,                                                                                                              label:'3 Tahun',  fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{month:'short',year:'2-digit'}) },
  '5Y': { key:'5Y',  krakenInterval:10080, krakenSince:()=>Math.floor(Date.now()/1000)-5*365*86400,                                                                                                              label:'5 Tahun',  fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{month:'short',year:'2-digit'}) },
  '10Y':{ key:'10Y', krakenInterval:21600, krakenSince:()=>Math.floor(Date.now()/1000)-10*365*86400,                                                                                                             label:'10 Tahun', fmt:(t)=>new Date(t*1000).toLocaleDateString('id-ID',{year:'numeric',month:'short'}) },
};

async function fetchWithTimeout(url, ms=8000, retries=1){
  for(let attempt=0; attempt<=retries; attempt++){
    try{
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), ms);
      const r = await fetch(url, {signal: controller.signal});
      clearTimeout(tid);
      return r;
    }catch(e){
      if(attempt === retries) throw e;
      // Tunggu sebentar sebelum retry (exponential backoff)
      await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
    }
  }
}

// ── BINANCE FETCH WITH PROXY FALLBACK ──
// Binance diblokir ISP di Indonesia — coba langsung dulu, fallback ke proxy CORS
// ── MULTI-SOURCE KLINES FETCH ──
// Bybit (primary) → OKX (fallback) → Binance proxy (last resort)
// Bybit & OKX tidak diblokir ISP Indonesia, CORS terbuka

const BYBIT_TF_MAP = {'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M'};
const OKX_TF_MAP = {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'};

async function bybitKlines(symbol, interval, limit) {
  const tf = BYBIT_TF_MAP[interval] || '60';
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${tf}&limit=${limit}`;
  const r = await fetch(url, {signal: AbortSignal.timeout(8000)});
  if (!r.ok) throw new Error('Bybit HTTP ' + r.status);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error('Bybit: ' + d.retMsg);
  return d.result.list.reverse().map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])]);
}

async function okxKlines(symbol, interval, limit) {
  const tf = OKX_TF_MAP[interval] || '1H';
  // XAUUSD → XAU-USDT, BTCUSDT → BTC-USDT, dst
  const instId = symbol === 'XAUUSD' ? 'XAU-USDT' : symbol.replace('USDT','-USDT');
  const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${tf}&limit=${limit}`;
  const r = await fetch(url, {signal: AbortSignal.timeout(8000)});
  if (!r.ok) throw new Error('OKX HTTP ' + r.status);
  const d = await r.json();
  if (d.code !== '0') throw new Error('OKX: ' + d.msg);
  return d.data.reverse().map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])]);
}

async function fetchKlines(symbol, interval, limit=150) {
  // 1. Vercel proxy (server-side, tidak kena CORS)
  try {
    const r = await fetch(`/api/market?action=klines&symbol=${symbol}&interval=${interval}&limit=${limit}`, {signal: AbortSignal.timeout(10000)});
    const d = await r.json();
    if (d.ok && d.data && d.data.length) return d.data;
  } catch(e) { console.warn('[/api/klines]', e.message); }

  // 2. Bybit langsung — untuk XAUUSD pakai linear XAUUSDT, pair lain pakai spot
  try {
    if (symbol === 'XAUUSD') {
      const tf = BYBIT_TF_MAP[interval] || '60';
      const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=XAUUSDT&interval=${tf}&limit=${limit}`, {signal: AbortSignal.timeout(8000)});
      const d = await r.json();
      if (d.retCode === 0 && d.result?.list?.length)
        return d.result.list.reverse().map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])]);
      console.warn('[Bybit XAUUSDT] retCode:', d.retCode, d.retMsg);
    } else {
      return await bybitKlines(symbol, interval, limit);
    }
  } catch(e) { console.warn('[Bybit klines]', e.message); }

  // 3. OKX langsung — okxKlines sudah handle XAUUSD → XAU-USDT
  try { return await okxKlines(symbol, interval, limit); } catch(e) { console.warn('[OKX klines]', e.message); }

  // 4. Binance via proxy (crypto only, XAUUSD skip)
  if (symbol !== 'XAUUSD') {
    const bnUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    for (const fn of [u=>u, u=>`/api/proxy?url=${encodeURIComponent(u)}`]) {
      try {
        const r = await fetch(fn(bnUrl), {signal: AbortSignal.timeout(8000)});
        const text = await r.text();
        if (text.trim().startsWith('<')) continue;
        const data = JSON.parse(text);
        return data.map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])]);
      } catch(e) { console.warn('[Binance proxy]', e.message); }
    }
  }

  // 5. Fallback khusus XAUUSD — Gate.io dan CORS proxies
  if (symbol === 'XAUUSD') return fetchXAUKlines(interval, limit);

  throw new Error('Semua sumber data gagal. Coba lagi nanti.');
}

// ── XAU/USD KLINES — multiple sources dengan CORS proxy fallback ──
async function fetchXAUKlines(interval, limit = 150) {
  const tf_okx   = OKX_TF_MAP[interval] || '1H';
  const tf_bybit = BYBIT_TF_MAP[interval] || '60';
  const okxUrl   = `https://www.okx.com/api/v5/market/candles?instId=XAU-USDT&bar=${tf_okx}&limit=${limit}`;

  const parseOKX = d => d.code === '0' && d.data?.length
    ? d.data.reverse().map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])])
    : null;

  // 1. OKX langsung
  try {
    const r = await fetch(okxUrl, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    const result = parseOKX(d);
    if (result) return result;
    console.warn('[OKX XAU direct] bad response:', d.code, d.msg);
  } catch(e) { console.warn('[OKX XAU direct]', e.message); }

  // 2. Bybit linear XAUUSDT
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=XAUUSDT&interval=${tf_bybit}&limit=${limit}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length)
      return d.result.list.reverse().map(k => [parseInt(k[0]),parseFloat(k[1]),parseFloat(k[2]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[5])]);
    console.warn('[Bybit XAUUSDT] retCode:', d.retCode, d.retMsg);
  } catch(e) { console.warn('[Bybit XAUUSDT]', e.message); }

  // 3. Gate.io XAU_USDT spot
  try {
    const gTf  = {'1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d'}[interval] || '1h';
    const sec  = {'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[interval] || 3600;
    const from = Math.floor(Date.now()/1000) - limit * sec;
    const r = await fetch(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=XAU_USDT&interval=${gTf}&from=${from}&limit=${limit}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (Array.isArray(d) && d.length)
      return d.map(k => [parseInt(k[0])*1000,parseFloat(k[5]),parseFloat(k[3]),parseFloat(k[4]),parseFloat(k[2]),parseFloat(k[1])]);
    console.warn('[Gate.io XAU] empty or error:', d);
  } catch(e) { console.warn('[Gate.io XAU]', e.message); }

  // 4. OKX via allorigins proxy
  try {
    const r = await fetch(`/api/proxy?url=${encodeURIComponent(okxUrl)}`, {signal: AbortSignal.timeout(10000)});
    const text = await r.text();
    if (!text.trim().startsWith('<')) {
      const result = parseOKX(JSON.parse(text));
      if (result) return result;
    }
  } catch(e) { console.warn('[OKX via allorigins]', e.message); }

  // 5. OKX via corsproxy.io
  try {
    const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(okxUrl)}`, {signal: AbortSignal.timeout(10000)});
    const text = await r.text();
    if (!text.trim().startsWith('<')) {
      const result = parseOKX(JSON.parse(text));
      if (result) return result;
    }
  } catch(e) { console.warn('[OKX via corsproxy.io]', e.message); }

  throw new Error('Data XAU/USD tidak tersedia dari semua sumber');
}

// ── FUNDING RATE — Bybit perpetual futures ──
async function fetchFundingRate(symbol) {
  // XAUUSD tidak punya funding rate perpetual, skip
  if (symbol === 'XAUUSD') return null;
  const perpSym = symbol; // Bybit perpSymbol = BTCUSDT, dll
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${perpSym}&limit=3`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length) {
      const latest = d.result.list[0];
      const rate = parseFloat(latest.fundingRate) * 100; // dalam persen
      return { rate, symbol: perpSym, time: parseInt(latest.fundingRateTimestamp) };
    }
  } catch(e) { console.warn('[Funding rate]', e.message); }
  // Fallback OKX funding rate (Binance fapi.* blokir CORS dari browser)
  try {
    const okxSym = perpSym.replace('USDT', '-USDT-SWAP');
    const r = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${okxSym}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.code === '0' && d.data?.length) {
      const rate = parseFloat(d.data[0].fundingRate) * 100;
      return { rate, symbol: perpSym };
    }
  } catch(e) { console.warn('[OKX funding]', e.message); }
  return null;
}

// ── BTC DOMINANCE — via CoinGecko global ──
async function fetchBTCDominance() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global', {signal: AbortSignal.timeout(8000)});
    const d = await r.json();
    const btcDom = d.data?.market_cap_percentage?.btc;
    const totalMcap = d.data?.total_market_cap?.usd;
    if (btcDom !== undefined) return { btcDom: parseFloat(btcDom.toFixed(2)), totalMcap };
  } catch(e) { console.warn('[BTC dominance]', e.message); }
  // Fallback: alternative.me global stats (CORS aman, allow *)
  try {
    const r = await fetch('https://api.alternative.me/v1/global/', {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.bitcoin_percentage_of_market_cap) return { btcDom: parseFloat(parseFloat(d.bitcoin_percentage_of_market_cap).toFixed(2)) };
  } catch(e) {}
  return null;
}

async function fetchTicker24h(symbol) {
  // XAUUSD — routing khusus ke sumber harga emas
  if (symbol === 'XAUUSD') return fetchXAUTicker();

  // 1. Vercel proxy /api/ticker (paling andal)
  try {
    const r = await fetch(`/api/market?action=ticker&symbol=${symbol}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.ok && d.data) return d.data;
  } catch(e) { console.warn('[/api/ticker]', e.message); }

  // 2. Bybit langsung
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length) {
      const t = d.result.list[0];
      return { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2) };
    }
  } catch(e) { console.warn('[Bybit ticker]', e.message); }

  // 3. OKX langsung
  try {
    const instId = symbol.replace('USDT', '-USDT');
    const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.code === '0' && d.data?.length) {
      const t = d.data[0];
      return { lastPrice: t.last, priceChangePercent: (parseFloat(t.sodUtc8) > 0 ? ((parseFloat(t.last) - parseFloat(t.sodUtc8)) / parseFloat(t.sodUtc8) * 100).toFixed(2) : '0') };
    }
  } catch(e) { console.warn('[OKX ticker]', e.message); }

  // 4. Binance via allorigins proxy
  try {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
    const r = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {signal: AbortSignal.timeout(6000)});
    const text = await r.text();
    if (!text.trim().startsWith('<')) return JSON.parse(text);
  } catch(e) { console.warn('[Binance proxy ticker]', e.message); }

  return null;
}

// ── XAU/USD TICKER — harga live emas dari beberapa sumber ──
async function fetchXAUTicker() {
  // 1. OKX spot XAU-USDT (paling reliable untuk emas)
  try {
    const r = await fetch('https://www.okx.com/api/v5/market/ticker?instId=XAU-USDT', {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.code === '0' && d.data?.length) {
      const t = d.data[0];
      const open = parseFloat(t.sodUtc8);
      const last = parseFloat(t.last);
      const pct = open > 0 ? ((last - open) / open * 100).toFixed(2) : '0';
      return { lastPrice: String(last), priceChangePercent: pct };
    }
  } catch(e) { console.warn('[OKX XAU ticker]', e.message); }

  // 2. Bybit spot XAUUSDT
  try {
    const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=XAUUSDT', {signal: AbortSignal.timeout(6000)});
    const d = await r.json();
    if (d.retCode === 0 && d.result?.list?.length) {
      const t = d.result.list[0];
      return { lastPrice: t.lastPrice, priceChangePercent: (parseFloat(t.price24hPcnt) * 100).toFixed(2) };
    }
  } catch(e) { console.warn('[Bybit XAUUSDT ticker]', e.message); }

  // 3. Binance XAUUSDT via allorigins proxy
  try {
    const url = 'https://api.binance.com/api/v3/ticker/24hr?symbol=XAUUSDT';
    const r = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {signal: AbortSignal.timeout(6000)});
    const text = await r.text();
    if (!text.trim().startsWith('<')) {
      const d = JSON.parse(text);
      return { lastPrice: d.lastPrice, priceChangePercent: parseFloat(d.priceChangePercent).toFixed(2) };
    }
  } catch(e) { console.warn('[Binance XAUUSDT ticker]', e.message); }

  return null;
}

// Legacy binanceFetch — untuk kompatibilitas
async function binanceFetch(path, ms=8000) {
  let lastErr;
  for (const fn of [u=>u, u=>`/api/proxy?url=${encodeURIComponent(u)}`]) {
    try {
      const r = await fetch(fn(path), {signal: AbortSignal.timeout(ms)});
      const text = await r.text();
      if (text.trim().startsWith('<')) throw new Error('Bukan JSON');
      return JSON.parse(text);
    } catch(e) { lastErr = e; }
  }
  throw new Error('Binance tidak dapat diakses: ' + (lastErr?.message || 'Unknown'));
}

async function krakenOHLC(interval, since){
  const url=`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${interval}&since=${since}`;
  const r=await fetchWithTimeout(url, 12000);
  if(!r.ok) throw new Error('Kraken HTTP '+r.status);
  const d=await r.json();
  if(d.error&&d.error.length) throw new Error('Kraken: '+d.error[0]);
  const pair=d.result&&(d.result['XXBTZUSD']||d.result['XBTUSD']);
  if(!pair||!pair.length) throw new Error('Kraken empty');
  return pair.map(k=>([parseInt(k[0]), parseFloat(k[4])])); // [timestamp_sec, close_price]
}

// CoinGecko market_chart sebagai fallback
async function cgMarketChart(days){
  const url=`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`;
  const r=await fetchWithTimeout(url, 15000);
  if(!r.ok) throw new Error('CoinGecko HTTP '+r.status);
  const d=await r.json();
  if(!d||!d.prices||!d.prices.length) throw new Error('CoinGecko empty');
  return d.prices.map(p=>([Math.floor(p[0]/1000), p[1]]));
}

// Binance klines sebagai source ke-3 (sering lebih lancar di jaringan data)
async function binanceKlines(interval, limit){
  const url=`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
  const r=await fetchWithTimeout(url, 15000);
  if(!r.ok) throw new Error('Binance HTTP '+r.status);
  const d=await r.json();
  if(!d||!d.length) throw new Error('Binance empty');
  // Binance: [openTime, open, high, low, close, ...]
  return d.map(k=>([Math.floor(parseInt(k[0])/1000), parseFloat(k[4])]));
}

// Map timeframe config ke Binance interval & limit
const BINANCE_TF_MAP = {
  '1D':  { interval:'1h',  limit:24  },
  '1W':  { interval:'4h',  limit:42  },
  '1M':  { interval:'1d',  limit:30  },
  'YTD': { interval:'1d',  limit:366 },
  '1Y':  { interval:'1d',  limit:365 },
  '3Y':  { interval:'1w',  limit:156 },
  '5Y':  { interval:'1w',  limit:260 },
  '10Y': { interval:'1M',  limit:120 },
};

async function fetchChartData(cfg){
  const tf = cfg.key;

  // Return cache jika masih fresh (< 5 menit)
  const cached = _btcChartCache[tf];
  if(cached && (Date.now() - cached.ts) < _BTC_CACHE_TTL){
    return cached.data;
  }

  // 5Y & 10Y: hanya Kraken + CoinGecko (Binance limit 1000 candle, data terpotong)
  // 1D/1W/1M/1Y/3Y: race Kraken + Binance (data cukup, Binance lebih cepat di Asia)
  const longTF = tf === '5Y' || tf === '10Y';
  const bMap = longTF ? null : BINANCE_TF_MAP[tf || '1W'];
  const sources = [];

  // Source 1: Kraken (prioritas untuk long TF karena data lengkap hingga 2011)
  sources.push(
    fetchWithTimeout(`https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${cfg.krakenInterval}&since=${cfg.krakenSince()}`, longTF ? 8000 : 4000)
      .then(r => r.ok ? r.json() : Promise.reject('Kraken '+r.status))
      .then(d => {
        if(d.error&&d.error.length) throw new Error(d.error[0]);
        const pair = d.result&&(d.result['XXBTZUSD']||d.result['XBTUSD']);
        if(!pair||!pair.length) throw new Error('empty');
        const result = pair.map(k=>([parseInt(k[0]), parseFloat(k[4])]));
        // Validasi: untuk 5Y/10Y harus ada data dari jauh
        if(longTF && result.length < 100) throw new Error('Kraken data terlalu sedikit untuk '+tf);
        return result;
      })
  );

  // Source 2: Binance — hanya untuk TF pendek (≤3Y) + YTD
  if(bMap){
    // Untuk YTD: gunakan startTime = 1 Jan tahun ini (lebih akurat dari limit)
    const binanceUrl = tf === 'YTD'
      ? `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${bMap.interval}&startTime=${new Date(new Date().getFullYear(),0,1).getTime()}&limit=1000`
      : `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${bMap.interval}&limit=${bMap.limit}`;
    sources.push(
      fetchWithTimeout(binanceUrl, 4000)
        .then(r => r.ok ? r.json() : Promise.reject('Binance '+r.status))
        .then(d => {
          if(!d||!d.length) throw new Error('empty');
          return d.map(k=>([Math.floor(parseInt(k[0])/1000), parseFloat(k[4])]));
        })
    );
  }

  // Race: ambil yang paling cepat berhasil
  let data = null;
  try {
    data = await Promise.any(sources);
  } catch(e) {
    // Semua gagal → fallback CoinGecko (support data hingga 2013)
    console.warn('Kraken'+(bMap?'+Binance':'')+' gagal, fallback CoinGecko');
    try {
      const days = Math.round((Date.now()/1000 - cfg.krakenSince())/86400);
      data = await cgMarketChart(days);
    } catch(e3) {
      throw new Error('Semua sumber data gagal. Cek koneksi.');
    }
  }

  if(!data || data.length === 0) throw new Error('Data kosong dari semua sumber.');

  // Simpan ke cache
  _btcChartCache[tf] = { data, ts: Date.now() };
  return data;
}

let _histCache=null; // [[timestamp_sec, price], ...]
let _histCacheLoading=null; // Promise, agar tidak fetch 2x bersamaan

async function getHistCache(){
  if(_histCache) return _histCache;
  if(_histCacheLoading) return _histCacheLoading;

  _histCacheLoading=(async()=>{
          const since=Math.floor(Date.now()/1000)-10*365*86400;
    try{
      const data=await krakenOHLC(21600, since);
      if(data&&data.length>0){_histCache=data;return data;}
    }catch(e){ console.warn('Kraken histCache gagal:', e.message); }
      try{
      const data=await krakenOHLC(10080, since);
      if(data&&data.length>0){_histCache=data;return data;}
    }catch(e){ console.warn('Kraken weekly histCache gagal:', e.message); }
    return null;
  })();
  const result=await _histCacheLoading;
  _histCacheLoading=null;
  return result;
}

async function cgPriceAt(dateStr){
  const dt=new Date(dateStr);
  const tsFrom=Math.floor(dt.getTime()/1000);

  try{
    const cache=await getHistCache();
    if(cache&&cache.length){
          let best=null,bestDiff=Infinity;
      for(const [ts,p] of cache){
        const diff=Math.abs(ts-tsFrom);
        if(diff<bestDiff){bestDiff=diff;best=p;}
      }
          if(best&&best>10&&bestDiff<86400*20) return {price:best, source:'Kraken'};
    }
  }catch(e){ console.warn('Kraken histCache lookup gagal:', e.message); }

  try{
    const dd=String(dt.getDate()).padStart(2,'0');
    const mm=String(dt.getMonth()+1).padStart(2,'0');
    const yyyy=dt.getFullYear();
    const url=`https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${dd}-${mm}-${yyyy}&localization=false`;
    const r=await fetchWithTimeout(url, 15000);
    if(r.ok){
      const d=await r.json();
      const price=d?.market_data?.current_price?.usd;
      if(price&&price>10) return {price, source:'CoinGecko'};
    }
  }catch(e){ console.warn('CoinGecko history gagal:', e.message); }

  throw new Error('Semua sumber gagal untuk tanggal '+dateStr);
}

/* ══════════ BTC LIVE CHART ══════════ */
let cBTCLive = null;
let curTF = '1W';
let overlayEnabled = {m2:false, gold:false, sp500:false};
let overlayCache = {}; // cache {m2:{tf:data}, gold:{tf:data}, sp500:{tf:data}}
// BTC chart data cache: {tf: {data, ts}} — TTL 5 menit
const _btcChartCache = {};
const _BTC_CACHE_TTL = 3 * 60 * 1000;  // 3 min - balance freshness vs speed
let _loadingTF = null; // prevent concurrent loads of same TF

async function loadBTCChart(tf){
  // Jika TF sama dan sedang loading, jangan load ulang
  if(_loadingTF === tf) return;
  // Prefetch TF berikutnya di background (jika belum di-cache)
  const prefetchTFs = ['1W','1M','1Y','10Y'];
  const nextTF = prefetchTFs.find(t => t !== tf && !(_btcChartCache[t] && (Date.now()-_btcChartCache[t].ts < _BTC_CACHE_TTL)));
  if (nextTF) setTimeout(() => {
    const nc = TF_CONFIG[nextTF];
    if (nc) fetchChartData(nc).catch(()=>{});
  }, 3000);
  _loadingTF = tf;
  curTF = tf;
  document.querySelectorAll('.tf-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.tf===tf);
  });
  const cfg = TF_CONFIG[tf];
  const loading = document.getElementById('btcc-loading');
  const safe=(id,fn)=>{const e=document.getElementById(id);if(e)fn(e)};
  // Hanya tampilkan loading jika tidak ada cache
  const hasCached = _btcChartCache[tf] && (Date.now()-_btcChartCache[tf].ts < _BTC_CACHE_TTL);
  if(loading && !hasCached){loading.style.display='flex';loading.innerHTML='<div style="width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div><span>Memuat...</span>';}
  try{
    // Kraken OHLC (primary) → CoinGecko (fallback) — semua CORS terbuka
    const prices=await fetchChartData(cfg);
      const labels = prices.map(p=>cfg.fmt(p[0]));
    const vals   = prices.map(p=>p[1]);
    const isUp   = vals[vals.length-1] >= vals[0];
    const color  = isUp ? '#10b981' : '#ef4444';
    const colorBg= isUp ? 'rgba(16,185,129,' : 'rgba(239,68,68,';
      const hi=Math.max(...vals), lo=Math.min(...vals);
    const op=vals[0], cl=vals[vals.length-1];
    safe('btcc-open',  e=>e.textContent='$'+op.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('btcc-high',  e=>e.textContent='$'+hi.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('btcc-low',   e=>e.textContent='$'+lo.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('btcc-close', e=>e.textContent='$'+cl.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('btcc-vol',   e=>e.textContent='N/A'); // volume tidak tersedia dari Kraken OHLC
      const retPct=(cl-op)/op*100;
    const retUsd=cl-op;
    const retUp=retPct>=0;
    const retColor=retUp?'var(--accent3)':'var(--danger)';
    const retBg=retUp?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)';
    const retSign=retUp?'+':'';
    safe('btcc-return-label',e=>e.textContent=`Return ${cfg.label}`);
    safe('btcc-return-usd',e=>{e.textContent=retSign+'$'+Math.abs(retUsd).toLocaleString('en-US',{maximumFractionDigits:0});e.style.color=retColor});
    safe('btcc-return-pct',e=>{e.textContent=retSign+retPct.toFixed(2)+'%';e.style.color=retColor;e.style.background=retBg;e.style.border=`1px solid ${retColor}`});
      if(cBTCLive){cBTCLive.destroy();cBTCLive=null;}
    const ctx = document.getElementById('c-btclive');
    if(!ctx){if(loading)loading.style.display='none';_loadingTF=null;return;}

    // Build datasets
    const datasets = [{
      label:'BTC/USD',
      data:vals,
      borderColor:color,
      borderWidth:2,
      pointRadius:0,
      pointHoverRadius:4,
      pointHoverBackgroundColor:color,
      fill:true,
      backgroundColor:(ctx2)=>{
        const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height);
        g.addColorStop(0,colorBg+'0.25)');
        g.addColorStop(1,colorBg+'0.01)');
        return g;
      },
      tension:.35,
      yAxisID:'y',
    }];

    // Add overlays (M2, Gold, SP500)
    const overlayConfigs = {
      m2:    { fetchFn: fetchM2Data,    label:'Global M2', color:'rgba(245,158,11,0.8)',  hoverColor:'#f59e0b', yId:'yM2',    smooth:false, tickCb: v=>'$'+(v/1000).toFixed(0)+'T',  tooltipCb: v=>` M2: $${(v/1000).toFixed(1)}T` },
      gold:  { fetchFn: fetchGoldData,  label:'Emas XAU',  color:'rgba(251,191,36,0.8)',  hoverColor:'#fbbf24', yId:'yGold',  smooth:true,  tickCb: v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'}), tooltipCb: v=>` Emas: $${v.toLocaleString('en-US',{maximumFractionDigits:0})}` },
      sp500: { fetchFn: fetchSP500Data, label:'S&P500',    color:'rgba(139,92,246,0.8)',  hoverColor:'#8b5cf6', yId:'ySP500', smooth:true,  tickCb: v=>v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'}), tooltipCb: v=>` S&P500: ${v.toLocaleString('en-US',{maximumFractionDigits:0})}` },
    };
    for (const [key, cfg] of Object.entries(overlayConfigs)) {
      if (!overlayEnabled[key]) continue;
      try {
        const rawData = await cfg.fetchFn(tf);
        if (rawData && rawData.length > 1) {
          const n = labels.length;
          const interp = [];
          // Smooth interpolation: linear interpolate between data points
          for (let i = 0; i < n; i++) {
            const pos = i / (n - 1) * (rawData.length - 1);
            const lo = Math.floor(pos);
            const hi = Math.min(Math.ceil(pos), rawData.length - 1);
            const t = pos - lo;
            const valLo = rawData[lo].val;
            const valHi = rawData[hi].val;
            interp.push(valLo + (valHi - valLo) * t);
          }
          datasets.push({
            label: cfg.label,
            data: interp,
            borderColor: cfg.color,
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHoverBackgroundColor: cfg.hoverColor,
            fill: false,
            tension: cfg.smooth ? .5 : .1,
            cubicInterpolationMode: cfg.smooth ? 'monotone' : 'default',
            spanGaps: true,
            yAxisID: cfg.yId,
          });
        }
      } catch(e) { console.warn(key + ' overlay error:', e); }
    }

    // Update overlay returns in return row
    const overlayReturnsEl = document.getElementById('overlay-returns');
    const anyOverlayOn = Object.values(overlayEnabled).some(Boolean);
    if (overlayReturnsEl) overlayReturnsEl.style.display = anyOverlayOn ? 'flex' : 'none';

    // Calculate and display return for each active overlay
    const retDefs = {
      gold:  { rowId:'ret-gold-row',  usdId:'ret-gold-usd',  pctId:'ret-gold-pct',  color:'#fbbf24', unit:'$',  isPrice:true },
      sp500: { rowId:'ret-sp500-row', usdId:'ret-sp500-usd', pctId:'ret-sp500-pct', color:'#8b5cf6', unit:'',   isPrice:false },
      m2:    { rowId:'ret-m2-row',    usdId:'ret-m2-usd',    pctId:'ret-m2-pct',    color:'#f59e0b', unit:'$',  isPrice:true },
    };
    for (const [key, rd] of Object.entries(retDefs)) {
      const rowEl = document.getElementById(rd.rowId);
      if (!rowEl) continue;
      if (!overlayEnabled[key]) { rowEl.style.display = 'none'; continue; }
      rowEl.style.display = 'flex';
      try {
        const cache = overlayCache[key] && overlayCache[key][tf];
        if (cache && cache.length >= 2) {
          const first = cache[0].val, last = cache[cache.length-1].val;
          const pct = (last - first) / first * 100;
          const sign = pct >= 0 ? '+' : '';
          const col = pct >= 0 ? (key==='gold'?'#fbbf24':key==='sp500'?'#8b5cf6':'#f59e0b') : '#ef4444';
          const usdEl = document.getElementById(rd.usdId);
          const pctEl = document.getElementById(rd.pctId);
          if (usdEl) {
            if (key === 'm2') {
              usdEl.textContent = sign + '$' + Math.abs((last-first)/1000).toFixed(1) + 'T';
            } else {
              usdEl.textContent = sign + '$' + Math.abs(last-first).toLocaleString('en-US',{maximumFractionDigits:0});
            }
            usdEl.style.color = col;
          }
          if (pctEl) {
            pctEl.textContent = sign + pct.toFixed(2) + '%';
            pctEl.style.color = col;
            pctEl.style.background = pct>=0?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)';
            pctEl.style.border = '1px solid ' + col;
          }
        }
      } catch(e) {}
    }

    cBTCLive = new Chart(ctx.getContext('2d'),{
      type:'line',
      data:{
        labels,
        datasets,
      },
      options:{
        animation:false,
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          tooltip:{
            backgroundColor:'rgba(11,17,32,.97)',
            borderColor:color,
            borderWidth:1,
            titleColor:'#94a3b8',
            titleFont:{family:'Space Mono',size:10},
            bodyColor:color,
            bodyFont:{family:'Space Mono',size:13,weight:'bold'},
            padding:10,
            callbacks:{
              label:ctx=>{
                const oc = Object.values({
                  m2:{label:'Global M2',cb:v=>` M2: $${(v/1000).toFixed(1)}T`},
                  gold:{label:'Emas XAU',cb:v=>` Emas: $${v.toLocaleString('en-US',{maximumFractionDigits:0})}`},
                  sp500:{label:'S&P500',cb:v=>` S&P500: ${v.toLocaleString('en-US',{maximumFractionDigits:0})}`},
                }).find(o=>o.label===ctx.dataset.label);
                if(oc) return oc.cb(ctx.parsed.y);
                const price=ctx.parsed.y;
                const firstPrice=vals[0];
                const retPct=((price-firstPrice)/firstPrice*100);
                const retSign=retPct>=0?'+':'';
                const priceStr=` $${price.toLocaleString('en-US',{maximumFractionDigits:0})}`;
                const retStr=`  ${retSign}${retPct.toFixed(2)}% vs awal`;
                return [priceStr, retStr];
              },
              labelColor:(ctx)=>{
                const colorMap={'Global M2':'#f59e0b','Emas XAU':'#fbbf24','S&P500':'#8b5cf6'};
                const c=colorMap[ctx.dataset.label];
                if(c) return{borderColor:c,backgroundColor:c,borderWidth:2,borderRadius:3};
                const price=ctx.parsed.y;
                const retPct=((price-vals[0])/vals[0]*100);
                const col=retPct>=0?'#10b981':'#ef4444';
                return{borderColor:col,backgroundColor:col,borderWidth:2,borderRadius:3};
              }
            }
          }
        },
        scales:{
          x:{
            ticks:{color:'#475569',font:{size:9},maxTicksLimit:8,maxRotation:0},
            grid:{color:'rgba(255,255,255,0.03)'},
            border:{display:false}
          },
          y:{
            position:'right',
            ticks:{
              color:'#475569',font:{size:9},
              callback:v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'})
            },
            grid:{color:'rgba(255,255,255,0.03)'},
            border:{display:false}
          },
          yM2:{
            display: overlayEnabled.m2 && datasets.some(d=>d.yAxisID==='yM2'),
            position:'left',
            ticks:{color:'rgba(245,158,11,0.45)',font:{size:8},maxTicksLimit:5,callback:v=>'$'+(v/1000).toFixed(0)+'T'},
            grid:{display:false},border:{display:false}
          },
          yGold:{
            display: overlayEnabled.gold && datasets.some(d=>d.yAxisID==='yGold'),
            position:'left',
            ticks:{color:'rgba(251,191,36,0.45)',font:{size:8},maxTicksLimit:5,callback:v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'})},
            grid:{display:false},border:{display:false}
          },
          ySP500:{
            display: overlayEnabled.sp500 && datasets.some(d=>d.yAxisID==='ySP500'),
            position:'left',
            ticks:{color:'rgba(139,92,246,0.45)',font:{size:8},maxTicksLimit:5,callback:v=>v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'})},
            grid:{display:false},border:{display:false}
          }
        }
      }
    });
  }catch(e){
    _loadingTF=null;
    console.warn('BTC chart error:',e);
    if(loading){
      loading.innerHTML=`<div style="text-align:center">
        <div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal memuat data</div>
        <button onclick="loadBTCChart('${tf}')" style="background:var(--accent);color:var(--bg);border:none;border-radius:6px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;font-family:'Inter',sans-serif;font-weight:700">↺ Coba Lagi</button>
      </div>`;
      loading.style.display='flex';
    }
    return;
  }
  if(loading) loading.style.display='none';
  _loadingTF = null;  // ← CRITICAL: reset agar bisa reload chart setelah sukses
}

// ── GLOBAL M2 MONEY SUPPLY ──
// Sumber: stlouisfed.org FRED API (CORS terbuka via proxy)
async function fetchM2Data(tf) {
  if (!overlayCache.m2) overlayCache.m2 = {};
  if (overlayCache.m2[tf]) return overlayCache.m2[tf];
  const daysMap = {'1D':2,'1W':8,'1M':35,'YTD':366,'1Y':370,'3Y':1100,'5Y':1830,'10Y':3660};
  const days = tf === 'YTD'
    ? Math.ceil((Date.now() - new Date(new Date().getFullYear(),0,1).getTime()) / 86400000) + 1
    : (daysMap[tf] || 3660);
  const now = new Date();
  const startDate = tf === 'YTD' ? new Date(new Date().getFullYear(),0,1) : new Date(now - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  // CORS proxy untuk FRED WM2NS (Global M2, miliar USD)
  const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=WM2NS&observation_start=${fmt(startDate)}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(fredUrl)}`;

  try {
    const r = await fetch(proxyUrl, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('proxy error');
    const text = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const result = lines.map(l => {
      const parts = l.split(',');
      return { date: parts[0], val: parseFloat(parts[1]) };
    }).filter(d => !isNaN(d.val) && d.val > 0);
    if (result.length < 2) throw new Error('no data');
    overlayCache.m2[tf] = result;
    return result;
  } catch(e) {
    console.warn('M2 fetch failed, using static data:', e);
    // Data statis approximate (miliar USD) sebagai fallback
    const staticM2 = [
      {date:'2015-01-01',val:65000},{date:'2015-07-01',val:66000},
      {date:'2016-01-01',val:67500},{date:'2016-07-01',val:69000},
      {date:'2017-01-01',val:71000},{date:'2017-07-01',val:73000},
      {date:'2018-01-01',val:75000},{date:'2018-07-01',val:74000},
      {date:'2019-01-01',val:73500},{date:'2019-07-01',val:75000},
      {date:'2020-01-01',val:76000},{date:'2020-07-01',val:82000},
      {date:'2021-01-01',val:87000},{date:'2021-07-01',val:89000},
      {date:'2022-01-01',val:87000},{date:'2022-07-01',val:84000},
      {date:'2023-01-01',val:82000},{date:'2023-07-01',val:83000},
      {date:'2024-01-01',val:86000},{date:'2024-07-01',val:89000},
      {date:'2025-01-01',val:94000},{date:'2025-02-01',val:95900},
    ];
    const cutoff = fmt(startDate);
    const filtered = staticM2.filter(d => d.date >= cutoff);
    const result2 = filtered.length >= 2 ? filtered : staticM2.slice(-6);
    overlayCache.m2[tf] = result2;
    return result2;
  }
}


// ── GOLD (XAU/USD) DATA ──
async function fetchGoldData(tf) {
  if (!overlayCache.gold) overlayCache.gold = {};
  // Return cache immediately if exists (preloaded)
  if (overlayCache.gold[tf]) return overlayCache.gold[tf];
  // Quick check: if static fallback already loaded before, return it
  if (overlayCache._goldStatic && overlayCache._goldStatic[tf]) {
    // Trigger background refresh of real data (don't await)
    _bgFetchGold(tf);
    return overlayCache._goldStatic[tf];
  }
  const daysMap = {'1D':2,'1W':8,'1M':35,'YTD':366,'1Y':370,'3Y':1100,'5Y':1830,'10Y':3660};
  const days = tf === 'YTD'
    ? Math.ceil((Date.now() - new Date(new Date().getFullYear(),0,1).getTime()) / 86400000) + 1
    : (daysMap[tf] || 3660);
  const now = new Date();
  const startDate = tf === 'YTD' ? new Date(new Date().getFullYear(),0,1) : new Date(now - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  // FRED: GOLDAMGBD228NLBM = Gold Fixing Price daily (USD per Troy Ounce)
  const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=GOLDAMGBD228NLBM&observation_start=${fmt(startDate)}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(fredUrl)}`;
  try {
    const r = await fetch(proxyUrl, {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error('proxy error');
    const text = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const result = lines.map(l => {
      const parts = l.split(',');
      return { date: parts[0], val: parseFloat(parts[1]) };
    }).filter(d => !isNaN(d.val) && d.val > 100)
      .sort((a,b) => a.date.localeCompare(b.date));
    if (result.length < 2) throw new Error('no data');
    overlayCache.gold[tf] = result;
    return result;
  } catch(e) {
    console.warn('Gold fetch failed, using static:', e);
    // Data statis approximate harga emas (USD/oz)
    const staticGold = [
      {date:'2015-01-05',val:1183},
      {date:'2015-01-12',val:1182},
      {date:'2015-01-19',val:1183},
      {date:'2015-01-26',val:1190},
      {date:'2015-02-02',val:1182},
      {date:'2015-02-09',val:1169},
      {date:'2015-02-16',val:1185},
      {date:'2015-02-23',val:1179},
      {date:'2015-03-02',val:1179},
      {date:'2015-03-09',val:1182},
      {date:'2015-03-16',val:1182},
      {date:'2015-03-23',val:1190},
      {date:'2015-03-30',val:1185},
      {date:'2015-04-06',val:1179},
      {date:'2015-04-13',val:1170},
      {date:'2015-04-20',val:1167},
      {date:'2015-04-27',val:1178},
      {date:'2015-05-04',val:1187},
      {date:'2015-05-11',val:1175},
      {date:'2015-05-18',val:1173},
      {date:'2015-05-25',val:1178},
      {date:'2015-06-01',val:1159},
      {date:'2015-06-08',val:1170},
      {date:'2015-06-15',val:1177},
      {date:'2015-06-22',val:1180},
      {date:'2015-07-01',val:1170},
      {date:'2015-07-08',val:1175},
      {date:'2015-07-15',val:1171},
      {date:'2015-07-22',val:1173},
      {date:'2015-07-29',val:1151},
      {date:'2015-08-05',val:1161},
      {date:'2015-08-12',val:1136},
      {date:'2015-08-19',val:1119},
      {date:'2015-08-26',val:1130},
      {date:'2015-09-02',val:1120},
      {date:'2015-09-09',val:1128},
      {date:'2015-09-16',val:1118},
      {date:'2015-09-23',val:1093},
      {date:'2015-09-30',val:1104},
      {date:'2015-10-07',val:1080},
      {date:'2015-10-14',val:1081},
      {date:'2015-10-21',val:1073},
      {date:'2015-10-28',val:1072},
      {date:'2015-11-04',val:1073},
      {date:'2015-11-11',val:1068},
      {date:'2015-11-18',val:1064},
      {date:'2015-12-01',val:1066},
      {date:'2015-12-08',val:1065},
      {date:'2015-12-15',val:1059},
      {date:'2015-12-22',val:1063},
      {date:'2015-12-29',val:1071},
      {date:'2016-01-05',val:1087},
      {date:'2016-01-12',val:1090},
      {date:'2016-01-19',val:1123},
      {date:'2016-01-26',val:1107},
      {date:'2016-02-02',val:1117},
      {date:'2016-02-09',val:1147},
      {date:'2016-02-16',val:1168},
      {date:'2016-02-23',val:1174},
      {date:'2016-03-01',val:1192},
      {date:'2016-03-08',val:1213},
      {date:'2016-03-15',val:1214},
      {date:'2016-03-22',val:1216},
      {date:'2016-03-29',val:1241},
      {date:'2016-04-05',val:1270},
      {date:'2016-04-12',val:1261},
      {date:'2016-04-19',val:1290},
      {date:'2016-04-26',val:1306},
      {date:'2016-05-03',val:1312},
      {date:'2016-05-10',val:1335},
      {date:'2016-05-17',val:1344},
      {date:'2016-05-24',val:1372},
      {date:'2016-05-31',val:1362},
      {date:'2016-06-07',val:1355},
      {date:'2016-06-14',val:1360},
      {date:'2016-06-21',val:1360},
      {date:'2016-07-01',val:1380},
      {date:'2016-07-08',val:1362},
      {date:'2016-07-15',val:1363},
      {date:'2016-07-22',val:1365},
      {date:'2016-07-29',val:1340},
      {date:'2016-08-05',val:1334},
      {date:'2016-08-12',val:1304},
      {date:'2016-08-19',val:1298},
      {date:'2016-08-26',val:1288},
      {date:'2016-09-02',val:1283},
      {date:'2016-09-09',val:1274},
      {date:'2016-09-16',val:1245},
      {date:'2016-09-23',val:1231},
      {date:'2016-09-30',val:1214},
      {date:'2016-10-07',val:1208},
      {date:'2016-10-14',val:1192},
      {date:'2016-10-21',val:1173},
      {date:'2016-10-28',val:1150},
      {date:'2016-11-04',val:1158},
      {date:'2016-11-11',val:1146},
      {date:'2016-11-18',val:1150},
      {date:'2016-12-01',val:1137},
      {date:'2016-12-08',val:1155},
      {date:'2016-12-15',val:1135},
      {date:'2016-12-22',val:1155},
      {date:'2016-12-29',val:1144},
      {date:'2017-01-05',val:1142},
      {date:'2017-01-12',val:1140},
      {date:'2017-01-19',val:1153},
      {date:'2017-01-26',val:1173},
      {date:'2017-02-02',val:1173},
      {date:'2017-02-09',val:1177},
      {date:'2017-02-16',val:1155},
      {date:'2017-02-23',val:1191},
      {date:'2017-03-02',val:1196},
      {date:'2017-03-09',val:1193},
      {date:'2017-03-16',val:1200},
      {date:'2017-03-23',val:1213},
      {date:'2017-03-30',val:1238},
      {date:'2017-04-06',val:1219},
      {date:'2017-04-13',val:1233},
      {date:'2017-04-20',val:1259},
      {date:'2017-04-27',val:1249},
      {date:'2017-05-04',val:1257},
      {date:'2017-05-11',val:1270},
      {date:'2017-05-18',val:1264},
      {date:'2017-05-25',val:1286},
      {date:'2017-06-01',val:1279},
      {date:'2017-06-08',val:1307},
      {date:'2017-06-15',val:1305},
      {date:'2017-06-22',val:1335},
      {date:'2017-06-29',val:1320},
      {date:'2017-07-06',val:1337},
      {date:'2017-07-13',val:1313},
      {date:'2017-07-20',val:1330},
      {date:'2017-07-27',val:1339},
      {date:'2017-08-03',val:1358},
      {date:'2017-08-10',val:1323},
      {date:'2017-08-17',val:1354},
      {date:'2017-08-24',val:1351},
      {date:'2017-09-01',val:1362},
      {date:'2017-09-08',val:1352},
      {date:'2017-09-15',val:1345},
      {date:'2017-09-22',val:1337},
      {date:'2017-09-29',val:1328},
      {date:'2017-10-06',val:1342},
      {date:'2017-10-13',val:1336},
      {date:'2017-10-20',val:1357},
      {date:'2017-10-27',val:1327},
      {date:'2017-11-03',val:1335},
      {date:'2017-11-10',val:1313},
      {date:'2017-11-17',val:1323},
      {date:'2017-11-24',val:1328},
      {date:'2017-12-01',val:1332},
      {date:'2017-12-08',val:1337},
      {date:'2017-12-15',val:1320},
      {date:'2017-12-22',val:1308},
      {date:'2018-01-01',val:1325},
      {date:'2018-01-08',val:1325},
      {date:'2018-01-15',val:1324},
      {date:'2018-01-22',val:1310},
      {date:'2018-01-29',val:1327},
      {date:'2018-02-05',val:1313},
      {date:'2018-02-12',val:1316},
      {date:'2018-02-19',val:1318},
      {date:'2018-02-26',val:1307},
      {date:'2018-03-05',val:1299},
      {date:'2018-03-12',val:1313},
      {date:'2018-03-19',val:1288},
      {date:'2018-03-26',val:1277},
      {date:'2018-04-02',val:1275},
      {date:'2018-04-09',val:1283},
      {date:'2018-04-16',val:1263},
      {date:'2018-04-23',val:1261},
      {date:'2018-04-30',val:1262},
      {date:'2018-05-07',val:1239},
      {date:'2018-05-14',val:1221},
      {date:'2018-05-21',val:1235},
      {date:'2018-05-28',val:1228},
      {date:'2018-06-04',val:1214},
      {date:'2018-06-11',val:1223},
      {date:'2018-06-18',val:1215},
      {date:'2018-06-25',val:1195},
      {date:'2018-07-02',val:1205},
      {date:'2018-07-09',val:1193},
      {date:'2018-07-16',val:1177},
      {date:'2018-07-23',val:1192},
      {date:'2018-07-30',val:1185},
      {date:'2018-08-06',val:1176},
      {date:'2018-08-13',val:1186},
      {date:'2018-08-20',val:1185},
      {date:'2018-09-01',val:1175},
      {date:'2018-09-08',val:1184},
      {date:'2018-09-15',val:1191},
      {date:'2018-09-22',val:1177},
      {date:'2018-09-29',val:1191},
      {date:'2018-10-06',val:1191},
      {date:'2018-10-13',val:1217},
      {date:'2018-10-20',val:1183},
      {date:'2018-10-27',val:1213},
      {date:'2018-11-03',val:1209},
      {date:'2018-11-10',val:1218},
      {date:'2018-11-17',val:1245},
      {date:'2018-11-24',val:1234},
      {date:'2018-12-01',val:1264},
      {date:'2018-12-08',val:1246},
      {date:'2018-12-15',val:1263},
      {date:'2018-12-22',val:1263},
      {date:'2018-12-29',val:1270},
      {date:'2019-01-05',val:1287},
      {date:'2019-01-12',val:1292},
      {date:'2019-01-19',val:1307},
      {date:'2019-01-26',val:1292},
      {date:'2019-02-02',val:1344},
      {date:'2019-02-09',val:1330},
      {date:'2019-02-16',val:1359},
      {date:'2019-02-23',val:1339},
      {date:'2019-03-02',val:1361},
      {date:'2019-03-09',val:1400},
      {date:'2019-03-16',val:1364},
      {date:'2019-03-23',val:1364},
      {date:'2019-03-30',val:1381},
      {date:'2019-04-06',val:1399},
      {date:'2019-04-13',val:1407},
      {date:'2019-04-20',val:1419},
      {date:'2019-04-27',val:1406},
      {date:'2019-05-04',val:1395},
      {date:'2019-05-11',val:1411},
      {date:'2019-05-18',val:1432},
      {date:'2019-05-25',val:1425},
      {date:'2019-06-01',val:1398},
      {date:'2019-06-08',val:1422},
      {date:'2019-06-15',val:1444},
      {date:'2019-06-22',val:1461},
      {date:'2019-06-29',val:1455},
      {date:'2019-07-06',val:1465},
      {date:'2019-07-13',val:1461},
      {date:'2019-07-20',val:1480},
      {date:'2019-07-27',val:1504},
      {date:'2019-08-03',val:1523},
      {date:'2019-08-10',val:1535},
      {date:'2019-08-17',val:1531},
      {date:'2019-08-24',val:1529},
      {date:'2019-09-01',val:1535},
      {date:'2019-09-08',val:1531},
      {date:'2019-09-15',val:1555},
      {date:'2019-09-22',val:1521},
      {date:'2019-09-29',val:1549},
      {date:'2019-10-06',val:1564},
      {date:'2019-10-13',val:1582},
      {date:'2019-10-20',val:1570},
      {date:'2019-10-27',val:1588},
      {date:'2019-11-03',val:1577},
      {date:'2019-11-10',val:1580},
      {date:'2019-11-17',val:1588},
      {date:'2019-11-24',val:1624},
      {date:'2019-12-01',val:1625},
      {date:'2019-12-08',val:1627},
      {date:'2019-12-15',val:1671},
      {date:'2019-12-22',val:1635},
      {date:'2019-12-29',val:1651},
      {date:'2020-01-05',val:1654},
      {date:'2020-01-12',val:1653},
      {date:'2020-01-19',val:1693},
      {date:'2020-01-26',val:1687},
      {date:'2020-02-02',val:1653},
      {date:'2020-02-09',val:1670},
      {date:'2020-02-16',val:1683},
      {date:'2020-02-23',val:1690},
      {date:'2020-03-01',val:1662},
      {date:'2020-03-08',val:1652},
      {date:'2020-03-15',val:1664},
      {date:'2020-03-22',val:1700},
      {date:'2020-03-29',val:1715},
      {date:'2020-04-05',val:1740},
      {date:'2020-04-12',val:1746},
      {date:'2020-04-19',val:1763},
      {date:'2020-04-26',val:1776},
      {date:'2020-05-03',val:1837},
      {date:'2020-05-10',val:1865},
      {date:'2020-05-17',val:1902},
      {date:'2020-05-24',val:1927},
      {date:'2020-05-31',val:1938},
      {date:'2020-06-07',val:1988},
      {date:'2020-06-14',val:1988},
      {date:'2020-06-21',val:2001},
      {date:'2020-06-28',val:2022},
      {date:'2020-07-05',val:2036},
      {date:'2020-07-12',val:2021},
      {date:'2020-07-19',val:2067},
      {date:'2020-08-01',val:2071},
      {date:'2020-08-08',val:2060},
      {date:'2020-08-15',val:2050},
      {date:'2020-08-22',val:2062},
      {date:'2020-08-29',val:2076},
      {date:'2020-09-05',val:2039},
      {date:'2020-09-12',val:2019},
      {date:'2020-09-19',val:2004},
      {date:'2020-09-26',val:1998},
      {date:'2020-10-03',val:1963},
      {date:'2020-10-10',val:1965},
      {date:'2020-10-17',val:1950},
      {date:'2020-10-24',val:1959},
      {date:'2020-10-31',val:1926},
      {date:'2020-11-07',val:1908},
      {date:'2020-11-14',val:1863},
      {date:'2020-11-21',val:1864},
      {date:'2020-11-28',val:1818},
      {date:'2020-12-05',val:1821},
      {date:'2020-12-12',val:1804},
      {date:'2020-12-19',val:1769},
      {date:'2020-12-26',val:1792},
      {date:'2021-01-02',val:1756},
      {date:'2021-01-09',val:1707},
      {date:'2021-01-16',val:1728},
      {date:'2021-01-23',val:1703},
      {date:'2021-01-30',val:1699},
      {date:'2021-02-06',val:1697},
      {date:'2021-02-13',val:1690},
      {date:'2021-02-20',val:1654},
      {date:'2021-03-01',val:1664},
      {date:'2021-03-08',val:1694},
      {date:'2021-03-15',val:1712},
      {date:'2021-03-22',val:1736},
      {date:'2021-03-29',val:1755},
      {date:'2021-04-05',val:1724},
      {date:'2021-04-12',val:1788},
      {date:'2021-04-19',val:1775},
      {date:'2021-04-26',val:1851},
      {date:'2021-05-03',val:1854},
      {date:'2021-05-10',val:1853},
      {date:'2021-05-17',val:1916},
      {date:'2021-05-24',val:1906},
      {date:'2021-06-01',val:1871},
      {date:'2021-06-08',val:1905},
      {date:'2021-06-15',val:1890},
      {date:'2021-06-22',val:1904},
      {date:'2021-06-29',val:1897},
      {date:'2021-07-06',val:1928},
      {date:'2021-07-13',val:1888},
      {date:'2021-07-20',val:1918},
      {date:'2021-07-27',val:1944},
      {date:'2021-08-03',val:1908},
      {date:'2021-08-10',val:1928},
      {date:'2021-08-17',val:1932},
      {date:'2021-08-24',val:1923},
      {date:'2021-08-31',val:1949},
      {date:'2021-09-07',val:1946},
      {date:'2021-09-14',val:1935},
      {date:'2021-09-21',val:1983},
      {date:'2021-09-28',val:1973},
      {date:'2021-10-05',val:1964},
      {date:'2021-10-12',val:1962},
      {date:'2021-10-19',val:1965},
      {date:'2021-10-26',val:2003},
      {date:'2021-11-02',val:1987},
      {date:'2021-11-09',val:2002},
      {date:'2021-11-16',val:1998},
      {date:'2021-11-23',val:2016},
      {date:'2021-11-30',val:2009},
      {date:'2021-12-07',val:2028},
      {date:'2021-12-14',val:2018},
      {date:'2021-12-21',val:2039},
      {date:'2021-12-28',val:2041},
      {date:'2022-01-04',val:2032},
      {date:'2022-01-11',val:2023},
      {date:'2022-01-18',val:2025},
      {date:'2022-01-25',val:2031},
      {date:'2022-02-01',val:2029},
      {date:'2022-02-08',val:2062},
      {date:'2022-02-15',val:2048},
      {date:'2022-02-22',val:2075},
      {date:'2022-03-01',val:2087},
      {date:'2022-03-08',val:2049},
      {date:'2022-03-15',val:2017},
      {date:'2022-03-22',val:2028},
      {date:'2022-03-29',val:2021},
      {date:'2022-04-05',val:1984},
      {date:'2022-04-12',val:1988},
      {date:'2022-04-19',val:1978},
      {date:'2022-04-26',val:1946},
      {date:'2022-05-03',val:1919},
      {date:'2022-05-10',val:1897},
      {date:'2022-05-17',val:1911},
      {date:'2022-05-24',val:1857},
      {date:'2022-05-31',val:1823},
      {date:'2022-06-07',val:1805},
      {date:'2022-06-14',val:1799},
      {date:'2022-06-21',val:1752},
      {date:'2022-06-28',val:1746},
      {date:'2022-07-05',val:1727},
      {date:'2022-07-12',val:1707},
      {date:'2022-07-19',val:1697},
      {date:'2022-07-26',val:1654},
      {date:'2022-08-02',val:1662},
      {date:'2022-08-09',val:1625},
      {date:'2022-08-16',val:1622},
      {date:'2022-08-23',val:1637},
      {date:'2022-09-01',val:1631},
      {date:'2022-09-08',val:1621},
      {date:'2022-09-15',val:1609},
      {date:'2022-09-22',val:1637},
      {date:'2022-09-29',val:1628},
      {date:'2022-10-06',val:1633},
      {date:'2022-10-13',val:1647},
      {date:'2022-10-20',val:1670},
      {date:'2022-10-27',val:1652},
      {date:'2022-11-03',val:1699},
      {date:'2022-11-10',val:1712},
      {date:'2022-11-17',val:1718},
      {date:'2022-11-24',val:1757},
      {date:'2022-12-01',val:1769},
      {date:'2022-12-08',val:1770},
      {date:'2022-12-15',val:1788},
      {date:'2022-12-22',val:1826},
      {date:'2022-12-29',val:1813},
      {date:'2023-01-05',val:1849},
      {date:'2023-01-12',val:1863},
      {date:'2023-01-19',val:1892},
      {date:'2023-01-26',val:1913},
      {date:'2023-02-02',val:1928},
      {date:'2023-02-09',val:1962},
      {date:'2023-02-16',val:1964},
      {date:'2023-02-23',val:1971},
      {date:'2023-03-02',val:1971},
      {date:'2023-03-09',val:2014},
      {date:'2023-03-16',val:2023},
      {date:'2023-03-23',val:2048},
      {date:'2023-03-30',val:2021},
      {date:'2023-04-06',val:2041},
      {date:'2023-04-13',val:2045},
      {date:'2023-04-20',val:2047},
      {date:'2023-05-01',val:2050},
      {date:'2023-05-08',val:2020},
      {date:'2023-05-15',val:2058},
      {date:'2023-05-22',val:2048},
      {date:'2023-05-29',val:2046},
      {date:'2023-06-05',val:2053},
      {date:'2023-06-12',val:1999},
      {date:'2023-06-19',val:1990},
      {date:'2023-06-26',val:1975},
      {date:'2023-07-03',val:1990},
      {date:'2023-07-10',val:1916},
      {date:'2023-07-17',val:1934},
      {date:'2023-07-24',val:1888},
      {date:'2023-07-31',val:1856},
      {date:'2023-08-07',val:1849},
      {date:'2023-08-14',val:1845},
      {date:'2023-08-21',val:1869},
      {date:'2023-08-28',val:1829},
      {date:'2023-09-04',val:1829},
      {date:'2023-09-11',val:1809},
      {date:'2023-09-18',val:1830},
      {date:'2023-10-01',val:1804},
      {date:'2023-10-08',val:1842},
      {date:'2023-10-15',val:1814},
      {date:'2023-10-22',val:1828},
      {date:'2023-10-29',val:1856},
      {date:'2023-11-05',val:1872},
      {date:'2023-11-12',val:1913},
      {date:'2023-11-19',val:1916},
      {date:'2023-11-26',val:1921},
      {date:'2023-12-03',val:1958},
      {date:'2023-12-10',val:1986},
      {date:'2023-12-17',val:2036},
      {date:'2023-12-24',val:2061},
      {date:'2023-12-31',val:2083},
      {date:'2024-01-07',val:2130},
      {date:'2024-01-14',val:2137},
      {date:'2024-01-21',val:2173},
      {date:'2024-01-28',val:2207},
      {date:'2024-02-04',val:2258},
      {date:'2024-02-11',val:2254},
      {date:'2024-02-18',val:2272},
      {date:'2024-02-25',val:2280},
      {date:'2024-03-03',val:2329},
      {date:'2024-03-10',val:2320},
      {date:'2024-03-17',val:2348},
      {date:'2024-03-24',val:2312},
      {date:'2024-04-01',val:2370},
      {date:'2024-04-08',val:2327},
      {date:'2024-04-15',val:2342},
      {date:'2024-04-22',val:2385},
      {date:'2024-04-29',val:2350},
      {date:'2024-05-06',val:2387},
      {date:'2024-05-13',val:2406},
      {date:'2024-05-20',val:2402},
      {date:'2024-05-27',val:2467},
      {date:'2024-06-03',val:2490},
      {date:'2024-06-10',val:2443},
      {date:'2024-06-17',val:2475},
      {date:'2024-06-24',val:2543},
      {date:'2024-07-01',val:2523},
      {date:'2024-07-08',val:2565},
      {date:'2024-07-15',val:2598},
      {date:'2024-07-22',val:2632},
      {date:'2024-07-29',val:2635},
      {date:'2024-08-05',val:2662},
      {date:'2024-08-12',val:2662},
      {date:'2024-08-19',val:2724},
      {date:'2024-08-26',val:2701},
      {date:'2024-09-02',val:2732},
      {date:'2024-09-09',val:2724},
      {date:'2024-09-16',val:2746},
      {date:'2024-09-23',val:2745},
      {date:'2024-10-01',val:2746},
      {date:'2024-10-08',val:2729},
      {date:'2024-10-15',val:2773},
      {date:'2024-10-22',val:2794},
      {date:'2024-10-29',val:2776},
      {date:'2024-11-05',val:2798},
      {date:'2024-11-12',val:2812},
      {date:'2024-11-19',val:2826},
      {date:'2024-11-26',val:2825},
      {date:'2024-12-03',val:2836},
      {date:'2024-12-10',val:2864},
      {date:'2024-12-17',val:2859},
      {date:'2024-12-24',val:2846},
      {date:'2024-12-31',val:2880},
      {date:'2025-01-07',val:2844},
      {date:'2025-01-14',val:2894},
      {date:'2025-01-21',val:2908},
      {date:'2025-02-01',val:2929},
      {date:'2025-02-08',val:2921},
      {date:'2025-02-15',val:2984},
      {date:'2025-02-22',val:3027},
      {date:'2025-03-01',val:3075},
      {date:'2025-03-08',val:3138},
      {date:'2025-03-15',val:3212},
      {date:'2025-03-22',val:3247},
      {date:'2025-04-01',val:3317},
      {date:'2025-04-08',val:3294},
      {date:'2025-04-15',val:3315},
      {date:'2025-04-22',val:3302},
      {date:'2025-04-29',val:3327},
      {date:'2025-05-06',val:3327},
      {date:'2025-05-13',val:3282},
      {date:'2025-05-20',val:3292},
      {date:'2025-05-27',val:3284},
      {date:'2025-06-03',val:3255},
      {date:'2025-06-10',val:3315},
      {date:'2025-06-17',val:3328},
      {date:'2025-06-24',val:3296},
      {date:'2025-07-01',val:3283},
      {date:'2025-07-08',val:3324},
      {date:'2025-07-15',val:3233},
      {date:'2025-07-22',val:3299},
      {date:'2025-07-29',val:3298},
      {date:'2025-08-05',val:3278},
      {date:'2025-08-12',val:3329},
      {date:'2025-08-19',val:3318},
      {date:'2025-08-26',val:3284},
      {date:'2025-09-02',val:3288},
      {date:'2025-09-09',val:3280},
      {date:'2025-09-16',val:3276},
      {date:'2025-09-23',val:3254},
      {date:'2025-09-30',val:3324},
      {date:'2025-10-07',val:3314},
      {date:'2025-10-14',val:3308},
      {date:'2025-10-21',val:3257},
      {date:'2025-10-28',val:3340},
      {date:'2025-11-04',val:3337},
      {date:'2025-11-11',val:3289},
      {date:'2025-11-18',val:3260},
      {date:'2025-11-25',val:3261},
      {date:'2025-12-02',val:3294},
      {date:'2025-12-09',val:3258},
      {date:'2025-12-16',val:3281},
      {date:'2025-12-23',val:3310},
      {date:'2025-12-30',val:3242},
      {date:'2026-01-06',val:3334},
      {date:'2026-01-13',val:3322},
      {date:'2026-01-20',val:3248},
      {date:'2026-01-27',val:3243},
      {date:'2026-02-03',val:3273},
      {date:'2026-02-10',val:3253}
    ];
    const cutoff = fmt(startDate);
    const filtered = staticGold.filter(d => d.date >= cutoff);
    const result2 = filtered.length >= 2 ? filtered : staticGold.slice(-6);
    overlayCache.gold[tf] = result2;
    return result2;
  }
}

// ── S&P 500 DATA ──
async function fetchSP500Data(tf) {
  if (!overlayCache.sp500) overlayCache.sp500 = {};
  if (overlayCache.sp500[tf]) return overlayCache.sp500[tf];
  if (overlayCache._sp500Static && overlayCache._sp500Static[tf]) {
    _bgFetchSP500(tf);
    return overlayCache._sp500Static[tf];
  }
  const daysMap = {'1D':2,'1W':8,'1M':35,'YTD':366,'1Y':370,'3Y':1100,'5Y':1830,'10Y':3660};
  const days = tf === 'YTD'
    ? Math.ceil((Date.now() - new Date(new Date().getFullYear(),0,1).getTime()) / 86400000) + 1
    : (daysMap[tf] || 3660);
  const now = new Date();
  const startDate = tf === 'YTD' ? new Date(new Date().getFullYear(),0,1) : new Date(now - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  // FRED: SP500 = S&P 500 Index
  const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&observation_start=${fmt(startDate)}`;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(fredUrl)}`;
  try {
    const r = await fetch(proxyUrl, {signal: AbortSignal.timeout(8000)});
    if (!r.ok) throw new Error('proxy error');
    const text = await r.text();
    const lines = text.trim().split('\n').slice(1);
    const result = lines.map(l => {
      const parts = l.split(',');
      return { date: parts[0], val: parseFloat(parts[1]) };
    }).filter(d => !isNaN(d.val) && d.val > 0)
      .sort((a,b) => a.date.localeCompare(b.date)); // pastikan ascending
    if (result.length < 2) throw new Error('no data');
    overlayCache.sp500[tf] = result;
    return result;
  } catch(e) {
    console.warn('SP500 fetch failed, using static:', e);
    // Data statis approximate S&P500
    const staticSP500 = [
      {date:'2015-01-05',val:2036},
      {date:'2015-01-12',val:2050},
      {date:'2015-01-19',val:2051},
      {date:'2015-01-26',val:2060},
      {date:'2015-02-02',val:2055},
      {date:'2015-02-09',val:2048},
      {date:'2015-02-16',val:2048},
      {date:'2015-02-23',val:2085},
      {date:'2015-03-02',val:2044},
      {date:'2015-03-09',val:2075},
      {date:'2015-03-16',val:2075},
      {date:'2015-03-23',val:2098},
      {date:'2015-03-30',val:2096},
      {date:'2015-04-06',val:2103},
      {date:'2015-04-13',val:2127},
      {date:'2015-04-20',val:2112},
      {date:'2015-04-27',val:2107},
      {date:'2015-05-04',val:2142},
      {date:'2015-05-11',val:2142},
      {date:'2015-05-21',val:2148},
      {date:'2015-05-28',val:2134},
      {date:'2015-06-04',val:2102},
      {date:'2015-06-11',val:2111},
      {date:'2015-06-18',val:2065},
      {date:'2015-06-25',val:2046},
      {date:'2015-07-02',val:1998},
      {date:'2015-07-09',val:1974},
      {date:'2015-07-16',val:1960},
      {date:'2015-07-23',val:1935},
      {date:'2015-07-30',val:1903},
      {date:'2015-08-06',val:1900},
      {date:'2015-08-13',val:1870},
      {date:'2015-08-25',val:1840},
      {date:'2015-09-01',val:1882},
      {date:'2015-09-08',val:1868},
      {date:'2015-09-15',val:1904},
      {date:'2015-09-22',val:1958},
      {date:'2015-09-29',val:2010},
      {date:'2015-10-06',val:2046},
      {date:'2015-10-13',val:2066},
      {date:'2015-10-20',val:2096},
      {date:'2015-11-01',val:2080},
      {date:'2015-11-08',val:2130},
      {date:'2015-11-15',val:2080},
      {date:'2015-11-22',val:2065},
      {date:'2015-11-29',val:2042},
      {date:'2015-12-06',val:2036},
      {date:'2015-12-13',val:1995},
      {date:'2015-12-20',val:1966},
      {date:'2015-12-27',val:1930},
      {date:'2016-01-03',val:1903},
      {date:'2016-01-10',val:1885},
      {date:'2016-01-17',val:1860},
      {date:'2016-01-24',val:1845},
      {date:'2016-01-31',val:1825},
      {date:'2016-02-11',val:1843},
      {date:'2016-02-18',val:1838},
      {date:'2016-02-25',val:1858},
      {date:'2016-03-03',val:1854},
      {date:'2016-03-10',val:1861},
      {date:'2016-03-17',val:1872},
      {date:'2016-03-24',val:1904},
      {date:'2016-03-31',val:1910},
      {date:'2016-04-07',val:1916},
      {date:'2016-04-14',val:1940},
      {date:'2016-04-21',val:1943},
      {date:'2016-04-28',val:2013},
      {date:'2016-05-05',val:2036},
      {date:'2016-05-12',val:2018},
      {date:'2016-05-19',val:2043},
      {date:'2016-05-26',val:2064},
      {date:'2016-06-02',val:2084},
      {date:'2016-06-09',val:2114},
      {date:'2016-06-16',val:2125},
      {date:'2016-06-23',val:2133},
      {date:'2016-06-30',val:2143},
      {date:'2016-07-11',val:2143},
      {date:'2016-07-18',val:2146},
      {date:'2016-07-25',val:2116},
      {date:'2016-08-01',val:2134},
      {date:'2016-08-08',val:2157},
      {date:'2016-08-15',val:2127},
      {date:'2016-08-22',val:2182},
      {date:'2016-08-29',val:2188},
      {date:'2016-09-05',val:2180},
      {date:'2016-09-12',val:2191},
      {date:'2016-09-19',val:2190},
      {date:'2016-09-26',val:2224},
      {date:'2016-10-03',val:2223},
      {date:'2016-10-10',val:2225},
      {date:'2016-10-17',val:2207},
      {date:'2016-10-24',val:2256},
      {date:'2016-10-31',val:2233},
      {date:'2016-11-07',val:2263},
      {date:'2016-11-14',val:2255},
      {date:'2016-11-21',val:2269},
      {date:'2016-11-28',val:2294},
      {date:'2016-12-05',val:2245},
      {date:'2016-12-13',val:2268},
      {date:'2016-12-20',val:2258},
      {date:'2016-12-27',val:2269},
      {date:'2017-01-03',val:2299},
      {date:'2017-01-10',val:2296},
      {date:'2017-01-17',val:2307},
      {date:'2017-01-24',val:2332},
      {date:'2017-01-31',val:2392},
      {date:'2017-02-07',val:2374},
      {date:'2017-02-14',val:2377},
      {date:'2017-02-21',val:2406},
      {date:'2017-03-01',val:2377},
      {date:'2017-03-08',val:2401},
      {date:'2017-03-15',val:2416},
      {date:'2017-03-22',val:2404},
      {date:'2017-03-29',val:2400},
      {date:'2017-04-05',val:2370},
      {date:'2017-04-12',val:2431},
      {date:'2017-04-19',val:2418},
      {date:'2017-04-26',val:2444},
      {date:'2017-05-03',val:2458},
      {date:'2017-05-10',val:2415},
      {date:'2017-05-17',val:2445},
      {date:'2017-05-24',val:2425},
      {date:'2017-05-31',val:2463},
      {date:'2017-06-07',val:2450},
      {date:'2017-06-14',val:2474},
      {date:'2017-06-21',val:2453},
      {date:'2017-06-28',val:2457},
      {date:'2017-07-05',val:2453},
      {date:'2017-07-12',val:2471},
      {date:'2017-07-19',val:2504},
      {date:'2017-07-26',val:2439},
      {date:'2017-08-08',val:2449},
      {date:'2017-08-15',val:2473},
      {date:'2017-08-22',val:2471},
      {date:'2017-08-29',val:2469},
      {date:'2017-09-05',val:2532},
      {date:'2017-09-12',val:2506},
      {date:'2017-09-19',val:2557},
      {date:'2017-09-26',val:2536},
      {date:'2017-10-03',val:2526},
      {date:'2017-10-10',val:2596},
      {date:'2017-10-17',val:2630},
      {date:'2017-10-24',val:2634},
      {date:'2017-10-31',val:2662},
      {date:'2017-11-07',val:2637},
      {date:'2017-11-14',val:2641},
      {date:'2017-11-21',val:2687},
      {date:'2017-11-28',val:2677},
      {date:'2017-12-05',val:2703},
      {date:'2017-12-18',val:2681},
      {date:'2017-12-25',val:2705},
      {date:'2018-01-01',val:2763},
      {date:'2018-01-08',val:2809},
      {date:'2018-01-15',val:2854},
      {date:'2018-01-26',val:2862},
      {date:'2018-02-02',val:2890},
      {date:'2018-02-09',val:2832},
      {date:'2018-02-16',val:2778},
      {date:'2018-02-23',val:2744},
      {date:'2018-03-02',val:2667},
      {date:'2018-03-09',val:2644},
      {date:'2018-03-16',val:2622},
      {date:'2018-03-23',val:2563},
      {date:'2018-04-02',val:2533},
      {date:'2018-04-09',val:2531},
      {date:'2018-04-16',val:2556},
      {date:'2018-04-23',val:2548},
      {date:'2018-04-30',val:2558},
      {date:'2018-05-07',val:2597},
      {date:'2018-05-14',val:2600},
      {date:'2018-05-21',val:2639},
      {date:'2018-05-28',val:2652},
      {date:'2018-06-04',val:2664},
      {date:'2018-06-11',val:2718},
      {date:'2018-06-18',val:2737},
      {date:'2018-06-25',val:2737},
      {date:'2018-07-02',val:2748},
      {date:'2018-07-09',val:2806},
      {date:'2018-07-16',val:2836},
      {date:'2018-07-23',val:2824},
      {date:'2018-07-30',val:2843},
      {date:'2018-08-06',val:2904},
      {date:'2018-08-13',val:2924},
      {date:'2018-08-20',val:2900},
      {date:'2018-08-27',val:2904},
      {date:'2018-09-03',val:2930},
      {date:'2018-09-10',val:2918},
      {date:'2018-09-20',val:2933},
      {date:'2018-09-27',val:2935},
      {date:'2018-10-04',val:2909},
      {date:'2018-10-11',val:2870},
      {date:'2018-10-18',val:2775},
      {date:'2018-10-25',val:2697},
      {date:'2018-11-01',val:2697},
      {date:'2018-11-08',val:2613},
      {date:'2018-11-15',val:2554},
      {date:'2018-11-22',val:2478},
      {date:'2018-11-29',val:2451},
      {date:'2018-12-06',val:2401},
      {date:'2018-12-13',val:2350},
      {date:'2018-12-24',val:2369},
      {date:'2018-12-31',val:2322},
      {date:'2019-01-07',val:2338},
      {date:'2019-01-14',val:2404},
      {date:'2019-01-21',val:2447},
      {date:'2019-01-28',val:2460},
      {date:'2019-02-04',val:2521},
      {date:'2019-02-11',val:2572},
      {date:'2019-02-18',val:2618},
      {date:'2019-02-25',val:2688},
      {date:'2019-03-04',val:2735},
      {date:'2019-03-11',val:2768},
      {date:'2019-03-18',val:2794},
      {date:'2019-03-25',val:2852},
      {date:'2019-04-01',val:2882},
      {date:'2019-04-08',val:2884},
      {date:'2019-04-15',val:2899},
      {date:'2019-04-23',val:2927},
      {date:'2019-04-30',val:2916},
      {date:'2019-05-07',val:2928},
      {date:'2019-05-14',val:2959},
      {date:'2019-05-21',val:2978},
      {date:'2019-05-28',val:2969},
      {date:'2019-06-04',val:2975},
      {date:'2019-06-11',val:2976},
      {date:'2019-06-18',val:3007},
      {date:'2019-06-25',val:3005},
      {date:'2019-07-02',val:3000},
      {date:'2019-07-09',val:2989},
      {date:'2019-07-16',val:3036},
      {date:'2019-07-26',val:2992},
      {date:'2019-08-02',val:3041},
      {date:'2019-08-09',val:3024},
      {date:'2019-08-16',val:3012},
      {date:'2019-08-23',val:2986},
      {date:'2019-08-30',val:2995},
      {date:'2019-09-06',val:2949},
      {date:'2019-09-13',val:2946},
      {date:'2019-09-20',val:2913},
      {date:'2019-10-01',val:2928},
      {date:'2019-10-08',val:2921},
      {date:'2019-10-15',val:2921},
      {date:'2019-10-22',val:2994},
      {date:'2019-10-29',val:3002},
      {date:'2019-11-05',val:3003},
      {date:'2019-11-12',val:2997},
      {date:'2019-11-19',val:3071},
      {date:'2019-11-26',val:3104},
      {date:'2019-12-03',val:3131},
      {date:'2019-12-10',val:3131},
      {date:'2019-12-17',val:3219},
      {date:'2019-12-24',val:3269},
      {date:'2019-12-31',val:3254},
      {date:'2020-01-07',val:3259},
      {date:'2020-01-14',val:3318},
      {date:'2020-01-21',val:3308},
      {date:'2020-01-28',val:3355},
      {date:'2020-02-04',val:3380},
      {date:'2020-02-11',val:3365},
      {date:'2020-02-19',val:3414},
      {date:'2020-02-26',val:3205},
      {date:'2020-03-04',val:2800},
      {date:'2020-03-11',val:2393},
      {date:'2020-03-23',val:2203},
      {date:'2020-03-30',val:2240},
      {date:'2020-04-06',val:2276},
      {date:'2020-04-13',val:2397},
      {date:'2020-04-20',val:2505},
      {date:'2020-04-27',val:2637},
      {date:'2020-05-04',val:2774},
      {date:'2020-05-11',val:2923},
      {date:'2020-05-18',val:3027},
      {date:'2020-05-25',val:3105},
      {date:'2020-06-01',val:3222},
      {date:'2020-06-08',val:3239},
      {date:'2020-06-15',val:3230},
      {date:'2020-06-22',val:3267},
      {date:'2020-06-29',val:3223},
      {date:'2020-07-06',val:3308},
      {date:'2020-07-13',val:3277},
      {date:'2020-07-20',val:3320},
      {date:'2020-07-27',val:3370},
      {date:'2020-08-03',val:3395},
      {date:'2020-08-10',val:3391},
      {date:'2020-08-18',val:3385},
      {date:'2020-08-25',val:3387},
      {date:'2020-09-01',val:3384},
      {date:'2020-09-08',val:3280},
      {date:'2020-09-15',val:3268},
      {date:'2020-09-24',val:3228},
      {date:'2020-10-01',val:3271},
      {date:'2020-10-08',val:3291},
      {date:'2020-10-15',val:3326},
      {date:'2020-10-22',val:3357},
      {date:'2020-10-29',val:3378},
      {date:'2020-11-05',val:3434},
      {date:'2020-11-12',val:3490},
      {date:'2020-11-19',val:3574},
      {date:'2020-11-26',val:3611},
      {date:'2020-12-03',val:3649},
      {date:'2020-12-10',val:3710},
      {date:'2020-12-17',val:3695},
      {date:'2020-12-24',val:3710},
      {date:'2020-12-31',val:3744},
      {date:'2021-01-07',val:3812},
      {date:'2021-01-14',val:3778},
      {date:'2021-01-21',val:3785},
      {date:'2021-01-28',val:3842},
      {date:'2021-02-04',val:3787},
      {date:'2021-02-11',val:3873},
      {date:'2021-02-18',val:3917},
      {date:'2021-02-25',val:3983},
      {date:'2021-03-04',val:4006},
      {date:'2021-03-11',val:4023},
      {date:'2021-03-18',val:4049},
      {date:'2021-03-25',val:4079},
      {date:'2021-04-01',val:4093},
      {date:'2021-04-08',val:4133},
      {date:'2021-04-15',val:4158},
      {date:'2021-04-22',val:4174},
      {date:'2021-04-29',val:4200},
      {date:'2021-05-06',val:4244},
      {date:'2021-05-13',val:4203},
      {date:'2021-05-20',val:4229},
      {date:'2021-05-27',val:4246},
      {date:'2021-06-03',val:4243},
      {date:'2021-06-10',val:4241},
      {date:'2021-06-17',val:4280},
      {date:'2021-06-24',val:4366},
      {date:'2021-07-01',val:4351},
      {date:'2021-07-08',val:4307},
      {date:'2021-07-15',val:4405},
      {date:'2021-07-22',val:4444},
      {date:'2021-07-29',val:4454},
      {date:'2021-08-05',val:4453},
      {date:'2021-08-12',val:4480},
      {date:'2021-08-19',val:4556},
      {date:'2021-08-26',val:4569},
      {date:'2021-09-02',val:4551},
      {date:'2021-09-09',val:4538},
      {date:'2021-09-16',val:4516},
      {date:'2021-09-23',val:4544},
      {date:'2021-09-30',val:4511},
      {date:'2021-10-07',val:4548},
      {date:'2021-10-18',val:4467},
      {date:'2021-10-25',val:4501},
      {date:'2021-11-01',val:4518},
      {date:'2021-11-08',val:4527},
      {date:'2021-11-15',val:4578},
      {date:'2021-11-22',val:4596},
      {date:'2021-11-29',val:4676},
      {date:'2021-12-06',val:4682},
      {date:'2021-12-13',val:4711},
      {date:'2021-12-20',val:4729},
      {date:'2021-12-27',val:4722},
      {date:'2022-01-03',val:4795},
      {date:'2022-01-10',val:4752},
      {date:'2022-01-17',val:4711},
      {date:'2022-01-24',val:4586},
      {date:'2022-01-31',val:4528},
      {date:'2022-02-07',val:4398},
      {date:'2022-02-14',val:4350},
      {date:'2022-02-21',val:4269},
      {date:'2022-02-28',val:4201},
      {date:'2022-03-08',val:4173},
      {date:'2022-03-15',val:4137},
      {date:'2022-03-22',val:4161},
      {date:'2022-03-29',val:4158},
      {date:'2022-04-05',val:4078},
      {date:'2022-04-12',val:4025},
      {date:'2022-04-19',val:3989},
      {date:'2022-04-26',val:3925},
      {date:'2022-05-03',val:3886},
      {date:'2022-05-10',val:3821},
      {date:'2022-05-17',val:3760},
      {date:'2022-05-24',val:3785},
      {date:'2022-05-31',val:3694},
      {date:'2022-06-07',val:3708},
      {date:'2022-06-16',val:3655},
      {date:'2022-06-23',val:3734},
      {date:'2022-06-30',val:3785},
      {date:'2022-07-07',val:3885},
      {date:'2022-07-14',val:4001},
      {date:'2022-07-21',val:4122},
      {date:'2022-07-28',val:4203},
      {date:'2022-08-04',val:4310},
      {date:'2022-08-16',val:4312},
      {date:'2022-08-23',val:4271},
      {date:'2022-08-30',val:4196},
      {date:'2022-09-06',val:4113},
      {date:'2022-09-13',val:3955},
      {date:'2022-09-20',val:3785},
      {date:'2022-09-27',val:3676},
      {date:'2022-10-04',val:3625},
      {date:'2022-10-12',val:3555},
      {date:'2022-10-19',val:3605},
      {date:'2022-10-26',val:3602},
      {date:'2022-11-02',val:3623},
      {date:'2022-11-09',val:3673},
      {date:'2022-11-16',val:3723},
      {date:'2022-11-23',val:3722},
      {date:'2022-11-30',val:3773},
      {date:'2022-12-07',val:3857},
      {date:'2022-12-14',val:3909},
      {date:'2022-12-21',val:3981},
      {date:'2022-12-28',val:4026},
      {date:'2023-01-04',val:4021},
      {date:'2023-01-11',val:4013},
      {date:'2023-01-18',val:4091},
      {date:'2023-01-25',val:4152},
      {date:'2023-02-02',val:4171},
      {date:'2023-02-09',val:4102},
      {date:'2023-02-16',val:4157},
      {date:'2023-02-23',val:4128},
      {date:'2023-03-02',val:4132},
      {date:'2023-03-09',val:4097},
      {date:'2023-03-16',val:4149},
      {date:'2023-03-23',val:4178},
      {date:'2023-03-30',val:4179},
      {date:'2023-04-06',val:4155},
      {date:'2023-04-13',val:4160},
      {date:'2023-04-20',val:4180},
      {date:'2023-05-01',val:4198},
      {date:'2023-05-08',val:4149},
      {date:'2023-05-15',val:4201},
      {date:'2023-05-22',val:4266},
      {date:'2023-05-29',val:4271},
      {date:'2023-06-05',val:4326},
      {date:'2023-06-12',val:4375},
      {date:'2023-06-19',val:4414},
      {date:'2023-06-26',val:4437},
      {date:'2023-07-03',val:4552},
      {date:'2023-07-10',val:4540},
      {date:'2023-07-17',val:4627},
      {date:'2023-07-27',val:4623},
      {date:'2023-08-03',val:4545},
      {date:'2023-08-10',val:4487},
      {date:'2023-08-17',val:4552},
      {date:'2023-08-24',val:4432},
      {date:'2023-08-31',val:4522},
      {date:'2023-09-07',val:4346},
      {date:'2023-09-14',val:4300},
      {date:'2023-09-21',val:4280},
      {date:'2023-09-28',val:4212},
      {date:'2023-10-05',val:4168},
      {date:'2023-10-12',val:4195},
      {date:'2023-10-19',val:4185},
      {date:'2023-10-27',val:4144},
      {date:'2023-11-03',val:4099},
      {date:'2023-11-10',val:4180},
      {date:'2023-11-17',val:4242},
      {date:'2023-11-24',val:4304},
      {date:'2023-12-01',val:4428},
      {date:'2023-12-08',val:4483},
      {date:'2023-12-15',val:4525},
      {date:'2023-12-22',val:4603},
      {date:'2023-12-29',val:4750},
      {date:'2024-01-05',val:4850},
      {date:'2024-01-12',val:4800},
      {date:'2024-01-19',val:4802},
      {date:'2024-01-26',val:4913},
      {date:'2024-02-02',val:4898},
      {date:'2024-02-09',val:4955},
      {date:'2024-02-16',val:5061},
      {date:'2024-02-23',val:5083},
      {date:'2024-03-01',val:5142},
      {date:'2024-03-08',val:5119},
      {date:'2024-03-15',val:5271},
      {date:'2024-03-28',val:5232},
      {date:'2024-04-04',val:5322},
      {date:'2024-04-11',val:5292},
      {date:'2024-04-18',val:5240},
      {date:'2024-04-25',val:5380},
      {date:'2024-05-02',val:5356},
      {date:'2024-05-09',val:5453},
      {date:'2024-05-16',val:5481},
      {date:'2024-05-23',val:5479},
      {date:'2024-05-30',val:5481},
      {date:'2024-06-06',val:5584},
      {date:'2024-06-13',val:5611},
      {date:'2024-06-20',val:5594},
      {date:'2024-06-27',val:5642},
      {date:'2024-07-04',val:5685},
      {date:'2024-07-16',val:5665},
      {date:'2024-07-23',val:5424},
      {date:'2024-08-05',val:5204},
      {date:'2024-08-12',val:5195},
      {date:'2024-08-19',val:5154},
      {date:'2024-08-26',val:5264},
      {date:'2024-09-02',val:5355},
      {date:'2024-09-09',val:5421},
      {date:'2024-09-16',val:5420},
      {date:'2024-09-23',val:5557},
      {date:'2024-09-30',val:5739},
      {date:'2024-10-07',val:5692},
      {date:'2024-10-14',val:5730},
      {date:'2024-10-21',val:5790},
      {date:'2024-10-28',val:5915},
      {date:'2024-11-04',val:5923},
      {date:'2024-11-11',val:5961},
      {date:'2024-11-18',val:6045},
      {date:'2024-11-29',val:6062},
      {date:'2024-12-06',val:6069},
      {date:'2024-12-13',val:6077},
      {date:'2024-12-20',val:6006},
      {date:'2024-12-27',val:6024},
      {date:'2025-01-03',val:6123},
      {date:'2025-01-10',val:6111},
      {date:'2025-01-17',val:6111},
      {date:'2025-01-24',val:6057},
      {date:'2025-01-31',val:6082},
      {date:'2025-02-07',val:6192},
      {date:'2025-02-19',val:6068},
      {date:'2025-02-26',val:6089},
      {date:'2025-03-05',val:5850},
      {date:'2025-03-12',val:5558},
      {date:'2025-03-19',val:5265},
      {date:'2025-03-26',val:5072},
      {date:'2025-04-07',val:5010},
      {date:'2025-04-14',val:5111},
      {date:'2025-04-21',val:5170},
      {date:'2025-04-28',val:5313},
      {date:'2025-05-05',val:5586},
      {date:'2025-05-12',val:5761},
      {date:'2025-05-19',val:5843},
      {date:'2025-06-01',val:5875},
      {date:'2025-06-08',val:5844},
      {date:'2025-06-15',val:5879},
      {date:'2025-06-22',val:5915},
      {date:'2025-06-29',val:5908},
      {date:'2025-07-06',val:5973},
      {date:'2025-07-13',val:5906},
      {date:'2025-07-20',val:5880},
      {date:'2025-07-27',val:5924},
      {date:'2025-08-03',val:5943},
      {date:'2025-08-10',val:5899},
      {date:'2025-08-17',val:5880},
      {date:'2025-08-24',val:5928},
      {date:'2025-08-31',val:5851},
      {date:'2025-09-07',val:5900},
      {date:'2025-09-14',val:5901},
      {date:'2025-09-21',val:5871},
      {date:'2025-09-28',val:5942},
      {date:'2025-10-05',val:5803},
      {date:'2025-10-12',val:5918},
      {date:'2025-10-19',val:5805},
      {date:'2025-10-26',val:5864},
      {date:'2025-11-02',val:5785},
      {date:'2025-11-09',val:5783},
      {date:'2025-11-16',val:5791},
      {date:'2025-11-23',val:5881},
      {date:'2025-11-30',val:5810},
      {date:'2025-12-07',val:5759},
      {date:'2025-12-14',val:5794},
      {date:'2025-12-21',val:5842},
      {date:'2025-12-28',val:5770},
      {date:'2026-01-04',val:5864},
      {date:'2026-01-11',val:5814},
      {date:'2026-01-18',val:5793},
      {date:'2026-01-25',val:5821},
      {date:'2026-02-01',val:5850},
      {date:'2026-02-08',val:5815},
      {date:'2026-02-15',val:5850}
    ];
    const cutoff = fmt(startDate);
    const filtered = staticSP500.filter(d => d.date >= cutoff);
    const result2 = filtered.length >= 2 ? filtered : staticSP500.slice(-6);
    overlayCache.sp500[tf] = result2;
    return result2;
  }
}

// ── PRELOAD: fetch overlay data di background saat app start ──
async function _preloadOverlayData() {
  // Urutan TF yang paling sering dipakai (preload 1W dan curTF dulu)
  const tfsToPreload = ['1W', '10Y', '5Y', '1Y', '3Y', '1M'];

  // Preload semua overlay secara paralel, dengan delay kecil agar tidak blokir
  // fetch BTC utama
  await new Promise(r => setTimeout(r, 1500)); // tunggu BTC chart selesai dulu

  const fetchFns = {
    gold:  fetchGoldData,
    sp500: fetchSP500Data,
    m2:    fetchM2Data,
  };

  // Preload TF saat ini dulu (paling relevan)
  const curTFs = [curTF, ...tfsToPreload.filter(t => t !== curTF)];

  for (const tf of curTFs) {
    // Fetch semua 3 overlay untuk TF ini secara paralel
    await Promise.allSettled([
      fetchFns.gold(tf).catch(()=>{}),
      fetchFns.sp500(tf).catch(()=>{}),
      fetchFns.m2(tf).catch(()=>{}),
    ]);
    // Jeda singkat antar TF agar tidak flood network
    await new Promise(r => setTimeout(r, 300));
  }
  // Preload complete
}

// Background fetch helpers — update cache without blocking UI
async function _bgFetchGold(tf) {
  try { const d = await fetchGoldData(tf); overlayCache.gold[tf] = d; } catch(e) {}
}
async function _bgFetchSP500(tf) {
  try { const d = await fetchSP500Data(tf); overlayCache.sp500[tf] = d; } catch(e) {}
}

function toggleOverlay(key) {
  overlayEnabled[key] = !overlayEnabled[key];
  const on = overlayEnabled[key];
  const colors = {
    m2:    {on:'rgba(245,158,11,.2)',  onBorder:'rgba(245,158,11,.6)',  onColor:'#f59e0b',  off:'rgba(245,158,11,.08)',  offBorder:'rgba(245,158,11,.25)',  offColor:'rgba(245,158,11,.6)',  dotOn:'#f59e0b',  dotOff:'rgba(245,158,11,.5)'},
    gold:  {on:'rgba(251,191,36,.2)',  onBorder:'rgba(251,191,36,.6)',  onColor:'#fbbf24',  off:'rgba(251,191,36,.08)',  offBorder:'rgba(251,191,36,.25)',  offColor:'rgba(251,191,36,.6)',  dotOn:'#fbbf24',  dotOff:'rgba(251,191,36,.5)'},
    sp500: {on:'rgba(139,92,246,.2)',  onBorder:'rgba(139,92,246,.6)',  onColor:'#8b5cf6',  off:'rgba(139,92,246,.08)',  offBorder:'rgba(139,92,246,.25)',  offColor:'rgba(139,92,246,.6)',  dotOn:'#8b5cf6',  dotOff:'rgba(139,92,246,.5)'},
  };
  const c = colors[key];
  const btn = document.getElementById(key+'-toggle-btn');
  const dot = document.getElementById(key+'-dot');
  if (btn) {
    btn.style.background = on ? c.on : c.off;
    btn.style.borderColor = on ? c.onBorder : c.offBorder;
    btn.style.color = on ? c.onColor : c.offColor;
  }
  if (dot) dot.style.background = on ? c.dotOn : c.dotOff;
  // Update legend
  const anyOn = Object.values(overlayEnabled).some(Boolean);
  const legend = document.getElementById('overlay-legend');
  if (legend) legend.style.display = anyOn ? 'flex' : 'none';
  const legEl = document.getElementById('leg-'+key);
  if (legEl) legEl.style.display = on ? 'flex' : 'none';
  // Jika overlay di-enable dan data sudah di-cache → render langsung (instant)
  // Jika belum di-cache → loadBTCChart akan fetch sambil showing loading
  loadBTCChart(curTF);
}

function updateBTCLiveDisplay(){
  const p=S.btcPrice||0, ch=S.btcChange||0, r=S.usdIdr||16000;
  const isUp=ch>=0;
  const safe=(id,fn)=>{const e=document.getElementById(id);if(e)fn(e)};
  safe('btcc-price',e=>e.textContent='$'+p.toLocaleString('en-US',{maximumFractionDigits:0}));
  safe('btcc-idr',e=>e.textContent='≈ '+new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(p*r));
  safe('btcc-badge',e=>{
    e.textContent=(isUp?'▲ +':'▼ ')+ch.toFixed(2)+'% (24h)';
    e.className='btc-change-badge '+(isUp?'up':'dn');
  });
}

function updateDCABTCDisplay(){
  const p=S.btcPrice||0,ch=S.btcChange||0,r=S.usdIdr||16000;
  const isUp=ch>=0;
  const safe=(id,fn)=>{const e=document.getElementById(id);if(e)fn(e)};
  safe('dca-btcc-price',e=>e.textContent='$'+p.toLocaleString('en-US',{maximumFractionDigits:0}));
  safe('dca-btcc-idr',e=>e.textContent='≈ '+new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(p*r));
  safe('dca-btcc-badge',e=>{
    e.textContent=(isUp?'▲ +':'▼ ')+ch.toFixed(2)+'% (24h)';
    e.className='btc-change-badge '+(isUp?'up':'dn');
  });
}

function updateChartsInPlace(){
  const p=S.btcPrice,r=S.usdIdr;
  if(cDCA?.data){
    const sorted=[...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(sorted.length){cDCA.data.datasets[0].data=sorted.map(e=>Math.round(e.btcAmount*p*r/1e3));cDCA.update('none')}
  }
  if(cPNL?.data){
    let cb=0,ci=0;const pd=[],id2=[];
    [...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date)).forEach(e=>{
      cb+=e.btcAmount;ci+=e.amountIDR;
      pd.push(Math.round(cb*p*r/1e6));id2.push(Math.round(ci/1e6));
    });
    if(pd.length){cPNL.data.datasets[0].data=pd;cPNL.data.datasets[1].data=id2;cPNL.update('none')}
  }
  // refresh stat numbers on visible pages
  const ap=document.querySelector('.page.active');
  if(ap?.id==='page-dashboard')refreshDashStats();
  if(ap?.id==='page-dca'){refreshDCAStats();updateDCABTCDisplay();if(cDCABTCLive)cDCABTCLive.update('none');}
}

/* ══════════ CHARTS ══════════ */
let cAlloc=null,cPNL=null,cDCA=null,cSim=null,cCF=null;
let cDCABTCLive=null,curDCATF='1W';

async function loadDCABTCChart(tf){
  curDCATF=tf;
  document.querySelectorAll('#dca-tf-btns .tf-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.tf===tf);
  });
  const cfg=TF_CONFIG[tf];
  if(!cfg){console.warn('loadDCABTCChart: unknown tf',tf);return;}
  const loading=document.getElementById('dca-btcc-loading');
  const safe=(id,fn)=>{const e=document.getElementById(id);if(e)fn(e)};
  if(loading){loading.style.display='flex';loading.innerHTML='<div style="width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div><span>Memuat...</span>';}
  try{
    const prices=await fetchChartData(cfg);
    const labels=prices.map(p=>cfg.fmt(p[0]));
    const vals=prices.map(p=>p[1]);
    const isUp=vals[vals.length-1]>=vals[0];
    const color=isUp?'#10b981':'#ef4444';
    const colorBg=isUp?'rgba(16,185,129,':'rgba(239,68,68,';
    const hi=Math.max(...vals),lo=Math.min(...vals);
    const op=vals[0],cl=vals[vals.length-1];
    safe('dca-btcc-open',e=>e.textContent='$'+op.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('dca-btcc-high',e=>e.textContent='$'+hi.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('dca-btcc-low',e=>e.textContent='$'+lo.toLocaleString('en-US',{maximumFractionDigits:0}));
    safe('dca-btcc-close',e=>e.textContent='$'+cl.toLocaleString('en-US',{maximumFractionDigits:0}));
    // Avg buy price — sama persis dengan refreshDCAStats: totalIDR / totalBTC / kurs
    const r=S.usdIdr||16000;
    const totalBTC=S.dca.reduce((s,e)=>s+e.btcAmount,0);
    const totalIDR=S.dca.reduce((s,e)=>s+e.amountIDR,0);
    const avgUSD=totalBTC>0?totalIDR/totalBTC/r:0;
    const avgLegend=document.getElementById('dca-avg-legend');
    if(avgUSD>0){
      if(avgLegend)avgLegend.style.display='flex';
      safe('dca-avg-val-legend',e=>e.textContent='$'+avgUSD.toLocaleString('en-US',{maximumFractionDigits:0}));
      const gap=((cl-avgUSD)/avgUSD*100);
      const gapUp=gap>=0;
      safe('dca-avg-gap-badge',e=>{
        e.textContent=(gapUp?'▲ +':'▼ ')+gap.toFixed(2)+'% dari avg buy';
        e.style.color=gapUp?'#10b981':'#ef4444';
        e.style.background=gapUp?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)';
        e.style.border=`1px solid ${gapUp?'rgba(16,185,129,.3)':'rgba(239,68,68,.3)'}`;
      });
      safe('dca-btcc-vs-avg',e=>{
        e.textContent=(gapUp?'+':'')+gap.toFixed(2)+'%';
        e.style.color=gapUp?'#10b981':'#ef4444';
      });
    }else{
      if(avgLegend)avgLegend.style.display='none';
    }
    if(cDCABTCLive){cDCABTCLive.destroy();cDCABTCLive=null;['dca-label-current','dca-label-avg','dca-label-pnl'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});const tags=document.getElementById('dca-buysell-tags');if(tags)tags.innerHTML='';}
    const ctx=document.getElementById('c-dca-btclive');
    if(!ctx){if(loading)loading.style.display='none';return;}
    const datasets=[{
      label:'BTC/USD',
      data:vals,
      borderColor:color,
      borderWidth:2,
      pointRadius:0,
      pointHoverRadius:4,
      pointHoverBackgroundColor:color,
      fill:true,
      backgroundColor:(ctx2)=>{
        const g=ctx2.chart.ctx.createLinearGradient(0,0,0,ctx2.chart.height);
        g.addColorStop(0,colorBg+'0.25)');
        g.addColorStop(1,colorBg+'0.01)');
        return g;
      },
      tension:.35,
    }];
    // Add individual entry lines
    if(S.dca.length){
      S.dca.forEach((e,i)=>{
        const entryPrice=e.priceUSD;
        if(entryPrice>=lo*0.98&&entryPrice<=hi*1.02){
          datasets.push({
            label:`Entry #${i+1} $${Math.round(entryPrice).toLocaleString('en-US')}`,
            data:vals.map(()=>entryPrice),
            borderColor:'rgba(245,158,11,0.25)',
            borderWidth:1,
            borderDash:[3,4],
            pointRadius:0,
            fill:false,
            tension:0,
          });
        }
      });
      // Main avg line
      if(avgUSD>0){
        datasets.push({
          label:'Avg Buy $'+Math.round(avgUSD).toLocaleString('en-US'),
          data:vals.map(()=>avgUSD),
          borderColor:'#f59e0b',
          borderWidth:2,
          borderDash:[8,4],
          pointRadius:0,
          fill:false,
          tension:0,
        });
      }
    }
    cDCABTCLive=new Chart(ctx.getContext('2d'),{
      type:'line',
      data:{labels,datasets},
      options:{
        animation:false,
        responsive:true,
        maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{
            display:avgUSD>0,
            labels:{
              filter:item=>item.datasetIndex===0||(avgUSD>0&&item.text&&item.text.startsWith('Avg')),
              color:'#64748b',
              font:{size:9,family:'Space Mono'},
              boxWidth:16,
              boxHeight:2,
              padding:12,
            }
          },
          tooltip:{
            backgroundColor:'rgba(11,17,32,.97)',
            borderColor:color,
            borderWidth:1,
            titleColor:'#94a3b8',
            titleFont:{family:'Space Mono',size:10},
            bodyColor:color,
            bodyFont:{family:'Space Mono',size:13,weight:'bold'},
            padding:10,
            callbacks:{
              label:ctx2=>{
                if(ctx2.datasetIndex===0){
                  const price=ctx2.parsed.y;
                  const retPct=((price-vals[0])/vals[0]*100);
                  const retSign=retPct>=0?'+':'';
                  return[` $${price.toLocaleString('en-US',{maximumFractionDigits:0})}`,`  ${retSign}${retPct.toFixed(2)}% vs awal`];
                }
                if(avgUSD>0&&ctx2.dataset.label&&ctx2.dataset.label.startsWith('Avg')){
                  const price=ctx2.parsed.y;
                  const diff=((vals[ctx2.dataIndex]-price)/price*100);
                  const sign=diff>=0?'+':'';
                  return[` Avg Buy: $${price.toLocaleString('en-US',{maximumFractionDigits:0})}`,`  Harga Kini ${sign}${diff.toFixed(2)}% dari avg`];
                }
                return null;
              },
              labelColor:(ctx2)=>{
                if(ctx2.datasetIndex===0){const r=((ctx2.parsed.y-vals[0])/vals[0]*100);const c=r>=0?'#10b981':'#ef4444';return{borderColor:c,backgroundColor:c,borderWidth:2,borderRadius:3};}
                if(ctx2.dataset.label&&ctx2.dataset.label.startsWith('Avg')) return{borderColor:'#f59e0b',backgroundColor:'#f59e0b',borderWidth:2,borderRadius:3};
                return null;
              }
            }
          }
        },
        scales:{
          x:{ticks:{color:'#475569',font:{size:9},maxTicksLimit:8,maxRotation:0},grid:{color:'rgba(255,255,255,0.03)'},border:{display:false}},
          y:{position:'right',ticks:{color:'#475569',font:{size:9},callback:v=>'$'+v.toLocaleString('en-US',{maximumFractionDigits:0,notation:'compact'})},grid:{color:'rgba(255,255,255,0.03)'},border:{display:false}}
        }
      },
      plugins:[{
        id:'dcaPriceLabels',
        afterDraw(chart){
          const yScale=chart.scales.y;
          if(!yScale)return;
          const chartArea=chart.chartArea;
          // Current price label
          const curEl=document.getElementById('dca-label-current');
          const curValEl=document.getElementById('dca-label-current-val');
          if(curEl&&curValEl&&cl){
            const yPx=yScale.getPixelForValue(cl);
            const inRange=yPx>=chartArea.top&&yPx<=chartArea.bottom;
            curEl.style.display=inRange?'block':'none';
            curEl.style.top=yPx+'px';
            const priceColor=isUp?'#10b981':'#ef4444';
            const priceBg=isUp?'rgba(16,185,129,.18)':'rgba(239,68,68,.18)';
            const priceBorder=isUp?'rgba(16,185,129,.45)':'rgba(239,68,68,.45)';
            const lineEl=document.getElementById('dca-label-current-line');
            if(lineEl)lineEl.style.background=priceColor;
            curValEl.style.color=priceColor;
            curValEl.style.background=priceBg;
            curValEl.style.borderColor=priceBorder;
            curValEl.textContent='$'+cl.toLocaleString('en-US',{maximumFractionDigits:0});
          }
          // Avg buy label
          const avgEl=document.getElementById('dca-label-avg');
          const avgValEl=document.getElementById('dca-label-avg-val');
          if(avgEl&&avgValEl&&avgUSD>0){
            const yPx=yScale.getPixelForValue(avgUSD);
            const inRange=yPx>=chartArea.top&&yPx<=chartArea.bottom;
            avgEl.style.display=inRange?'block':'none';
            avgEl.style.top=yPx+'px';
            avgValEl.textContent='$'+avgUSD.toLocaleString('en-US',{maximumFractionDigits:0});
          }else if(avgEl){avgEl.style.display='none';}
          // PnL badge — between current price and avg, only if gap is big enough
          const pnlEl=document.getElementById('dca-label-pnl');
          const pnlValEl=document.getElementById('dca-label-pnl-val');
          if(pnlEl&&pnlValEl&&avgUSD>0&&cl){
            const yCur=yScale.getPixelForValue(cl);
            const yAvg=yScale.getPixelForValue(avgUSD);
            const midY=(yCur+yAvg)/2;
            const gapPx=Math.abs(yCur-yAvg);
            const inRange=midY>=chartArea.top&&midY<=chartArea.bottom&&gapPx>22;
            pnlEl.style.display=inRange?'block':'none';
            pnlEl.style.top=midY+'px';
            const gap=((cl-avgUSD)/avgUSD*100);
            const gapUp=gap>=0;
            pnlValEl.textContent=(gapUp?'+':'')+gap.toFixed(1)+'%';
            pnlValEl.style.color=gapUp?'rgba(16,185,129,.95)':'rgba(239,68,68,.95)';
            pnlValEl.style.background=gapUp?'rgba(16,185,129,.12)':'rgba(239,68,68,.12)';
            pnlValEl.style.borderColor=gapUp?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)';
          }else if(pnlEl){pnlEl.style.display='none';}

          // ── BUY tags (Bybit style) - posisi tepat berdasarkan waktu + harga ──
          const tagsContainer = document.getElementById('dca-buysell-tags');
          if(tagsContainer && S.dca.length){
            tagsContainer.innerHTML = '';
            const xScale = chart.scales.x;
            const timestamps = prices.map(p => p[0]); // unix seconds

            S.dca.forEach(entry => {
              if(!entry.date || !entry.priceUSD) return;
              const entryTs = Math.floor(new Date(entry.date).getTime() / 1000);

              // Cari index chart terdekat dengan tanggal entry
              let closestIdx = 0;
              let minDiff = Infinity;
              timestamps.forEach((ts, i) => {
                const diff = Math.abs(ts - entryTs);
                if(diff < minDiff){ minDiff = diff; closestIdx = i; }
              });

              // Cek apakah entry ada dalam range timeframe chart ini
              const chartStart = timestamps[0];
              const chartEnd = timestamps[timestamps.length - 1];
              if(entryTs < chartStart - (chartEnd - chartStart) * 0.05) return; // di luar range

              // Hitung koordinat X dan Y piksel
              const xPx = xScale.getPixelForValue(closestIdx);
              const yPx = yScale.getPixelForValue(entry.priceUSD);

              // Cek apakah dalam area chart
              if(xPx < chartArea.left || xPx > chartArea.right) return;
              if(yPx < chartArea.top || yPx > chartArea.bottom) return;

              const tag = document.createElement('div');
              tag.style.cssText = `
                position:absolute;
                left:${xPx}px;
                top:${yPx}px;
                transform:translate(-50%, -160%);
                background:rgba(16,185,129,0.95);
                color:#fff;
                font-family:'Space Mono',monospace;
                font-size:.5rem;
                font-weight:800;
                padding:.16rem .38rem;
                border-radius:4px 4px 4px 4px;
                letter-spacing:.05em;
                box-shadow:0 2px 8px rgba(16,185,129,.55),inset 0 1px 0 rgba(255,255,255,.2);
                line-height:1.4;
                white-space:nowrap;
                z-index:20;
              `;
              tag.textContent = 'B';

              // Panah kecil di bawah tag menunjuk ke bawah (ke titik harga)
              const arrow = document.createElement('div');
              arrow.style.cssText = `
                position:absolute;
                left:50%;
                bottom:-5px;
                transform:translateX(-50%);
                width:0;height:0;
                border-left:4px solid transparent;
                border-right:4px solid transparent;
                border-top:5px solid rgba(16,185,129,0.95);
              `;
              tag.appendChild(arrow);
              tagsContainer.appendChild(tag);
            });
          }
        }
      }]
    });
    if(!avgUSD){['dca-label-avg','dca-label-pnl'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display='none';});}
  }catch(e){
    console.warn('DCA BTC chart error:',e);
    if(loading){loading.innerHTML=`<div style="text-align:center"><div style="color:var(--muted);font-size:.78rem;margin-bottom:.5rem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal memuat data</div><button onclick="loadDCABTCChart('${tf}')" style="background:var(--accent);color:var(--bg);border:none;border-radius:6px;padding:.3rem .8rem;font-size:.72rem;cursor:pointer;font-family:'Inter',sans-serif;font-weight:700">↺ Coba Lagi</button></div>`;loading.style.display='flex';}
    return;
  }
  if(loading)loading.style.display='none';
}
const CO={animation:false,responsive:true,maintainAspectRatio:false};
const TK={color:'#64748b',font:{size:10}};
const getGR=()=>({color:document.documentElement.getAttribute('data-theme')==='light'?'rgba(0,0,0,0.06)':'rgba(255,255,255,0.03)'});
const LG={
  color:'#94a3b8',
  font:{family:'Inter',size:11},
  boxWidth:12,
  boxHeight:12,
  useBorderRadius:true,
  borderRadius:4,
  padding:10
};

function mkLineChart(id,labels,datasets){
  const GR=getGR();
  const ctx=document.getElementById(id).getContext('2d');
  return new Chart(ctx,{type:'line',data:{labels,datasets},
    options:{...CO,plugins:{legend:{labels:LG}},scales:{x:{ticks:TK,grid:GR},y:{ticks:{...TK,callback:v=>'Rp'+v+'jt'},grid:GR}}}});
}
function mkBarChart(id,labels,datasets){
  const GR=getGR();
  const ctx=document.getElementById(id).getContext('2d');
  return new Chart(ctx,{type:'bar',data:{labels,datasets},
    options:{...CO,plugins:{legend:{labels:LG}},scales:{x:{ticks:TK,grid:GR},y:{ticks:TK,grid:GR}}}});
}

/* ══════════ FEAR & GREED INDEX ══════════ */
function fngColor(v){
  if(v<=24) return '#ef4444';
  if(v<=44) return '#f97316';
  if(v<=55) return '#eab308';
  if(v<=74) return '#84cc16';
  return '#22c55e';
}
function fngLabel(v){
  if(v<=24) return 'EXTREME FEAR';
  if(v<=44) return 'FEAR';
  if(v<=55) return 'NEUTRAL';
  if(v<=74) return 'GREED';
  return 'EXTREME GREED';
}

function drawFngGauge(value){
  const canvas = document.getElementById('c-fng-gauge');
  if(!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const W = 260, H = 148;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H - 22;
  const R  = 96;
  const SW = 18; // stroke width (thicker = more glass-like)

  // ── 1. Outer glow track (shadow behind arc) ──
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 2*Math.PI);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = SW + 8;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // ── 2. Track base (dark glass base) ──
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 2*Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = SW + 2;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // ── 3. Colored zone segments ──
  const colors = ['#ef4444','#f97316','#eab308','#84cc16','#22c55e'];
  const stops  = [0, 25, 45, 55, 75, 100];
  for(let i = 0; i < stops.length-1; i++){
    const aS = Math.PI + (stops[i]/100)*Math.PI;
    const aE = Math.PI + (stops[i+1]/100)*Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, R, aS, aE);
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = SW;
    ctx.lineCap = 'butt';
    // subtle glow per segment
    ctx.shadowColor = colors[i];
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── 4. Glass shimmer highlight (top edge of arc = light reflection) ──
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 2*Math.PI);
  const shineGrad = ctx.createLinearGradient(cx - R, cy, cx + R, cy - R);
  shineGrad.addColorStop(0,   'rgba(255,255,255,0)');
  shineGrad.addColorStop(0.3, 'rgba(255,255,255,.28)');
  shineGrad.addColorStop(0.5, 'rgba(255,255,255,.15)');
  shineGrad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.strokeStyle = shineGrad;
  ctx.lineWidth = SW * 0.45;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // ── 5. Inner shadow line (bottom edge of arc = depth) ──
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI, 2*Math.PI);
  ctx.strokeStyle = 'rgba(0,0,0,.3)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'butt';
  // offset inward
  ctx.save();
  ctx.arc(cx, cy, R - SW/2 + 1, Math.PI, 2*Math.PI);
  ctx.strokeStyle = 'rgba(0,0,0,.25)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // ── 6. Needle glow tip ──
  const needleAngle = Math.PI + (value/100)*Math.PI;
  const needleLen = R - 5;
  const tipX = cx + (R - SW/2) * Math.cos(needleAngle);
  const tipY = cy + (R - SW/2) * Math.sin(needleAngle);

  ctx.beginPath();
  ctx.arc(tipX, tipY, 9, 0, 2*Math.PI);
  ctx.fillStyle = fngColor(value);
  ctx.shadowColor = fngColor(value);
  ctx.shadowBlur = 22;
  ctx.fill();
  ctx.shadowBlur = 0;

  // inner white core on tip
  ctx.beginPath();
  ctx.arc(tipX, tipY, 4, 0, 2*Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fill();

  // ── 7. Needle line ──
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + needleLen*Math.cos(needleAngle), cy + needleLen*Math.sin(needleAngle));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,.7)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── 8. Center hub (glass ball) ──
  const hubGrad = ctx.createRadialGradient(cx-2, cy-2, 1, cx, cy, 8);
  hubGrad.addColorStop(0, 'rgba(255,255,255,.95)');
  hubGrad.addColorStop(1, 'rgba(200,210,230,.6)');
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, 2*Math.PI);
  ctx.fillStyle = hubGrad;
  ctx.shadowColor = 'rgba(255,255,255,.5)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // ── 9. Min/Max labels ──
  ctx.font = `700 10px 'Space Mono', monospace`;
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  ctx.textAlign = 'center';
  ctx.fillText('0',   cx - R - 2, cy + 18);
  ctx.fillText('100', cx + R + 4, cy + 18);
}

async function fetchFearGreed(){
  // Coba CMC Fear & Greed dulu (lebih akurat, sesuai tools lain)
  // Kemudian fallback ke alternative.me
  let data = null;

  // Source 1: CoinMarketCap (via cdn.jsdelivr.net proxy yang CORS-friendly)
  try {
    const ts = Date.now();
    const res = await fetch(`https://api.alternative.me/fng/?limit=32&format=json&_=${ts}`,
      {signal: AbortSignal.timeout(8000), cache:'no-store'});
    const json = await res.json();
    if(json.data && json.data.length) data = json.data;
  } catch(e) { console.warn('FnG source 1 gagal:', e.message); }

  // Source 2: fallback ke endpoint lain
  if(!data) {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=32',
        {signal: AbortSignal.timeout(8000)});
      const json = await res.json();
      if(json.data && json.data.length) data = json.data;
    } catch(e) { console.warn('FnG source 2 gagal:', e.message); }
  }

  if(!data || !data.length) return;

  const cur   = parseInt(data[0].value);
  const yest  = parseInt(data[1]?.value  ?? data[0].value);
  const week  = parseInt(data[7]?.value  ?? data[0].value);
  const month = parseInt(data[30]?.value ?? data[0].value);
  const ts    = data[0].timestamp;

  drawFngGauge(cur);

  const valEl = document.getElementById('fng-value');
  const lblEl = document.getElementById('fng-label');
  if(valEl){ valEl.textContent = cur; valEl.style.color = fngColor(cur); }
  if(lblEl){ lblEl.textContent = fngLabel(cur); lblEl.style.color = fngColor(cur); }

  const setCard = (valId, lblId, v) => {
    const ve = document.getElementById(valId);
    const le = document.getElementById(lblId);
    const c  = fngColor(v);
    if(ve){ ve.textContent = v; ve.style.color = c; }
    if(le){ le.textContent = fngLabel(v); le.style.color = c; }
  };
  setCard('fng-yesterday-val','fng-yesterday-lbl', yest);
  setCard('fng-week-val',     'fng-week-lbl',      week);
  setCard('fng-month-val',    'fng-month-lbl',     month);

  const upEl = document.getElementById('fng-updated');
  if(upEl){
    const d = new Date(parseInt(ts)*1000);
    upEl.textContent = d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}) + ' · alternative.me';
  }
}

/* ══════════ DASHBOARD ══════════ */
function refreshDashStats(){
  const p=S.btcPrice,r=S.usdIdr||16000;
  if(!p) return;
  let ti=0,tb=0;S.dca.forEach(e=>{ti+=e.amountIDR;tb+=e.btcAmount});
  const cv=tb*p*r,pnl=cv-ti,pp=ti>0?pnl/ti*100:0;
  // FIX: exclude aset BTC auto-sync dari DCA agar tidak double count dengan cv
  let ptot=0;S.port.forEach(x=>{ if(!(x.ticker?.toLowerCase()==='btc'&&x._dcaManaged===true)) ptot+=x.qty*x.currentPrice; });
  const q=id=>document.getElementById(id);
  q('d-total').textContent=fmtIDR(cv+ptot);
  q('d-invest').textContent=fmtIDR(ti);
  q('d-pnl').textContent=fmtIDR(Math.abs(pnl));q('d-pnl').className='sval sensitive-val '+(pnl>=0?'pos':'neg');
  q('d-pnl-pct').textContent=fmtPct(pp);q('d-pnl-pct').className='ssub sensitive-val '+(pnl>=0?'pos':'neg');
  q('d-btcamt').textContent=fmtBTC(tb);
  q('d-btcidr').textContent=fmtIDR(cv);
  q('d-entries').textContent=S.dca.length;
  q('d-avg').textContent='Avg: $'+(tb>0?Math.round(ti/tb/r).toLocaleString():0);
}
function renderDash(){
  refreshDashStats();
  const today=new Date().toLocaleDateString('id-ID',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('dash-date').textContent='Terakhir diperbarui: '+today;

  const p=S.btcPrice,r=S.usdIdr;
  // Recent table
  const recent=[...S.dca].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  const tb=document.getElementById('d-recent');
  if(!tb)return;
  if(!recent.length){tb.innerHTML='<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--muted)">Belum ada data. <a href="#" onclick="showPage(\'dca\')" style="color:var(--accent)">Tambah DCA →</a></td></tr>';return}
  tb.innerHTML=recent.map(e=>{
    const cv=e.btcAmount*p*r,pnl=cv-e.amountIDR,pp=pnl/e.amountIDR*100;
    return`<tr><td>${esc(e.date)}</td><td>${fmtUSD(e.priceUSD)}</td><td>${fmtIDR(e.amountIDR)}</td><td style="color:var(--accent4)">${e.btcAmount.toFixed(8)}</td><td>${fmtIDR(cv)}</td><td class="${pnl>=0?'pos':'neg'}">${fmtPct(pp)}</td></tr>`;
  }).join('');

  // Alloc chart — per-aset, tidak double BTC, nama asli masing-masing
  let ti=0,tb2=0;S.dca.forEach(e=>{ti+=e.amountIDR;tb2+=e.btcAmount});
  const dcaVal=tb2*p*r;
  // Palette warna untuk aset non-BTC
  const _allocPalette=['#7c3aed','#06b6d4','#10b981','#f59e0b','#f43f5e','#a78bfa','#34d399','#fb923c'];
  // Build slices: BTC DCA dulu, lalu aset manual (skip yg _dcaManaged BTC)
  const _allocLabels=[], _allocData=[], _allocColors=[];
  if(dcaVal>0){ _allocLabels.push('Bitcoin DCA'); _allocData.push(dcaVal); _allocColors.push('#F7931A'); }
  S.port.filter(x=>!(x.ticker?.toLowerCase()==='btc'&&x._dcaManaged===true)).forEach((x,i)=>{
    const v=x.qty*x.currentPrice;
    if(v>0){ _allocLabels.push(x.name); _allocData.push(v); _allocColors.push(_allocPalette[i%_allocPalette.length]); }
  });
  if(cAlloc)cAlloc.destroy();
  const ctx1=document.getElementById('c-alloc').getContext('2d');
  const hasData=_allocData.length>0;
  cAlloc=new Chart(ctx1,{type:'doughnut',data:{
    labels:hasData?_allocLabels:['Kosong'],
    datasets:[{data:hasData?_allocData:[1],backgroundColor:hasData?_allocColors:['rgba(100,116,139,0.3)'],borderWidth:0,hoverOffset:4}]
  },options:{...CO,cutout:'68%',plugins:{
    legend:{labels:{color:'#94a3b8',font:{family:'Inter',size:12},usePointStyle:true,pointStyle:'rectRounded',pointStyleWidth:18,boxHeight:18}},
    tooltip:{callbacks:{
      label: function(ctx){
        const total=ctx.dataset.data.reduce((a,b)=>a+b,0);
        const val=ctx.parsed;
        const pct=total>0?(val/total*100).toFixed(1):'0';
        const fmt=v=>v>=1e9?'Rp '+(v/1e9).toFixed(2)+'M':v>=1e6?'Rp '+(v/1e6).toFixed(2)+'jt':'Rp '+Math.round(v).toLocaleString('id-ID');
        return ' '+fmt(val)+' ('+pct+'%)';
      }
    }}
  }}}); 

  // PNL chart
  const sorted=[...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let cb=0,ci=0;const pl=[],il=[],dl=[];
  sorted.forEach(e=>{cb+=e.btcAmount;ci+=e.amountIDR;pl.push(Math.round(cb*p*r/1e6));il.push(Math.round(ci/1e6));dl.push(e.date)});
  if(cPNL)cPNL.destroy();
  cPNL=mkLineChart('c-pnl',dl.length?dl:['—'],[
    {label:'Nilai (juta)',data:pl.length?pl:[0],borderColor:'#00e5ff',backgroundColor:'rgba(0,229,255,.08)',fill:true,tension:.4,pointRadius:3,pointBackgroundColor:'#00e5ff'},
    {label:'Modal (juta)',data:il.length?il:[0],borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.05)',fill:true,tension:.4,pointRadius:3,borderDash:[5,5],pointBackgroundColor:'#7c3aed'}
  ]);
}

/* ══════════ DCA ══════════ */
function refreshDCAStats(){
  const p=S.btcPrice,r=S.usdIdr;
  let ti=0,tb=0;S.dca.forEach(e=>{ti+=e.amountIDR;tb+=e.btcAmount});
  const cv=tb*p*r,pnl=cv-ti,pp=ti>0?pnl/ti*100:0,avg=tb>0?ti/tb/r:0;
  const q=id=>document.getElementById(id);
  q('dca-invest').textContent=fmtIDR(ti);
  q('dca-val').textContent=fmtIDR(cv);
  q('dca-pnl').textContent=(pnl>=0?'+':'')+fmtIDR(Math.abs(pnl));q('dca-pnl').className='sval sensitive-val '+(pnl>=0?'pos':'neg');
  q('dca-pnl-pct').textContent=fmtPct(pp);q('dca-pnl-pct').className='ssub sensitive-val '+(pnl>=0?'pos':'neg');
  q('dca-avg').textContent='$'+Math.round(avg).toLocaleString();
  q('dca-btc').textContent=fmtBTC(tb);
}
function renderDCA(){
  refreshDCAStats();
  updateDCABTCDisplay();
  const p=S.btcPrice,r=S.usdIdr||16000;
  if(!p){
    if(!renderDCA._retries) renderDCA._retries=0;
    renderDCA._retries++;
    if(renderDCA._retries<10) setTimeout(renderDCA,600);
    else renderDCA._retries=0; // reset for next manual call
    return;
  }
  renderDCA._retries=0;
  // Load DCA BTC live chart
  loadDCABTCChart(curDCATF);
  const sorted=[...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const tb=document.getElementById('dca-tbody');
  if(!sorted.length){
    tb.innerHTML='<tr><td colspan="11"><div class="empty"><div class="empty-icon" style="width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#f7931a22,#f7931a44);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f7931a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 8.5c-.83-1-2-1.5-3-1.5-2.21 0-4 1.79-4 4s1.79 4 4 4c1 0 2.17-.5 3-1.5"/><path d="M9 12h6"/></svg></div><h3>Belum ada transaksi DCA</h3><p>Klik Tambah Transaksi</p></div></td></tr>';
  }else{
    tb.innerHTML=sorted.map((e,i)=>{
      const cv=e.btcAmount*p*r,pnl=cv-e.amountIDR,pp=pnl/e.amountIDR*100;
      return`<tr>
        <td style="color:var(--muted)">${i+1}</td>
        <td>${esc(e.date)}${e.time?`<br><span style="font-size:.65rem;color:var(--muted);font-family:'Space Mono',monospace">${esc(e.time)}</span>`:''}</td>
        <td>${fmtUSD(e.priceUSD)}</td>
        <td>${fmtIDR(e.priceUSD*e.kurs)}</td>
        <td>${fmtIDR(e.amountIDR)}</td>
        <td style="color:var(--accent4)">${e.btcAmount.toFixed(8)}</td>
        <td>${fmtIDR(cv)}</td>
        <td class="${pnl>=0?'pos':'neg'}">${pnl>=0?'+':'-'}${fmtIDR(Math.abs(pnl))}</td>
        <td><span class="badge ${pnl>=0?'bg':'br'}">${fmtPct(pp)}</span></td>
        <td style="color:var(--muted);font-size:.72rem">${esc(e.note)||'—'}</td>
        <td><button class="btn-del" onclick="delDCA('${esc(e.id)}')">✕</button></td>
      </tr>`;
    }).join('');
  }
  if(cDCA){cDCA.destroy();cDCA=null}
  if(sorted.length){
    cDCA=mkBarChart('c-dca',sorted.map(e=>e.date),[
      {label:'Nilai Kini (ribu)',data:sorted.map(e=>Math.round(e.btcAmount*p*r/1e3)),backgroundColor:'rgba(0,229,255,.6)',borderRadius:4,barPercentage:.7,categoryPercentage:.75},
      {label:'Modal (ribu)',data:sorted.map(e=>Math.round(e.amountIDR/1e3)),backgroundColor:'rgba(124,58,237,.4)',borderRadius:4,barPercentage:.7,categoryPercentage:.75}
    ]);
  }
}
// FIX: Helper — selalu sync total BTC dari DCA ke aset porto otomatis
function _syncDCAToPorto() {
  const totalBTC = S.dca.reduce((s,e) => s + e.btcAmount, 0);
  const totalIDR = S.dca.reduce((s,e) => s + e.amountIDR, 0);
  const btcIDR = (S.btcPrice || 0) * (S.usdIdr || 16300);

  // Cari aset BTC yang bisa dimanage (bukan yang di-opt-out user dengan _dcaManaged:false)
  let btcAsset = S.port.find(x => x.ticker && x.ticker.toLowerCase() === 'btc' && x._dcaManaged !== false);

  if (totalBTC <= 0) {
    // Tidak ada DCA → hapus aset auto jika ada
    if (btcAsset && btcAsset._dcaManaged === true)
      S.port = S.port.filter(x => !(x.ticker?.toLowerCase() === 'btc' && x._dcaManaged === true));
    return;
  }
  if (!btcAsset) {
    // Belum ada → buat baru
    btcAsset = { id:'dca-btc-auto', name:'Bitcoin', ticker:'btc', type:'crypto', qty:0, avgPrice:0, currentPrice:btcIDR, _dcaManaged:true };
    S.port.push(btcAsset);
  } else {
    // Pastikan flag terpasang (handle data lama tanpa flag)
    btcAsset._dcaManaged = true;
  }
  // Update qty, avgPrice, currentPrice dari data DCA
  btcAsset.qty = totalBTC;
  btcAsset.avgPrice = totalBTC > 0 ? totalIDR / totalBTC : 0;
  if (btcIDR > 0) btcAsset.currentPrice = btcIDR; // jaga nilai lama jika harga belum load
}

function addDCA(){
  const date=document.getElementById('m-dca-date').value;
  const time=document.getElementById('m-dca-time')?.value||'';
  const usd=getRawUSD('m-dca-usd');
  const rate=getRawVal('m-dca-rate')||S.usdIdr||16000;
  const idr=getRawVal('m-dca-idr');
  const note=document.getElementById('m-dca-note').value;
  if(!date||!usd||!idr){toast('Isi tanggal, harga BTC, dan jumlah IDR!',1);return}
  const newEntry = {id:Date.now().toString(),date,time,priceUSD:usd,kurs:rate,amountIDR:idr,btcAmount:idr/rate/usd,note};
  S.dca.push(newEntry);

  // FIX: Sync DCA ke Porto secara otomatis
  _syncDCAToPorto();

  saveState();closeModal('modal-dca');
  document.getElementById('m-dca-usd').value='';document.getElementById('m-dca-date').value='';
  document.getElementById('m-dca-idr').value='';
  document.getElementById('m-dca-note').value='';
  document.getElementById('m-dca-rate').value='';
  if(document.getElementById('m-dca-time')) document.getElementById('m-dca-time').value='';
  if(document.getElementById('m-dca-time-hint')) document.getElementById('m-dca-time-hint').textContent='';
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Transaksi ditambahkan!');renderDCA();
}
function delDCA(id){
  S.dca=S.dca.filter(e=>e.id!==id);
  // FIX: sync porto BTC setelah delete
  _syncDCAToPorto();
  saveState();toast('Dihapus');renderDCA();
}
function clearDCA(){
  if(!confirm('Hapus semua data DCA?'))return;
  S.dca=[];
  // FIX: sync porto BTC setelah clear
  _syncDCAToPorto();
  saveState();toast('Semua data DCA dihapus');renderDCA();
}
// Format angka USD dengan titik sebagai pemisah ribuan
function fmtInputUSD(el){
  const raw=el.value.replace(/[^0-9]/g,'');
  if(!raw){el.value='';return;}
  el.value=parseInt(raw,10).toLocaleString('id-ID');
}

// Ambil nilai raw dari field USD (hapus titik)
function getRawUSD(id){
  const v=document.getElementById(id).value.replace(/[^0-9]/g,'');
  return v?parseFloat(v):0;
}

// Pakai harga BTC sekarang
/* ══════════ GANTI SEED PHRASE ══════════ */
let pendingNewSeed = null;

function showChangeSeed(){
  // Tutup modal-acct dulu, baru buka modal-change-seed
  closeModal('modal-acct');
  setTimeout(()=>{
    // Tampilkan seed lama
    const oldRow = document.getElementById('old-seed-display');
    if(oldRow && curSeed){
      oldRow.innerHTML = curSeed.map((w,i)=>`<div class="sw"><div class="sw-num">${i+1}</div>${w}</div>`).join('');
    }
    // Generate seed baru otomatis
    regenerateNewSeed();
    // Reset ke step 1
    document.getElementById('change-seed-step1').style.display='block';
    document.getElementById('change-seed-step2').style.display='none';
    openModal('modal-change-seed');
  }, 200);
}

function regenerateNewSeed(){
  pendingNewSeed = rnd3();
  const newRow = document.getElementById('new-seed-display');
  if(newRow){
    newRow.innerHTML = pendingNewSeed.map((w,i)=>
      `<div class="sw" style="border-color:var(--accent3);box-shadow:0 0 8px rgba(16,185,129,.2)">
        <div class="sw-num">${i+1}</div>${w}
      </div>`
    ).join('');
  }
}

async function confirmChangeSeed(){
  if(!pendingNewSeed || !curSeed) return;
  const btn = document.getElementById('btn-confirm-seed');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';
  try{
    // 1. Ambil data saat ini (hanya data user, bukan market state)
    const currentData = {dca:S.dca, port:S.port, cf:S.cf};
    // 2. Simpan ke seed baru
    await dbSet(pendingNewSeed, currentData);
    // 3. Hapus seed lama dari Supabase
    const oldSeedKey = await seedKeyHash(...curSeed);
    try{ await sbDelete(oldSeedKey); }
    catch(e){ console.warn('Gagal hapus seed lama (tidak kritis):', e); }
    // 4. Update cache localStorage dengan seed baru
    localStorage.setItem('wo_cache', JSON.stringify({seed: pendingNewSeed, data: currentData}));
    localStorage.setItem('wo_theme', localStorage.getItem('wo_theme')||'dark');
    // 5. Update session
    curSeed = pendingNewSeed;
    // 6. Tampilkan konfirmasi
    const confirmedRow = document.getElementById('confirmed-seed-display');
    if(confirmedRow){
      confirmedRow.innerHTML = curSeed.map((w,i)=>
        `<div class="sw" style="border-color:var(--accent3)"><div class="sw-num">${i+1}</div>${w}</div>`
      ).join('');
    }
    // 7. Update tampilan di nav topstrip
    const navAcct = document.getElementById('nav-acct');
    const navAcctMob = document.getElementById('nav-acct-mob');
    // nav-acct stays as "Akun" label (seed not shown in desktop header for privacy)
    if(navAcctMob) navAcctMob.textContent = curSeed.join(' · ');
    // 8. Update modal akun
    const seedRow = document.getElementById('acct-seed-row');
    if(seedRow) seedRow.innerHTML = curSeed.map((w,i)=>`<div class="sw"><div class="sw-num">${i+1}</div>${w}</div>`).join('');
    // 9. Tampilkan step 2
    document.getElementById('change-seed-step1').style.display='none';
    document.getElementById('change-seed-step2').style.display='block';
    toast('Seed phrase berhasil diganti!');
    pendingNewSeed = null;
  }catch(e){
    toast('Gagal menyimpan seed baru: '+e.message, 1);
    btn.disabled = false;
    btn.textContent = 'Konfirmasi Ganti';
  }
}

/* ══════════ THEME PRESETS & CUSTOM COLORS ══════════ */
const THEME_PRESETS = [
  { name:'Cyan (Default)', accent:'#00e5ff', accent2:'#7c3aed', accent3:'#10b981', accent4:'#f59e0b', id:'default' },
  { name:'Neon Green', accent:'#00ff88', accent2:'#7c3aed', accent3:'#00e5ff', accent4:'#f59e0b', id:'neongreen' },
  { name:'Purple Haze', accent:'#a855f7', accent2:'#ec4899', accent3:'#10b981', accent4:'#f59e0b', id:'purple' },
  { name:'Solar Gold', accent:'#f59e0b', accent2:'#ef4444', accent3:'#10b981', accent4:'#00e5ff', id:'gold' },
  { name:'Hot Pink', accent:'#ec4899', accent2:'#7c3aed', accent3:'#10b981', accent4:'#f59e0b', id:'pink' },
  { name:'Ocean Blue', accent:'#3b82f6', accent2:'#1d4ed8', accent3:'#10b981', accent4:'#f59e0b', id:'blue' },
];

function applyThemeVars(accent, accent2, accent3, accent4) {
  const root = document.documentElement;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent2', accent2);
  root.style.setProperty('--accent3', accent3);
  root.style.setProperty('--accent4', accent4);
  root.style.setProperty('--glow', `0 0 20px ${accent}26`);
  root.style.setProperty('--glow2', `0 0 40px ${accent}4d`);
}

function restoreSavedTheme() {
  // Check both zw_display_mode (new) and wo_theme (legacy toggleTheme key)
  const mode = localStorage.getItem('zw_display_mode') || localStorage.getItem('wo_theme');
  if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme'); // dark = no attribute
  const saved = localStorage.getItem('zw_theme');
  if (!saved || saved === 'default') return;
  if (saved === 'custom') {
    try {
      const c = JSON.parse(localStorage.getItem('zw_theme_custom') || '{}');
      if (c.accent) applyThemeVars(c.accent, c.accent2||'#7c3aed', c.accent3||'#10b981', c.accent4||'#f59e0b');
    } catch(e){}
    return;
  }
  const preset = THEME_PRESETS.find(t=>t.id===saved);
  if (preset) applyThemeVars(preset.accent, preset.accent2, preset.accent3, preset.accent4);
}

/* ══════════ APP STYLE SYSTEM ══════════
   Cyberpunk (default) / Zen Paper / Tactile Maximalism / Liquid Glass
   Fungsi ini mengontrol data-style attribute di <html>
   dan menyimpan pilihan ke localStorage
══════════════════════════════════════ */
const _VIVID_FONTS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
const _ZEN_FONTS   = 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,600&family=Lora:ital,wght@0,400;0,500;0,600;1,400&family=DM+Mono:wght@400;500&display=swap';
const _GLASS_FONTS = 'https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400&family=Fira+Code:wght@400;500&display=swap';

function _loadFont(id, url) {
  if (!document.getElementById(id)) {
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet'; l.href = url;
    document.head.appendChild(l);
  }
}

function setAppStyle(style) {
  const root = document.documentElement;
  if (style === 'zen') {
    root.setAttribute('data-style', 'zen');
    localStorage.setItem('zw_app_style', 'zen');
    _loadFont('_zen-fonts', _ZEN_FONTS);
    _updateStyleBtns('zen');
    toast('🍵 Zen Paper aktif — tampilan berubah total!');
  } else if (style === 'vivid') {
    root.setAttribute('data-style', 'vivid');
    localStorage.setItem('zw_app_style', 'vivid');
    _loadFont('_vivid-fonts', _VIVID_FONTS);
    _updateStyleBtns('vivid');
    toast('🧸 Tactile Maximalism aktif — squishy & vibrant!');
  } else if (style === 'glass') {
    root.setAttribute('data-style', 'glass');
    localStorage.setItem('zw_app_style', 'glass');
    _loadFont('_glass-fonts', _GLASS_FONTS);
    _updateStyleBtns('glass');
    toast('🪟 Liquid Glass aktif — Apple iOS 26 vibes!');
  } else {
    root.removeAttribute('data-style');
    localStorage.setItem('zw_app_style', 'cyberpunk');
    _updateStyleBtns('cyberpunk');
    toast('⚡ Cyberpunk mode aktif!');
  }
}

function _updateStyleBtns(style) {
  const els = {
    zenBadge:   document.getElementById('zen-active-badge'),
    vividBadge: document.getElementById('vivid-active-badge'),
    glassBadge: document.getElementById('glass-active-badge'),
    cpBadge:    document.getElementById('cyberpunk-active-badge'),
    zenBtn:     document.getElementById('zen-style-btn2'),
    vividBtn:   document.getElementById('vivid-style-btn2'),
    glassBtn:   document.getElementById('glass-style-btn2'),
    cpBtn:      document.getElementById('cyberpunk-style-btn2'),
  };
  // Reset semua ke state non-aktif
  if (els.zenBadge)   els.zenBadge.textContent   = 'BARU';
  if (els.vividBadge) els.vividBadge.textContent = 'BARU';
  if (els.glassBadge) els.glassBadge.textContent = 'iOS 26';
  if (els.cpBadge)    els.cpBadge.textContent    = '';
  [els.zenBtn, els.vividBtn, els.glassBtn, els.cpBtn].forEach(b => b?.classList.remove('sactive'));

  // Aktifkan yang dipilih
  if (style === 'zen') {
    if (els.zenBadge) els.zenBadge.textContent = 'AKTIF';
    els.zenBtn?.classList.add('sactive');
  } else if (style === 'vivid') {
    if (els.vividBadge) els.vividBadge.textContent = 'AKTIF';
    els.vividBtn?.classList.add('sactive');
  } else if (style === 'glass') {
    if (els.glassBadge) els.glassBadge.textContent = 'AKTIF';
    els.glassBtn?.classList.add('sactive');
  } else {
    // cyberpunk
    if (els.cpBadge) els.cpBadge.textContent = 'AKTIF';
    els.cpBtn?.classList.add('sactive');
  }
}

function restoreAppStyle() {
  const saved = localStorage.getItem('zw_app_style');
  if (saved === 'zen') {
    _loadFont('_zen-fonts', _ZEN_FONTS);
    document.documentElement.setAttribute('data-style', 'zen');
  } else if (saved === 'vivid') {
    _loadFont('_vivid-fonts', _VIVID_FONTS);
    document.documentElement.setAttribute('data-style', 'vivid');
  } else if (saved === 'glass') {
    _loadFont('_glass-fonts', _GLASS_FONTS);
    document.documentElement.setAttribute('data-style', 'glass');
  }
}

// Jalankan langsung saat load — restore tema yang tersimpan
restoreAppStyle();

function initThemePage() {
  renderThemePresets();
  updateModeBtns();
  // Sync tombol style sesuai kondisi saat ini
  const currentStyle = localStorage.getItem('zw_app_style') || 'cyberpunk';
  _updateStyleBtns(currentStyle);
}

function renderThemePresets() {
  const container = document.getElementById('theme-presets');
  if (!container) return;
  const saved = localStorage.getItem('zw_theme') || 'default';
  container.innerHTML = THEME_PRESETS.map(t => `
    <button onclick="applyPreset('${t.id}')"
      style="padding:1rem;border-radius:14px;border:2px solid ${t.id===saved?'#fff':'rgba(255,255,255,.12)'};
        background:linear-gradient(135deg,${t.accent}22,${t.accent2}22);
        cursor:pointer;text-align:left;transition:all .2s;position:relative;overflow:hidden">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.6rem">
        <div style="width:20px;height:20px;border-radius:6px;background:${t.accent};flex-shrink:0;box-shadow:0 0 10px ${t.accent}80"></div>
        <div style="width:14px;height:14px;border-radius:4px;background:${t.accent2};flex-shrink:0"></div>
        <div style="width:14px;height:14px;border-radius:4px;background:${t.accent3};flex-shrink:0"></div>
      </div>
      <div style="font-size:.82rem;font-weight:700;color:var(--text)">${t.name}</div>
      ${t.id===saved ? '<div style="position:absolute;top:.5rem;right:.6rem;font-size:.65rem;color:'+t.accent+';font-weight:800">✓ AKTIF</div>' : ''}
    </button>
  `).join('');
}

function applyPreset(id) {
  const preset = THEME_PRESETS.find(t=>t.id===id);
  if (!preset) return;
  applyThemeVars(preset.accent, preset.accent2, preset.accent3, preset.accent4);
  localStorage.setItem('zw_theme', id);
  localStorage.setItem('zw_theme_custom', JSON.stringify(preset));
  renderThemePresets();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Tema diterapkan!');
}

function applyCustomTheme() {
  const color = document.getElementById('custom-accent-color')?.value || '#00e5ff';
  applyThemeVars(color, '#7c3aed', '#10b981', '#f59e0b');
  localStorage.setItem('zw_theme', 'custom');
  localStorage.setItem('zw_theme_custom', JSON.stringify({accent:color, accent2:'#7c3aed', accent3:'#10b981', accent4:'#f59e0b'}));
  renderThemePresets();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Warna custom diterapkan!');
}

/* ══════════════════════════════════════════════════════════
   CIRCULAR RIPPLE REVEAL — CSS clip-path technique
   
   Cara kerja:
   1. Jalankan onSwitch() → DOM berubah ke tema baru di balik overlay
   2. Overlay (warna tema baru) di-reveal via clip-path circle expand
      dari titik origin (posisi tombol) → smooth GPU-accelerated
   3. Overlay fade-out setelah expand selesai → tema baru terlihat
   
   Menggunakan CSS clip-path + Web Animations API untuk performa
   terbaik di mobile. GPU-composited, tidak ada jank.
════════════════════════════════════════════════════════════ */
function _themeRippleReveal(targetMode, originEl, onSwitch) {
  if (window._zwRippleBusy) return;
  window._zwRippleBusy = true;

  const DURATION = 600;
  const ease = t => 1 - Math.pow(1 - t, 3);

  try {
    // Hitung origin point dari posisi elemen tombol
    const rect = originEl && originEl.getBoundingClientRect ? originEl.getBoundingClientRect() : null;
    const ox = rect ? Math.round(rect.left + rect.width  / 2) : window.innerWidth  - 44;
    const oy = rect ? Math.round(rect.top  + rect.height / 2) : 44;
    const W  = window.innerWidth;
    const H  = window.innerHeight;

    // Radius maksimum — jarak dari origin ke sudut terjauh layar
    const maxR = Math.ceil(Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy))) + 10;

    // Warna overlay sesuai tema tujuan
    const isDarkTarget = targetMode === 'dark';
    const styleAttr = document.documentElement.getAttribute('data-style') || '';
    let bgColor;
    if (styleAttr === 'vivid')       bgColor = isDarkTarget ? '#0d1b2a' : '#e8f4fd';
    else if (styleAttr === 'glass')  bgColor = isDarkTarget ? '#050810' : '#f8fbff';
    else                             bgColor = isDarkTarget ? '#080c18' : '#f0f6ff';

    // Buat overlay div — lebih ringan dari canvas, GPU composited
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100vw',
      'height:100vh',
      'z-index:0',
      'pointer-events:none',
      `background:${bgColor}`,
      `clip-path:circle(0px at ${ox}px ${oy}px)`,
    ].join(';');
    document.body.style.position = 'relative';
    document.body.appendChild(overlay);

    let rafId;
    const t0 = performance.now();

    function done() {
      cancelAnimationFrame(rafId);
      try { onSwitch(); } catch(e) {}
      requestAnimationFrame(() => {
        overlay.remove();
        document.body.style.position = '';
        window._zwRippleBusy = false;
      });
    }

    const safety = setTimeout(done, DURATION + 500);

    function tick(now) {
      const t = Math.min((now - t0) / DURATION, 1);
      const r = ease(t) * maxR;
      overlay.style.clipPath = 'circle(' + r.toFixed(1) + 'px at ' + ox + 'px ' + oy + 'px)';
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        clearTimeout(safety);
        done();
      }
    }
    rafId = requestAnimationFrame(tick);

  } catch(err) {
    try { onSwitch(); } catch(e) {}
    window._zwRippleBusy = false;
  }
}

function setDisplayMode(mode, originEl) {
  _themeRippleReveal(mode, originEl, () => {
    if (mode === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('zw_display_mode', 'light');
      localStorage.setItem('wo_theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('zw_display_mode', 'dark');
      localStorage.setItem('wo_theme', 'dark');
    }
    updateModeBtns();
  });
  toast(mode==='light' ? '&#9728; Light mode aktif' : '&#9790; Dark mode aktif');
}

function updateModeBtns() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const darkBtn = document.getElementById('mode-dark-btn');
  const lightBtn = document.getElementById('mode-light-btn');
  const activeBg = 'rgba(128,128,128,.1)';
  if (darkBtn) {
    darkBtn.style.borderColor = isDark ? 'var(--accent)' : 'var(--border)';
    darkBtn.style.background = isDark ? activeBg : 'transparent';
  }
  if (lightBtn) {
    lightBtn.style.borderColor = !isDark ? 'var(--accent)' : 'var(--border)';
    lightBtn.style.background = !isDark ? activeBg : 'transparent';
  }
}

function resetTheme() {
  localStorage.removeItem('zw_theme');
  localStorage.removeItem('zw_theme_custom');
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent2');
  document.documentElement.style.removeProperty('--accent3');
  document.documentElement.style.removeProperty('--accent4');
  document.documentElement.style.removeProperty('--glow');
  document.documentElement.style.removeProperty('--glow2');
  renderThemePresets();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Tema direset ke default');
}

/* ══════════ THEME ══════════ */
function initTheme(){
  const saved=localStorage.getItem('wo_theme');
  const prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme=saved||(prefersDark?'dark':'light');
  if(theme==='light'){
    document.documentElement.setAttribute('data-theme','light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function toggleTheme(originEl){
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  const targetMode = isLight ? 'dark' : 'light';
  _themeRippleReveal(targetMode, originEl, () => {
    if(isLight){
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('wo_theme','dark');
    } else {
      document.documentElement.setAttribute('data-theme','light');
      localStorage.setItem('wo_theme','light');
    }
    updateModeBtns();
  });
  const thumbs=document.querySelectorAll('.theme-toggle-thumb');
  thumbs.forEach(t=>{
    t.classList.add('thumb-press');
    setTimeout(()=>t.classList.remove('thumb-press'),200);
  });
}

function fillBTCPrice(){
  if(S.btcPrice){
    document.getElementById('m-dca-usd').value=Math.round(S.btcPrice).toLocaleString('id-ID');
    const rateEl=document.getElementById('m-dca-rate');
    if(rateEl) rateEl.value=(S.usdIdr||16000).toLocaleString('id-ID');
  }
}

async function onDCADateChange(dateStr){
  if(!dateStr) return;
  const today=new Date().toISOString().slice(0,10);
  if(dateStr>=today){
    fillBTCPrice(); return;
  }
  const dateObj=new Date(dateStr);
  const COINGECKO_START=new Date('2013-04-28');
  if(dateObj<COINGECKO_START){
    // Beri tahu user tapi tetap coba
    const input=document.getElementById('m-dca-usd');
    input.placeholder='Data pre-2013 terbatas, coba manual';
    toast('Data sebelum Apr 2013 sangat terbatas. Silakan cek harga di CoinMarketCap dan isi manual.',1);
    return;
  }
  await fillBTCPriceByDate(dateStr);
}

async function fillBTCPriceByDate(dateStr){
  const d=dateStr||document.getElementById('m-dca-date').value;
  if(!d){toast('Pilih tanggal dulu!',1);return;}

  const timeEl=document.getElementById('m-dca-time');
  const timeVal=timeEl?timeEl.value:'';
  const hasTime=timeVal&&timeVal.length===5;

  const loading=document.getElementById('m-dca-usd-loading');
  const input=document.getElementById('m-dca-usd');
  const hint=document.getElementById('m-dca-time-hint');

  input.value='';
  input.placeholder='Mengambil harga...';
  if(loading) loading.style.display='block';
  if(hint) hint.innerHTML='<span style="color:var(--muted)">Mencari harga...</span>';

  try{
    const DATA_START=new Date('2013-04-28');
    const dateObj=new Date(d+'T00:00:00Z');
    if(dateObj<DATA_START){
      input.placeholder='Masukkan manual (data pre-Apr 2013 tidak tersedia)';
      toast('Data sebelum Apr 2013 tidak tersedia via API. Masukkan harga manual.',1);
      return;
    }

    let result=null;

    if(hasTime){
      const [hh]=timeVal.split(':').map(Number);
      // Input user dalam WIB (UTC+7) — konversi ke UTC untuk query API
      const hhUTC=((hh-7)%24+24)%24; // WIB - 7 = UTC
      const candleStartMs=new Date(`${d}T${String(hhUTC).padStart(2,'0')}:00:00Z`).getTime();
      const candleEndMs=candleStartMs+3600000;
      const daysAgo=(Date.now()-candleStartMs)/86400000;

      // === 1. CoinGecko /market_chart/range — PASTI bisa, < 90 hari = per jam ===
      if(!result && daysAgo < 89){
        try{
          const url=`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${Math.floor(candleStartMs/1000)}&to=${Math.floor(candleEndMs/1000)}`;
          const r=await fetchWithTimeout(url,15000);
          if(r.ok){
            const json=await r.json();
            const pts=json?.prices||[];
            if(pts.length>0){
              // Ambil datapoint terdekat ke jam yang diminta
              let best=null,bestDiff=Infinity;
              for(const [ts,p] of pts){
                const diff=Math.abs(ts-candleStartMs);
                if(diff<bestDiff){bestDiff=diff;best={ts,p};}
              }
              if(best&&best.p>10){
                const tUTC=new Date(best.ts);const tWIB=new Date(tUTC.getTime()+7*3600000);const t=tWIB.toISOString().slice(11,16)+' WIB';
                result={price:best.p,source:`CoinGecko (${t})`};
              }
            }
          }
        }catch(e){console.warn('CG range gagal:',e.message);}
      }

      // === 2. Bybit dengan startTime spesifik — CORS ok, historis dalam ===
      if(!result){
        try{
          const url=`https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&start=${candleStartMs}&limit=1`;
          const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
          if(r.ok){
            const json=await r.json();
            const list=json?.result?.list||[];
            if(list.length>0){
              const c=list[0];
              const close=parseFloat(c[4]);
              if(close>10){
                const tWIB=new Date(parseInt(c[0])+7*3600000);const t=tWIB.toISOString().slice(11,16)+' WIB';
                result={price:close,source:`Bybit (${t})`,candle:{open:parseFloat(c[1]),high:parseFloat(c[2]),low:parseFloat(c[3]),close}};
              }
            }
          }
        }catch(e){console.warn('Bybit gagal:',e.message);}
      }

      // === 3. OKX history-candles dengan range spesifik ===
      if(!result){
        try{
          // OKX: after=ts lebih tua (older end), before=ts lebih baru (newer end)
          const url=`https://www.okx.com/api/v5/market/history-candles?instId=BTC-USDT&bar=1H&after=${candleStartMs-1}&before=${candleEndMs}&limit=2`;
          const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
          if(r.ok){
            const json=await r.json();
            const data=json?.data||[];
            if(data.length>0){
              // Cari candle yang paling dekat candleStartMs
              let best=null,bestDiff=Infinity;
              for(const c of data){
                const diff=Math.abs(parseInt(c[0])-candleStartMs);
                if(diff<bestDiff){bestDiff=diff;best=c;}
              }
              if(best&&bestDiff<=3600000){
                const close=parseFloat(best[4]);
                if(close>10){
                  const tWIB=new Date(parseInt(best[0])+7*3600000);const t=tWIB.toISOString().slice(11,16)+' WIB';
                  result={price:close,source:`OKX (${t})`,candle:{open:parseFloat(best[1]),high:parseFloat(best[2]),low:parseFloat(best[3]),close}};
                }
              }
            }
          }
        }catch(e){console.warn('OKX gagal:',e.message);}
      }

      // === 4. Binance + allorigins proxy ===
      if(!result){
        try{
          const bnUrl=`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${candleStartMs}&endTime=${candleEndMs}&limit=1`;
          const proxyUrl=`/api/proxy?url=${encodeURIComponent(bnUrl)}`;
          const r=await fetch(proxyUrl,{signal:AbortSignal.timeout(12000)});
          if(r.ok){
            const text=await r.text();
            if(!text.trim().startsWith('<')){
              const data=JSON.parse(text);
              if(data&&data.length>0){
                const c=data[0];
                const close=parseFloat(c[4]);
                if(close>10){
                  const tWIB=new Date(parseInt(c[0])+7*3600000);const t=tWIB.toISOString().slice(11,16)+' WIB';
                  result={price:close,source:`Binance (${t})`,candle:{open:parseFloat(c[1]),high:parseFloat(c[2]),low:parseFloat(c[3]),close}};
                }
              }
            }
          }
        }catch(e){console.warn('Binance proxy gagal:',e.message);}
      }

      // === 5. CoinGecko market_chart?days=N (> 89 hari — data per hari, ambil terdekat) ===
      if(!result){
        try{
          const daysBack=Math.ceil(daysAgo)+2;
          const url=`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${daysBack}`;
          const r=await fetchWithTimeout(url,15000);
          if(r.ok){
            const json=await r.json();
            const pts=json?.prices||[];
            let best=null,bestDiff=Infinity;
            for(const [ts,p] of pts){
              const diff=Math.abs(ts-candleStartMs);
              if(diff<bestDiff){bestDiff=diff;best={ts,p,diff};}
            }
            if(best&&best.p>10&&best.diff<7200000){
              const tWIB2=new Date(best.ts+7*3600000);const t=tWIB2.toISOString().slice(11,16)+' WIB';
              result={price:best.p,source:`CoinGecko approx (${t})`};
            }
          }
        }catch(e){console.warn('CG days gagal:',e.message);}
      }

      if(!result){
        // Semua sumber per-jam gagal, fallback ke harga harian
        toast('Harga per jam tidak tersedia, mengambil harga close harian...',0);
      }
    }

    // === FINAL FALLBACK: harga close harian ===
    if(!result) result=await cgPriceAt(d);

    if(result&&result.price&&result.price>10){
      input.value=Math.round(result.price).toLocaleString('id-ID');
      input.placeholder='';
      const rateEl=document.getElementById('m-dca-rate');
      if(rateEl&&S.usdIdr) rateEl.value=S.usdIdr.toLocaleString('id-ID');
      if(hint&&result.candle){
        hint.innerHTML=`<span style="color:var(--accent3)">H:$${Math.round(result.candle.high).toLocaleString('en-US')}</span>&nbsp;<span style="color:var(--danger)">L:$${Math.round(result.candle.low).toLocaleString('en-US')}</span>&nbsp;<span style="color:var(--muted);font-size:.6rem">${result.source}</span>`;
      }else if(hint){
        hint.innerHTML=`<span style="color:var(--muted)">${result.source||''}</span>`;
      }
      toast(`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${d}${hasTime?' jam '+timeVal+' WIB':''} · ${result.source}: $${Math.round(result.price).toLocaleString('en-US')}`);
    }else{
      input.placeholder='Masukkan manual';
      toast('Tidak dapat ambil harga per jam. Coba "Pakai harga di tanggal ini" atau isi manual.',1);
    }
  }catch(e){
    console.error('fillBTCPriceByDate error:',e);
    input.placeholder='Gagal ambil harga, isi manual';
    toast('Gagal ambil harga. Coba "Pakai harga di tanggal ini" atau isi manual.',1);
  }finally{
    if(loading) loading.style.display='none';
  }
}
function onDCATimeChange(){
  const timeEl=document.getElementById('m-dca-time');
  const hint=document.getElementById('m-dca-time-hint');
  const dateEl=document.getElementById('m-dca-date');
  if(!timeEl||!hint) return;
  const t=timeEl.value;
  if(!t){hint.textContent='';return;}
  if(dateEl&&dateEl.value){
    // Auto-fetch harga per jam langsung
    fillBTCPriceByDate();
  } else {
    hint.textContent='Pilih tanggal dulu untuk ambil harga per jam';
  }
}

/* ══════════ PORTFOLIO ══════════ */
function renderPort(){
  const total=S.port.reduce((s,x)=>s+x.qty*x.currentPrice,0);
  const ICONS={crypto:'◈',stock:'↗',gold:'◆',reksadana:'▣',other:'○'};
  const cards=document.getElementById('port-cards');
  const tb=document.getElementById('port-tbody');

  // ── EVM Wallet rows ──
  let walletRows = '';
  const hasBTC = walletState.btcAddresses && walletState.btcAddresses.length > 0;
  const hasEVM = walletState.connected && walletState.address;

  if (hasEVM) {
    if (walletState.loading && walletState.tokens.length === 0) {
      walletRows += `<tr style="background:rgba(124,58,237,.04)">
        <td colspan="9" style="padding:1.2rem;text-align:center">
          <div style="display:inline-flex;align-items:center;gap:.7rem;color:rgba(167,139,250,.8);font-size:.8rem">
            <div style="width:14px;height:14px;border:2px solid rgba(167,139,250,.3);border-top-color:#a78bfa;border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0"></div>
            Memuat token dari ${walletState.providerName||'wallet'}...
          </div>
        </td>
      </tr>`;
    } else {
      const grandTotalIDR = total
        + walletState.tokens.reduce((s,t)=>s+(t.valueIDR||0),0)
        + walletState.btcAddresses.reduce((s,b)=>s+(b.valueIDR||0),0);
      walletRows += walletState.tokens.map((t, idx) => {
        const gradArr = (NATIVE_GRAD[t.chainId]||'#627EEA,#8FA8F5').split(',');
        const gradCss = t.isNative
          ? `linear-gradient(135deg,${gradArr[0]},${gradArr[1]})`
          : 'linear-gradient(135deg,rgba(124,58,237,.7),rgba(167,139,250,.8))';
        const icon = t.isNative ? (NATIVE_ICON[t.chainId]||'Ξ') : t.symbol.slice(0,2);
        const logoEl = t.logo
          ? `<img src="${t.logo}" alt="${icon}" style="width:22px;height:22px;border-radius:6px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none';this.nextSibling.style.display='inline-flex'"><span style="display:none;width:22px;height:22px;border-radius:6px;background:${gradCss};align-items:center;justify-content:center;font-size:.55rem;font-weight:900;color:#fff;flex-shrink:0">${icon}</span>`
          : `<span style="display:inline-flex;width:22px;height:22px;border-radius:6px;background:${gradCss};align-items:center;justify-content:center;font-size:.55rem;font-weight:900;color:#fff;flex-shrink:0">${icon}</span>`;
        const badge = idx===0 ? `<span style="font-size:.58rem;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.3);color:#a78bfa;border-radius:4px;padding:.08rem .32rem;font-weight:700;font-family:'Inter',sans-serif;margin-left:.3rem">(Wallet)</span>` : '';
        const priceCell = t.priceIDR ? `<span>${fmtIDR(t.priceIDR)}</span>` : `<span style="color:var(--muted)">—</span>`;
        const valueCell = t.valueIDR ? `<span style="color:#a78bfa;font-weight:700">${fmtIDR(t.valueIDR)}</span>` : `<span style="color:var(--muted)">—</span>`;
        const alloc = (grandTotalIDR>0&&t.valueIDR) ? (t.valueIDR/grandTotalIDR*100).toFixed(1)+'%' : '—';
        const usdTip = t.valueUSD ? `$${t.valueUSD.toLocaleString('en-US',{maximumFractionDigits:2})}` : '';
        return `<tr style="background:rgba(124,58,237,${idx===0?'.07':'.04'});border-left:3px solid rgba(167,139,250,${idx===0?'.5':'.2'})" title="${usdTip}">
          <td><span style="display:inline-flex;align-items:center;gap:.4rem">${logoEl}<span><strong>${esc(t.symbol)}</strong><span style="color:var(--muted);font-size:.7rem;margin-left:.25rem">${esc(t.name.length>18?t.name.slice(0,18)+'…':t.name)}</span>${badge}</span></span>
          ${idx===0?`<div style="font-family:'Space Mono',monospace;font-size:.58rem;color:rgba(167,139,250,.6);margin-top:.15rem">${truncateAddr(walletState.address)} · ${CHAIN_NAME[walletState.chainId]||'Chain '+walletState.chainId} · ${walletState.providerName||''}</div>`:''}
          </td>
          <td style="font-size:.78rem">${fmtQty(t.balance)}</td>
          <td style="color:var(--muted)">—</td><td>${priceCell}</td><td>${valueCell}</td>
          <td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td>
          <td style="color:rgba(167,139,250,.7)">${alloc}</td>
          <td style="color:var(--muted);font-size:.62rem">read-only</td></tr>`;
      }).join('');
    }
  }

  // ── BTC rows ──
  if (hasBTC) {
    const grandTotalIDR = total
      + walletState.tokens.reduce((s,t)=>s+(t.valueIDR||0),0)
      + walletState.btcAddresses.reduce((s,b)=>s+(b.valueIDR||0),0);
    walletRows += walletState.btcAddresses.map((b, idx) => {
      const btcBal  = b.btc !== null ? b.btc : 0;
      const priceCell = b._btcPriceIDR ? `<span>${fmtIDR(b._btcPriceIDR)}</span>` : `<span style="color:var(--muted)">${b.loading?'…':'—'}</span>`;
      const valueCell = b.valueIDR ? `<span style="color:#f59e0b;font-weight:700">${fmtIDR(b.valueIDR)}</span>` : `<span style="color:var(--muted)">${b.loading?'…':'—'}</span>`;
      const alloc = (grandTotalIDR>0&&b.valueIDR) ? (b.valueIDR/grandTotalIDR*100).toFixed(1)+'%' : '—';
      const badge = idx===0 ? `<span style="font-size:.58rem;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.3);color:#f59e0b;border-radius:4px;padding:.08rem .32rem;font-weight:700;font-family:'Inter',sans-serif;margin-left:.3rem">(Wallet)</span>` : '';
      const usdTip = b.valueUSD ? `$${b.valueUSD.toLocaleString('en-US',{maximumFractionDigits:2})}` : '';
      return `<tr style="background:rgba(245,158,11,${idx===0?'.07':'.04'});border-left:3px solid rgba(245,158,11,${idx===0?'.5':'.2'})" title="${usdTip}">
        <td><span style="display:inline-flex;align-items:center;gap:.4rem">
          <span style="display:inline-flex;width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#f59e0b,#fbbf24);align-items:center;justify-content:center;font-size:.7rem;font-weight:900;color:#fff;flex-shrink:0">₿</span>
          <span><strong>BTC</strong><span style="color:var(--muted);font-size:.7rem;margin-left:.25rem">Bitcoin</span>${badge}</span>
        </span>
        <div style="font-family:'Space Mono',monospace;font-size:.58rem;color:rgba(245,158,11,.6);margin-top:.15rem">${truncateAddr(b.address)}${b._auto?' · OKX/Phantom':''}</div></td>
        <td style="font-size:.78rem">${b.loading?'…':fmtQty(btcBal)}</td>
        <td style="color:var(--muted)">—</td><td>${priceCell}</td><td>${valueCell}</td>
        <td style="color:var(--muted)">—</td><td style="color:var(--muted)">—</td>
        <td style="color:rgba(245,158,11,.7)">${alloc}</td>
        <td style="color:var(--muted);font-size:.62rem">read-only</td></tr>`;
    }).join('');
  }

  if(!S.port.length && !walletRows){
    cards.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="emoji" style="opacity:.4;color:var(--accent)"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg></div><h3>Belum ada aset</h3><p>Tambah aset kamu</p></div>';
    tb.innerHTML = walletRows || '<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--muted)">—</td></tr>';
    return;
  }
  if(!S.port.length && walletRows){
    cards.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="emoji" style="opacity:.4;color:var(--accent)"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg></div><h3>Belum ada aset manual</h3><p>Token wallet ditampilkan di tabel bawah</p></div>';
    tb.innerHTML = walletRows;
    return;
  }
  cards.innerHTML=S.port.map(x=>{
    const val=x.qty*x.currentPrice,inv=x.qty*x.avgPrice,pnl=val-inv,pp=pnl/inv*100;
    return`<div class="port-card">
      <div class="port-top">
        <div style="display:flex;align-items:center;gap:.6rem">
          <div class="asset-icon">${ICONS[x.type]||'○'}</div>
          <div><div class="asset-name">${esc(x.name)}</div><div class="asset-ticker">${esc(x.ticker)}</div></div>
        </div>
        <button class="btn-del" onclick="delPort('${esc(x.id)}')">✕</button>
      </div>
      <div class="asset-price">${fmtIDR(val)}</div><!-- nilai total = qty × harga -->
      <div style="font-size:.8rem;font-family:'Space Mono',monospace;font-weight:700" class="${pnl>=0?'pos':'neg'}">${fmtPct(pp)} &nbsp; ${pnl>=0?'+':''} ${fmtIDR(pnl)}</div>
      <div class="pbar"><div class="pbar-fill" style="width:${Math.min(Math.abs(pp),100)}%;background:${pnl>=0?'var(--accent3)':'var(--danger)'}"></div></div>
      <div style="font-size:.7rem;color:var(--muted)">${fmtIDR(val)} · ${total>0?(val/total*100).toFixed(1):'0'}% portofolio</div>
    </div>`;
  }).join('');
  tb.innerHTML=walletRows+S.port.map(x=>{
    const val=x.qty*x.currentPrice,inv=x.qty*x.avgPrice,pnl=val-inv,pp=pnl/inv*100;
    return`<tr>
      <td>${ICONS[x.type]||'○'} <strong>${esc(x.name)}</strong> <span style="color:var(--muted);font-size:.7rem">${esc(x.ticker)}</span></td>
      <td>${x.qty}</td><td>${fmtIDR(x.avgPrice)}</td><td>${fmtIDR(x.currentPrice)}</td>
      <td>${fmtIDR(val)}</td>
      <td class="${pnl>=0?'pos':'neg'}">${pnl>=0?'+':''} ${fmtIDR(pnl)}</td>
      <td><span class="badge ${pnl>=0?'bg':'br'}">${fmtPct(pp)}</span></td>
      <td>${total>0?(val/total*100).toFixed(1):'0'}%</td>
      <td><button class="btn-del" onclick="delPort('${esc(x.id)}')">✕</button></td>
    </tr>`;
  }).join('');
}
function addPort(){
  const name=document.getElementById('m-p-name').value.trim();
  const ticker=document.getElementById('m-p-ticker').value.toUpperCase();
  const type=document.getElementById('m-p-type').value;
  const qty=parseFloat(document.getElementById('m-p-qty').value);
  const avg=getRawVal('m-p-avg');
  const cur=getRawVal('m-p-cur');
  if(!name||!qty||!avg||!cur){toast('Isi semua field!',1);return}
  S.port.push({id:Date.now().toString(),name,ticker,type,qty,avgPrice:avg,currentPrice:cur});
  saveState();closeModal('modal-port');
  ['m-p-name','m-p-ticker','m-p-qty','m-p-avg','m-p-cur'].forEach(id=>document.getElementById(id).value='');
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Aset ditambahkan!');renderPort();
}
function delPort(id){S.port=S.port.filter(x=>x.id!==id);saveState();toast('Dihapus');renderPort()}

/* ══════════ SIMULATION DINAMIS ══════════ */
let simPriceCache = {}; // cache harga per tanggal

function syncSimInputs(){
  const lv=document.getElementById('s-live');
  if(lv&&S.btcPrice) lv.textContent='$'+S.btcPrice.toLocaleString();
  const rateEl=document.getElementById('s-rate');
  if(rateEl&&S.usdIdr&&(getRawVal('s-rate')<1000)) rateEl.value=(S.usdIdr).toLocaleString('id-ID');
  // Set default tanggal
  const today=new Date().toISOString().split('T')[0];
  const sd=document.getElementById('s-startdate');
  const ed=document.getElementById('s-enddate');
  if(sd&&!sd.value){
    // Default: 1 tahun lalu
    const d=new Date();d.setFullYear(d.getFullYear()-1);
    sd.value=d.toISOString().split('T')[0];
  }
  if(sd) sd.max=today;
  if(ed) ed.max=today;
}

async function bulkFetchHistoricalPrices(dates){
  if(!dates||!dates.length) return {};
  const result={};

  const missing=dates.filter(d=>!simPriceCache[d]);
  if(!missing.length){
    dates.forEach(d=>{ result[d]=simPriceCache[d]; });
    return result;
  }

  const sortedMissing=[...missing].sort();
  const startDt=new Date(sortedMissing[0]);
  const endDt=new Date(sortedMissing[sortedMissing.length-1]);
  const daysDiff=Math.ceil((endDt-startDt)/(1000*86400))+2;

  let krakenInt=1440; // daily default
  if(daysDiff>720) krakenInt=10080;     // weekly untuk >2 tahun
  if(daysDiff<=60)  krakenInt=240;      // 4h untuk ≤2 bulan (lebih akurat)
  if(daysDiff<=14)  krakenInt=60;       // hourly untuk ≤2 minggu

  try{
    const ohlc=(await getHistCache()) || await krakenOHLC(krakenInt, Math.floor(startDt.getTime()/1000)-86400*7);
        missing.forEach(dateStr=>{
      const target=new Date(dateStr).getTime()/1000;
          let best=null, bestDiff=Infinity;
      for(const [ts, price] of ohlc){
        const diff=Math.abs(ts-target);
        if(diff<bestDiff){bestDiff=diff;best=price;}
        if(ts>target+86400*2) break; // sudah melewati tanggal
      }
      if(best&&best>100){
        simPriceCache[dateStr]=best;
        result[dateStr]=best;
      }
    });
      const stillMissing=missing.filter(d=>!result[d]);
    if(stillMissing.length>0){
      console.warn('Beberapa tanggal tidak ditemukan di Kraken bulk, coba individual:', stillMissing.length);
    }
  }catch(e){
    console.warn('Kraken bulk fetch gagal:', e.message);
    // Fallback: individual CoinGecko (tapi delay agar tidak rate limit)
    for(let i=0;i<missing.length;i++){
      const d=missing[i];
      try{
        const r2=await cgPriceAt(d);
        const p=r2?.price||r2;
        if(p&&p>10){simPriceCache[d]=p;result[d]=p;}
      }catch(e2){}
      if(i%5===4) await new Promise(r=>setTimeout(r,1100)); // delay setiap 5 req
    }
  }

  dates.forEach(d=>{
    if(simPriceCache[d]) result[d]=simPriceCache[d];
  });
  return result;
}

function generateDCAdates(startDate, endDate, freq){
  const dates=[];
  let cur=new Date(startDate);
  const end=new Date(endDate);
  while(cur<=end){
    dates.push(cur.toISOString().split('T')[0]);
    if(freq==='monthly'){cur=new Date(cur);cur.setMonth(cur.getMonth()+1)}
    else if(freq==='biweekly'){cur=new Date(cur);cur.setDate(cur.getDate()+14)}
    else if(freq==='weekly'){cur=new Date(cur);cur.setDate(cur.getDate()+7)}
    else if(freq==='daily'){cur=new Date(cur);cur.setDate(cur.getDate()+1)}
    else{cur=new Date(cur);cur.setMonth(cur.getMonth()+1)}
  }
  return dates;
}

async function runSimDynamic(){
  const btn=document.getElementById('s-run-btn');
  const status=document.getElementById('sim-fetch-status');

  const resetBtn=()=>{
    if(btn){btn.disabled=false;btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Hitung Simulasi';}
  };

  const startDate=document.getElementById('s-startdate').value;
  const endDateRaw=document.getElementById('s-enddate').value;
  const endDate=endDateRaw||new Date().toISOString().split('T')[0];
  const freq=document.getElementById('s-freq').value;
  const amt=getRawVal('s-amt')||500000;
  const rate=getRawVal('s-rate')||S.usdIdr||16000;
  const curP=S.btcPrice;

  if(!startDate){toast('Pilih tanggal mulai DCA!',1);return}
  if(new Date(startDate)>=new Date(endDate)){toast('Tanggal mulai harus sebelum tanggal akhir!',1);return}

  if(btn){btn.disabled=true;btn.textContent='⏳ Mengambil data historis...';}
  if(status){status.style.display='block';status.style.color='var(--muted)';status.textContent='Mengambil data historis...';}

  try{
    const dates=generateDCAdates(startDate,endDate,freq);
    const total=dates.length;

      if(status) status.textContent=`Mengambil ${total} data harga sekaligus...`;
    const priceMap=await bulkFetchHistoricalPrices(dates);

      const prices=dates.map(d=>priceMap[d]||null);

      let tb=0,ti=0;
    const rows=[],cl=[],cv=[],ci=[],validPeriods=[];

      const validDates=dates.filter((_,i)=>prices[i]&&prices[i]>100);
    const validPrices=prices.filter(p=>p&&p>100);

    if(validDates.length===0){
      if(status){status.style.color='var(--danger)';status.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:.3rem"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal mendapatkan data harga historis. Cek koneksi internet.';}
      toast('Gagal ambil data harga historis',1);
      resetBtn();return;
    }

    validDates.forEach((dateStr,i)=>{
      const price=validPrices[i];
      const bought=amt/rate/price;
      tb+=bought;ti+=amt;
      const val=tb*curP*rate,pnl=val-ti,pp=pnl/ti*100;
      validPeriods.push({dateStr,price,bought,tb,ti,val,pnl,pp});
      rows.push(`<tr>
        <td style="color:var(--muted);font-size:.72rem">${dateStr}</td>
        <td style="color:var(--accent4)">$${price.toLocaleString('en-US',{maximumFractionDigits:0})}</td>
        <td>${fmtIDR(amt)}</td>
        <td style="font-size:.72rem">${bought.toFixed(8)}</td>
        <td style="color:var(--accent4);font-size:.72rem">${tb.toFixed(8)}</td>
        <td>${fmtIDR(val)}</td>
        <td class="${pnl>=0?'pos':'neg'}"><span class="badge ${pnl>=0?'bg':'br'}">${fmtPct(pp)}</span></td>
      </tr>`);
      const step=Math.max(1,Math.floor(validDates.length/60));
      if(i%step===0||i===validDates.length-1){
        cl.push(dateStr.substring(0,7));
        cv.push(+(val/1e6).toFixed(2));
        ci.push(+(ti/1e6).toFixed(2));
      }
    });

    const curVal=tb*curP*rate,pnl=curVal-ti,roi=ti>0?pnl/ti*100:0,avg=tb>0?ti/tb/rate:0;
    const q=id=>document.getElementById(id);
    q('s-port').textContent=fmtIDR(curVal);
    q('s-btctot').textContent=tb.toFixed(8)+' BTC';
    q('s-total').textContent=fmtIDR(ti);
    q('s-profit').textContent=(pnl>=0?'+':'')+fmtIDR(Math.abs(pnl));
    q('s-profit').className='sim-sum-val '+(pnl>=0?'pos':'neg');
    q('s-roi').textContent=fmtPct(roi);
    q('s-roi').className='sim-sum-sub '+(roi>=0?'pos':'neg');
    q('s-avg').textContent='$'+Math.round(avg).toLocaleString('en-US');
    q('s-periods').textContent=validPeriods.length+' kali';
    q('s-btcacc').textContent=tb.toFixed(8)+' BTC';
    q('s-tbody').innerHTML=rows.join('');

    try{if(cSim)cSim.destroy();}catch(e){}
    cSim=mkLineChart('c-sim',cl,[
      {label:'Nilai (juta)',data:cv,borderColor:'#00e5ff',backgroundColor:'rgba(0,229,255,.1)',fill:true,tension:.4,pointRadius:2,pointBackgroundColor:'#00e5ff'},
      {label:'Modal (juta)',data:ci,borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.05)',fill:true,tension:.4,pointRadius:2,borderDash:[5,5],pointBackgroundColor:'#7c3aed'}
    ]);

    if(status){status.style.color='var(--accent3)';status.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:.3rem"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${validPeriods.length} periode · ${validDates[0]} → ${validDates[validDates.length-1]} · harga Kraken/CoinGecko`;}
    toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Simulasi selesai!');

  }catch(err){
    console.error('runSimDynamic error:',err);
    if(status){status.style.color='var(--danger)';status.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:.3rem"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal — cek koneksi dan coba lagi';}
    toast('Gagal ambil data historis',1);
  }finally{
      resetBtn();
  }
}


/* ══════════ CASHFLOW ══════════ */
function renderCF(){
  let inc=0,exp=0,inv=0;
  S.cf.forEach(e=>{if(e.type==='income')inc+=e.amount;else if(e.type==='expense')exp+=e.amount;else inv+=e.amount});
  const net=inc-exp-inv,pct=inc>0?inv/inc*100:0;
  const q=id=>document.getElementById(id);
  q('cf-in').textContent=fmtIDR(inc);q('cf-out').textContent=fmtIDR(exp);
  q('cf-net').textContent=fmtIDR(net);q('cf-net').className='sval '+(net>=0?'pos':'neg');
  q('cf-pct').textContent=pct.toFixed(1)+'%';
  const tb=q('cf-tbody');
  if(!S.cf.length){tb.innerHTML='<tr><td colspan="6"><div class="empty"><div class="emoji" style="opacity:.4;color:var(--accent)"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div><h3>Belum ada transaksi</h3><p>Mulai catat keuangan kamu</p></div></td></tr>'}
  else{
    const sorted=[...S.cf].sort((a,b)=>new Date(b.date)-new Date(a.date));
    const TC={income:'bb',expense:'br',investment:'bg'};
    const TL={income:'Pemasukan',expense:'Pengeluaran',investment:'Investasi'};
    tb.innerHTML=sorted.map(e=>`<tr><td>${esc(e.date)}</td><td style="color:var(--muted)">${esc(e.category)}</td><td>${esc(e.desc)||'—'}</td><td><span class="badge ${TC[e.type]}">${TL[e.type]}</span></td><td class="${e.type==='income'?'pos':e.type==='expense'?'neg':'acc'}">${e.type==='income'?'+':'-'} ${fmtIDR(e.amount)}</td><td><button class="btn-del" onclick="delCF('${esc(e.id)}')">✕</button></td></tr>`).join('');
  }
  const months={};
  S.cf.forEach(e=>{const m=e.date.substring(0,7);if(!months[m])months[m]={i:0,e:0,v:0};if(e.type==='income')months[m].i+=e.amount;else if(e.type==='expense')months[m].e+=e.amount;else months[m].v+=e.amount});
  const ml=Object.keys(months).sort();
  if(cCF)cCF.destroy();
  const ctx=document.getElementById('c-cf').getContext('2d');
  cCF=new Chart(ctx,{type:'bar',data:{labels:ml.length?ml:['—'],datasets:[
    {label:'Pemasukan',data:ml.map(m=>+(months[m].i/1e6).toFixed(2)),backgroundColor:'rgba(16,185,129,.6)',borderRadius:4,barPercentage:.7,categoryPercentage:.75},
    {label:'Pengeluaran',data:ml.map(m=>+(months[m].e/1e6).toFixed(2)),backgroundColor:'rgba(239,68,68,.5)',borderRadius:4,barPercentage:.7,categoryPercentage:.75},
    {label:'Investasi',data:ml.map(m=>+(months[m].v/1e6).toFixed(2)),backgroundColor:'rgba(0,229,255,.5)',borderRadius:4,barPercentage:.7,categoryPercentage:.75}
  ]},options:{...CO,plugins:{legend:{labels:LG}},scales:{x:{ticks:TK,grid:getGR()},y:{ticks:{...TK,callback:v=>'Rp'+v+'jt'},grid:getGR()}}}});
}
function addCF(){
  const date=document.getElementById('m-cf-date').value;
  const type=document.getElementById('m-cf-type').value;
  const cat=document.getElementById('m-cf-cat').value.trim();
  const desc=document.getElementById('m-cf-desc').value;
  const amt=getRawVal('m-cf-amt');
  if(!date||!cat||!amt){toast('Isi tanggal, kategori, dan jumlah!',1);return}
  S.cf.push({id:Date.now().toString(),date,type,category:cat,desc,amount:amt});
  saveState();closeModal('modal-cf');
  ['m-cf-cat','m-cf-desc','m-cf-amt'].forEach(id=>document.getElementById(id).value='');
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Transaksi ditambahkan!');renderCF();
}
function delCF(id){S.cf=S.cf.filter(e=>e.id!==id);saveState();toast('Dihapus');renderCF()}

/* ══════════ INIT ══════════ */
let _fetchBTCInterval=null, _chartRefreshInterval=null;

function initApp(){
  restoreSavedTheme();
  const today=new Date().toISOString().split('T')[0];
  ['m-dca-date','m-cf-date'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=today});
  fetchBTC().then(()=>{renderDash();});
  fetchFearGreed();
  loadBTCChart('1W');
  // Clear existing intervals before setting new ones (prevents leak on re-login)
  if(_fetchBTCInterval) clearInterval(_fetchBTCInterval);
  if(_chartRefreshInterval) clearInterval(_chartRefreshInterval);
  // WS sudah handle realtime — refresh rate IDR + 24h change setiap 5 menit
  _fetchBTCInterval=setInterval(_fetchUSDIDRRate, 5*60*1000);
  _chartRefreshInterval=setInterval(()=>{
    // Invalidate cache before auto-refresh so kita dapat data fresh
    delete _btcChartCache[curTF];
    loadBTCChart(curTF);
  },300000);
  // ── PRELOAD overlay data di background agar toggle instan ──
  _preloadOverlayData();
  syncSimInputs();
  requestAnimationFrame(()=>{
    const firstActive=document.querySelector('.bnav-item.active');
    animateNavIndicator(firstActive);
  });
  // Register firebase-messaging-sw.js lebih awal agar SW.ready benar
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
      .then(reg => {
        window._swReg = reg;
        // Init FCM jika notif sudah diizinkan
        if (Notification.permission === 'granted') {
          ZW_FCM.init().then(() => {
            const savedToken = localStorage.getItem('zw_fcm_token');
            if (!savedToken) ZW_FCM.getToken().catch(()=>{});
          });
        }
      })
      .catch(() => {
        // Fallback: init FCM tanpa pre-register SW
        if (Notification.permission === 'granted') {
          ZW_FCM.init().catch(()=>{});
        }
      });
  }
  // Restore posisi futures aktif dari localStorage (persist setelah refresh)
  setTimeout(() => restoreActiveTrades(), 500);
}

async function boot(){
  doGenerate();
  // Checkbox harus dicentang manual oleh user (keamanan seed phrase)
  confirmed=false;

  // Try auto-login from cache
  try{
    const raw=localStorage.getItem('wo_cache');
    if(raw){
      const {seed,data}=JSON.parse(raw);
      if(seed?.length===3&&data){
        showLL('Memulihkan sesi...');
            try{
          const cloud=await dbGet(seed);
          if(cloud){
                    const useCloud=(cloud.dca||[]).length>=(data.dca||[]).length;
            hideLL();await enterApp(seed,useCloud?cloud:data);return;
          }
        }catch(e){}
            hideLL();await enterApp(seed,data);
        toast('Data dari cache lokal');return;
      }
    }
  }catch(e){}
  hideLL();
  switchTab('new');
}

initTheme();
restoreSavedTheme();
boot();



/* ══════════════════════════════════════════════════════════════════
   EXPORT PDF v7 — Fixed SVG charts, fixed print layout
══════════════════════════════════════════════════════════════════ */
async function exportPDF(){
  const p=S.btcPrice||0, r=S.usdIdr||16000;
  const now=new Date();
  const dateStr=now.toLocaleDateString('id-ID',{year:'numeric',month:'long',day:'numeric'});
  const timeStr=now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const acctHash=await sha256(curSeed?curSeed.join('-'):'');
  const seedDisplay=acctHash?'ACCT-'+acctHash.slice(0,8).toUpperCase():'—';

  /* ─── KALKULASI ─── */
  let ti=0,tb=0;
  S.dca.forEach(e=>{ti+=e.amountIDR||0;tb+=e.btcAmount||0});
  const btcVal=tb*p*r, dcaPnl=btcVal-ti, dcaPnlPct=ti>0?dcaPnl/ti*100:0;
  const avgBuyUSD=tb>0?ti/tb/r:0;
  const dcaAsc=[...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date));
  let portTotal=0,portInvest=0;
  // FIX: exclude aset BTC auto-sync dari DCA (sudah dihitung di btcVal)
  S.port.forEach(x=>{
    if(x.ticker?.toLowerCase()==='btc'&&x._dcaManaged===true) return;
    portTotal+=x.qty*x.currentPrice;portInvest+=x.qty*x.avgPrice;
  });
  const portPnl=portTotal-portInvest,portPnlPct=portInvest>0?portPnl/portInvest*100:0;
  let cfInc=0,cfExp=0,cfInv=0;
  S.cf.forEach(e=>{if(e.type==='income')cfInc+=e.amount;else if(e.type==='expense')cfExp+=e.amount;else cfInv+=e.amount;});
  const cfNet=cfInc-cfExp-cfInv;
  const cfDesc=[...S.cf].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const grandTotal=btcVal+portTotal,totalInvest=ti+portInvest;
  const grandPnl=grandTotal-totalInvest,grandPnlPct=totalInvest>0?grandPnl/totalInvest*100:0;

  /* ─── FORMATTERS ─── */
  const idr=n=>{n=Math.round(n);const a=Math.abs(n),s=n<0?'-':'';if(a>=1e12)return s+'Rp '+(a/1e12).toFixed(2)+'T';if(a>=1e9)return s+'Rp '+(a/1e9).toFixed(2)+'M';if(a>=1e6)return s+'Rp '+(a/1e6).toFixed(2)+'jt';return s+'Rp '+a.toLocaleString('id-ID');};
  const pct=(n,sign=true)=>(sign&&n>=0?'+':'')+n.toFixed(2)+'%';
  const gc=n=>n>=0?'#059669':'#ef4444';
  const arr=n=>n>=0?'▲':'▼';

  /* ─── SVG CHARTS (fully self-contained, no CSS dependency) ─── */
  function makeSVG(w,h,content){
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;width:${w}px;height:${h}px">${content}</svg>`;
  }

  function growthSVG(){
    const W=660,H=180;
    if(!dcaAsc.length){
      return makeSVG(W,H,`<rect width="${W}" height="${H}" fill="#f9fafb" rx="4"/><text x="${W/2}" y="${H/2+5}" text-anchor="middle" fill="#9ca3af" font-size="12" font-family="Arial">Belum ada data DCA</text>`);
    }
    let cumBTC=0,cumIDR=0;
    const pts=dcaAsc.map(e=>{
      cumBTC+=e.btcAmount||0; cumIDR+=e.amountIDR||0;
      return {val:Math.round(cumBTC*p*r), inv:Math.round(cumIDR), d:e.date};
    });
    const PL=62,PR=12,PT=12,PB=32;
    const iW=W-PL-PR, iH=H-PT-PB;
    const maxV=Math.max(...pts.map(x=>Math.max(x.val,x.inv)),1);
    const sx=i=>PL+i/(Math.max(pts.length-1,1))*iW;
    const sy=v=>PT+iH*(1-v/maxV);
    // Grid
    let g='';
    [0,0.25,0.5,0.75,1].forEach(t=>{
      const v=t*maxV,y=sy(v);
      const lv=v>=1e6?(v/1e6).toFixed(1)+'jt':v>=1e3?(v/1e3).toFixed(0)+'rb':Math.round(v)+'';
      g+=`<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W-PR}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="0.7"/>`;
      g+=`<text x="${(PL-4).toFixed(1)}" y="${(y+3.5).toFixed(1)}" text-anchor="end" fill="#9ca3af" font-size="8" font-family="Arial">${lv}</text>`;
    });
    // X labels (pick up to 7 evenly)
    const step=Math.max(1,Math.ceil(pts.length/7));
    for(let i=0;i<pts.length;i++){
      if(i%step===0||i===pts.length-1){
        const x=sx(i);
        g+=`<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${(PT+iH).toFixed(1)}" stroke="#f3f4f6" stroke-width="0.7"/>`;
        g+=`<text x="${x.toFixed(1)}" y="${(PT+iH+14).toFixed(1)}" text-anchor="middle" fill="#9ca3af" font-size="8" font-family="Arial">${pts[i].d.slice(0,7)}</text>`;
      }
    }
    // Area + lines
    const vp=pts.map((x,i)=>`${sx(i).toFixed(1)},${sy(x.val).toFixed(1)}`).join(' ');
    const ip=pts.map((x,i)=>`${sx(i).toFixed(1)},${sy(x.inv).toFixed(1)}`).join(' ');
    const base=(PT+iH).toFixed(1);
    const vArea=`${PL},${base} ${vp} ${(W-PR).toFixed(1)},${base}`;
    const iArea=`${PL},${base} ${ip} ${(W-PR).toFixed(1)},${base}`;
    return makeSVG(W,H,`
      <rect width="${W}" height="${H}" fill="white"/>
      <rect x="${PL}" y="${PT}" width="${iW}" height="${iH}" fill="#fafeff"/>
      ${g}
      <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${base}" stroke="#d1d5db" stroke-width="1"/>
      <polygon points="${iArea}" fill="#e0f9ff" opacity="0.6"/>
      <polygon points="${vArea}" fill="#d1fae5" opacity="0.7"/>
      <polyline points="${ip}" fill="none" stroke="#06b6d4" stroke-width="1.8" stroke-dasharray="5,3"/>
      <polyline points="${vp}" fill="none" stroke="#059669" stroke-width="2.2"/>
    `);
  }

  function pnlBarSVG(){
    const W=660,H=110;
    if(!dcaAsc.length){
      return makeSVG(W,H,`<rect width="${W}" height="${H}" fill="#f9fafb" rx="4"/><text x="${W/2}" y="${H/2+5}" text-anchor="middle" fill="#9ca3af" font-size="12" font-family="Arial">Belum ada data</text>`);
    }
    const pnls=dcaAsc.map(e=>(e.btcAmount||0)*p*r-e.amountIDR);
    const maxA=Math.max(...pnls.map(Math.abs),1);
    const PL=12,PR=12,PT=10,PB=10;
    const iW=W-PL-PR, iH=(H-PT-PB)/2, midY=PT+iH;
    const n=pnls.length;
    const bW=Math.max(3,Math.min(16,iW/n*0.6));
    let bars='';
    pnls.forEach((v,i)=>{
      const x=PL+(i/(Math.max(n-1,1)))*(iW-bW);
      const h=Math.max(Math.abs(v)/maxA*iH,2);
      const c=v>=0?'#059669':'#ef4444';
      const y=v>=0?midY-h:midY;
      bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}" rx="2" opacity="0.8"/>`;
    });
    return makeSVG(W,H,`
      <rect width="${W}" height="${H}" fill="white"/>
      <line x1="${PL}" y1="${midY.toFixed(1)}" x2="${W-PR}" y2="${midY.toFixed(1)}" stroke="#d1d5db" stroke-width="1.5"/>
      <text x="${PL+2}" y="${PT+9}" fill="#059669" font-size="8" font-family="Arial" font-weight="bold">▲ UNTUNG</text>
      <text x="${PL+2}" y="${H-2}" fill="#ef4444" font-size="8" font-family="Arial" font-weight="bold">▼ RUGI</text>
      ${bars}
    `);
  }

  /* ─── HTML TEMPLATE ─── */
  const css=`
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#cbd5e1}

/* SAVE BAR */
.topbar{position:fixed;top:0;left:0;right:0;z-index:999;height:56px;
  background:linear-gradient(90deg,#0891b2,#7c3aed);
  display:flex;align-items:center;justify-content:space-between;padding:0 18px;
  box-shadow:0 2px 12px rgba(0,0,0,.3)}
.topbar-left .t1{font-weight:800;font-size:14px;color:#fff}
.topbar-left .t2{font-size:9.5px;color:rgba(255,255,255,.7);margin-top:1px}
.btn-pdf{background:#fff;color:#0891b2;border:none;border-radius:9px;
  padding:9px 20px;font-size:13px;font-weight:800;cursor:pointer;
  display:flex;align-items:center;gap:7px;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.btn-pdf:hover{background:#ecfeff}
@media print{.topbar{display:none!important}}

/* PAGES */
.wrap{padding:72px 16px 16px}
.pg{width:210mm;margin:0 auto 20px;background:#fff;
  box-shadow:0 4px 24px rgba(0,0,0,.15);
  page-break-after:always;break-after:page;
  display:flex;flex-direction:column;overflow:hidden}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
  html,body{background:#fff!important;margin:0!important;padding:0!important}
  .wrap{padding:0!important;margin:0!important}
  .pg{width:210mm!important;height:297mm!important;min-height:unset!important;max-height:297mm!important;margin:0!important;padding:0!important;box-shadow:none!important;border-radius:0!important;overflow:hidden!important;page-break-after:always!important;break-after:page!important;page-break-inside:avoid!important;break-inside:avoid!important;display:flex!important;flex-direction:column!important}
  .pg:last-child{page-break-after:auto!important;break-after:auto!important}
  .pb{flex:1!important;overflow:hidden!important;min-height:0!important}
  svg{display:block!important;overflow:visible!important}
  @page{size:A4 portrait;margin:0}
}

/* PAGE HEADER */
.ph{display:flex;justify-content:space-between;align-items:center;
  padding:10px 16px;
  background:linear-gradient(90deg,#0891b2 0%,#06b6d4 45%,#7c3aed 100%);
  flex-shrink:0}
.ph-logo-main{font-size:0;display:flex;align-items:baseline;gap:0}
.ph-logo-z{color:#00e5ff;font-style:italic;font-weight:900;font-size:23px;letter-spacing:-.03em;text-shadow:0 0 10px rgba(0,229,255,.5)}
.ph-logo-hyphen{color:rgba(0,229,255,.4);font-weight:300;font-size:17px;margin:0 1px}
.ph-logo-wealth{color:#fff;font-weight:800;font-size:23px;letter-spacing:-.02em}
.ph-logo-sub{font-size:7.5px;color:rgba(255,255,255,.55);letter-spacing:.08em;margin-top:2px}
.ph-right{text-align:right}
.ph-title{font-size:11.5px;font-weight:800;color:#fff;letter-spacing:.05em}
.ph-meta{font-size:8px;color:rgba(255,255,255,.75);margin-top:1.5px}

/* PAGE BODY + FOOTER */
.pb{flex:1;padding:12px 15px 6px}
.pf{padding:5px 15px 6px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:7.5px;color:#9ca3af;flex-shrink:0}

/* SECTION */
.s{margin-bottom:6px;margin-top:11px}
.s:first-child{margin-top:0}
.s-t{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#0891b2;
  border-bottom:2px solid #bae6fd;padding-bottom:3px;padding-left:8px;position:relative}
.s-t::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(#0891b2,#7c3aed);border-radius:2px}
.s-sub{font-size:8.5px;color:#6b7280;margin-top:2px;padding-left:8px}

/* CARDS */
.c4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px}
.card{border-radius:7px;padding:8px 10px;border:1px solid #e5e7eb;background:#fff;border-top-width:3px}
.card-l{font-size:7px;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:4px;font-weight:700}
.card-v{font-size:13px;font-weight:800;color:#111;line-height:1.2;word-break:break-all}
.card-s{font-size:8.5px;margin-top:3px}

/* TABLE */
.t{width:100%;border-collapse:collapse;font-size:9.5px;margin-bottom:9px}
.t thead tr{background:linear-gradient(90deg,#0891b2,#0e7490)}
.t th{padding:5px 7px;font-size:8px;text-transform:uppercase;letter-spacing:.05em;color:#fff;font-weight:700;text-align:left;white-space:nowrap}
.t td{padding:4.5px 7px;border-bottom:1px solid #f0f4f8;color:#374151;vertical-align:middle}
.t tbody tr:nth-child(even) td{background:#f8fbff}
.t tfoot td{background:#eff6ff!important;font-weight:700;font-size:9.5px;border-top:2px solid #bfdbfe;padding:5px 7px;color:#1e40af}
.kl{color:#6b7280;width:25%}.vl{width:25%}
.fw{font-weight:700}.er{text-align:center;color:#9ca3af;padding:14px!important;font-style:italic}

/* CHART */
.leg{display:flex;gap:12px;margin:3px 0 5px 2px}
.li{display:inline-flex;align-items:center;gap:4px;font-size:9px;color:#374151}
.ld{width:9px;height:9px;border-radius:2px;flex-shrink:0}
.cb{border:1px solid #e5e7eb;border-radius:5px;overflow:hidden;margin-bottom:8px;background:#fff;line-height:0}

/* CF */
.cf4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:9px}
.cfc{border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;background:#fff}
.cfl{font-size:7px;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:4px;font-weight:700}
.cfv{font-size:14px;font-weight:800;color:#111}

/* COLORS */
.g{color:#059669!important}.r{color:#ef4444!important}.c{color:#06b6d4!important}.m{color:#6b7280!important}
`;

  /* PAGE BUILDERS */
  const PH=(pg,tot)=>`<div class="ph">
    <div>
      <div class="ph-logo-main"><span class="ph-logo-z">z</span><span class="ph-logo-hyphen">-</span><span class="ph-logo-wealth">wealth</span></div>
      <div class="ph-logo-sub">z-wealth.vercel.app</div>
    </div>
    <div class="ph-right">
      <div class="ph-title">LAPORAN KEUANGAN</div>
      <div class="ph-meta">Per ${dateStr}</div>
      <div class="ph-meta">Akun: ${seedDisplay} &nbsp;·&nbsp; Hal. ${pg}/${tot}</div>
    </div>
  </div>`;

  const PF=(pg,tot)=>`<div class="pf">
    <span>z-wealth.vercel.app · Laporan Konfidensial</span>
    <span>Generate: ${dateStr} ${timeStr} WIB &nbsp;·&nbsp; BTC $${p.toLocaleString('en-US')}</span>
    <span>Halaman ${pg} dari ${tot}</span>
  </div>`;

  const SEC=(t,s='')=>`<div class="s"><div class="s-t">${t}</div>${s?`<div class="s-sub">${s}</div>`:''}</div>`;

  const CARD=(color,label,val,sub='',sc='')=>`<div class="card" style="border-top-color:${color}">
    <div class="card-l">${label}</div>
    <div class="card-v">${val}</div>
    ${sub?`<div class="card-s ${sc}">${sub}</div>`:''}
  </div>`;

  const TBL=(heads,rows,foot='')=>`<table class="t">
    <thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
    ${foot?`<tfoot><tr>${foot}</tr></tfoot>`:''}
  </table>`;

  const TOT=6;

  /* PAGE 1 */
  const P1=`<div class="pg">
    ${PH(1,TOT)}
    <div class="pb">
      ${SEC('I. Ikhtisar Keuangan','Ringkasan posisi keuangan per '+dateStr)}
      <div class="c4">
        ${CARD('#059669','Total Nilai Portofolio',idr(grandTotal),arr(grandPnl)+' '+pct(grandPnlPct)+' dari modal',grandPnl>=0?'g':'r')}
        ${CARD('#06b6d4','Total Modal Diinvestasikan',idr(totalInvest),'DCA + Aset lainnya','m')}
        ${CARD('#f59e0b','Unrealized P&L','<span class="'+(grandPnl>=0?'g':'r')+'">'+(grandPnl>=0?'+':'')+idr(grandPnl)+'</span>',pct(grandPnlPct)+' return keseluruhan',grandPnl>=0?'g':'r')}
        ${CARD('#7c3aed','Kas Bersih',idr(cfNet),'Pemasukan - pengeluaran - investasi','m')}
      </div>
      ${SEC('II. Rincian Per Kategori')}
      ${TBL(
        ['Kategori','Modal Masuk','Nilai Sekarang','P&L (IDR)','Return'],
        `<tr><td class="fw">Bitcoin DCA</td><td>${idr(ti)}</td><td>${idr(btcVal)}</td><td class="${dcaPnl>=0?'g':'r'}">${dcaPnl>=0?'+':''} ${idr(dcaPnl)}</td><td class="${dcaPnl>=0?'g':'r'}">${pct(dcaPnlPct)}</td></tr>
         <tr><td class="fw">Portofolio Aset</td><td>${idr(portInvest)}</td><td>${idr(portTotal)}</td><td class="${portPnl>=0?'g':'r'}">${portPnl>=0?'+':''} ${idr(portPnl)}</td><td class="${portPnl>=0?'g':'r'}">${pct(portPnlPct)}</td></tr>
         <tr><td class="fw">Arus Kas Bersih</td><td>${idr(cfInc)}</td><td>—</td><td class="${cfNet>=0?'g':'r'}">${cfNet>=0?'+ ':''}${idr(cfNet)}</td><td>—</td></tr>`,
        `<td class="fw">TOTAL</td><td class="fw">${idr(totalInvest)}</td><td class="fw">${idr(grandTotal)}</td><td class="fw ${grandPnl>=0?'g':'r'}">${grandPnl>=0?'+':''} ${idr(grandPnl)}</td><td class="fw ${grandPnl>=0?'g':'r'}">${pct(grandPnlPct)}</td>`
      )}
      ${SEC('III. Informasi Bitcoin Live')}
      <table class="t">
        <tbody>
          <tr><td class="kl">Harga BTC saat ini</td><td class="fw" style="color:#f59e0b">$${p.toLocaleString('en-US')} USD</td><td class="kl">Kurs USD/IDR</td><td>Rp ${Math.round(r).toLocaleString('id-ID')}</td></tr>
          <tr><td class="kl">Perubahan 24 jam</td><td class="fw ${(S.btcChange||0)>=0?'g':'r'}">${arr(S.btcChange||0)} ${pct(S.btcChange||0,false)}</td><td class="kl">BTC dalam IDR</td><td>${idr(p*r)}</td></tr>
          <tr><td class="kl">Avg Buy Price (DCA)</td><td class="fw">$${Math.round(avgBuyUSD).toLocaleString('en-US')}</td><td class="kl">Total BTC diperoleh</td><td class="fw" style="color:#f59e0b">${tb.toFixed(8)} BTC</td></tr>
        </tbody>
      </table>
    </div>
    ${PF(1,TOT)}
  </div>`;

  /* PAGE 2 — CHARTS */
  const P2=`<div class="pg">
    ${PH(2,TOT)}
    <div class="pb">
      ${SEC('IV. Grafik Pertumbuhan Portofolio DCA','Nilai portofolio vs modal yang diinvestasikan sepanjang waktu')}
      <div class="leg">
        <span class="li"><span class="ld" style="background:#059669"></span>Nilai Portofolio</span>
        <span class="li"><span class="ld" style="background:#06b6d4;opacity:.7"></span>Modal Masuk</span>
      </div>
      <div class="cb">${growthSVG()}</div>
      ${SEC('V. P&L Per Entry DCA','Untung/rugi tiap transaksi berdasarkan harga BTC terkini')}
      <div class="leg">
        <span class="li"><span class="ld" style="background:#059669"></span>Untung</span>
        <span class="li"><span class="ld" style="background:#ef4444"></span>Rugi</span>
      </div>
      <div class="cb">${pnlBarSVG()}</div>
    </div>
    ${PF(2,TOT)}
  </div>`;

  /* PAGE 3 — DCA */
  const dcaRows=dcaAsc.map((e,i)=>{
    const cv=(e.btcAmount||0)*p*r,pnl=cv-e.amountIDR,pp=e.amountIDR>0?pnl/e.amountIDR*100:0;
    return `<tr>
      <td style="text-align:center;color:#9ca3af">${i+1}</td>
      <td>${e.date}</td>
      <td style="text-align:right">$${Math.round(e.priceUSD||0).toLocaleString('en-US')}</td>
      <td style="text-align:right">${idr(e.amountIDR)}</td>
      <td style="text-align:right;color:#f59e0b">${(e.btcAmount||0).toFixed(8)}</td>
      <td style="text-align:right">${idr(cv)}</td>
      <td style="text-align:right" class="${pnl>=0?'g':'r'}">${pnl>=0?'+':''} ${idr(Math.abs(pnl))}</td>
      <td style="text-align:center"><span style="padding:2px 5px;border-radius:3px;font-size:8.5px;font-weight:700;background:${pnl>=0?'#dcfce7':'#fee2e2'};color:${pnl>=0?'#059669':'#ef4444'}">${pct(pp)}</span></td>
    </tr>`;
  }).join('');

  const P3=`<div class="pg">
    ${PH(3,TOT)}
    <div class="pb">
      ${SEC('VI. Statistik DCA Bitcoin')}
      <div class="c4">
        ${CARD('#06b6d4','Total Investasi',idr(ti),'','m')}
        ${CARD('#059669','Nilai Sekarang',idr(btcVal),(dcaPnl>=0?'+':'')+idr(dcaPnl),dcaPnl>=0?'g':'r')}
        ${CARD('#f59e0b','Average Buy Price','$'+Math.round(avgBuyUSD).toLocaleString('en-US'),'','m')}
        ${CARD('#7c3aed','Total BTC',tb.toFixed(8),'BTC diperoleh','m')}
      </div>
      ${SEC('VII. Histori Transaksi DCA')}
      ${TBL(
        ['#','Tanggal','Harga BTC','Modal IDR','BTC','Nilai Kini','P&L','Return'],
        dcaAsc.length?dcaRows:'<tr><td colspan="8" class="er">Belum ada transaksi DCA</td></tr>',
        dcaAsc.length?`<td></td><td class="fw">TOTAL</td><td style="text-align:right" class="fw">$${Math.round(avgBuyUSD).toLocaleString('en-US')}</td><td style="text-align:right" class="fw">${idr(ti)}</td><td style="text-align:right;color:#f59e0b" class="fw">${tb.toFixed(8)}</td><td style="text-align:right" class="fw">${idr(btcVal)}</td><td style="text-align:right" class="fw ${dcaPnl>=0?'g':'r'}">${dcaPnl>=0?'+':''} ${idr(Math.abs(dcaPnl))}</td><td style="text-align:center" class="fw ${dcaPnl>=0?'g':'r'}">${pct(dcaPnlPct)}</td>`:''
      )}
    </div>
    ${PF(3,TOT)}
  </div>`;

  /* PAGE 4 — PORTFOLIO */
  const portRows=S.port.map(x=>{
    const val=x.qty*x.currentPrice,inv=x.qty*x.avgPrice,pnl=val-inv,pp=inv>0?pnl/inv*100:0;
    return `<tr>
      <td><span class="fw">${x.name}</span> <span style="color:#9ca3af;font-size:8.5px">${x.ticker||''}</span></td>
      <td style="color:#6b7280">${x.type||'—'}</td>
      <td style="text-align:right">${x.qty}</td>
      <td style="text-align:right">${idr(x.avgPrice)}</td>
      <td style="text-align:right">${idr(x.currentPrice)}</td>
      <td style="text-align:right">${idr(val)}</td>
      <td style="text-align:right" class="${pnl>=0?'g':'r'}">${pnl>=0?'+':''} ${idr(Math.abs(pnl))}</td>
      <td style="text-align:center"><span style="padding:2px 5px;border-radius:3px;font-size:8.5px;font-weight:700;background:${pnl>=0?'#dcfce7':'#fee2e2'};color:${pnl>=0?'#059669':'#ef4444'}">${pct(pp)}</span></td>
    </tr>`;
  }).join('');

  const P4=`<div class="pg">
    ${PH(4,TOT)}
    <div class="pb">
      ${SEC('VIII. Portofolio Aset Lainnya')}
      <div class="c4">
        ${CARD('#06b6d4','Total Nilai Aset',idr(portTotal),'','m')}
        ${CARD('#f59e0b','Total Modal',idr(portInvest),'','m')}
        ${CARD('#059669','Unrealized P&L','<span class="'+(portPnl>=0?'g':'r')+'">'+(portPnl>=0?'+':'')+idr(portPnl)+'</span>',pct(portPnlPct),portPnl>=0?'g':'r')}
        ${CARD('#7c3aed','Jumlah Aset',S.port.length+' aset','instrumen','m')}
      </div>
      ${SEC('IX. Detail Aset')}
      ${TBL(
        ['Nama','Tipe','Qty','Avg Buy','Harga Kini','Nilai','P&L','Return'],
        S.port.length?portRows:'<tr><td colspan="8" class="er">Belum ada aset di portofolio</td></tr>',
        S.port.length?`<td colspan="5" class="fw">TOTAL PORTOFOLIO</td><td style="text-align:right" class="fw">${idr(portTotal)}</td><td style="text-align:right" class="fw ${portPnl>=0?'g':'r'}">${portPnl>=0?'+':''} ${idr(Math.abs(portPnl))}</td><td style="text-align:center" class="fw ${portPnl>=0?'g':'r'}">${pct(portPnlPct)}</td>`:''
      )}
    </div>
    ${PF(4,TOT)}
  </div>`;

  /* PAGE 5 — CASHFLOW */
  const cfRows=cfDesc.map(e=>{
    const TL={income:'Pemasukan',expense:'Pengeluaran',investment:'Investasi'};
    const TC={income:'#059669',expense:'#ef4444',investment:'#06b6d4'};
    const TB={income:'#dcfce7',expense:'#fee2e2',investment:'#e0f9ff'};
    return `<tr>
      <td>${e.date}</td>
      <td><span style="padding:2px 6px;border-radius:3px;font-size:8.5px;font-weight:700;background:${TB[e.type]||'#f3f4f6'};color:${TC[e.type]||'#374151'}">${TL[e.type]||e.type}</span></td>
      <td>${e.category}</td>
      <td style="color:#6b7280">${e.desc ? e.desc.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '—'}</td>
      <td style="text-align:right" class="${e.type==='income'?'g':e.type==='expense'?'r':'c'}">${e.type==='income'?'+ ':'- '}${idr(e.amount)}</td>
    </tr>`;
  }).join('');

  const P5=`<div class="pg">
    ${PH(5,TOT)}
    <div class="pb">
      ${SEC('X. Arus Kas (Cashflow)')}
      <div class="cf4">
        <div class="cfc" style="border-left:3px solid #059669"><div class="cfl">Total Pemasukan</div><div class="cfv g">${idr(cfInc)}</div></div>
        <div class="cfc" style="border-left:3px solid #ef4444"><div class="cfl">Total Pengeluaran</div><div class="cfv r">${idr(cfExp)}</div></div>
        <div class="cfc" style="border-left:3px solid #06b6d4"><div class="cfl" data-i18n="stat.totalinvest">Total Investasi</div><div class="cfv c">${idr(cfInv)}</div></div>
        <div class="cfc" style="border-left:3px solid ${cfNet>=0?'#059669':'#ef4444'}"><div class="cfl" data-i18n="stat.netbalance">Saldo Bersih</div><div class="cfv ${cfNet>=0?'g':'r'}">${cfNet>=0?'+':''}${idr(cfNet)}</div></div>
      </div>
      ${SEC('XI. Rincian Transaksi Kas')}
      ${TBL(
        ['Tanggal','Tipe','Kategori','Deskripsi','Jumlah'],
        cfDesc.length?cfRows:'<tr><td colspan="5" class="er">Belum ada transaksi kas</td></tr>'
      )}
    </div>
    ${PF(5,TOT)}
  </div>`;

  /* PAGE 6 — RINGKASAN */
  const P6=`<div class="pg">
    ${PH(6,TOT)}
    <div class="pb">
      ${SEC('XII. Ringkasan Akhir & Konsolidasi')}
      <div class="c4">
        ${CARD('#059669','Total Aset Keseluruhan',idr(grandTotal),(grandPnl>=0?'+':'')+idr(grandPnl)+' ('+pct(grandPnlPct)+')',grandPnl>=0?'g':'r')}
        ${CARD('#06b6d4','Total Modal Seluruhnya',idr(totalInvest),'DCA + Aset + Investasi','m')}
        ${CARD('#f59e0b','Bitcoin DCA',idr(btcVal),tb.toFixed(8)+' BTC · avg $'+Math.round(avgBuyUSD).toLocaleString('en-US'),'m')}
        ${CARD('#7c3aed','Portofolio Aset',idr(portTotal),S.port.length+' instrumen','m')}
      </div>
      <div class="c4" style="margin-top:6px">
        ${CARD('#059669','Kas Bersih',idr(cfNet),'Pemasukan - Pengeluaran - Investasi',cfNet>=0?'g':'r')}
        ${CARD('#f59e0b','Total Pemasukan',idr(cfInc),'','g')}
        ${CARD('#ef4444','Total Pengeluaran',idr(cfExp),'','r')}
        ${CARD('#06b6d4','Total Inv. Kas',idr(cfInv),'','c')}
      </div>
      <div style="margin-top:12px;background:#fffbeb;border:1px solid #fef08a;border-left:4px solid #f59e0b;border-radius:6px;padding:11px 14px">
        <div style="font-size:10.5px;font-weight:800;color:#92400e;margin-bottom:5px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Disclaimer</div>
        <div style="font-size:9.5px;line-height:1.85;color:#374151">
          Laporan ini dibuat otomatis oleh z-wealth untuk keperluan dokumentasi pribadi. Data portofolio berdasarkan harga Bitcoin real-time saat laporan digenerate.<br>
          Dokumen ini <strong>bukan merupakan rekomendasi investasi</strong>. Nilai investasi dapat naik maupun turun. Selalu lakukan riset mandiri (DYOR).<br>
          <span style="color:#9ca3af;font-size:8.5px">z-wealth — Laporan Keuangan Konfidensial — ${dateStr}</span>
        </div>
      </div>
    </div>
    ${PF(6,TOT)}
  </div>`;

  /* ASSEMBLE HTML */
  const HTML=`<!DOCTYPE html>
<html lang="id"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>z-wealth — Laporan ${dateStr}</title>
<style>${css}</style>
</head><body>
<div class="topbar">
  <div class="topbar-left">
    <div class="t1"><span style="color:#00c8ff;font-style:italic;font-weight:900">z</span><span style="color:rgba(255,255,255,.85)">-wealth</span> &nbsp;—&nbsp; Laporan Keuangan</div>
    <div class="t2">${dateStr} &nbsp;·&nbsp; Akun: ${seedDisplay} &nbsp;·&nbsp; BTC $${p.toLocaleString('en-US')}</div>
  </div>
  <button class="btn-pdf" onclick="window.print()">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Simpan PDF
  </button>
</div>
<div class="wrap">${P1}${P2}${P3}${P4}${P5}${P6}</div>

</body></html>`;

  /* DELIVER */
  const blob=new Blob([HTML],{type:'text/html;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank');
  if(win){
    setTimeout(()=>URL.revokeObjectURL(url),20000);
    toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Laporan dibuka! Klik "Simpan PDF" di halaman tersebut');
  } else {
    const a=document.createElement('a');
    a.href=url;
    a.download=`z-wealth-laporan-${now.toISOString().slice(0,10)}.html`;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> File laporan diunduh — buka lalu klik Simpan PDF');
  }
}



/* ══════════════════════════════════════════════════════════════════
   SHARE CARD — Canvas-based JPG generator (Bybit-style, DCA context)
══════════════════════════════════════════════════════════════════ */
function showShareCard(){
  if(!S.dca.length){toast('Tambahkan transaksi DCA dulu',1);return;}
  if(!S.btcPrice){toast('Menunggu data harga BTC...',1);return;}

  const modal=document.getElementById('modal-share');
  modal.style.display='flex';
  // slight delay so modal is visible before heavy canvas draw
  setTimeout(drawShareCard,80);
}


// ── CHART SHARE CARD ──
function openChartShareModal() {
  const modal = document.getElementById('chart-share-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  setTimeout(() => generateChartShareCard(), 100);
}

function closeChartShareModal() {
  const modal = document.getElementById('chart-share-modal');
  if (modal) modal.style.display = 'none';
}

async function generateChartShareCard() {
  const canvas = document.getElementById('chart-share-canvas');
  if (!canvas) return;
  if (!cBTCLive) {
    // Show error message on canvas
    const W2=1080,H2=1440; canvas.width=W2; canvas.height=H2;
    const ctx2=canvas.getContext('2d');
    ctx2.fillStyle='#04060f'; ctx2.fillRect(0,0,W2,H2);
    ctx2.font='bold 36px Inter,sans-serif'; ctx2.fillStyle='rgba(148,163,184,0.5)';
    ctx2.textAlign='center'; ctx2.fillText('Memuat chart...', W2/2, H2/2);
    ctx2.textAlign='left'; return;
  }
  try {

  const W = 1080, H = 1440;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── BACKGROUND ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#04060f'); bg.addColorStop(1, '#080e1c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,229,255,0.02)';
  for (let x=40;x<W;x+=55) for (let y=40;y<H;y+=55){ctx.beginPath();ctx.arc(x,y,1,0,Math.PI*2);ctx.fill();}
  const gTop=ctx.createRadialGradient(W/2,0,0,W/2,0,500);
  gTop.addColorStop(0,'rgba(0,229,255,0.06)');gTop.addColorStop(1,'transparent');
  ctx.fillStyle=gTop;ctx.fillRect(0,0,W,500);

  const PAD = 64;

  // Count active overlays for dynamic sizing
  const activeOverlays = ['gold','sp500','m2'].filter(k => overlayEnabled[k]);
  const nOverlay = activeOverlays.length;

  // ── FIXED HEIGHTS ──
  const HEADER_H  = 160;  // logo + domain + breathing room
  const PRICE_H   = 190;  // price + badge + gap
  const DIV_H     = 48;   // divider
  const OV_ROW_H  = 68;   // each overlay row (MUST be before BTC_RET_H)
  const BTC_RET_H = OV_ROW_H;  // bitcoin row same height
  const FOOTER_H  = 50;   // date footer
  const FOOTER_PAD = 16;

  const totalFixed = PAD + HEADER_H + PRICE_H + DIV_H + BTC_RET_H + (nOverlay * OV_ROW_H) + DIV_H + FOOTER_H + FOOTER_PAD + PAD;
  const chartH = Math.max(360, H - totalFixed);

  // ── LAYOUT Y POSITIONS ──
  let y = PAD;

  // LOGO + DOMAIN
  const logoBaseline = y + 36;
  ctx.shadowBlur = 0;
  drawZWealthLogo(ctx, PAD, logoBaseline, 30, '#00e5ff');
  ctx.font = '400 22px Inter,sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,0.4)';
  ctx.fillText('z-wealth.vercel.app', PAD, logoBaseline + 32);

  // TIMEFRAME top-right
  const tfLabelRaw = (TF_CONFIG[curTF]?.label) || curTF;
  const tfLabel = 'Return ' + tfLabelRaw;
  ctx.font = '600 26px Inter,sans-serif';
  const tfW = ctx.measureText(tfLabel).width + 36;
  ctx.fillStyle = 'rgba(0,229,255,0.08)';
  ctx.beginPath(); ctx.roundRect(W-PAD-tfW, y+8, tfW, 42, 10); ctx.fill();
  ctx.strokeStyle='rgba(0,229,255,0.18)';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='rgba(0,229,255,0.8)';
  ctx.textAlign='center';
  ctx.fillText(tfLabel, W-PAD-tfW/2, y+36);
  ctx.textAlign='left';

  y += HEADER_H;

  // BTC PRICE
  const price = S.btcPrice || 0;
  const ch = S.btcChange || 0;
  const isUp = ch >= 0;
  const badgeColor = isUp ? '#10b981' : '#ef4444';
  const badgeBg = isUp ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';

  ctx.font = '700 92px Space Mono,monospace';
  ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 0;
  ctx.fillText('$'+price.toLocaleString('en-US',{maximumFractionDigits:0}), PAD, y+78);

  // Badge
  const chText = (isUp?'▲ +':'▼ ')+ch.toFixed(2)+'%';
  ctx.font = 'bold 30px Inter,sans-serif';
  const pillW = ctx.measureText(chText).width + 44;
  ctx.fillStyle = badgeBg;
  ctx.beginPath();ctx.roundRect(PAD, y+90, pillW, 48, 12);ctx.fill();
  ctx.strokeStyle=badgeColor+'50';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle=badgeColor;
  ctx.fillText(chText, PAD+22, y+120);

  y += PRICE_H;

  // CHART
  const srcCanvas = document.getElementById('c-btclive');
  if (srcCanvas) ctx.drawImage(srcCanvas, PAD, y, W-PAD*2, chartH);
  y += chartH;

  // DIVIDER
  y += 20;
  const dg=ctx.createLinearGradient(PAD,0,W-PAD,0);
  dg.addColorStop(0,'transparent');dg.addColorStop(0.5,'rgba(0,229,255,0.2)');dg.addColorStop(1,'transparent');
  ctx.strokeStyle=dg;ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(PAD,y);ctx.lineTo(W-PAD,y);ctx.stroke();
  y += 24;

  // BTC RETURN
  const retPct = document.getElementById('btcc-return-pct')?.textContent || '';
  const retLabel = document.getElementById('btcc-return-label')?.textContent || '';
  const retUp = !retPct.startsWith('-');
  const retColor = retUp ? '#10b981' : '#ef4444';

  const btcRowH = OV_ROW_H - 4;  // match overlay row height
  ctx.fillStyle = retUp ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)';
  ctx.beginPath();ctx.roundRect(PAD, y, W-PAD*2, btcRowH, 12);ctx.fill();
  ctx.strokeStyle=retColor+'25';ctx.lineWidth=1;ctx.stroke();
  // Dot (hijau/merah seperti overlay)
  ctx.fillStyle=retColor;
  ctx.beginPath();ctx.arc(PAD+24, y+btcRowH/2, 6, 0, Math.PI*2);ctx.fill();
  // Label Bitcoin
  ctx.font='600 26px Inter,sans-serif';ctx.fillStyle='rgba(226,232,240,0.65)';
  ctx.fillText('Bitcoin', PAD+46, y+btcRowH/2+9);
  // % kanan - font sama dengan overlay
  ctx.font='bold 32px Space Mono,monospace';ctx.fillStyle=retColor;
  ctx.textAlign='right';
  ctx.fillText(retPct, W-PAD-22, y+btcRowH/2+11);
  ctx.textAlign='left';
  y += OV_ROW_H;  // same step as overlay rows

  // OVERLAY ROWS
  const overlayDefs = [
    {key:'gold',  label:'Emas (XAU)', pctId:'ret-gold-pct',  color:'#fbbf24'},
    {key:'sp500', label:'S&P 500',    pctId:'ret-sp500-pct', color:'#8b5cf6'},
    {key:'m2',    label:'Global M2',  pctId:'ret-m2-pct',    color:'#f59e0b'},
  ];
  for (const row of overlayDefs) {
    if (!overlayEnabled[row.key]) continue;
    const pStr = document.getElementById(row.pctId)?.textContent || '';
    const col = !pStr.startsWith('-') ? row.color : '#ef4444';
    const rowH = OV_ROW_H - 4;

    ctx.fillStyle='rgba(255,255,255,0.03)';
    ctx.beginPath();ctx.roundRect(PAD,y,W-PAD*2,rowH,10);ctx.fill();
    ctx.strokeStyle=row.color+'18';ctx.lineWidth=1;ctx.stroke();

    ctx.fillStyle=row.color;
    ctx.beginPath();ctx.arc(PAD+24,y+rowH/2,6,0,Math.PI*2);ctx.fill();

    ctx.font='600 26px Inter,sans-serif';ctx.fillStyle='rgba(226,232,240,0.65)';
    ctx.fillText(row.label, PAD+46, y+rowH/2+9);

    ctx.font='bold 32px Space Mono,monospace';ctx.fillStyle=col;
    ctx.textAlign='right';
    ctx.fillText(pStr, W-PAD-22, y+rowH/2+11);
    ctx.textAlign='left';
    y += OV_ROW_H;
  }

  // FOOTER — always at bottom, dark strip
  const footY = H - FOOTER_H - FOOTER_PAD;
  ctx.fillStyle='rgba(4,6,15,0.85)';
  ctx.fillRect(0, footY-10, W, FOOTER_H+FOOTER_PAD+10);
  ctx.font='400 22px Inter,sans-serif';ctx.fillStyle='rgba(100,116,139,0.5)';
  const dateStr=new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
  ctx.fillText(dateStr, PAD, footY+28);
  } catch(err) {
    console.error('generateChartShareCard error:', err);
    // Show error on canvas
    const W2=canvas.width||1080, H2=canvas.height||1440;
    const ctx2=canvas.getContext('2d');
    ctx2.fillStyle='#04060f'; ctx2.fillRect(0,0,W2,H2);
    ctx2.font='bold 32px Inter,sans-serif'; ctx2.fillStyle='#ef4444';
    ctx2.textAlign='center';
    ctx2.fillText('Error: '+err.message, W2/2, H2/2);
    ctx2.textAlign='left';
  }
}


function downloadChartCard() {
  const canvas = document.getElementById('chart-share-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'z-wealth-chart-' + curTF + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function closeShareModal(){
  document.getElementById('modal-share').style.display='none';
}

/* ── z-wealth canvas logo renderer ── */
function drawZWealthLogo(ctx, x, y, size, accentColor){
  ctx.save();
  const s = size;

  /* Underscore/bar behind z — design element */
  const barH = s * 0.07;
  const barY = y + barH;
  const grad = ctx.createLinearGradient(x, barY, x + s * 4.2, barY);
  grad.addColorStop(0, accentColor);
  grad.addColorStop(0.5, 'rgba(0,200,255,0.3)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(x, barY, s * 4.2, barH);

  /* "z" — italic 900, glowing */
  ctx.font = `italic 900 ${s}px "Segoe UI",Arial,sans-serif`;
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = s * 0.7;
  ctx.fillStyle = accentColor;
  ctx.fillText('z', x, y);
  const zW = ctx.measureText('z').width;
  ctx.shadowBlur = 0;

  /* "-" hyphen — very dim, thin */
  ctx.font = `300 ${Math.round(s * 0.7)}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = 'rgba(0,200,255,0.35)';
  const hx = x + zW + s * 0.04;
  ctx.fillText('-', hx, y - s * 0.06);
  const hW = ctx.measureText('-').width;

  /* "wealth" — regular weight, white */
  ctx.font = `700 ${s}px "Segoe UI",Arial,sans-serif`;
  ctx.fillStyle = '#f0f9ff';
  ctx.fillText('wealth', hx + hW + s * 0.02, y);

  ctx.restore();
}

function drawShareCard(){
  const p=S.btcPrice||0, usdIdr=S.usdIdr||16000;
  let ti=0,tb=0;
  S.dca.forEach(e=>{ti+=e.amountIDR||0;tb+=e.btcAmount||0});
  const cv=tb*p*usdIdr, pnl=cv-ti, pp=ti>0?pnl/ti*100:0;
  const avg=tb>0?ti/tb/usdIdr:0;
  const isProfit=pnl>=0;
  const now=new Date();
  const dtStr=now.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const since=[...S.dca].sort((a,b)=>new Date(a.date)-new Date(b.date))[0]?.date||'—';

  const W=1080,H=1350;
  const cv2=document.getElementById('share-canvas');
  cv2.width=W;cv2.height=H;
  const ctx=cv2.getContext('2d');

  // Colors
  const GREEN='#00f5a0', CYAN='#00d4ff', PURPLE='#a855f7', RED='#ff4d6d';
  const accentColor=isProfit?GREEN:RED;
  const accentR=isProfit?'0,245,160':'255,77,109';
  const PAD=72;
  function ac(a){return 'rgba('+accentR+','+a+')';}
  function rr(x,y,w,h,rad){
    if(w<=0||h<=0)return; rad=Math.min(rad,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rad,y);ctx.lineTo(x+w-rad,y);ctx.quadraticCurveTo(x+w,y,x+w,y+rad);
    ctx.lineTo(x+w,y+h-rad);ctx.quadraticCurveTo(x+w,y+h,x+w-rad,y+h);
    ctx.lineTo(x+rad,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-rad);
    ctx.lineTo(x,y+rad);ctx.quadraticCurveTo(x,y,x+rad,y);
    ctx.closePath();
  }

  // ── 1. BACKGROUND ──
  const isGlass = document.documentElement.getAttribute('data-style') === 'glass';
  if (isGlass) {
    // Liquid Glass card — light, translucent, ambient gradient
    const bgG=ctx.createLinearGradient(0,0,W,H);
    bgG.addColorStop(0,'#dde8f8');bgG.addColorStop(.5,'#e8eef8');bgG.addColorStop(1,'#e2ddf5');
    ctx.fillStyle=bgG;ctx.fillRect(0,0,W,H);
    // Ambient color blobs
    const glassBlobs = isProfit
      ? [[W*.15,H*.08,W*.7,'rgba(0,122,255,.14)'],[W*.85,H*.3,W*.6,'rgba(52,199,89,.12)'],[W*.5,H*.85,W*.65,'rgba(175,82,222,.1)']]
      : [[W*.15,H*.08,W*.7,'rgba(255,59,48,.13)'],[W*.85,H*.3,W*.6,'rgba(255,149,0,.1)'],[W*.5,H*.85,W*.55,'rgba(175,82,222,.1)']];
    glassBlobs.forEach(function(g){
      var gr=ctx.createRadialGradient(g[0],g[1],0,g[0],g[1],g[2]);gr.addColorStop(0,g[3]);gr.addColorStop(1,'transparent');ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
    });
    // Glass card overlay — frosted panel
    ctx.fillStyle='rgba(255,255,255,.35)';
    rr(40,40,W-80,H-80,48);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.7)';ctx.lineWidth=2;
    rr(40,40,W-80,H-80,48);ctx.stroke();
    // Specular highlight at top
    const specG=ctx.createLinearGradient(40,40,40,200);
    specG.addColorStop(0,'rgba(255,255,255,.6)');specG.addColorStop(1,'rgba(255,255,255,.0)');
    ctx.fillStyle=specG;rr(40,40,W-80,160,48);ctx.fill();
    // Light refraction top bar
    const rfG=ctx.createLinearGradient(80,40,W-80,40);
    rfG.addColorStop(0,'transparent');rfG.addColorStop(.3,'rgba(0,200,255,.5)');rfG.addColorStop(.5,'rgba(255,255,255,.9)');rfG.addColorStop(.7,'rgba(180,100,255,.5)');rfG.addColorStop(1,'transparent');
    ctx.fillStyle=rfG;ctx.fillRect(80,40,W-160,2);
  } else {
    const bgG=ctx.createLinearGradient(0,0,0,H);
    if(isProfit){bgG.addColorStop(0,'#060d10');bgG.addColorStop(1,'#040810');}
    else        {bgG.addColorStop(0,'#0d0608');bgG.addColorStop(1,'#080410');}
    ctx.fillStyle=bgG;ctx.fillRect(0,0,W,H);
  }

  // Grid (cyberpunk only)
  if (!isGlass) {
    ctx.strokeStyle=ac(0.03);ctx.lineWidth=1;
    for(let x=0;x<=W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<=H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  }

  // ── 2. GLOW BLOBS (cyberpunk only) ──
  if (!isGlass) {
    if(isProfit){
      [[W*.9,H*.08,W*.6,'rgba(0,245,160,0.13)'],[W*.05,H*.85,W*.55,'rgba(168,85,247,0.1)'],[W*.5,0,W*.45,'rgba(0,212,255,0.07)']].forEach(function(g){
        var gr=ctx.createRadialGradient(g[0],g[1],0,g[0],g[1],g[2]);gr.addColorStop(0,g[3]);gr.addColorStop(1,'transparent');ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
      });
    } else {
      [[W*.85,H*.12,W*.6,'rgba(255,77,109,0.14)'],[W*.05,H*.88,W*.5,'rgba(120,20,50,0.1)']].forEach(function(g){
        var gr=ctx.createRadialGradient(g[0],g[1],0,g[0],g[1],g[2]);gr.addColorStop(0,g[3]);gr.addColorStop(1,'transparent');ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
      });
    }
  }

  // ── 3. TOP RAINBOW BAR ──
  var tl=ctx.createLinearGradient(0,0,W,0);
  if(isProfit){tl.addColorStop(0,'transparent');tl.addColorStop(.15,GREEN);tl.addColorStop(.5,CYAN);tl.addColorStop(.8,PURPLE);tl.addColorStop(1,'transparent');}
  else        {tl.addColorStop(0,'transparent');tl.addColorStop(.3,RED);tl.addColorStop(.7,'rgba(200,30,60,.6)');tl.addColorStop(1,'transparent');}
  ctx.fillStyle=tl;ctx.fillRect(0,0,W,5);

  // ── 4. DECORATIVE CANDLESTICK CHART (BG) ──
  ctx.save();
  var cdata=isProfit?[.2,.35,.25,.5,.4,.6,.55,.75,.65,.85,.8,1,.9]:[1,.85,.9,.7,.8,.6,.65,.45,.5,.35,.4,.2,.1];
  var chartX=W-390,chartY=175,chartW=350,chartH=260,cww=chartW/cdata.length;
  ctx.globalAlpha=0.10;
  for(var ci=0;ci<cdata.length;ci++){
    var cv3=cdata[ci],cprev=ci>0?cdata[ci-1]:cv3,isBull=cv3>=cprev;
    var cbodyH=Math.max(Math.abs(cv3-cprev)*chartH,8);
    var cbodyY=chartY+(1-Math.max(cv3,cprev))*chartH;
    ctx.strokeStyle=isBull?GREEN:RED;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(chartX+ci*cww+cww*.35,chartY+(1-cv3)*chartH-12);ctx.lineTo(chartX+ci*cww+cww*.35,chartY+(1-cv3)*chartH+cbodyH+12);ctx.stroke();
    ctx.fillStyle=isBull?GREEN:RED;rr(chartX+ci*cww+cww*.15,cbodyY,cww*.7,cbodyH,3);ctx.fill();
  }
  ctx.globalAlpha=0.18;ctx.strokeStyle=accentColor;ctx.lineWidth=3;
  ctx.beginPath();
  for(var ci2=0;ci2<cdata.length;ci2++){ctx.lineTo(chartX+ci2*cww+cww*.5,chartY+(1-cdata[ci2])*chartH);}
  ctx.stroke();
  ctx.restore();

  // ── 5. ROCKET SILHOUETTE ──
  ctx.save();
  var rs=1.6,rx=W-120,ry=H*.41;
  ctx.translate(rx,ry);
  if(!isProfit){ctx.scale(1,-1);}
  if(isProfit){
    var bodyG=ctx.createLinearGradient(0,-110*rs,0,75*rs);
    bodyG.addColorStop(0,'rgba(168,85,247,0.18)');bodyG.addColorStop(.4,'rgba(0,212,255,0.16)');bodyG.addColorStop(1,'rgba(0,245,160,0.12)');
    ctx.fillStyle=bodyG;
  } else {ctx.fillStyle='rgba(255,60,90,0.10)';}
  ctx.beginPath();ctx.moveTo(0,-110*rs);ctx.bezierCurveTo(40*rs,-78*rs,50*rs,18*rs,30*rs,78*rs);ctx.lineTo(-30*rs,78*rs);ctx.bezierCurveTo(-50*rs,18*rs,-40*rs,-78*rs,0,-110*rs);ctx.closePath();ctx.fill();
  ctx.strokeStyle=isProfit?'rgba(0,212,255,0.3)':'rgba(255,60,90,0.25)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(0,-110*rs);ctx.bezierCurveTo(40*rs,-78*rs,50*rs,18*rs,30*rs,78*rs);ctx.lineTo(-30*rs,78*rs);ctx.bezierCurveTo(-50*rs,18*rs,-40*rs,-78*rs,0,-110*rs);ctx.closePath();ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.07)';
  ctx.beginPath();ctx.arc(0,-32*rs,17*rs,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=isProfit?'rgba(0,212,255,0.4)':'rgba(255,60,90,0.35)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.arc(0,-32*rs,17*rs,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle=isProfit?'rgba(0,245,160,0.10)':'rgba(255,60,90,0.08)';
  [-1,1].forEach(function(side){ctx.beginPath();ctx.moveTo(side*28*rs,32*rs);ctx.lineTo(side*78*rs,88*rs);ctx.lineTo(side*28*rs,78*rs);ctx.closePath();ctx.fill();});
  if(isProfit){
    var flG=ctx.createRadialGradient(0,108*rs,0,0,118*rs,60*rs);
    flG.addColorStop(0,'rgba(255,240,80,0.7)');flG.addColorStop(.3,'rgba(255,140,0,0.5)');flG.addColorStop(1,'transparent');
    ctx.fillStyle=flG;ctx.beginPath();ctx.ellipse(0,105*rs,24*rs,55*rs,0,0,Math.PI*2);ctx.fill();
  } else {
    var flG2=ctx.createRadialGradient(0,108*rs,0,0,108*rs,50*rs);
    flG2.addColorStop(0,'rgba(255,80,30,0.5)');flG2.addColorStop(1,'transparent');
    ctx.fillStyle=flG2;ctx.beginPath();ctx.ellipse(0,102*rs,22*rs,48*rs,0,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();

  // ── 6. LOGO ──
  const glassAccent = isProfit ? '#007aff' : '#ff3b30';
  drawZWealthLogo(ctx,PAD,110,50, isGlass ? glassAccent : accentColor);
  ctx.font='400 20px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = isGlass ? 'rgba(28,28,30,.35)' : 'rgba(148,163,184,.4)';
  ctx.fillText('z-wealth.vercel.app',PAD,142);
  ctx.textAlign='right';ctx.font='400 24px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = isGlass ? 'rgba(28,28,30,.4)' : 'rgba(148,163,184,.5)';
  ctx.fillText(dtStr,W-PAD,110);ctx.textAlign='left';

  // Sep line
  var sl1=ctx.createLinearGradient(PAD,165,W-PAD,165);
  if(isProfit){sl1.addColorStop(0,'transparent');sl1.addColorStop(.1,ac(.7));sl1.addColorStop(.5,'rgba(0,212,255,.35)');sl1.addColorStop(1,'transparent');}
  else        {sl1.addColorStop(0,ac(.7));sl1.addColorStop(.7,ac(.1));sl1.addColorStop(1,'transparent');}
  ctx.strokeStyle=sl1;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PAD,165);ctx.lineTo(W-PAD,165);ctx.stroke();

  // ── 7. PAIR HEADER ──
  ctx.font='900 80px "Segoe UI Black",Arial,sans-serif';
  ctx.fillStyle = isGlass ? '#1c1c1e' : '#ffffff';
  ctx.fillText('BTC / IDR',PAD,268);
  var pw=ctx.measureText('BTC / IDR').width;
  // DCA badge
  ctx.font='800 27px "Segoe UI",Arial,sans-serif';
  var dcaTxt='● DCA', dcaW=ctx.measureText(dcaTxt).width+44, dcaX=PAD+pw+28, dcaY=268-60, dcaH=52;
  ctx.fillStyle=ac(.18);rr(dcaX,dcaY,dcaW,dcaH,dcaH/2);ctx.fill();
  ctx.strokeStyle=ac(.6);ctx.lineWidth=1.5;rr(dcaX,dcaY,dcaW,dcaH,dcaH/2);ctx.stroke();
  ctx.fillStyle=accentColor;ctx.fillText(dcaTxt,dcaX+dcaW/2-ctx.measureText(dcaTxt).width/2,dcaY+dcaH*.68);

  // ── 8. ROI LABEL + NUMBER ──
  ctx.font='500 30px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle = isGlass ? 'rgba(28,28,30,.45)' : 'rgba(148,163,184,.7)';
  ctx.fillText('ROI Unrealized',PAD,330);
  var roiStr=(isProfit?'+':'')+pp.toFixed(2)+'%';
  var rfs=155;
  ctx.font='900 '+rfs+'px "Segoe UI Black",Arial,sans-serif';
  while(ctx.measureText(roiStr).width>W-PAD*2-20&&rfs>80){rfs-=6;ctx.font='900 '+rfs+'px "Segoe UI Black",Arial,sans-serif';}
  const roiColor = isGlass ? (isProfit ? '#007aff' : '#ff3b30') : accentColor;
  ctx.shadowColor=roiColor;ctx.shadowBlur= isGlass ? 20 : 80;ctx.fillStyle=roiColor;
  ctx.fillText(roiStr,PAD,510);ctx.shadowBlur= isGlass ? 8 : 35;ctx.fillText(roiStr,PAD,510);ctx.shadowBlur=0;

  // Sep line 2
  var sl2=ctx.createLinearGradient(PAD,565,W-PAD,565);
  sl2.addColorStop(0,ac(.5));sl2.addColorStop(.6,ac(.1));sl2.addColorStop(1,'transparent');
  ctx.strokeStyle=sl2;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PAD,565);ctx.lineTo(W-PAD,565);ctx.stroke();

  // ── 9. STAT CARDS 2x2 ──
  var CW=(W-PAD*2-18)/2,CH=155,CG=18,CY1=605,CY2=CY1+CH+CG;
  function sCard(label,value,cx,cy,vc){
    ctx.save();
    if (isGlass) {
      // Glass frosted card
      ctx.fillStyle='rgba(255,255,255,.5)';rr(cx,cy,CW,CH,24);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.75)';ctx.lineWidth=1.5;rr(cx,cy,CW,CH,24);ctx.stroke();
      // specular top line
      const sh2=ctx.createLinearGradient(cx+20,cy,cx+CW-20,cy);
      sh2.addColorStop(0,'transparent');sh2.addColorStop(.4,'rgba(255,255,255,.8)');sh2.addColorStop(1,'transparent');
      ctx.strokeStyle=sh2;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx+20,cy+1);ctx.lineTo(cx+CW-20,cy+1);ctx.stroke();
      ctx.fillStyle=vc+'33';ctx.fillRect(cx+20,cy+CH-4,CW-40,3);
      ctx.font='500 22px "Segoe UI",Arial,sans-serif';ctx.fillStyle='rgba(28,28,30,.45)';ctx.fillText(label,cx+26,cy+44);
      ctx.font='800 48px "Segoe UI Black",Arial,sans-serif';
      var fz=48;while(ctx.measureText(value).width>CW-44&&fz>24){fz-=4;ctx.font='800 '+fz+'px "Segoe UI Black",Arial,sans-serif';}
      ctx.fillStyle='#1c1c1e';ctx.shadowBlur=0;ctx.fillText(value,cx+26,cy+116);
    } else {
      var bg=ctx.createLinearGradient(cx,cy,cx+CW,cy+CH);
      bg.addColorStop(0,'rgba(255,255,255,.065)');bg.addColorStop(1,'rgba(255,255,255,.02)');
      ctx.fillStyle=bg;rr(cx,cy,CW,CH,20);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=1;rr(cx,cy,CW,CH,20);ctx.stroke();
      var sh=ctx.createLinearGradient(cx+20,cy,cx+CW-20,cy);
      sh.addColorStop(0,'transparent');sh.addColorStop(.4,'rgba(255,255,255,.2)');sh.addColorStop(1,'transparent');
      ctx.strokeStyle=sh;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx+20,cy+1);ctx.lineTo(cx+CW-20,cy+1);ctx.stroke();
      ctx.fillStyle=vc+'33';ctx.fillRect(cx+20,cy+CH-4,CW-40,3);
      ctx.font='500 22px "Segoe UI",Arial,sans-serif';ctx.fillStyle='rgba(148,163,184,.6)';ctx.fillText(label,cx+26,cy+44);
      ctx.font='800 48px "Segoe UI Black",Arial,sans-serif';
      var fz=48;while(ctx.measureText(value).width>CW-44&&fz>24){fz-=4;ctx.font='800 '+fz+'px "Segoe UI Black",Arial,sans-serif';}
      ctx.fillStyle=vc;ctx.shadowColor=vc;ctx.shadowBlur=12;ctx.fillText(value,cx+26,cy+116);ctx.shadowBlur=0;
    }
    ctx.restore();
  }
  var colL=PAD,colR=PAD+CW+CG;
  const glassGreen='#1c9c4e', glassRed='#ff3b30', glassMuted='#8e8e93', glassBlue='#007aff';
  sCard('Avg Entry','$'+Math.round(avg).toLocaleString('en-US'),colL,CY1, isGlass?'#1c1c1e':'#e2e8f0');
  sCard('Harga Kini','$'+Math.round(p).toLocaleString('en-US'),colR,CY1, isGlass?(isProfit?glassBlue:glassRed):(isProfit?GREEN:RED));
  sCard('DCA Sejak',since,colL,CY2, isGlass?glassMuted:'#94a3b8');
  sCard('Transaksi',S.dca.length+' kali',colR,CY2, isGlass?glassMuted:'#94a3b8');

  // ── 10. PROGRESS BAR ──
  var barY=CY2+CH+46,barW=W-PAD*2,barH2=12;
  ctx.fillStyle='rgba(255,255,255,.06)';rr(PAD,barY,barW,barH2,6);ctx.fill();
  var pctF=Math.min(Math.max((pp+100)/200,.02),1),fw=barW*pctF;
  var bf=ctx.createLinearGradient(PAD,barY,PAD+fw,barY);
  bf.addColorStop(0,isProfit?'rgba(0,245,160,.25)':'rgba(255,77,109,.25)');bf.addColorStop(1,isProfit?GREEN:RED);
  ctx.fillStyle=bf;rr(PAD,barY,fw,barH2,6);ctx.fill();
  ctx.fillStyle='#fff';ctx.shadowColor=accentColor;ctx.shadowBlur=14;
  ctx.beginPath();ctx.arc(PAD+fw,barY+barH2/2,8,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  ctx.font='600 22px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle='rgba(148,163,184,.5)';ctx.fillText('-100%',PAD,barY+36);
  ctx.textAlign='center';ctx.fillText('0%',PAD+barW/2,barY+36);
  ctx.textAlign='right';ctx.fillText('+100%',PAD+barW,barY+36);ctx.textAlign='left';

  // ── 11. STATUS BANNER ──
  var stY=barY+62,stH=148,stW=W-PAD*2;
  var stBg=ctx.createLinearGradient(PAD,stY,PAD+stW,stY);
  stBg.addColorStop(0,ac(.11));stBg.addColorStop(.6,ac(.05));stBg.addColorStop(1,'rgba(120,40,255,.05)');
  ctx.fillStyle=stBg;rr(PAD,stY,stW,stH,20);ctx.fill();
  ctx.strokeStyle=ac(.28);ctx.lineWidth=1;rr(PAD,stY,stW,stH,20);ctx.stroke();
  var dotCy2=stY+stH/2;
  ctx.fillStyle=accentColor;ctx.shadowColor=accentColor;ctx.shadowBlur=20;
  ctx.beginPath();ctx.arc(PAD+42,dotCy2,12,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  ctx.strokeStyle=ac(.28);ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(PAD+42,dotCy2,20,0,Math.PI*2);ctx.stroke();
  ctx.font='800 36px "Segoe UI",Arial,sans-serif';ctx.fillStyle=accentColor;
  ctx.fillText(isProfit?'POSISI PROFIT 🚀':'POSISI RUGI',PAD+76,dotCy2-10);
  ctx.font='400 24px "Segoe UI",Arial,sans-serif';ctx.fillStyle='rgba(148,163,184,.7)';
  ctx.fillText('DCA sejak '+since+' · Unrealized P&L',PAD+76,dotCy2+28);

  // ── 12. BOTTOM ──
  var botY=H-72;
  var bln=ctx.createLinearGradient(PAD,botY,W-PAD,botY);
  bln.addColorStop(0,'transparent');bln.addColorStop(.3,ac(.22));bln.addColorStop(.7,'rgba(120,40,255,.22)');bln.addColorStop(1,'transparent');
  ctx.strokeStyle=bln;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PAD,botY);ctx.lineTo(W-PAD,botY);ctx.stroke();
  ctx.textAlign='center';ctx.font='400 20px "Segoe UI",Arial,sans-serif';ctx.fillStyle='rgba(148,163,184,.2)';
  ctx.fillText('Not financial advice',W/2,botY+38);ctx.textAlign='left';
}

/* helper used elsewhere */
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function downloadShareCard(){
  const canvas=document.getElementById('share-canvas');
  const link=document.createElement('a');
  const now=new Date();
  link.download='z-wealth-DCA-'+now.toISOString().slice(0,10)+'.jpg';
  link.href=canvas.toDataURL('image/jpeg',0.96);
  document.body.appendChild(link);link.click();document.body.removeChild(link);
  toast('Kartu berhasil disimpan');
}

// ── FUTURES SHARE CARD ──
let _futuresSharePair = null;

function openFuturesShareModal(pair) {
  const trade = _sigActiveTrades[pair];
  if (!trade) return;
  _futuresSharePair = pair;
  const modal = document.getElementById('modal-futures-share');
  modal.style.display = 'flex';

  // Gunakan lastPrice dari state (akurat) — bukan parse dari UI text
  const currentPrice = trade.lastPrice || trade.tradeData.entry;

  // Hitung PnL dengan leverage
  const t = trade.tradeData;
  const lev = t.leverage || 1;
  const isLong = t.direction === 'LONG';
  const rawPnl = currentPrice > 0
    ? (isLong ? (currentPrice - t.entry) / t.entry * 100 : (t.entry - currentPrice) / t.entry * 100)
    : 0;
  const pnlVal = rawPnl * lev;
  const pnlStr = (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(2) + '%';

  drawFuturesCard(t, currentPrice, pnlStr);
}

function closeFuturesShareModal() {
  const modal = document.getElementById('modal-futures-share');
  if (modal) modal.style.display = 'none';
}

function downloadFuturesCard() {
  const canvas = document.getElementById('futures-share-canvas');
  const link = document.createElement('a');
  const now = new Date();
  link.download = 'z-wealth-FUTURES-' + (_futuresSharePair||'BTC') + '-' + now.toISOString().slice(0,10) + '.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.96);
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  toast('Kartu futures berhasil disimpan 🚀');
}

function drawFuturesCard(t, currentPrice, pnlStr) {
  const canvas = document.getElementById('futures-share-canvas');
  const W = 1080, H = 1350;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const isLong = t.direction === 'LONG';
  const lev = t.leverage || 1;
  const rawPnl = isLong
    ? (currentPrice - t.entry) / t.entry * 100
    : (t.entry - currentPrice) / t.entry * 100;
  const pnlVal = rawPnl * lev;
  const isProfit = pnlVal >= 0;

  // ── COLORS — ditentukan oleh PROFIT/LOSS, bukan direction ──
  const GREEN   = '#00f5a0';
  const CYAN    = '#00d4ff';
  const PURPLE  = '#a855f7';
  const RED     = '#ff4d6d';
  const ORANGE  = '#ff9500';

  // accentColor = hijau neon saat profit, merah saat rugi
  const accentColor  = isProfit ? GREEN : RED;
  const accentR      = isProfit ? '0,245,160' : '255,77,109';
  // dirColor = warna khusus badge direction (tetap ikut LONG/SHORT)
  const dirColor     = isLong ? GREEN : RED;
  const dirR         = isLong ? '0,245,160' : '255,77,109';
  const levColor     = lev >= 50 ? RED : lev >= 20 ? ORANGE : '#ffcc00';
  const PAD = 72;

  function ac(a){ return `rgba(${accentR},${a})`; }
  function dc(a){ return `rgba(${dirR},${a})`; }

  // ── HELPER: rounded rect ──
  function rr(x,y,w,h,r){
    if(w<=0||h<=0) return;
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  // ── FIXED LAYOUT (calculated so everything fits in H=1350) ──
  // Logo row:     y=80-148
  // Sep line:     y=165
  // Pair row:     y=200-285
  // PnL label:    y=330
  // PnL number:   y=330-555 (max 155px font → height ~136)
  // Sep line2:    y=575
  // Cards row1:   y=608-763 (h=155)
  // Cards row2:   y=783-938 (h=155)
  // Progress bar: y=980
  // Status:       y=1040-1180
  // Bottom:       y=1270

  const LOGO_Y      = 110;
  const SEP1_Y      = 162;
  const PAIR_Y      = 268;
  const PNL_LABEL_Y = 328;
  const PNL_NUM_Y   = 510;   // fixed baseline — font capped at 155px
  const PNL_FS      = 155;   // fixed font size for PnL
  const SEP2_Y      = 565;
  const CARD_Y1     = 605;
  const CARD_H      = 155;
  const CARD_GAP    = 18;
  const CARD_Y2     = CARD_Y1 + CARD_H + CARD_GAP;
  const BAR_Y       = CARD_Y2 + CARD_H + 46;
  const BAR_H       = 12;
  const ST_Y        = BAR_Y + 62;
  const ST_H        = 148;
  const BOT_Y       = H - 72;

  // ── 1. BACKGROUND ──
  const bgG = ctx.createLinearGradient(0,0,0,H);
  if(isProfit){
    // PROFIT: dark teal-green depth
    bgG.addColorStop(0,'#060d10'); bgG.addColorStop(0.4,'#060b0e'); bgG.addColorStop(1,'#040810');
  } else {
    // LOSS: dark crimson depth
    bgG.addColorStop(0,'#0d0608'); bgG.addColorStop(0.4,'#0a0508'); bgG.addColorStop(1,'#080410');
  }
  ctx.fillStyle = bgG; ctx.fillRect(0,0,W,H);

  // ── 2. GRID PATTERN ──
  ctx.save();
  ctx.strokeStyle = isProfit ? 'rgba(0,245,160,0.03)' : 'rgba(255,77,109,0.035)';
  ctx.lineWidth = 1;
  for(let x=0;x<=W;x+=60){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for(let y=0;y<=H;y+=60){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  ctx.restore();

  // ── 3. GLOW BLOBS ──
  if(isProfit){
    // PROFIT: multi-color liquid glass blobs
    // Green blob top-right
    const g1 = ctx.createRadialGradient(W*0.9,H*0.08,0,W*0.9,H*0.08,W*0.65);
    g1.addColorStop(0,'rgba(0,245,160,0.14)'); g1.addColorStop(1,'transparent');
    ctx.fillStyle=g1; ctx.fillRect(0,0,W,H);
    // Cyan blob top-center
    const g2 = ctx.createRadialGradient(W*0.5,H*0.0,0,W*0.5,H*0.0,W*0.5);
    g2.addColorStop(0,'rgba(0,212,255,0.09)'); g2.addColorStop(1,'transparent');
    ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
    // Purple blob bottom-left
    const g3 = ctx.createRadialGradient(W*0.05,H*0.85,0,W*0.05,H*0.85,W*0.55);
    g3.addColorStop(0,'rgba(168,85,247,0.12)'); g3.addColorStop(1,'transparent');
    ctx.fillStyle=g3; ctx.fillRect(0,0,W,H);
    // Blue blob bottom-right
    const g4 = ctx.createRadialGradient(W*0.9,H*0.9,0,W*0.9,H*0.9,W*0.45);
    g4.addColorStop(0,'rgba(59,130,246,0.08)'); g4.addColorStop(1,'transparent');
    ctx.fillStyle=g4; ctx.fillRect(0,0,W,H);
  } else {
    // LOSS: red + dark orange blobs
    const g1 = ctx.createRadialGradient(W*0.85,H*0.12,0,W*0.85,H*0.12,W*0.6);
    g1.addColorStop(0,'rgba(255,77,109,0.14)'); g1.addColorStop(1,'transparent');
    ctx.fillStyle=g1; ctx.fillRect(0,0,W,H);
    const g2 = ctx.createRadialGradient(W*0.05,H*0.88,0,W*0.05,H*0.88,W*0.5);
    g2.addColorStop(0,'rgba(120,20,50,0.12)'); g2.addColorStop(1,'transparent');
    ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
  }

  // ── 4. TOP ACCENT LINE ──
  const tl = ctx.createLinearGradient(0,0,W,0);
  if(isProfit){
    // rainbow: green → cyan → purple
    tl.addColorStop(0,'transparent');
    tl.addColorStop(0.15,'#00f5a0');
    tl.addColorStop(0.45,'#00d4ff');
    tl.addColorStop(0.75,'#a855f7');
    tl.addColorStop(1,'transparent');
  } else {
    tl.addColorStop(0,'transparent');
    tl.addColorStop(0.3,'#ff4d6d');
    tl.addColorStop(0.7,'rgba(200,30,60,0.6)');
    tl.addColorStop(1,'transparent');
  }
  ctx.fillStyle=tl; ctx.fillRect(0,0,W,5);

  // ── 5. DECORATIVE BG ART ──
  ctx.save();

  // 5a. Mini candlestick chart (top-right background)
  const candleData = isProfit
    ? [0.2,0.35,0.25,0.5,0.4,0.6,0.55,0.75,0.65,0.85,0.8,1.0,0.9]
    : [1.0,0.85,0.9,0.7,0.8,0.6,0.65,0.45,0.5,0.35,0.4,0.2,0.1];
  const chartX = W - 390, chartY = 175, chartW = 350, chartH = 270;
  const cw2 = chartW / candleData.length;
  ctx.globalAlpha = 0.11;
  for(let i=0;i<candleData.length;i++){
    const v = candleData[i];
    const prev = i>0 ? candleData[i-1] : v;
    const isBull = v >= prev;
    const cx2 = chartX + i*cw2 + cw2*0.15;
    const bodyH = Math.max(Math.abs(v-prev)*chartH, 8);
    const bodyY = chartY + (1-Math.max(v,prev))*chartH;
    ctx.strokeStyle = isBull ? GREEN : RED; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx2+cw2*0.35, chartY+(1-v)*chartH-12);
    ctx.lineTo(cx2+cw2*0.35, chartY+(1-v)*chartH+bodyH+12);
    ctx.stroke();
    ctx.fillStyle = isBull ? GREEN : RED;
    rr(cx2, bodyY, cw2*0.7, bodyH, 3); ctx.fill();
  }

  // Trend line
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = accentColor; ctx.lineWidth = 3;
  ctx.beginPath();
  for(let i=0;i<candleData.length;i++){
    const px2 = chartX + i*cw2 + cw2*0.5;
    const py2 = chartY + (1-candleData[i])*chartH;
    if(i===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
  }
  ctx.stroke();

  // Area fill under trend
  ctx.globalAlpha = 0.055;
  const tFill = ctx.createLinearGradient(0,chartY,0,chartY+chartH);
  tFill.addColorStop(0, accentColor); tFill.addColorStop(1, 'transparent');
  ctx.fillStyle = tFill;
  ctx.beginPath();
  for(let i=0;i<candleData.length;i++){
    const px2 = chartX + i*cw2 + cw2*0.5;
    const py2 = chartY + (1-candleData[i])*chartH;
    if(i===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
  }
  ctx.lineTo(chartX+chartW, chartY+chartH); ctx.lineTo(chartX, chartY+chartH);
  ctx.closePath(); ctx.fill();

  // 5b. Rocket silhouette — PROFIT=colorful keatas, LOSS=merah kebawah
  ctx.globalAlpha = 1;
  ctx.save();
  const rs = 1.7;
  const rx = W - 120, ry = H * 0.41;
  ctx.translate(rx, ry);
  // PROFIT = rocket ke atas normal, LOSS = terbalik (jatuh ke bawah)
  if(!isProfit){ ctx.scale(1,-1); }

  // body gradient — PROFIT: green→cyan rainbow, LOSS: dark red
  if(isProfit){
    const bodyG = ctx.createLinearGradient(0,-110*rs,0,75*rs);
    bodyG.addColorStop(0,'rgba(168,85,247,0.18)');
    bodyG.addColorStop(0.4,'rgba(0,212,255,0.16)');
    bodyG.addColorStop(1,'rgba(0,245,160,0.12)');
    ctx.fillStyle = bodyG;
  } else {
    ctx.fillStyle = 'rgba(255,60,90,0.10)';
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(0,-110*rs);
  ctx.bezierCurveTo(40*rs,-78*rs,50*rs,18*rs,30*rs,78*rs);
  ctx.lineTo(-30*rs,78*rs);
  ctx.bezierCurveTo(-50*rs,18*rs,-40*rs,-78*rs,0,-110*rs);
  ctx.closePath(); ctx.fill();

  // body border stroke
  if(isProfit){
    const strokeG = ctx.createLinearGradient(0,-110*rs,0,78*rs);
    strokeG.addColorStop(0,'rgba(168,85,247,0.5)');
    strokeG.addColorStop(0.5,'rgba(0,212,255,0.4)');
    strokeG.addColorStop(1,'rgba(0,245,160,0.3)');
    ctx.strokeStyle = strokeG;
  } else {
    ctx.strokeStyle = 'rgba(255,60,90,0.3)';
  }
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0,-110*rs);
  ctx.bezierCurveTo(40*rs,-78*rs,50*rs,18*rs,30*rs,78*rs);
  ctx.lineTo(-30*rs,78*rs);
  ctx.bezierCurveTo(-50*rs,18*rs,-40*rs,-78*rs,0,-110*rs);
  ctx.closePath(); ctx.stroke();

  // nose shine
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(0,-110*rs);
  ctx.bezierCurveTo(18*rs,-85*rs,22*rs,-35*rs,0,-18*rs);
  ctx.bezierCurveTo(-22*rs,-35*rs,-18*rs,-85*rs,0,-110*rs);
  ctx.closePath(); ctx.fill();

  // window/porthole
  if(isProfit){
    const winG = ctx.createRadialGradient(-5*rs,-32*rs,0,-5*rs,-32*rs,17*rs);
    winG.addColorStop(0,'rgba(0,212,255,0.4)'); winG.addColorStop(1,'rgba(0,212,255,0.05)');
    ctx.fillStyle = winG;
  } else {
    ctx.fillStyle = 'rgba(255,60,90,0.2)';
  }
  ctx.beginPath(); ctx.arc(0,-32*rs,17*rs,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = isProfit ? 'rgba(0,212,255,0.5)' : 'rgba(255,60,90,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0,-32*rs,17*rs,0,Math.PI*2); ctx.stroke();

  // fins
  ctx.fillStyle = isProfit ? 'rgba(0,245,160,0.12)' : 'rgba(255,60,90,0.10)';
  ctx.strokeStyle = isProfit ? 'rgba(0,245,160,0.3)' : 'rgba(255,60,90,0.25)';
  ctx.lineWidth = 1;
  [-1,1].forEach(side=>{
    ctx.beginPath();
    ctx.moveTo(side*28*rs,32*rs); ctx.lineTo(side*78*rs,88*rs); ctx.lineTo(side*28*rs,78*rs);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });

  // exhaust flame
  if(isProfit){
    // colorful flame: yellow→orange→transparent
    const flG = ctx.createRadialGradient(0,108*rs,0,0,118*rs,60*rs);
    flG.addColorStop(0,'rgba(255,240,80,0.7)');
    flG.addColorStop(0.3,'rgba(255,140,0,0.5)');
    flG.addColorStop(0.7,'rgba(255,60,120,0.2)');
    flG.addColorStop(1,'transparent');
    ctx.fillStyle = flG;
    ctx.beginPath(); ctx.ellipse(0,105*rs,24*rs,55*rs,0,0,Math.PI*2); ctx.fill();
    // inner bright core
    const flCore = ctx.createRadialGradient(0,105*rs,0,0,105*rs,18*rs);
    flCore.addColorStop(0,'rgba(255,255,200,0.8)');
    flCore.addColorStop(1,'transparent');
    ctx.fillStyle = flCore;
    ctx.beginPath(); ctx.ellipse(0,105*rs,10*rs,22*rs,0,0,Math.PI*2); ctx.fill();
  } else {
    // dim red flame for loss
    const flG = ctx.createRadialGradient(0,108*rs,0,0,108*rs,50*rs);
    flG.addColorStop(0,'rgba(255,80,30,0.5)');
    flG.addColorStop(0.5,'rgba(200,20,60,0.25)');
    flG.addColorStop(1,'transparent');
    ctx.fillStyle = flG;
    ctx.beginPath(); ctx.ellipse(0,102*rs,22*rs,48*rs,0,0,Math.PI*2); ctx.fill();
  }

  // PROFIT: sparkle dots around rocket
  if(isProfit){
    [[-55,-80],[-45,-40],[50,-70],[60,-20],[40,30],[-50,50]].forEach(([sx,sy])=>{
      const sparkR = 3+Math.random()*3;
      const sparkColors = ['rgba(0,245,160,0.7)','rgba(0,212,255,0.6)','rgba(168,85,247,0.5)','rgba(255,220,0,0.5)'];
      ctx.fillStyle = sparkColors[Math.floor(Math.abs(sx+sy)%sparkColors.length)];
      ctx.beginPath(); ctx.arc(sx*rs*0.5, sy*rs*0.5, sparkR, 0, Math.PI*2); ctx.fill();
    });
  }

  ctx.restore(); // rocket
  ctx.restore(); // main save

  // ── 6. LOGO — pakai drawZWealthLogo yang sudah bagus ──
  drawZWealthLogo(ctx, PAD, LOGO_Y, 50, accentColor);
  ctx.font='400 20px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.4)';
  ctx.fillText('z-wealth.vercel.app', PAD, LOGO_Y+30);

  // Date/time right — sejajar dengan logo
  const now=new Date();
  const dtStr = now.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  ctx.textAlign='right'; ctx.font='400 24px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.5)';
  ctx.fillText(dtStr, W-PAD, LOGO_Y); ctx.textAlign='left';

  // ── 7. SEP LINE 1 ──
  function sepLine(y){
    const sg=ctx.createLinearGradient(PAD,y,W-PAD,y);
    if(isProfit){
      sg.addColorStop(0,'transparent');
      sg.addColorStop(0.1,'rgba(0,245,160,0.7)');
      sg.addColorStop(0.5,'rgba(0,212,255,0.4)');
      sg.addColorStop(0.8,'rgba(168,85,247,0.2)');
      sg.addColorStop(1,'transparent');
    } else {
      sg.addColorStop(0,ac(0.7)); sg.addColorStop(0.7,ac(0.1)); sg.addColorStop(1,'transparent');
    }
    ctx.strokeStyle=sg; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PAD,y); ctx.lineTo(W-PAD,y); ctx.stroke();
  }
  sepLine(SEP1_Y);

  // ── 8. PAIR + BADGES ──
  const pairLabel = t.pair.replace('USDT','/USDT');
  ctx.font='900 80px "Segoe UI Black",Arial,sans-serif'; ctx.fillStyle='#ffffff';
  ctx.fillText(pairLabel, PAD, PAIR_Y);
  const pw=ctx.measureText(pairLabel).width;

  // badges
  function badge(text, x, y, bh, bgColor, borderColor, textColor){
    ctx.font=`800 27px "Segoe UI",Arial,sans-serif`;
    const bw=ctx.measureText(text).width+44;
    ctx.fillStyle=bgColor; rr(x,y,bw,bh,bh/2); ctx.fill();
    ctx.strokeStyle=borderColor; ctx.lineWidth=1.5; rr(x,y,bw,bh,bh/2); ctx.stroke();
    ctx.fillStyle=textColor; ctx.fillText(text, x+bw/2-ctx.measureText(text).width/2, y+bh*0.68);
    return bw;
  }
  const badgeY=PAIR_Y-60, badgeH=52;
  let bx=PAD+pw+28;
  bx += badge(isLong?'▲ LONG':'▼ SHORT', bx, badgeY, badgeH, dc(0.18), dc(0.65), dirColor)+14;
  const tfLabels={'1m':'1M','5m':'5M','15m':'15M','1h':'1H','4h':'4H','1d':'1D'};
  bx += badge(tfLabels[t.tf]||t.tf?.toUpperCase()||'4H', bx, badgeY, badgeH, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.18)', 'rgba(248,250,252,0.75)')+14;
  if(lev>1){
    ctx.shadowColor=levColor; ctx.shadowBlur=10;
    badge(lev+'x', bx, badgeY, badgeH, lev>=20?'rgba(255,70,0,0.14)':'rgba(255,200,0,0.11)', levColor, levColor);
    ctx.shadowBlur=0;
  }

  // ── 9. PnL LABEL ──
  ctx.font='500 30px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.7)';
  ctx.fillText(lev>1?`PnL  ×${lev} Leverage`:'PnL', PAD, PNL_LABEL_Y);

  // ── 10. PnL NUMBER (fixed size, scaled down only if too wide) ──
  const pnlDisplay=(pnlVal>=0?'+':'')+pnlVal.toFixed(2)+'%';
  const pnlColor=isProfit?accentColor:RED;
  let pfs=PNL_FS;
  ctx.font=`900 ${pfs}px "Segoe UI Black",Arial,sans-serif`;
  while(ctx.measureText(pnlDisplay).width > W-PAD*2-20 && pfs>80){
    pfs-=6; ctx.font=`900 ${pfs}px "Segoe UI Black",Arial,sans-serif`;
  }
  ctx.shadowColor=pnlColor; ctx.shadowBlur=80;
  ctx.fillStyle=pnlColor; ctx.fillText(pnlDisplay, PAD, PNL_NUM_Y);
  ctx.shadowBlur=35; ctx.fillText(pnlDisplay, PAD, PNL_NUM_Y);
  ctx.shadowBlur=0;

  // ── 11. SEP LINE 2 ──
  sepLine(SEP2_Y);

  // ── 12. STAT CARDS 2×2 ──
  const cw=(W-PAD*2-CARD_GAP)/2;
  function statCard(label, value, cx, cy, vColor){
    ctx.save();
    // bg glass
    const bg=ctx.createLinearGradient(cx,cy,cx+cw,cy+CARD_H);
    bg.addColorStop(0,'rgba(255,255,255,0.065)'); bg.addColorStop(1,'rgba(255,255,255,0.02)');
    ctx.fillStyle=bg; rr(cx,cy,cw,CARD_H,20); ctx.fill();
    // border
    ctx.strokeStyle='rgba(255,255,255,0.09)'; ctx.lineWidth=1; rr(cx,cy,cw,CARD_H,20); ctx.stroke();
    // shine
    const sh=ctx.createLinearGradient(cx+20,cy,cx+cw-20,cy);
    sh.addColorStop(0,'transparent'); sh.addColorStop(0.4,'rgba(255,255,255,0.2)'); sh.addColorStop(1,'transparent');
    ctx.strokeStyle=sh; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cx+20,cy+1); ctx.lineTo(cx+cw-20,cy+1); ctx.stroke();
    // bottom color accent
    ctx.fillStyle=vColor+'33'; ctx.fillRect(cx+20, cy+CARD_H-4, cw-40, 3);
    // label
    ctx.font='500 22px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.6)';
    ctx.fillText(label, cx+26, cy+44);
    // value
    ctx.font=`800 48px "Segoe UI Black",Arial,sans-serif`;
    let fz=48;
    while(ctx.measureText(value).width>cw-44&&fz>24){ fz-=4; ctx.font=`800 ${fz}px "Segoe UI Black",Arial,sans-serif`; }
    ctx.fillStyle=vColor; ctx.shadowColor=vColor; ctx.shadowBlur=12;
    ctx.fillText(value, cx+26, cy+116);
    ctx.shadowBlur=0; ctx.restore();
  }

  const colL=PAD, colR=PAD+cw+CARD_GAP;
  const eStr='$'+Number(t.entry).toLocaleString('en-US');
  const nStr=currentPrice>0?'$'+Number(currentPrice).toLocaleString('en-US'):'—';
  const sStr='$'+Number(t.sl).toLocaleString('en-US');
  const pStr='$'+Number(t.tp).toLocaleString('en-US');

  statCard('Harga Entry', eStr, colL, CARD_Y1, '#e2e8f0');
  statCard('Harga Kini',  nStr, colR, CARD_Y1, isProfit?accentColor:RED);
  statCard('Stop Loss',   sStr, colL, CARD_Y2, RED);
  statCard('Take Profit', pStr, colR, CARD_Y2, GREEN);

  // ── 13. PROGRESS BAR ──
  const barW=W-PAD*2;
  ctx.fillStyle='rgba(255,255,255,0.06)'; rr(PAD,BAR_Y,barW,BAR_H,6); ctx.fill();
  const pct=Math.min(Math.max((pnlVal+(t.slPct||5))/((t.slPct||5)+(t.tpPct||5)),0.02),1);
  const fw=barW*pct;
  if(fw>0){
    const bf=ctx.createLinearGradient(PAD,BAR_Y,PAD+fw,BAR_Y);
    bf.addColorStop(0,isProfit?'rgba(0,245,160,0.25)':'rgba(255,77,109,0.25)');
    bf.addColorStop(1,isProfit?GREEN:RED);
    ctx.fillStyle=bf; rr(PAD,BAR_Y,fw,BAR_H,6); ctx.fill();
  }
  // dot
  ctx.fillStyle='#fff'; ctx.shadowColor=accentColor; ctx.shadowBlur=14;
  ctx.beginPath(); ctx.arc(PAD+fw,BAR_Y+BAR_H/2,8,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  // labels
  ctx.font='600 22px "Segoe UI",Arial,sans-serif';
  ctx.fillStyle='rgba(239,68,68,0.7)'; ctx.fillText('SL',PAD,BAR_Y+36);
  ctx.textAlign='center'; ctx.fillStyle='rgba(148,163,184,0.5)'; ctx.fillText('Entry',PAD+barW/2,BAR_Y+36);
  ctx.textAlign='right'; ctx.fillStyle='rgba(0,245,160,0.7)'; ctx.fillText('TP',PAD+barW,BAR_Y+36);
  ctx.textAlign='left';

  // ── 14. STATUS BANNER ──
  const stW=W-PAD*2;
  const stBg=ctx.createLinearGradient(PAD,ST_Y,PAD+stW,ST_Y);
  stBg.addColorStop(0,ac(0.11)); stBg.addColorStop(0.6,ac(0.05)); stBg.addColorStop(1,'rgba(120,40,255,0.05)');
  ctx.fillStyle=stBg; rr(PAD,ST_Y,stW,ST_H,20); ctx.fill();
  ctx.strokeStyle=ac(0.28); ctx.lineWidth=1; rr(PAD,ST_Y,stW,ST_H,20); ctx.stroke();
  // pulse dot
  const dotCy=ST_Y+ST_H/2;
  ctx.fillStyle=accentColor; ctx.shadowColor=accentColor; ctx.shadowBlur=20;
  ctx.beginPath(); ctx.arc(PAD+42,dotCy,12,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
  ctx.strokeStyle=ac(0.28); ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(PAD+42,dotCy,20,0,Math.PI*2); ctx.stroke();
  // text
  ctx.font='800 36px "Segoe UI",Arial,sans-serif'; ctx.fillStyle=accentColor;
  const statusLabel=isProfit?(isLong?'POSISI PROFIT':'SHORT PROFIT'):(isLong?'POSISI RUGI':'SHORT RUGI');
  ctx.fillText(statusLabel,PAD+76,dotCy-10);
  ctx.font='400 24px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.7)';
  const durMin=t.entryTime?Math.round((Date.now()-t.entryTime)/60000):0;
  const durStr=durMin<60?durMin+' menit':Math.floor(durMin/60)+' jam '+(durMin%60)+' menit';
  ctx.fillText('Durasi: '+durStr+(lev>1?' · Leverage '+lev+'x':'')+' · Unrealized P&L',PAD+76,dotCy+28);

  // ── 15. BOTTOM DIVIDER + WATERMARK ──
  const bln=ctx.createLinearGradient(PAD,BOT_Y,W-PAD,BOT_Y);
  bln.addColorStop(0,'transparent'); bln.addColorStop(0.3,ac(0.22)); bln.addColorStop(0.7,'rgba(120,40,255,0.22)'); bln.addColorStop(1,'transparent');
  ctx.strokeStyle=bln; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(PAD,BOT_Y); ctx.lineTo(W-PAD,BOT_Y); ctx.stroke();
  ctx.textAlign='center'; ctx.font='400 20px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,0.2)';
  ctx.fillText('Not financial advice',W/2,BOT_Y+38); ctx.textAlign='left';
}

// ══════════════════════════════════════════════
// CHAT ENGINE — Supabase Realtime
// ══════════════════════════════════════════════

// ── CONFIG: ISI DENGAN SUPABASE PROJECT KAMU ──
const SUPABASE_URL = 'https://kpikyqafapclyirpqflp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c';

const PUBLIC_ROOM_ID = '00000000-0000-0000-0000-000000000001';
const AVATAR_COLORS = [
  '#00e5ff','#7c3aed','#10b981','#f59e0b','#ef4444',
  '#ec4899','#06b6d4','#8b5cf6','#f97316','#22c55e'
];

let chatState = {
  myCode: null,
  myColor: null,
  currentRoomId: null,
  currentRoomName: '',
  currentRoomType: '',
  replyTo: null,
  replyText: '',
  replySender: '',
  pendingMedia: null,
  rooms: [],
  msgSubscription: null,
  newRoomType: 'group',
  newRoomColor: AVATAR_COLORS[0],
  // Pagination
  msgOffset: 0,
  msgHasMore: false,
  msgLoadingMore: false,
};

let chatSB = null;

// ── INIT SUPABASE ──
function initSupabase() {
  try {
    // Supabase v2 UMD: window.supabase.createClient
    const lib = window.supabase || window.Supabase;
    if (lib && lib.createClient) {
      chatSB = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return true;
    }
    return false;
  } catch(e) {
    console.warn('Supabase init error:', e);
    return false;
  }
}

// ── INIT CHAT — dengan retry jika CDN belum load ──
let _chatInitTries = 0;
async function initChat() {
  // Sudah terkoneksi sebelumnya
  if (chatSB) { await chatBoot(); return; }

  // Show loading indicator on first try
  if (_chatInitTries === 0) showChatLoading();

  // Coba init
  if (initSupabase()) { await chatBoot(); return; }

  // CDN belum load — tunggu max 5 detik lalu retry
  _chatInitTries++;
  if (_chatInitTries < 10) {
    setTimeout(initChat, 500);
  } else {
    _chatInitTries = 0;
    showChatOffline();
  }
}

function showChatLoading() {
  // Tampilkan loading di atas content yang ada, tidak replace seluruh DOM
  const screen = document.getElementById('chat-rooms-screen');
  if (!screen) return;
  // Hapus loading lama jika ada
  const old = screen.querySelector('.chat-loading-overlay');
  if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'chat-loading-overlay';
  div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;background:rgba(5,8,16,.85);backdrop-filter:blur(8px);z-index:99;border-radius:inherit';
  div.innerHTML = `<div style="width:36px;height:36px;border:3px solid rgba(0,229,255,.2);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite"></div><div class="chat-empty-text">Memuat chat...</div>`;
  screen.style.position = 'relative';
  screen.appendChild(div);
}

function hideChatLoading() {
  const screen = document.getElementById('chat-rooms-screen');
  if (!screen) return;
  const ov = screen.querySelector('.chat-loading-overlay');
  if (ov) ov.remove();
}

async function chatBoot() {
  if (!chatSB) { hideChatLoading(); showChatOffline(); return; }
  // Reset tries on success
  _chatInitTries = 0;
  // Get or create anon identity
  let code = localStorage.getItem('chat_code');
  let color = localStorage.getItem('chat_color');
  if (!code) {
    code = 'anon-' + Math.random().toString(36).slice(2,8);
    color = AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)];
    localStorage.setItem('chat_code', code);
    localStorage.setItem('chat_color', color);
  }
  // SELALU upsert ke DB setiap boot — mencegah FK error jika DB reset atau device baru
  // onConflict:'code' memastikan tidak duplikat, hanya update jika sudah ada
  try {
    await chatSB.from('anon_users').upsert(
      { code, avatar_color: color || '#00e5ff' },
      { onConflict: 'code' }
    );
  } catch(e) { console.warn('anon_users upsert warn:', e.message); }
  chatState.myCode = code;
  chatState.myColor = color;

  // Show code in UI
  const lbl = document.getElementById('chat-my-code-label');
  if (lbl) lbl.textContent = code;
  const dmDisp = document.getElementById('dm-my-code-display');
  if (dmDisp) dmDisp.textContent = code;

  // Build color picker
  buildColorPicker();

  // Load rooms
  await loadRooms();
  hideChatLoading();

  // ── Push Notification + Sync FCM Token ke DB ──
  setTimeout(async () => {
    await initPushNotification();
    // Sync token ke DB — chatSB & myCode sudah siap di sini
    // Juga sync alert & reminder ke DB supaya cron job bisa baca
    _syncUserPushData();
    // FIX: Selalu minta token fresh dari FCM setiap app dibuka
    // Firebase SDK return token lama jika masih valid, atau buat baru jika expired
    // Ini memastikan token di Supabase DB selalu up-to-date
    if (Notification.permission === 'granted') {
      try {
        const freshToken = await ZW_FCM.getToken();
        if (freshToken) await _saveFCMTokenToDB(freshToken);
      } catch(e) {
        // Fallback: sync token lama jika FCM gagal
        const existingToken = localStorage.getItem('zw_fcm_token');
        if (existingToken) _saveFCMTokenToDB(existingToken).catch(()=>{});
      }
    }
  }, 2500);

  // ── Deep link handler ──
  _handleChatDeepLink();

  // ── Init notification system ──
  if (window.ChatNotif) {
    ChatNotif.init();
    setTimeout(() => subscribeGlobalChatNotif(), 800);
  }

  // ── Dashboard Chat Preview ──
  setTimeout(() => loadDashChatPreview(), 500);
}

// ── DASHBOARD CHAT PREVIEW ──
// loadDashChatPreview — Live feed pesan 1 jam terakhir dari semua room
// Menampilkan General, Grup, DM terbaru, auto-hilang setelah 1 jam
let _dashFeedSub = null;
let _dashFeedInterval = null;
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

async function loadDashChatPreview() {
  const container = document.getElementById('dash-chat-preview');
  if (!container || !chatSB) return;

  // Ubah tampilan container menjadi feed style
  container.style.cssText = `
    background:var(--surface);border:1px solid var(--border);border-radius:16px;
    margin-bottom:1.2rem;overflow:hidden;min-height:60px;display:block;
  `;

  await renderDashFeed();

  // Realtime: subscribe ke semua perubahan messages
  if (_dashFeedSub) { try { chatSB.removeChannel(_dashFeedSub); } catch(e) {} }
  _dashFeedSub = chatSB.channel('dash-feed-global')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      renderDashFeed();
    })
    .subscribe();

  // Auto-refresh tiap 2 menit (untuk update waktu dan hapus pesan > 1 jam)
  if (_dashFeedInterval) clearInterval(_dashFeedInterval);
  _dashFeedInterval = setInterval(() => renderDashFeed(), 2 * 60 * 1000);
}

async function renderDashFeed() {
  const container = document.getElementById('dash-chat-preview');
  if (!container || !chatSB) return;

  try {
    const myCode = chatState?.myCode || null;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Ambil 100 pesan 24 jam terakhir
    const { data: msgs, error } = await chatSB.from('messages')
      .select('id,content,sender_code,created_at,media_url,room_id')
      .gte('created_at', oneDayAgo)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      container.innerHTML = `<div style="color:var(--muted);font-size:.8rem;padding:1.5rem;text-align:center">Gagal memuat: ${error.message}</div>`;
      return;
    }

    const allMsgs = msgs || [];

    // Ambil info rooms untuk semua room_id yang muncul
    const roomIds = [...new Set(allMsgs.map(m => m.room_id).filter(id => id && id !== NULL_UUID))];
    let roomMap = {};
    if (roomIds.length > 0) {
      try {
        const { data: rooms } = await chatSB.from('chat_rooms')
          .select('id,name,type,avatar_color').in('id', roomIds);
        (rooms || []).forEach(r => { roomMap[r.id] = r; });
      } catch(e) {}
    }

    // 3 slot: ambil 1 pesan terbaru per kategori
    let slotGeneral = null; // public / UUID nil
    let slotGroup   = null; // group (terbaru dari semua grup)
    let slotDM      = null; // dm (terbaru dari semua DM)

    for (const m of allMsgs) {
      const isNull = !m.room_id || m.room_id === NULL_UUID;
      const room = isNull ? { id: null, name: '# General', type: 'public', avatar_color: '#00e5ff' } : roomMap[m.room_id];
      if (!room) continue;

      if (!slotGeneral && (isNull || room.type === 'public')) slotGeneral = { msg: m, room };
      else if (!slotGroup && room.type === 'group') slotGroup = { msg: m, room };
      else if (!slotDM && room.type === 'dm') slotDM = { msg: m, room };

      if (slotGeneral && slotGroup && slotDM) break;
    }

    // Susun slot yang ada (skip yang null)
    const grouped = [slotGeneral, slotGroup, slotDM].filter(Boolean);

    renderDashFeedMessages(container, grouped, myCode);

  } catch(e) {
    console.warn('[dashFeed]', e.message);
    container.innerHTML = `<div style="color:var(--muted);font-size:.8rem;padding:1.5rem;text-align:center">Gagal memuat preview</div>`;
  }
}

function renderDashFeedMessages(container, grouped, myCode) {
  const totalNew = grouped.length;

  let html = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem 1rem .4rem;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="display:flex;align-items:center;gap:.45rem">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span style="font-size:.72rem;font-weight:800;color:var(--text);letter-spacing:.04em">PESAN TERBARU</span>
        ${totalNew > 0 ? `<span style="background:var(--accent);color:#000;font-size:.55rem;font-weight:800;padding:.1rem .4rem;border-radius:99px">${totalNew}</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="font-size:.6rem;color:var(--muted)">24 jam terakhir</span>
        <button onclick="renderDashFeed()" title="Refresh" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:.1rem;display:flex;align-items:center;opacity:.7">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>
    </div>`;

  if (!grouped.length) {
    html += `<div style="color:var(--muted);font-size:.8rem;padding:1.4rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.4rem">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span>Belum ada pesan. Jadilah yang pertama!</span>
    </div>`;
  } else {
    html += `<div style="display:flex;flex-direction:column">`;
    grouped.forEach(({ msg: m, room }) => {
      const isMyMsg = myCode && m.sender_code === myCode;
      const initials = (m.sender_code || '?').slice(5, 7).toUpperCase();
      const colorPalette = ['#00e5ff','#10b981','#a78bfa','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899','#f97316','#22c55e'];
      const colorIdx = (m.sender_code || '').split('').reduce((a,c) => a + c.charCodeAt(0), 0) % colorPalette.length;
      const color = colorPalette[colorIdx];
      const diffMin = Math.round((Date.now() - new Date(m.created_at).getTime()) / 60000);
      const timeAgo = diffMin < 1 ? 'baru saja' : diffMin < 60 ? diffMin + ' mnt lalu' : diffMin < 1440 ? Math.floor(diffMin/60) + ' jam lalu' : '1 hari lalu';
      const text = m.media_url
        ? `<span style="color:#94a3b8;font-size:.75rem">📎 Media</span>`
        : `<span style="font-size:.8rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${escHtml((m.content || '').slice(0, 60))}${(m.content||'').length > 60 ? '...' : ''}</span>`;
      const roomBadgeColor = room.type === 'public' ? '#10b981' : room.type === 'dm' ? '#a78bfa' : '#f59e0b';
      const roomIcon = room.type === 'public' ? '🌐' : room.type === 'dm' ? '💬' : '👥';
      const clickId = room.id || 'general';
      html += `
        <div onclick="openRoomFromFeed('${clickId}','${escHtml(room.name)}','${room.type}','${room.avatar_color||'#334155'}')"
          style="display:flex;align-items:center;gap:.65rem;padding:.6rem 1rem;cursor:pointer;transition:background .15s;border-bottom:1px solid rgba(255,255,255,.03)"
          onmouseover="this.style.background='rgba(255,255,255,.04)'" onmouseout="this.style.background=''">
          <div style="width:34px;height:34px;border-radius:10px;background:${escHtml(color)};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff">${escHtml(initials)}</div>
          <div style="flex:1;min-width:0;overflow:hidden">
            <div style="display:flex;align-items:center;gap:.3rem;margin-bottom:.12rem">
              <span style="font-size:.58rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:99px;padding:.05rem .3rem;color:${roomBadgeColor};white-space:nowrap">${roomIcon} ${escHtml(room.name)}</span>
              <span style="font-size:.58rem;color:var(--muted);margin-left:auto;white-space:nowrap;flex-shrink:0">${timeAgo}</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:.25rem;overflow:hidden">
              <span style="font-size:.62rem;font-weight:700;color:${escHtml(color)};white-space:nowrap;flex-shrink:0">${isMyMsg ? 'Kamu' : escHtml((m.sender_code||'?').slice(0,14))}:</span>
              <div style="overflow:hidden;flex:1">${text}</div>
            </div>
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  html += `<div style="border-top:1px solid rgba(255,255,255,.06);padding:.5rem 1rem;text-align:center">
    <button onclick="showPage('chat');initChat();" style="background:none;border:none;color:var(--accent);font-size:.75rem;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:.3rem">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Buka Chat Komunitas
    </button>
  </div>`;

  container.innerHTML = html;
}

// Buka room langsung dari dashboard feed
function openRoomFromFeed(roomId, roomName, roomType, avatarColor) {
  showPage('chat');
  setTimeout(async () => {
    // Jika roomId = 'general' atau UUID nil, cari room General dari DB
    if (roomId === 'general' || roomId === NULL_UUID) {
      try {
        if (chatSB) {
          const { data: publicRooms } = await chatSB.from('chat_rooms')
            .select('id,name,type,avatar_color').eq('type','public').order('created_at').limit(1);
          if (publicRooms && publicRooms.length > 0) {
            const r = publicRooms[0];
            if (typeof openRoom === 'function') openRoom(r.id, r.name, r.type, r.avatar_color);
            return;
          }
        }
      } catch(e) {}
      // Fallback: buka chat page saja tanpa room spesifik
      if (typeof initChat === 'function') initChat();
      return;
    }
    if (typeof openRoom === 'function') {
      openRoom(roomId, roomName, roomType, avatarColor);
    } else {
      initChat();
    }
  }, 200);
}

function showChatOffline() {
  const screen = document.getElementById('chat-rooms-screen');
  if (!screen) return;
  screen.innerHTML = `
    <div class="chat-empty" style="height:60vh;justify-content:center;flex-direction:column">
      <div class="chat-empty-icon">⏳</div>
      <div class="chat-empty-text" style="color:var(--text)">
        <strong>Menghubungkan ke server...</strong><br><br>
        Pastikan koneksi internet aktif.<br>
        <button onclick="initChat()" style="
          margin-top:1rem;padding:.6rem 1.4rem;border-radius:12px;border:none;
          background:var(--accent);color:var(--bg);font-weight:700;cursor:pointer;
          font-family:'Inter',sans-serif;font-size:.85rem;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Coba Lagi
        </button>
      </div>
    </div>`;
}

// ── LOAD ALL ROOMS ──
async function loadRooms() {
  if (!chatSB) return;

  // Reset dulu agar tidak duplikat saat dipanggil ulang
  const groupEl = document.getElementById('group-rooms-list');
  const dmEl = document.getElementById('dm-rooms-list');
  if (groupEl) groupEl.innerHTML = '<div class="chat-empty" style="padding:1rem 0"><div class="chat-empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div class="chat-empty-text">Belum ada grup.<br>Buat grup baru!</div></div>';
  if (dmEl) dmEl.innerHTML = '<div class="chat-empty" style="padding:1rem 0"><div class="chat-empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><div class="chat-empty-text">Belum ada DM.<br>Masukkan kode anonim teman!</div></div>';

  // Public rooms
  const { data: publicRooms } = await chatSB
    .from('chat_rooms').select('*').eq('type','public').order('created_at');

  renderRoomList('public-rooms-list', publicRooms || []);

  // My group rooms (where I'm a member)
  const { data: myMemberships } = await chatSB
    .from('room_members').select('room_id').eq('user_code', chatState.myCode);

  if (myMemberships?.length) {
    const ids = myMemberships.map(m => m.room_id);
    const { data: groupRooms } = await chatSB
      .from('chat_rooms').select('*').eq('type','group').in('id', ids);
    const { data: dmRooms } = await chatSB
      .from('chat_rooms').select('*').eq('type','dm').in('id', ids);

    if (groupRooms?.length) renderRoomList('group-rooms-list', groupRooms);
    if (dmRooms?.length) renderRoomList('dm-rooms-list', dmRooms);
  }
}

function renderRoomList(containerId, rooms) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rooms.length) return;
  el.innerHTML = rooms.map(r => `
    <div class="room-item cg" onclick="openRoom('${r.id}','${escHtml(r.name)}','${r.type}','${r.avatar_color}')">
      <div class="room-avatar" style="background:${r.avatar_color}">
        ${r.type==='public'?'#':r.type==='dm'?'@':r.name?.charAt(0)?.toUpperCase()||'G'}
      </div>
      <div class="room-info">
        <div class="room-name">${escHtml(r.name)}</div>
        <div class="room-preview">${r.description || (r.type==='dm'?'Pesan pribadi':'Tap untuk chat')}</div>
      </div>
      <div class="room-meta">
        <div class="room-time">${r.type==='public'?'publik':''}</div>
      </div>
    </div>
  `).join('');
}

// ── OPEN ROOM ──
async function openRoom(roomId, name, type, color) {
  chatState.currentRoomId = roomId;
  chatState.currentRoomName = name;
  chatState.currentRoomType = type;

  // Update header
  const ha = document.getElementById('room-header-avatar');
  const hn = document.getElementById('room-header-name');
  const hs = document.getElementById('room-header-sub');
  if (ha) { ha.style.background = color; ha.textContent = type==='public'?'#':type==='dm'?'@':name.charAt(0).toUpperCase(); }
  if (hn) hn.textContent = name;
  if (hs) hs.textContent = type==='public'?'Room Publik':type==='dm'?'Pesan Pribadi':'Grup';

  // Tombol undang: tampil hanya untuk grup (bukan public, bukan dm)
  const inviteBtn = document.getElementById('room-invite-btn');
  if (inviteBtn) inviteBtn.style.display = type==='group' ? 'inline-flex' : 'none';

  // Tombol share link: tampil untuk grup dan DM
  const shareLinkBtn = document.getElementById('room-sharelink-btn');
  if (shareLinkBtn) shareLinkBtn.style.display = (type==='group' || type==='dm') ? 'inline-flex' : 'none';

  // Switch screen
  document.getElementById('chat-rooms-screen').classList.remove('active');
  document.getElementById('chat-room-screen').classList.add('active');

  // Join room_members if not already
  if (type !== 'public') {
    await chatSB.from('room_members').upsert(
      { room_id: roomId, user_code: chatState.myCode },
      { onConflict: 'room_id,user_code' }
    );
  }

  // Load messages
  await loadMessages(roomId);

  // Subscribe realtime
  subscribeRoom(roomId);

  // Nav: sembunyikan saat masuk room
  const bnav = document.getElementById('bottom-nav');
  if (bnav) { bnav.style.display = 'none'; }

  // Focus input
  setTimeout(() => document.getElementById('chat-input')?.focus(), 300);
}

// ── LOAD MESSAGES ──
const MSG_PAGE_SIZE = 40;

async function loadMessages(roomId) {
  const area = document.getElementById('messages-area');
  area.innerHTML = '<div class="msg-skeleton" style="width:60%;margin:.5rem 0"></div><div class="msg-skeleton" style="width:40%;margin:.5rem 0 .5rem auto"></div>';

  // Reset pagination state
  chatState.msgOffset = 0;
  chatState.msgHasMore = false;
  chatState.msgLoadingMore = false; // reset lock supaya load more tidak terkunci di room baru

  const { data: msgs, error } = await chatSB
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(MSG_PAGE_SIZE);

  // Guard: jika user sudah pindah room saat fetch berlangsung, batalkan render
  if (chatState.currentRoomId !== roomId) return;

  if (error) { area.innerHTML = '<div class="chat-empty"><div class="chat-empty-text">Gagal memuat pesan</div></div>'; return; }

  const list = (msgs || []).reverse();
  chatState.msgOffset = list.length;
  chatState.msgHasMore = (msgs || []).length === MSG_PAGE_SIZE;

  renderMessages(list);
  renderLoadMoreBtn();
}

async function loadMoreMessages() {
  if (!chatState.msgHasMore || chatState.msgLoadingMore) return;
  const roomId = chatState.currentRoomId;
  if (!roomId) return;

  chatState.msgLoadingMore = true;

  // Update tombol jadi loading
  const btn = document.getElementById('load-more-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(0,229,255,.3);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>Memuat...`;
  }

  try {
  const { data: msgs, error } = await chatSB
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .range(chatState.msgOffset, chatState.msgOffset + MSG_PAGE_SIZE - 1);

  if (chatState.currentRoomId !== roomId) return;
  if (error) { if (btn) { btn.disabled = false; btn.textContent = 'Gagal, coba lagi'; } return; }

  const list = (msgs || []).reverse();
  chatState.msgOffset += list.length;
  chatState.msgHasMore = (msgs || []).length === MSG_PAGE_SIZE;

  // Simpan scroll position supaya tidak loncat ke atas
  const area = document.getElementById('messages-area');
  const oldScrollHeight = area.scrollHeight;

  // Hapus tombol load more lama
  const oldBtn = document.getElementById('load-more-wrap');
  if (oldBtn) oldBtn.remove();

  // Prepend pesan lama ke atas
  let html = '';
  let lastDate = '';
  list.forEach(msg => {
    const d = new Date(msg.created_at);
    const dateLabel = d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'});
    if (dateLabel !== lastDate) {
      html += `<div class="msg-date-sep">${dateLabel}</div>`;
      lastDate = dateLabel;
    }
    html += buildMsgBubble(msg);
  });

  const temp = document.createElement('div');
  temp.innerHTML = html;
  // Bind reply gesture pada pesan lama
  temp.querySelectorAll('.msg-bubble').forEach(b => bindReplyGesture(b));

  // Insert semua node sebelum pesan pertama yang ada
  const firstChild = area.firstChild;
  while (temp.firstChild) {
    area.insertBefore(temp.firstChild, firstChild);
  }

  // Kembalikan scroll position supaya tidak loncat
  area.scrollTop = area.scrollHeight - oldScrollHeight;

  // Render tombol load more baru jika masih ada
  renderLoadMoreBtn();
  } catch(e) {
    console.error('[loadMoreMessages]', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Gagal, coba lagi'; }
  } finally {
    chatState.msgLoadingMore = false; // selalu reset, bahkan jika error/exception
  }
}

function renderLoadMoreBtn() {
  const area = document.getElementById('messages-area');
  // Hapus tombol lama jika ada
  const old = document.getElementById('load-more-wrap');
  if (old) old.remove();

  if (!chatState.msgHasMore) return;

  const wrap = document.createElement('div');
  wrap.id = 'load-more-wrap';
  wrap.style.cssText = 'display:flex;justify-content:center;padding:.6rem 0 .4rem';
  wrap.innerHTML = `<button id="load-more-btn" onclick="loadMoreMessages()" style="
    background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);
    border-radius:20px;padding:.4rem 1.1rem;color:var(--accent);
    font-size:.72rem;font-weight:700;font-family:'Inter',sans-serif;
    cursor:pointer;display:flex;align-items:center;gap:.4rem;
    transition:background .2s,border-color .2s;
  " onmouseover="this.style.background='rgba(0,229,255,.15)'" onmouseout="this.style.background='rgba(0,229,255,.08)'">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>
    Muat pesan sebelumnya
  </button>`;
  area.insertBefore(wrap, area.firstChild);
}

function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  if (!msgs.length) {
    area.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="13" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="17" cy="10" r="1" fill="#00e5ff" stroke="none"/></svg></div><div class="chat-empty-text">Belum ada pesan.<br>Jadilah yang pertama!</div></div>';
    return;
  }

  let html = '';
  let lastDate = '';
  msgs.forEach(msg => {
    const d = new Date(msg.created_at);
    const dateLabel = d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'});
    if (dateLabel !== lastDate) {
      html += `<div class="msg-date-sep">${dateLabel}</div>`;
      lastDate = dateLabel;
    }
    html += buildMsgBubble(msg);
  });
  area.innerHTML = html;
  area.scrollTop = area.scrollHeight;

  // Bind reply on bubble - dblclick desktop, long-press mobile
  area.querySelectorAll('.msg-bubble').forEach(b => {
    bindReplyGesture(b);
  });

  // Render tombol load more di atas jika ada lebih banyak pesan
  renderLoadMoreBtn();
}

function buildMsgBubble(msg) {
  const isMine = msg.sender_code === chatState.myCode;
  const t = new Date(msg.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  const color = isMine ? chatState.myColor : stringToColor(msg.sender_code);
  const initial = (msg.sender_code||'?').slice(5,7).toUpperCase();

  // Reply reference
  let replyHtml = '';
  if (msg.reply_to && msg.reply_text) {
    replyHtml = `<div class="msg-reply-ref" data-reply-id="${escHtml(String(msg.reply_to))}" onclick="scrollToReplyMsg('${escHtml(String(msg.reply_to))}')" title="Tap untuk lihat pesan asli">
      <div style="color:var(--accent);font-weight:700;font-size:.65rem;margin-bottom:.15rem">↩ ${escHtml(msg.reply_sender || 'Pesan')}</div>
      <div style="font-size:.73rem;opacity:.75;line-height:1.4;word-break:break-word">${escHtml(String(msg.reply_text).slice(0,120))}${(msg.reply_text?.length||0)>120?'…':''}</div>
    </div>`;
  }

  // Media content
  let contentHtml = '';
  if (msg.media_url) {
    const isVideo = msg.media_type?.startsWith('video') || /\.(mp4|webm|mov|avi)$/i.test(msg.media_url);
    if (isVideo) {
      contentHtml = `<div class="msg-media" onclick="openLightbox('video','${escHtml(msg.media_url)}')">
        <video src="${escHtml(msg.media_url)}" preload="metadata" muted playsinline style="pointer-events:none"></video>
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.3);border-radius:14px">
          <div style="width:40px;height:40px;background:rgba(0,0,0,.6);border-radius:50%;display:flex;align-items:center;justify-content:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
      </div>`;
      contentHtml = `<div style="position:relative">${contentHtml}</div>`;
    } else {
      contentHtml = `<div class="msg-media" onclick="openLightbox('img','${escHtml(msg.media_url)}')">
        <img src="${escHtml(msg.media_url)}" loading="lazy" alt="foto">
      </div>`;
    }
    // Caption jika ada
    if (msg.content) contentHtml += `<div style="padding:.3rem .1rem .1rem;font-size:.82rem">${escHtml(msg.content)}</div>`;
  } else {
    contentHtml = msg.content ? escHtml(msg.content) : '';
  }

  return `
    <div class="msg-row ${isMine?'mine':'theirs'}">
      ${!isMine ? `<div class="msg-avatar" style="background:${color}">${initial}</div>` : ''}
      <div class="msg-bubble-wrap">
        ${!isMine ? `<div class="msg-sender-name">${escHtml(msg.sender_code||'anon')}</div>` : ''}
        ${replyHtml}
        <div class="msg-bubble" data-msg-id="${msg.id}" data-msg-text="${escHtml(msg.content||'📎 Media')}" data-msg-sender="${escHtml(msg.sender_code||'')}">
          ${contentHtml}
        </div>
        <div class="msg-time">${t}</div>
      </div>
      ${isMine ? `<div class="msg-avatar" style="background:${color}">${initial}</div>` : ''}
    </div>`;
}

// ── REALTIME SUBSCRIBE ──
function subscribeRoom(roomId) {
  // Unsubscribe previous
  if (chatState.msgSubscription) {
    chatSB.removeChannel(chatState.msgSubscription);
  }
  chatState.msgSubscription = chatSB
    .channel('room-' + roomId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `room_id=eq.${roomId}`
    }, payload => {
      appendMessage(payload.new);
    })
    .subscribe();
}

function appendMessage(msg) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  // Deduplication: jangan append jika pesan sudah ada
  if (msg.id && area.querySelector(`[data-msg-id="${msg.id}"]`)) return;
  // Remove empty state
  const empty = area.querySelector('.chat-empty');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.innerHTML = buildMsgBubble(msg);
  const msgEl = el.firstElementChild;
  // Bind reply on bubble
  msgEl?.querySelector('.msg-bubble')?.addEventListener && bindReplyGesture(msgEl.querySelector('.msg-bubble'));
  area.appendChild(msgEl);
  area.scrollTop = area.scrollHeight;
}

// ── SEND MESSAGE ──
async function sendMessage() {
  const inp = document.getElementById('chat-input');
  const content = inp?.value?.trim();
  if (!content && !chatState.pendingMedia) return;
  if (!chatState.currentRoomId || !chatSB) {
    toast('⚠ Chat belum terhubung. Coba buka room kembali.', 1);
    return;
  }
  // Guard: pastikan myCode ada
  if (!chatState.myCode) {
    toast('⚠ Identitas chat belum siap. Mohon tunggu...', 1);
    await chatBoot();
    return;
  }

  const sendBtn = document.getElementById('chat-send-btn');
  if (sendBtn) sendBtn.classList.add('uploading');

  try {
    let media_url = null;
    let media_type = null;

    // Upload media jika ada
    if (chatState.pendingMedia) {
      const file = chatState.pendingMedia;
      const rawExt = file.name ? file.name.split('.').pop() : '';
      const ext = (rawExt && rawExt.length <= 5 ? rawExt : (file.type.split('/')[1] || 'jpg')).toLowerCase();
      const fileName = `chat/${chatState.currentRoomId}/${Date.now()}_${Math.random().toString(36).slice(2,7)}.${ext}`;
      toast(`Upload... ${file.name} (${(file.size/1024).toFixed(0)}kb, ${file.type})`, 0);
      const { data, error: upErr } = await chatSB.storage
        .from('chat-media')
        .upload(fileName, file, { cacheControl:'3600', upsert:false });
      if (upErr) {
        toast('Upload gagal: ' + (upErr.message || JSON.stringify(upErr)), 1);
        if (sendBtn) sendBtn.classList.remove('uploading');
        return;
      }
      toast('Upload OK, kirim pesan...', 0);
      const { data: urlData } = chatSB.storage.from('chat-media').getPublicUrl(fileName);
      media_url = urlData?.publicUrl;
      media_type = file.type;
      cancelUpload();
    }

    // Kirim hanya field yang pasti ada — hindari kolom yang belum ada
    const msg = {
      room_id: chatState.currentRoomId,
      sender_code: chatState.myCode,
      content: content || null,
    };
    if (media_url) { msg.media_url = media_url; msg.media_type = media_type; }
    if (chatState.replyTo) {
      msg.reply_to   = chatState.replyTo;
      msg.reply_text = chatState.replyText;
      msg.reply_sender = chatState.replySender || '';
    }

    inp.value = '';
    inp.style.height = '';
    cancelReply();

    const { error } = await chatSB.from('messages').insert(msg);
    if (error) {
      // Re-upsert user identity in case of FK/RLS error, then retry
      try {
        await chatSB.from('anon_users').upsert(
          { code: chatState.myCode, avatar_color: chatState.myColor || '#00e5ff' },
          { onConflict: 'code' }
        );
        const { error: err2 } = await chatSB.from('messages').insert(msg);
        if (err2) toast('Gagal kirim: ' + (err2.message || err2.code || 'Unknown error'), 1);
      } catch(retryErr) {
        toast('Gagal kirim: ' + (error.message || error.code || JSON.stringify(error)), 1);
      }
    }
  } catch(e) {
    toast('Error: ' + (e.message || String(e)), 1);
  } finally {
    if (sendBtn) sendBtn.classList.remove('uploading');
  }
}

function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

let _emojiOpen = false;

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  // Tutup emoji saat mulai ketik
  if (_emojiOpen) closeEmojiPicker();
}

// ── REPLY GESTURE: swipe-right (mobile WhatsApp style) + double-click (desktop) ──
function bindReplyGesture(bubble) {
  if (!bubble || bubble._replyBound) return;
  bubble._replyBound = true;

  const triggerReply = () => {
    const id     = bubble.dataset.msgId;
    const txt    = bubble.dataset.msgText;
    const sender = bubble.dataset.msgSender || '';
    if (id && txt) {
      if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
      setReply(id, txt, sender);
    }
  };

  // ── SWIPE RIGHT (WhatsApp style) ──
  let _sx = 0, _sy = 0, _swiping = false, _swipeDone = false;
  const SWIPE_THRESHOLD = 60;
  const ANGLE_LIMIT = 40;
  const row = bubble.closest('.msg-row') || bubble;

  bubble.addEventListener('touchstart', e => {
    _sx = e.touches[0].clientX;
    _sy = e.touches[0].clientY;
    _swiping = false;
    _swipeDone = false;
  }, { passive: true });

  bubble.addEventListener('touchmove', e => {
    if (_swipeDone) return;
    const dx = e.touches[0].clientX - _sx;
    const dy = e.touches[0].clientY - _sy;
    if (!_swiping && Math.abs(dx) > 10) {
      const angle = Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI);
      if (angle < ANGLE_LIMIT) _swiping = true;
    }
    if (_swiping && dx > 0) {
      const slide = Math.min(dx * 0.55, SWIPE_THRESHOLD + 10);
      row.style.transform = `translateX(${slide}px)`;
      row.style.transition = 'none';
      if (!row._replyIcon) {
        const ic = document.createElement('div');
        ic.className = '_swipe-reply-icon';
        ic.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`;
        ic.style.cssText = 'position:absolute;left:-36px;top:50%;transform:translateY(-50%);opacity:0;transition:opacity .15s;pointer-events:none;';
        row.style.position = 'relative';
        row.appendChild(ic);
        row._replyIcon = ic;
      }
      const progress = Math.min(slide / SWIPE_THRESHOLD, 1);
      row._replyIcon.style.opacity = progress;
      if (slide >= SWIPE_THRESHOLD && !_swipeDone) {
        _swipeDone = true;
        if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
        triggerReply();
      }
    }
  }, { passive: true });

  const endSwipe = () => {
    if (_swiping) {
      row.style.transition = 'transform .25s cubic-bezier(.25,.8,.25,1)';
      row.style.transform = '';
      if (row._replyIcon) { row._replyIcon.style.opacity = '0'; }
    }
    _swiping = false;
  };

  bubble.addEventListener('touchend', endSwipe, { passive: true });
  bubble.addEventListener('touchcancel', endSwipe, { passive: true });

  // Desktop: double click
  bubble.addEventListener('dblclick', triggerReply);
}

// ── REPLY ──
function setReply(msgId, text, sender) {
  chatState.replyTo = msgId;
  chatState.replyText = text;
  chatState.replySender = sender || '';
  const bar = document.getElementById('reply-preview');
  if (bar) { bar.classList.add('show'); }
  const pt = document.getElementById('reply-preview-text');
  if (pt) { pt.innerHTML = `<span style="color:var(--accent);font-weight:700">↩</span> ${text}`; }
  document.getElementById('chat-input')?.focus();
}

function cancelReply() {
  chatState.replyTo = null;
  chatState.replyText = '';
  const bar = document.getElementById('reply-preview');
  if (bar) bar.classList.remove('show');
}

// Scroll ke pesan asli saat reply-ref di-tap, dengan highlight animasi
function scrollToReplyMsg(msgId) {
  if (!msgId) return;
  const area = document.getElementById('messages-area');
  if (!area) return;
  const target = area.querySelector(`.msg-bubble[data-msg-id="${msgId}"]`);
  if (!target) { toast('Pesan tidak ditemukan', 1); return; }
  // Scroll ke target
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Highlight animasi
  target.style.transition = 'background .2s, outline .2s';
  target.style.outline = '2px solid var(--accent)';
  target.style.background = 'rgba(0,229,255,.18)';
  setTimeout(() => {
    target.style.outline = 'none';
    target.style.background = '';
    setTimeout(() => { target.style.transition = ''; }, 300);
  }, 1200);
}

// ── MEDIA UPLOAD ──
chatState.pendingMedia = null;

function onMediaSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) { toast('File max 50MB', 1); input.value=''; return; }

  chatState.pendingMedia = file;
  const bar = document.getElementById('upload-preview-bar');
  const thumb = document.getElementById('upload-preview-thumb');
  const name = document.getElementById('upload-preview-name');
  const size = document.getElementById('upload-preview-size');

  if (name) name.textContent = file.name;
  if (size) size.textContent = (file.size/1024/1024).toFixed(2) + ' MB';

  // Preview thumbnail
  if (thumb) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        thumb.innerHTML = `<img src="${e.target.result}" alt="preview" style="width:100%;height:100%;object-fit:cover">`;
      };
      reader.readAsDataURL(file);
    } else {
      thumb.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
    }
  }
  if (bar) bar.style.display = 'flex';
  input.value = '';
}

function cancelUpload() {
  chatState.pendingMedia = null;
  const bar = document.getElementById('upload-preview-bar');
  if (bar) bar.style.display = 'none';
  const thumb = document.getElementById('upload-preview-thumb');
  if (thumb) thumb.innerHTML = '';
}

// ── LIGHTBOX ──
function openLightbox(type, url) {
  const lb = document.getElementById('media-lightbox');
  const content = document.getElementById('media-lightbox-content');
  if (!lb || !content) return;
  content.innerHTML = type === 'video'
    ? `<video src="${url}" controls autoplay style="max-width:100%;max-height:88vh;border-radius:14px"></video>`
    : `<img src="${url}" alt="media" style="max-width:100%;max-height:90vh;border-radius:14px">`;
  lb.classList.add('open');
}
function closeLightbox() {
  const lb = document.getElementById('media-lightbox');
  if (lb) lb.classList.remove('open');
  const content = document.getElementById('media-lightbox-content');
  if (content) content.innerHTML = '';
}
// ESC key close lightbox
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const lb = document.getElementById('media-lightbox');
    if (lb?.classList.contains('open')) closeLightbox();
    if (_emojiOpen) closeEmojiPicker();
  }
});

// ── MEDIA: KAMERA & GALERI ──
// openCamera() didefinisikan di bawah sebagai dynamic input
function openGallery() {
  document.getElementById('media-upload-input')?.click();
}

// ── EMOJI PICKER ──
const EMOJI_DATA = {
  '😀': ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳'],
  '😢': ['😢','😭','😤','😠','😡','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','✡️','🔯','🪯','🕎','☯️','🛐'],
  '👍': ['👍','👎','👊','✊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤌','🤏','👈','👉','👆','👇','☝️','👋','🤚','🖐️','✋','🖖','💪','🦾','🦿','🖕','✍️','🤳','💅'],
  '🐶': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄'],
  '🍕': ['🍕','🍔','🍟','🌭','🍿','🧂','🥓','🥚','🍳','🧇','🥞','🧈','🍞','🥐','🥖','🥨','🧀','🥗','🥙','🌮','🌯','🫔','🥪','🫕','🍲','🫙','🍱','🍘','🍙','🍚'],
  '⚽': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥅','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂'],
  '🚗': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚁','🛸','✈️','🚀','🛩️','🚂','🚃','🚄','🚅','🚆','🚇'],
  '💯': ['💯','🔥','✨','⭐','🌟','💫','⚡','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','🌊','💧','💦','🌀','🌪️','🌫️','🌈','🎇','🎆','🎑','✅'],
};

function buildEmojiPicker() {
  const cats = document.getElementById('emoji-cats');
  const grid = document.getElementById('emoji-grid');
  if (!cats || !grid) return;

  const catEmojis = Object.keys(EMOJI_DATA);
  cats.innerHTML = '';
  catEmojis.forEach((k, i) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
    btn.textContent = k;
    btn.dataset.catKey = k;
    btn.onclick = function() { showEmojiCat(k, this); };
    cats.appendChild(btn);
  });

  showEmojiCatData(catEmojis[0]);

  // Pasang event delegation untuk emoji grid
  if (!grid._emojiDelegated) {
    grid._emojiDelegated = true;
    grid.addEventListener('click', function(e) {
      const btn = e.target.closest('.emoji-btn');
      if (btn && btn.dataset.emoji) {
        insertEmoji(btn.dataset.emoji);
      }
    });
  }
}

function showEmojiCat(key, btn) {
  document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  showEmojiCatData(key);
}

function showEmojiCatData(key) {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  const emojis = EMOJI_DATA[key] || [];
  grid.innerHTML = '';
  emojis.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn';
    btn.textContent = e;
    btn.dataset.emoji = e;
    grid.appendChild(btn);
  });
}

function insertEmoji(emoji) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const start = inp.selectionStart;
  const end = inp.selectionEnd;
  const val = inp.value;
  inp.value = val.slice(0,start) + emoji + val.slice(end);
  inp.selectionStart = inp.selectionEnd = start + emoji.length;
  inp.focus();
  autoGrow(inp);
}

function toggleEmojiPicker() {
  const panel = document.getElementById('emoji-picker-panel');
  const btn = document.getElementById('emoji-toggle-btn');
  if (!panel) return;

  if (_emojiOpen) {
    closeEmojiPicker();
    return;
  }
  _emojiOpen = true;

  // Build emoji content
  buildEmojiPicker();

  // Show panel - slide up dari bawah
  panel.style.display = 'block';
  panel.style.transform = 'translateY(100%)';
  panel.style.transition = 'none';

  // Force reflow lalu animate
  panel.getBoundingClientRect();
  panel.style.transition = 'transform .28s cubic-bezier(.25,.8,.25,1)';
  panel.style.transform = 'translateY(0)';

  if (btn) btn.classList.add('active');

  // Overlay gelap di belakang panel
  let overlay = document.getElementById('emoji-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'emoji-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.4);';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'block';
  overlay.onclick = closeEmojiPicker;
}

function closeEmojiPicker() {
  const panel = document.getElementById('emoji-picker-panel');
  const btn = document.getElementById('emoji-toggle-btn');
  const overlay = document.getElementById('emoji-overlay');
  if (!panel) return;
  _emojiOpen = false;
  panel.style.transform = 'translateY(100%)';
  setTimeout(() => { panel.style.display = 'none'; panel.style.transform = ''; }, 250);
  if (btn) btn.classList.remove('active');
  if (overlay) overlay.style.display = 'none';
}

function closeEmojiOutside(e) {
  // Tidak dipakai lagi — diganti overlay
}

// ── NAVIGATION ──
function chatGoBack() {
  // Unsubscribe
  if (chatState.msgSubscription) {
    chatSB?.removeChannel(chatState.msgSubscription);
    chatState.msgSubscription = null;
  }
  chatState.currentRoomId = null;
  document.getElementById('chat-room-screen').classList.remove('active');
  document.getElementById('chat-rooms-screen').classList.add('active');
  // Nav: tampilkan kembali saat kembali ke rooms list
  const bnav = document.getElementById('bottom-nav');
  if (bnav) { bnav.style.display = 'block'; bnav.classList.remove('bnav-hidden'); }
  // Refresh room list
  loadRooms();
}

// ── NEW ROOM MODAL ──
function openNewRoomModal() {
  const modal = document.getElementById('chat-new-room-modal');
  if (modal) { modal.classList.add('open'); }
  // Show my code in DM section
  const disp = document.getElementById('dm-my-code-display');
  if (disp) disp.textContent = chatState.myCode || '—';
  document.getElementById('dm-my-code-box')?.classList.add('show');
}

function closeNewRoomModal(e) {
  if (e.target.id === 'chat-new-room-modal') {
    document.getElementById('chat-new-room-modal').classList.remove('open');
  }
}

function setRoomType(type, el) {
  chatState.newRoomType = type;
  document.querySelectorAll('.room-type-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('group-fields').style.display = type==='group'?'block':'none';
  document.getElementById('dm-fields').style.display = type==='dm'?'block':'none';
  document.getElementById('join-fields').style.display = type==='join'?'block':'none';
  const btnText = {group:'Buat Grup', dm:'Mulai DM', join:'Join Grup'};
  document.getElementById('create-room-btn').textContent = btnText[type] || 'Buat';
}

function buildColorPicker() {
  const el = document.getElementById('color-picker');
  if (!el) return;
  el.innerHTML = AVATAR_COLORS.map(c => `
    <div class="color-dot ${c===chatState.newRoomColor?'selected':''}"
      style="background:${c};box-shadow:0 2px 12px ${c}55"
      onclick="selectColor('${c}',this)"></div>
  `).join('');
}

function selectColor(c, el) {
  chatState.newRoomColor = c;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
}

async function createRoom() {
  if (!chatSB) return;
  const type = chatState.newRoomType;

  // ── JOIN GRUP via kode ──
  if (type === 'join') {
    const code = document.getElementById('join-room-code')?.value?.trim().toUpperCase();
    if (!code || code.length < 4) { toast('Masukkan kode undangan yang valid', 1); return; }

    // Cari room dengan invite_code ini
    const { data: room, error } = await chatSB
      .from('chat_rooms').select('*').eq('invite_code', code).eq('type', 'group').single();

    if (error || !room) { toast('Kode tidak ditemukan atau sudah tidak aktif', 1); return; }

    // Cek apakah sudah member
    const { data: alreadyMember } = await chatSB
      .from('room_members').select('room_id')
      .eq('room_id', room.id).eq('user_code', chatState.myCode).single();

    if (alreadyMember) {
      document.getElementById('chat-new-room-modal').classList.remove('open');
      openRoom(room.id, room.name, 'group', room.avatar_color);
      toast('Kamu sudah di grup ini');
      return;
    }

    // Tambah sebagai member
    await chatSB.from('room_members').insert({ room_id: room.id, user_code: chatState.myCode });

    document.getElementById('chat-new-room-modal').classList.remove('open');
    openRoom(room.id, room.name, 'group', room.avatar_color);
    toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Berhasil join grup: ' + room.name);
    await loadRooms();
    return;
  }

  if (type === 'dm') {
    const target = document.getElementById('dm-target-code')?.value?.trim();
    if (!target || !target.startsWith('anon-')) { toast('Kode anonim tidak valid', 1); return; }
    if (target === chatState.myCode) { toast('Tidak bisa DM diri sendiri', 1); return; }

    // Cek apakah target user ada
    const { data: targetUser } = await chatSB.from('anon_users').select('code').eq('code', target).single();
    if (!targetUser) { toast('Kode anonim tidak ditemukan', 1); return; }

    // Cek apakah DM room sudah ada (cegah duplikat)
    const { data: myRooms } = await chatSB
      .from('room_members').select('room_id').eq('user_code', chatState.myCode);
    if (myRooms?.length) {
      const myRoomIds = myRooms.map(r => r.room_id);
      const { data: targetRooms } = await chatSB
        .from('room_members').select('room_id').eq('user_code', target).in('room_id', myRoomIds);
      if (targetRooms?.length) {
        const { data: existDM } = await chatSB
          .from('chat_rooms').select('*').eq('type','dm').in('id', targetRooms.map(r=>r.room_id)).single();
        if (existDM) {
          document.getElementById('chat-new-room-modal').classList.remove('open');
          openRoom(existDM.id, target, 'dm', '#7c3aed');
          toast('Membuka DM yang sudah ada');
          return;
        }
      }
    }

    const dmName = `${chatState.myCode} ↔ ${target}`;
    const { data: room, error } = await chatSB.from('chat_rooms').insert({
      type: 'dm', name: dmName, avatar_color: '#7c3aed', created_by: chatState.myCode
    }).select().single();

    if (error) { toast('Gagal buat DM', 1); return; }

    await chatSB.from('room_members').insert([
      { room_id: room.id, user_code: chatState.myCode },
      { room_id: room.id, user_code: target },
    ]);

    document.getElementById('chat-new-room-modal').classList.remove('open');
    openRoom(room.id, target, 'dm', '#7c3aed');

  } else {
    const name = document.getElementById('new-room-name')?.value?.trim();
    const desc = document.getElementById('new-room-desc')?.value?.trim();
    if (!name) { toast('Nama grup tidak boleh kosong', 1); return; }

    // Generate kode undangan unik 6 karakter
    const inviteCode = Math.random().toString(36).slice(2,8).toUpperCase();

    const { data: room, error } = await chatSB.from('chat_rooms').insert({
      type: 'group', name, description: desc||'',
      avatar_color: chatState.newRoomColor,
      created_by: chatState.myCode,
      invite_code: inviteCode,
    }).select().single();

    if (error) { toast('Gagal buat grup', 1); return; }

    await chatSB.from('room_members').insert({ room_id: room.id, user_code: chatState.myCode });

    document.getElementById('chat-new-room-modal').classList.remove('open');
    openRoom(room.id, name, 'group', chatState.newRoomColor);
    toast(`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Grup dibuat! Kode undangan: ${inviteCode}`);
  }
}

// ── INVITE / KODE GRUP ──
async function showRoomInvite() {
  if (!chatState.currentRoomId || !chatSB) return;

  // Ambil invite_code dari room
  const { data: room } = await chatSB
    .from('chat_rooms').select('invite_code,name').eq('id', chatState.currentRoomId).single();

  if (!room) { toast('Gagal ambil info grup', 1); return; }

  let code = room.invite_code;

  // Jika belum ada kode, generate sekarang
  if (!code) {
    code = Math.random().toString(36).slice(2,8).toUpperCase();
    await chatSB.from('chat_rooms').update({ invite_code: code }).eq('id', chatState.currentRoomId);
  }

  const base = window.location.origin + window.location.pathname;
  const link = `${base}?join=${encodeURIComponent(code)}`;

  // Show modal with code AND link
  _showInviteModal(room.name, code, link);
}

function _showInviteModal(name, code, link) {
  // Remove existing if any
  const old = document.getElementById('_invite-modal');
  if (old) old.remove();

  const div = document.createElement('div');
  div.id = '_invite-modal';
  div.style.cssText = 'position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.75);backdrop-filter:blur(12px);display:flex;align-items:flex-end;justify-content:center';
  div.innerHTML = `
    <div style="width:100%;max-width:480px;background:rgba(6,11,24,.98);border:1px solid rgba(255,255,255,.12);border-bottom:none;border-radius:24px 24px 0 0;padding:1.4rem;box-shadow:0 -24px 60px rgba(0,0,0,.7)">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.18);border-radius:2px;margin:0 auto .9rem"></div>
      <div style="font-weight:800;font-size:.95rem;margin-bottom:1.1rem;display:flex;align-items:center;gap:.5rem">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
        Undang ke "${name}"
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600">Kode Undangan</div>
      <div style="background:rgba(0,229,255,.07);border:1px solid rgba(0,229,255,.25);border-radius:12px;padding:.8rem 1rem;margin-bottom:.8rem;display:flex;align-items:center;justify-content:space-between">
        <span style="font-family:'Space Mono',monospace;font-size:1.1rem;font-weight:800;color:var(--accent);letter-spacing:.12em">${code}</span>
        <button onclick="navigator.clipboard?.writeText('${code}').then(()=>window._toast&&window._toast('Kode disalin!'))" style="background:rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.25);border-radius:8px;padding:.35rem .65rem;color:var(--accent);font-size:.72rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif">Salin</button>
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin-bottom:.5rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600">Link Langsung</div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:.7rem .9rem;margin-bottom:.8rem;display:flex;align-items:center;gap:.5rem">
        <span style="flex:1;font-size:.72rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${link}</span>
        <button onclick="navigator.clipboard?.writeText('${link}').then(()=>window._toast&&window._toast('Link disalin!'))" style="background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);border-radius:8px;padding:.35rem .65rem;color:var(--accent2);font-size:.72rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;flex-shrink:0">Salin</button>
      </div>
      <div style="display:flex;gap:.6rem">
        <button onclick="if(navigator.share)navigator.share({title:'Gabung grup z-wealth',text:'Gabung di grup \\'${name}\\' di z-wealth!',url:'${link}'}).catch(()=>{});else navigator.clipboard?.writeText('${link}')" style="flex:1;padding:.8rem;border-radius:12px;background:linear-gradient(135deg,rgba(0,229,255,.2),rgba(124,58,237,.15));border:1px solid rgba(0,229,255,.3);color:var(--accent);font-weight:800;font-size:.82rem;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;gap:.4rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Bagikan
        </button>
        <button onclick="document.getElementById('_invite-modal').remove()" style="padding:.8rem 1.4rem;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--muted);font-weight:700;font-size:.82rem;cursor:pointer;font-family:'Inter',sans-serif">Tutup</button>
      </div>
    </div>`;
  div.addEventListener('click', e => { if (e.target===div) div.remove(); });
  document.body.appendChild(div);
  // expose toast to inline handlers
  window._toast = toast;
}


// ── UTILS ──
function copyMyCode() {
  if (!chatState.myCode) return;
  navigator.clipboard?.writeText(chatState.myCode);
  toast('Kode disalin: ' + chatState.myCode);
}

function stringToColor(str) {
  if (!str) return '#64748b';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash<<5)-hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── COMING SOON ──

// ══════════ ALERTS & REMINDERS PAGE ══════════
let _alertsBtcPrice = null;

function initAlertsPage() {
  fetchAlertBtcPrice();
  renderAlertsList();
  renderRemindersList();
  updateReminderPreview();
  checkNotifPermission();
}

async function fetchAlertBtcPrice() {
  const priceEl = document.getElementById('alert-btc-price');
  const changeEl = document.getElementById('alert-btc-change');
  if (!priceEl) return;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true');
    const d = await r.json();
    const price = d.bitcoin?.usd;
    const change = d.bitcoin?.usd_24h_change;
    if (price) {
      _alertsBtcPrice = price;
      priceEl.textContent = '$' + price.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
      if (changeEl && change !== undefined) {
        const sign = change >= 0 ? '+' : '';
        changeEl.textContent = sign + change.toFixed(2) + '%';
        changeEl.style.color = change >= 0 ? 'var(--accent3)' : 'var(--danger)';
      }
      // Check alerts
      checkPriceAlerts(price);
    }
  } catch(e) {
    priceEl.textContent = 'Gagal memuat';
  }
}

function getAlerts() {
  try { return JSON.parse(localStorage.getItem('zw_price_alerts') || '[]'); } catch(e) { return []; }
}
function saveAlerts(arr) {
  localStorage.setItem('zw_price_alerts', JSON.stringify(arr));
  _syncUserPushData();
}

function openAlertModal() { openModal('modal-alert'); }
function openDonateModal() { openModal('modal-donate'); }

function copyDonate(addr, id) {
  navigator.clipboard.writeText(addr).then(() => {
    const btn = document.getElementById('copy-' + id);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Done';
      btn.style.background = 'rgba(16,185,129,.3)';
      btn.style.borderColor = 'rgba(16,185,129,.5)';
      btn.style.color = '#10b981';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      }, 2000);
    }
  }).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = addr;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    toast('✅ Address disalin!');
  });
}


function saveAlert() {
  const type = document.getElementById('alert-type')?.value;
  const rawPrice = (document.getElementById('alert-price')?.value || '').replace(/\./g,'').replace(',','.');
  const price = parseFloat(rawPrice);
  const note = document.getElementById('alert-note')?.value?.trim() || '';
  if (!price || isNaN(price)) { toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Masukkan target harga!', 2); return; }
  const alerts = getAlerts();
  alerts.push({ id: Date.now(), type, price, note, active: true, triggered: false });
  saveAlerts(alerts);
  closeModal('modal-alert');
  document.getElementById('alert-price').value = '';
  document.getElementById('alert-note').value = '';
  renderAlertsList();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Alert disimpan!');
}

function deleteAlert(id) {
  const alerts = getAlerts().filter(a => a.id !== id);
  saveAlerts(alerts);
  renderAlertsList();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> Alert dihapus');
}

function renderAlertsList() {
  const container = document.getElementById('alerts-list');
  if (!container) return;
  const alerts = getAlerts();
  if (!alerts.length) {
    container.innerHTML = '<div class="empty"><div class="emoji"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".4"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div><h3>Belum Ada Alert</h3><p>Buat alert harga untuk mendapat notifikasi</p></div>';
    return;
  }
  container.innerHTML = alerts.map(a => `
    <div style="background:var(--surface2);border:1px solid ${a.triggered?'rgba(239,68,68,.4)':a.type==='above'?'rgba(16,185,129,.3)':'rgba(239,68,68,.3)'};border-radius:12px;padding:.85rem 1rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.8rem">
      <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:${a.type==='above'?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'};flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${a.type==='above'?'#10b981':'#ef4444'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${a.type==='above'?'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>':'<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>'}</svg></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:700">${a.type==='above'?'Naik di atas':'Turun di bawah'} <span style="color:var(--accent);font-family:'Space Mono',monospace">$${a.price.toLocaleString()}</span></div>
        ${a.note ? `<div style="font-size:.72rem;color:var(--muted);margin-top:.15rem">${a.note}</div>` : ''}
        ${a.triggered ? '<div style="font-size:.68rem;color:var(--danger);font-weight:700;margin-top:.15rem">▲ TRIGGERED</div>' : ''}
      </div>
      <button onclick="deleteAlert(${a.id})" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--danger);border-radius:8px;padding:.4rem .7rem;font-size:.72rem;font-weight:700;cursor:pointer;flex-shrink:0">Hapus</button>
    </div>
  `).join('');
}

function checkPriceAlerts(currentPrice) {
  const alerts = getAlerts();
  let changed = false;
  alerts.forEach(a => {
    if (!a.active || a.triggered) return;
    const hit = (a.type === 'above' && currentPrice >= a.price) || (a.type === 'below' && currentPrice <= a.price);
    if (hit) {
      a.triggered = true; changed = true;
      const msg = `BTC ${a.type==='above'?'naik di atas':'turun di bawah'} $${a.price.toLocaleString()}! Harga sekarang: $${currentPrice.toLocaleString()}`;
      toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> ' + msg, 3);
      sendBrowserNotif('⚡ Price Alert BTC!', msg, 'price-alert', '/');
    }
  });
  if (changed) { saveAlerts(alerts); renderAlertsList(); }
}

// ── Reminders ──
function getReminders() {
  try { return JSON.parse(localStorage.getItem('zw_dca_reminders') || '[]'); } catch(e) { return []; }
}
function saveReminders(arr) {
  localStorage.setItem('zw_dca_reminders', JSON.stringify(arr));
  _syncUserPushData();
}

function updateReminderPreview() {
  const freq = document.getElementById('reminder-frequency')?.value;
  const dayField = document.getElementById('reminder-day-field');
  const dateField = document.getElementById('reminder-date-field');
  const specificField = document.getElementById('reminder-specific-field');
  const timeField = document.getElementById('reminder-time-field');

  if (dayField) dayField.style.display = (freq==='weekly') ? 'block' : 'none';
  if (dateField) dateField.style.display = (freq==='monthly') ? 'block' : 'none';
  if (specificField) specificField.style.display = (freq==='specific') ? 'block' : 'none';
  if (timeField) timeField.style.display = (freq==='specific') ? 'none' : 'block';

  const time = document.getElementById('reminder-time')?.value || '08:00';
  const amount = document.getElementById('reminder-amount')?.value;
  const preview = document.getElementById('reminder-preview');
  if (!preview) return;

  const freqLabel = {daily:'Setiap hari',weekly:'Setiap minggu',monthly:'Setiap bulan',specific:'Tanggal spesifik'}[freq]||freq;
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  let detail = '';

  if (freq==='weekly') {
    const dayVal = document.getElementById('reminder-day')?.value;
    detail = ` · Hari ${days[dayVal]||''}`;
  } else if (freq==='monthly') {
    const dateVal = document.getElementById('reminder-date')?.value;
    detail = ` · Tanggal ${dateVal}`;
  } else if (freq==='specific') {
    const dtVal = document.getElementById('reminder-specific-datetime')?.value;
    if (dtVal) {
      const dt = new Date(dtVal);
      detail = ` · ${dt.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} jam ${dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;
    } else {
      detail = ' · Pilih tanggal di atas';
    }
  }

  const amtTxt = amount ? ` · Rp${parseInt(amount).toLocaleString('id-ID')}` : '';
  const timeTxt = freq!=='specific' ? ` jam ${time}` : '';
  preview.style.display = 'block';
  preview.innerHTML = `<span style="font-weight:700">⏰ Pengingat:</span> ${freqLabel}${detail}${timeTxt}${amtTxt}<br><span style="font-size:.75rem;color:var(--muted)">Kamu akan diingatkan untuk melakukan DCA sesuai jadwal ini</span>`;
}

function saveReminder() {
  const freq = document.getElementById('reminder-frequency')?.value;
  const time = document.getElementById('reminder-time')?.value || '08:00';
  const amount = document.getElementById('reminder-amount')?.value;
  const day = document.getElementById('reminder-day')?.value;
  const date = document.getElementById('reminder-date')?.value;
  const specificDatetime = document.getElementById('reminder-specific-datetime')?.value;

  if (freq === 'specific' && !specificDatetime) {
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Pilih tanggal & jam dulu!', 1); return;
  }

  const reminders = getReminders();
  const r = {
    id: Date.now(), freq, time: freq==='specific' ? '' : time,
    amount: amount||'', day: day||'5', date: date||'1',
    specificDatetime: freq==='specific' ? specificDatetime : '',
    active: true
  };
  reminders.push(r);
  saveReminders(reminders);
  renderRemindersList();
  scheduleReminderNotif(r);
  // Reset form
  if (freq==='specific') document.getElementById('reminder-specific-datetime').value = '';
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Pengingat DCA disimpan!');
}

function deleteReminder(id) {
  const reminders = getReminders().filter(r=>r.id!==id);
  saveReminders(reminders);
  renderRemindersList();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> Pengingat dihapus');
}

function renderRemindersList() {
  const container = document.getElementById('reminders-list');
  if (!container) return;
  const reminders = getReminders();
  if (!reminders.length) {
    container.innerHTML = '<div class="empty"><div class="emoji"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><h3>Belum Ada Pengingat</h3><p>Set jadwal DCA kamu di atas</p></div>';
    return;
  }
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const freqLabel = {daily:'Setiap Hari',weekly:'Setiap Minggu',monthly:'Setiap Bulan',specific:'Sekali'};
  container.innerHTML = reminders.map(r => {
    let detail = '';
    let timeStr = '';
    if (r.freq==='weekly') { detail = ` · ${days[r.day]||''}`; timeStr = ` · ${r.time}`; }
    else if (r.freq==='monthly') { detail = ` · Tgl ${r.date}`; timeStr = ` · ${r.time}`; }
    else if (r.freq==='daily') { timeStr = ` · ${r.time}`; }
    else if (r.freq==='specific' && r.specificDatetime) {
      const dt = new Date(r.specificDatetime);
      detail = ` · ${dt.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})}`;
      timeStr = ` · ${dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;
    }
    const amtTxt = r.amount ? `Rp${parseInt(r.amount).toLocaleString('id-ID')}` : '';
    const isPast = r.freq==='specific' && r.specificDatetime && new Date(r.specificDatetime) < new Date();
    return `
      <div style="background:var(--surface2);border:1px solid ${isPast?'rgba(100,116,139,.2)':'rgba(0,229,255,.2)'};border-radius:12px;padding:.85rem 1rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.8rem;${isPast?'opacity:.55':''}">
        <div style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:${isPast?'rgba(16,185,129,.15)':'rgba(0,229,255,.1)'};flex-shrink:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${isPast?'#10b981':'var(--accent2)'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${isPast?'<path d=\"M22 11.08V12a10 10 0 1 1-5.93-9.14\"/><polyline points=\"22 4 12 14.01 9 11.01\"/>':'<circle cx=\"12\" cy=\"12\" r=\"10\"/><polyline points=\"12 6 12 12 16 14\"/>'}</svg></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:700">${freqLabel[r.freq]||r.freq}${detail}<span style="color:var(--accent);font-family:'Space Mono',monospace">${timeStr}</span></div>
          ${amtTxt ? `<div style="font-size:.72rem;color:var(--muted);margin-top:.15rem;display:flex;align-items:center;gap:.25rem"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent3)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> ${amtTxt}</div>` : ''}
          ${isPast ? '<div style="font-size:.68rem;color:var(--muted);margin-top:.1rem">Sudah lewat</div>' : ''}
        </div>
        <button onclick="deleteReminder(${r.id})" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--danger);border-radius:8px;padding:.4rem .7rem;font-size:.72rem;font-weight:700;cursor:pointer;flex-shrink:0">Hapus</button>
      </div>`;
  }).join('');
}

function scheduleReminderNotif(r) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const msg = `Pengingat DCA kamu! ${r.amount ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Rp'+parseInt(r.amount).toLocaleString('id-ID') : 'Lakukan DCA sekarang!'}`;
  const now = new Date();

  if (r.freq === 'specific' && r.specificDatetime) {
    const target = new Date(r.specificDatetime);
    const msUntil = target - now;
    if (msUntil > 0 && msUntil < 7*24*60*60*1000) {
      setTimeout(() => sendBrowserNotif('⏰ Waktunya DCA!', msg, 'reminder-dca', '/'), msUntil);
    }
    return;
  }

  // For recurring: schedule next 24h window
  const [h,m] = (r.time||'08:00').split(':').map(Number);
  let next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntil = next - now;
  if (msUntil < 24*60*60*1000) {
    setTimeout(() => sendBrowserNotif('⏰ Waktunya DCA!', msg, 'reminder-dca', '/'), msUntil);
  }
}

// ══════════════════════════════════════════════════════
// FCM PUSH NOTIFICATION ENGINE — z-wealth
// ══════════════════════════════════════════════════════
const ZW_FCM = (() => {
  const VAPID_KEY = 'BMlqViC-ebjJhQuTXIzM3HU2YYK1W4WOrAkuIQTcT3IJh2IAJW8QWXBCdQiE68QUPmYxFJnQMreNZnaUnpl01Dg';
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBUQINFDWLkr2M1eDnAJdXXw5RiQYvP-QA",
    authDomain: "z-wealth.firebaseapp.com",
    projectId: "z-wealth",
    storageBucket: "z-wealth.firebasestorage.app",
    messagingSenderId: "638430159788",
    appId: "1:638430159788:web:e787c228dfadf3ca995009"
  };

  let _messaging = null;
  let _fcmToken = null;
  let _initialized = false;

  async function init() {
    if (_initialized) return;
    if (typeof firebase === 'undefined') {
      console.warn('[FCM] Firebase SDK belum loaded, init ditunda');
      return; // _initialized tetap false agar bisa retry
    }
    try {
      // Cek apakah sudah ada Firebase app
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      _messaging = firebase.messaging();
      _initialized = true;

      // FIX: Single onMessage handler — foreground toast + token-refresh detection
      _messaging.onMessage(payload => {
        // Deteksi token refresh: jika token di memory != localStorage, sync ke DB
        const savedToken = localStorage.getItem('zw_fcm_token');
        if (_fcmToken && savedToken && _fcmToken !== savedToken) {
          _saveFCMTokenToDB(_fcmToken).catch(()=>{});
        }
        // Tampilkan toast saat app foreground
        const { title } = payload.notification || {};
        const toastTitle = (title || 'z-wealth').slice(0, 80) + ((title || '').length > 80 ? '…' : '');
        toast(`🔔 ${toastTitle}`, false, 5000);
      });
    } catch(e) {
      console.warn('[FCM] Init error:', e);
    }
  }

  async function getToken() {
    if (!_messaging) await init();
    if (!_messaging) return null;
    try {
      // Daftarkan SW firebase-messaging-sw.js
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
      window._swReg = swReg; // Set sebagai SW utama agar sendBrowserNotif pakai ini
      const token = await _messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
      _fcmToken = token;
      // Simpan token ke localStorage agar bisa dipakai kirim notif
      if (token) localStorage.setItem('zw_fcm_token', token);
          setTimeout(() => _saveFCMTokenToDB(token), 3000);
        
      return token;
    } catch(e) {
      console.warn('[FCM] getToken error:', e);
      return null;
    }
  }

  // Kirim notif via Vercel API (agar muncul meski app ditutup)
  async function sendPush(title, body, tag, url) {
    const token = _fcmToken || localStorage.getItem('zw_fcm_token');
    if (!token) return;
    try {
      const resp = await fetch('/api/notifications?action=notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, title, body, tag: tag || 'zwealth', url: url || '/' })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const errCode = err?.detail?.error?.details?.[0]?.errorCode || '';
        // Jika token invalid/expired, hapus dan minta token baru
        if (resp.status === 500 && (errCode === 'UNREGISTERED' || errCode === 'INVALID_ARGUMENT')) {
          console.warn('[FCM] Token invalid, clearing...');
          localStorage.removeItem('zw_fcm_token');
          _fcmToken = null;
          // Coba dapat token baru di background
          getToken().catch(() => {});
        }
      }
    } catch(e) {
      // Network error — fallback ke SW lokal
      sendSWNotif(title, body, tag);
    }
  }

  // Kirim notif via Service Worker (muncul meski app background, tapi bukan push server)
  function sendSWNotif(title, body, tag) {
    const msg = { type: 'SHOW_NOTIF', title, body, icon: '/icon-192.png', tag: tag || 'zw-' + Date.now() };
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    } else if (window._swReg?.active) {
      window._swReg.active.postMessage(msg);
    } else if (Notification.permission === 'granted') {
      // Last resort: browser Notification API
      try { new Notification(title, { body, icon: '/icon-192.png' }); } catch(e) {}
    }
  }

  return { init, getToken, sendPush, sendSWNotif };
})();

// Simpan FCM token ke Supabase DB agar server (webhook) bisa kirim push

// Sync price alerts & DCA reminders ke Supabase DB
// Dipanggil setiap kali ada perubahan alert/reminder
async function _syncUserPushData() {
  try {
    // Tunggu userCode siap (max 5 detik)
    let userCode = chatState?.myCode || localStorage.getItem('chat_code');
    if (!userCode) {
      let tries = 0;
      while (!userCode && tries < 10) {
        await new Promise(r => setTimeout(r, 500));
        userCode = chatState?.myCode || localStorage.getItem('chat_code');
        tries++;
      }
    }
    if (!userCode) { console.warn('[Sync] No userCode, skip'); return; }
    
    const alerts    = getAlerts();
    const reminders = getReminders();
    console.log('[Sync] Syncing', userCode, 'alerts:', alerts.length, 'reminders:', reminders.length);
    
    const res = await fetch('https://kpikyqafapclyirpqflp.supabase.co/rest/v1/user_push_data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_code:     userCode,
        price_alerts:  alerts,
        dca_reminders: reminders,
        active:        true,
        updated_at:    new Date().toISOString(),
      })
    });
    if (res.ok || res.status === 201) {
      console.log('[Sync] ✅ user_push_data synced for', userCode);
    } else {
      const err = await res.text();
      console.warn('[Sync] ❌ Failed:', res.status, err);
    }
  } catch(e) { console.warn('[Sync] user_push_data error:', e.message); }
}

// Simpan top bullish & bearish ke DB untuk cron job
async function _syncNewsToDb(articles) {
  try {
    if (!articles?.length) return;
    const topBullish = articles.filter(a => a.sentimen === 'POSITIF').slice(0, 3);
    const topBearish = articles.filter(a => a.sentimen === 'NEGATIF').slice(0, 3);
    const payload = {
      id: 'latest',
      bullish: topBullish.map(a => ({
        title:   a.judulID,
        summary: a.ringkasan || a.judulEN || '',
        source:  a.source || 'Crypto News'
      })),
      bearish: topBearish.map(a => ({
        title:   a.judulID,
        summary: a.ringkasan || a.judulEN || '',
        source:  a.source || 'Crypto News'
      })),
      updated_at: new Date().toISOString(),
    };
    await fetch('https://kpikyqafapclyirpqflp.supabase.co/rest/v1/news_cache', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(payload)
    });
  } catch(e) { console.warn('[News] sync to DB error:', e.message); }
}

async function _saveFCMTokenToDB(token) {
  if (!token) return;
  // Ambil user_code dari localStorage atau chatState
  const userCode = chatState?.myCode || localStorage.getItem('chat_code');
  if (!userCode) {
    console.warn('[FCM] _saveFCMTokenToDB: no user_code');
    return;
  }
  try {
    // Pakai fetch langsung ke Supabase REST API — tidak butuh chatSB
    const res = await fetch('https://kpikyqafapclyirpqflp.supabase.co/rest/v1/push_subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwaWt5cWFmYXBjbHlpcnBxZmxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0Njc3MzAsImV4cCI6MjA4NzA0MzczMH0.OcsM8BBY1AtRs-aUr1RHUG1NOnO-XwJsMMmSZkwNa7c',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_code:  userCode,
        endpoint:   'fcm:' + token.slice(-40),
        fcm_token:  token,
        p256dh:     '',
        auth:       '',
        user_agent: navigator.userAgent.slice(0, 200),
        updated_at: new Date().toISOString(),
      })
    });
    if (res.ok || res.status === 201) {
      console.log('[FCM] ✅ Token saved to DB for', userCode);
    } else {
      const err = await res.text();
      console.warn('[FCM] Token DB save failed:', res.status, err);
    }
  } catch(e) { console.warn('[FCM] Token DB save error:', e.message); }
}

// Kirim notif — strategi cerdas: FCM push jika ada token, SW lokal jika tidak
// Tidak keduanya sekaligus untuk menghindari double notif
function sendBrowserNotif(title, body, tag, url) {
  const cleanTitle = (title || '').replace(/<[^>]+>/g, '').trim() || 'z-wealth';
  const cleanBody  = (body  || '').replace(/<[^>]+>/g, '').trim();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const notifTag = tag || ('zw-' + Date.now());
  const notifOpts = {
    body: cleanBody,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: notifTag,
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: url || '/' }
  };

  const fcmToken = localStorage.getItem('zw_fcm_token');

  if (fcmToken && typeof ZW_FCM !== 'undefined') {
    // ── Punya FCM token: kirim via server push ──
    // FCM push akan trigger firebase-messaging-sw.js untuk showNotification
    // Muncul meski app ditutup. TIDAK pakai SW lokal agar tidak double.
    ZW_FCM.sendPush(cleanTitle, cleanBody, notifTag, url).catch(() => {
      // FCM gagal → fallback ke SW lokal
      _showLocalNotif(cleanTitle, notifOpts);
    });
  } else {
    // ── Tidak ada FCM token: pakai SW lokal ──
    // Hanya muncul saat app terbuka atau di background (bukan closed)
    _showLocalNotif(cleanTitle, notifOpts);
  }
}

// Helper: tampilkan notif via SW lokal (serviceWorker.ready)
function _showLocalNotif(title, opts) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      window._swReg = reg;
      return reg.showNotification(title, opts);
    }).catch(() => {
      try { new Notification(title, { body: opts.body, icon: '/icon-192.png', tag: opts.tag }); } catch(e) {}
    });
  } else {
    try { new Notification(title, { body: opts.body, icon: '/icon-192.png', tag: opts.tag }); } catch(e) {}
  }
}

function checkNotifPermission() {
  const card = document.getElementById('notif-perm-card');
  if (!card) return;
  if ('Notification' in window && Notification.permission !== 'granted') {
    card.style.display = 'block';
  } else {
    card.style.display = 'none';
  }
  if (typeof updateAcctNotifUI === 'function') updateAcctNotifUI();
}

function updateAcctNotifUI() {
  const icon = document.getElementById('acct-notif-icon');
  const label = document.getElementById('acct-notif-label');
  const sub = document.getElementById('acct-notif-sub');
  const btn = document.getElementById('acct-notif-btn');
  if (!label || !btn) return;
  const perm = ('Notification' in window) ? Notification.permission : 'not-supported';
  const hasFCM = !!localStorage.getItem('zw_fcm_token');

  if (perm === 'granted' && hasFCM) {
    if (icon) {
      icon.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    }
    label.style.color = '#10b981';
    label.textContent = 'Push Notifikasi Aktif';
    if (sub) sub.textContent = 'Notif muncul meski app ditutup';
    btn.textContent = 'Nonaktifkan';
    btn.style.cssText = 'flex-shrink:0;padding:.4rem .85rem;border-radius:8px;border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.1);color:#10b981;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s';
  } else if (perm === 'granted') {
    if (icon) {
      icon.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);display:flex;align-items:center;justify-content:center;flex-shrink:0';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
    }
    label.style.color = '#f59e0b';
    label.textContent = 'Notifikasi Aktif (terbatas)';
    if (sub) sub.textContent = 'Tap Upgrade Push untuk notif saat app tutup';
    btn.textContent = 'Upgrade Push';
    btn.style.cssText = 'flex-shrink:0;padding:.4rem .85rem;border-radius:8px;border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.1);color:#f59e0b;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s';
  } else if (perm === 'denied') {
    if (icon) {
      icon.style.cssText = 'width:32px;height:32px;border-radius:50%;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0';
    }
    label.style.color = '#ef4444';
    label.textContent = 'Notifikasi Diblokir';
    if (sub) sub.textContent = 'Buka pengaturan browser, izinkan notif';
    btn.textContent = 'Panduan';
    btn.style.cssText = 'flex-shrink:0;padding:.4rem .85rem;border-radius:8px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#ef4444;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s';
  } else {
    label.style.color = '#ef4444';
    label.textContent = 'Notifikasi Nonaktif';
    if (sub) sub.textContent = 'Tap untuk aktifkan push notif';
    btn.textContent = 'Aktifkan';
    btn.style.cssText = 'flex-shrink:0;padding:.4rem .85rem;border-radius:8px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#ef4444;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s';
  }
}

async function acctToggleNotif() {
  const perm = ('Notification' in window) ? Notification.permission : 'not-supported';
  if (perm === 'denied') {
    toast('Notif diblokir. Buka Pengaturan browser > Site Settings > Notifications > Allow', 4);
    return;
  }
  if (perm === 'granted' && localStorage.getItem('zw_fcm_token')) {
    // Sudah aktif → nonaktifkan
    localStorage.removeItem('zw_fcm_token');
    toast('🔕 Push notification dinonaktifkan');
    updateAcctNotifUI();
    return;
  }
  if (perm === 'granted' && !localStorage.getItem('zw_fcm_token')) {
    // Permission ada tapi belum ada token → langsung getToken tanpa minta permission lagi
    toast('⏳ Mendaftarkan push notification...');
    try {
      await ZW_FCM.init();
      const token = await ZW_FCM.getToken();
      if (token) {
        _saveFCMTokenToDB(token); // Simpan ke DB — chatSB sudah siap saat user klik
        toast('✅ Push notification aktif! Notif muncul meski app ditutup.');
        ZW_FCM.sendSWNotif('✅ z-wealth', 'Push notification berhasil diaktifkan!');
      } else {
        toast('⚠️ Gagal dapat token. Coba lagi atau restart browser.');
      }
    } catch(e) {
      toast('⚠️ Error: ' + e.message);
    }
    updateAcctNotifUI();
    return;
  }
  // perm === 'default' → minta izin dulu
  await requestNotifPermission();
  updateAcctNotifUI();
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    toast('Browser tidak mendukung notifikasi');
    return 'not-supported';
  }
  if (Notification.permission === 'denied') {
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Notifikasi sudah diblokir di browser', 2);
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    const card = document.getElementById('notif-perm-card');
    if (card) card.style.display = 'none';
    // Pastikan FCM token sudah ada — user mungkin sudah grant tapi belum punya token
    const existingToken = localStorage.getItem('zw_fcm_token');
    if (!existingToken) {
      toast('⏳ Mendaftarkan push notification...');
      try {
        await ZW_FCM.init();
        const token = await ZW_FCM.getToken();
        if (token) {
          _saveFCMTokenToDB(token); // Simpan ke DB
          toast('✅ Push notification aktif!');
        } else {
          toast('✅ Notifikasi aktif (mode terbatas)');
        }
      } catch(e) {
        toast('✅ Notifikasi sudah aktif!');
      }
    } else {
      toast('✅ Notifikasi sudah aktif!');
    }
    return 'granted';
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    const card = document.getElementById('notif-perm-card');
    if (card) card.style.display = 'none';
    // Daftarkan FCM token agar bisa dapat push meski app ditutup
    toast('⏳ Mendaftarkan push notification...');
    try {
      const token = await ZW_FCM.getToken();
      if (token) {
        _saveFCMTokenToDB(token); // Simpan ke DB — chatSB sudah siap saat ini
        toast('✅ Push notification aktif! Kamu akan dapat notif meski app ditutup.');
        ZW_FCM.sendSWNotif('✅ z-wealth Siap!', 'Push notification aktif. Harga alert, chat, dan berita akan masuk ke HP kamu.');
      } else {
        toast('✅ Notifikasi diaktifkan (mode terbatas - buka app)');
        ZW_FCM.sendSWNotif('✅ Notifikasi Aktif!', 'Kamu akan mendapat alert saat app terbuka.');
      }
    } catch(e) {
      toast('✅ Notifikasi diaktifkan!');
    }
  } else {
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Notifikasi tidak diizinkan', 2);
  }
  return perm;
}

function showComingSoon(name) {
  const overlay = document.getElementById('coming-soon-overlay');
  const nameEl = document.getElementById('coming-soon-name');
  if(nameEl) nameEl.textContent = name;
  if(overlay) { overlay.style.display = 'flex'; }
}
function hideComingSoon() {
  const overlay = document.getElementById('coming-soon-overlay');
  if(overlay) overlay.style.display = 'none';
}

// ── Fitur Lainnya inline expand ──
function toggleFiturMore() {
  const overlay = document.getElementById('fitur-modal-overlay');
  if (!overlay) return;
  if (overlay.classList.contains('open')) {
    closeFiturModal();
  } else {
    overlay.style.display = 'flex';
    // Force reflow then add open class for animation
    overlay.offsetHeight;
    overlay.classList.add('open');
    overlay.classList.remove('closing');
    document.body.style.overflow = 'hidden';
  }
}
function closeFiturModal(e) {
  if (e && e.target !== document.getElementById('fitur-modal-overlay')) return;
  const overlay = document.getElementById('fitur-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('closing');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.classList.remove('closing');
  }, 280);
}
function closeFiturPopup() {
  closeFiturModal();
}
function toggleFiturPopup(e) { toggleFiturMore(); }
function updateFabVisibility(pageId) { closeFiturModal(); }


// ══════════════════════════════════════════════════════════
//  AI SIGNAL FUTURES — Teknikal + Sentimen + Berita + Entry Tracking
// ══════════════════════════════════════════════════════════

let _sigPair = 'BTCUSDT';
let _sigTf   = '1h';
let _sigCandles = [];
let _sigCurrentSignal = null;
let _sigActiveTimer   = null;
let _sigActiveTrades  = {};
let _sigCurrentLeverage = 1; // default 1x (spot)
let _sigHistory = (() => { try { return JSON.parse(localStorage.getItem('sig_history') || '[]'); } catch(e) { return []; } })();

function selectLeverage(el) {
  document.querySelectorAll('.lev-btn').forEach(b => {
    b.style.background = 'rgba(255,255,255,.04)';
    b.style.borderColor = 'rgba(255,255,255,.08)';
    b.style.color = '#64748b';
  });
  el.style.background = 'rgba(245,158,11,.12)';
  el.style.borderColor = 'rgba(245,158,11,.35)';
  el.style.color = '#f59e0b';
  _sigCurrentLeverage = parseInt(el.dataset.lev) || 1;
  // Warning untuk leverage tinggi
  const warn = document.getElementById('lev-warning');
  if (warn) warn.style.display = _sigCurrentLeverage >= 20 ? 'block' : 'none';
  // Update label tombol entry
  const eb = document.getElementById('sig-entry-btn');
  if (eb && _sigCurrentSignal && _sigCurrentSignal.direction !== 'WAIT') {
    const dir = _sigCurrentSignal.direction;
    eb.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Entry ${dir} ${_sigCurrentLeverage > 1 ? _sigCurrentLeverage+'x' : ''} — ${_sigPair}`;
  }
}

function selectSigPair(el) {
  if (el.dataset.pair === 'XAUUSD') {
    // Show coming soon toast - don't activate
    toast('<span style="font-size:.9rem">⏳</span> <b>XAU/USD</b> — Segera Hadir! Fitur ini sedang dalam pengembangan.', 3500);
    return;
  }
  document.querySelectorAll('.sig-pair-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _sigPair = el.dataset.pair;
  document.getElementById('sig-display-pair').textContent = el.textContent;
}
function selectSigTf(el) {
  document.querySelectorAll('.sig-tf-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _sigTf = el.dataset.tf;
  const TF_LABEL = {'1m':'1M','5m':'5M','15m':'15M','1h':'1H','4h':'4H','1d':'1D'};
  document.getElementById('sig-display-tf').textContent = TF_LABEL[_sigTf] || _sigTf.toUpperCase();
}

// ── INDIKATOR KALKULASI ──
// ══════════════════════════════════════════════════════════
// TECHNICAL INDICATORS — Proper implementations
// ══════════════════════════════════════════════════════════

function calcSMA(data, period) {
  if (!data || data.length < period) return null;
  return data.slice(-period).reduce((a,b)=>a+b,0) / period;
}

// Standard EMA (incremental — O(n), tidak recalculate dari awal)
function calcEMA(data, period) {
  if (!data || data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
  return ema;
}

// Menghasilkan ARRAY EMA (dibutuhkan MACD yang benar)
function calcEMAArray(data, period) {
  if (!data || data.length < period) return [];
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let ema = data.slice(0, period).reduce((a,b)=>a+b,0) / period;
  result[period - 1] = ema;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// MACD yang benar — incremental EMA, tidak O(n²)
function calcMACD(closes) {
  if (!closes || closes.length < 35) return null;
  const ema12Arr = calcEMAArray(closes, 12);
  const ema26Arr = calcEMAArray(closes, 26);
  // Buat MACD line (mulai dari index 25, saat ema26 mulai ada nilai)
  const macdLine = [];
  for (let i = 25; i < closes.length; i++) {
    if (ema12Arr[i] !== null && ema26Arr[i] !== null) {
      macdLine.push(ema12Arr[i] - ema26Arr[i]);
    }
  }
  if (macdLine.length < 9) return null;
  // Signal line = EMA9 dari MACD line (incremental)
  const k = 2 / (9 + 1);
  let sig = macdLine.slice(0, 9).reduce((a,b)=>a+b,0) / 9;
  for (let i = 9; i < macdLine.length; i++) sig = macdLine[i] * k + sig * (1 - k);
  const last = macdLine[macdLine.length - 1];
  const hist = last - sig;
  // Deteksi crossover pada 2 bar terakhir
  const prevMacd = macdLine[macdLine.length - 2] || last;
  const crossBull = prevMacd < 0 && last > 0;
  const crossBear = prevMacd > 0 && last < 0;
  return { macd: last, signal: sig, hist, crossBull, crossBear };
}

// RSI BENAR — Wilder's Smoothed Moving Average (SMMA/RMA)
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period * 2 + 1) return null;
  // Fase 1: hitung simple average gain/loss untuk seed
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss += Math.abs(d);
  }
  avgGain /= period;
  avgLoss /= period;
  // Fase 2: Wilder Smoothing (SMMA) — ini yang bikin RSI akurat
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? Math.abs(d) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Stochastic BENAR — %K dan %D (signal line), plus deteksi crossover
function calcStochastic(candles, kPeriod = 14, dPeriod = 3) {
  if (!candles || candles.length < kPeriod + dPeriod) return null;
  // Hitung %K untuk setiap bar (butuh dPeriod bar terakhir untuk %D)
  const kValues = [];
  for (let i = candles.length - dPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...slice.map(c => c.h));
    const lo = Math.min(...slice.map(c => c.l));
    const cl = candles[i].c;
    kValues.push(hi === lo ? 50 : ((cl - lo) / (hi - lo)) * 100);
  }
  const kCurrent = kValues[kValues.length - 1];
  const kPrev    = kValues[kValues.length - 2];
  // %D = SMA3 dari %K
  const dCurrent = kValues.slice(-dPeriod).reduce((a,b)=>a+b,0) / dPeriod;
  const dPrev    = kValues.slice(-dPeriod - 1, -1).reduce((a,b)=>a+b,0) / dPeriod;
  // Crossover %K vs %D (signal paling kuat)
  const bullCross = kPrev < dPrev && kCurrent > dCurrent;
  const bearCross = kPrev > dPrev && kCurrent < dCurrent;
  return { k: kCurrent, d: dCurrent, bullCross, bearCross };
}

// Bollinger Bands — sama, sudah benar, tambah %B dan squeeze detail
function calcBB(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return null;
  const s   = closes.slice(-period);
  const sma = s.reduce((a,b)=>a+b,0) / period;
  const std = Math.sqrt(s.reduce((a,b)=>a+Math.pow(b-sma,2),0) / period);
  const upper = sma + mult * std;
  const lower = sma - mult * std;
  const bw   = std > 0 ? (upper - lower) / sma * 100 : 0;
  const pctB = std > 0 ? (closes[closes.length-1] - lower) / (upper - lower) : 0.5;
  return { upper, lower, mid: sma, std, bw, pctB };
}

// ATR BENAR — Wilder's Smoothed ATR (bukan simple average)
function calcATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  // Seed: simple average TR pertama
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
  }
  atr /= period;
  // Wilder Smoothing
  for (let i = period + 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c)
    );
    atr = (atr * (period - 1) + tr) / period;
  }
  return atr;
}

// ADX BENAR — Wilder's Smoothed DM dan TR (standar Wilder 1978)
function calcADX(candles, period = 14) {
  if (!candles || candles.length < period * 2 + 1) return null;
  const trs = [], pDMs = [], mDMs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i-1];
    const up   = c.h - p.h;
    const down = p.l - c.l;
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
    pDMs.push(up > down && up > 0 ? up   : 0);
    mDMs.push(down > up && down > 0 ? down : 0);
  }
  // Wilder seed (sum periode pertama)
  let smTR  = trs.slice(0, period).reduce((a,b)=>a+b,0);
  let smPDM = pDMs.slice(0, period).reduce((a,b)=>a+b,0);
  let smMDM = mDMs.slice(0, period).reduce((a,b)=>a+b,0);
  const dxArr = [];
  // DI pertama
  let diP = smTR > 0 ? (smPDM / smTR) * 100 : 0;
  let diM = smTR > 0 ? (smMDM / smTR) * 100 : 0;
  if (diP + diM > 0) dxArr.push(Math.abs(diP - diM) / (diP + diM) * 100);
  // Wilder smoothing dari periode+1 seterusnya
  for (let i = period; i < trs.length; i++) {
    smTR  = smTR  - smTR/period  + trs[i];
    smPDM = smPDM - smPDM/period + pDMs[i];
    smMDM = smMDM - smMDM/period + mDMs[i];
    diP = smTR > 0 ? (smPDM / smTR) * 100 : 0;
    diM = smTR > 0 ? (smMDM / smTR) * 100 : 0;
    if (diP + diM > 0) dxArr.push(Math.abs(diP - diM) / (diP + diM) * 100);
  }
  if (dxArr.length < period) return { adx: 0, diP, diM };
  // ADX = Wilder SMMA dari DX
  let adx = dxArr.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < dxArr.length; i++) adx = (adx * (period-1) + dxArr[i]) / period;
  return { adx, diP, diM };
}

// Fibonacci — benar dengan konteks tren (apakah retracement dari up atau downtrend)
function calcFib(candles) {
  if (!candles || candles.length < 2) return null;
  const lo  = Math.min(...candles.map(c => c.l));
  const hi  = Math.max(...candles.map(c => c.h));
  const d   = hi - lo;
  const cl  = candles[candles.length - 1].c;
  // Tentukan swing: apakah high lebih baru dari low (upswing) atau sebaliknya
  let hiIdx = 0, loIdx = 0;
  candles.forEach((c,i) => { if(c.h >= hi) hiIdx=i; if(c.l <= lo) loIdx=i; });
  const isUpswing = loIdx < hiIdx; // low muncul lebih dulu = uptrend lalu retracement
  return {
    hi, lo, d, isUpswing,
    r236: hi - d * 0.236,
    r382: hi - d * 0.382,
    r50:  hi - d * 0.5,
    r618: hi - d * 0.618,
    r786: hi - d * 0.786,
    ext127: hi + d * 0.272, // extension TP
    ext161: hi + d * 0.618,
    cl
  };
}

// Ichimoku — tetap sama tapi tambah TK cross & chikou
function calcIchimoku(candles) {
  if (!candles || candles.length < 52) return null;
  const last9  = candles.slice(-9);
  const last26 = candles.slice(-26);
  const last52 = candles.slice(-52);
  const tenkan = (Math.max(...last9.map(c=>c.h))  + Math.min(...last9.map(c=>c.l)))  / 2;
  const kijun  = (Math.max(...last26.map(c=>c.h)) + Math.min(...last26.map(c=>c.l))) / 2;
  const sA     = (tenkan + kijun) / 2;
  const sB     = (Math.max(...last52.map(c=>c.h)) + Math.min(...last52.map(c=>c.l))) / 2;
  const cl     = candles[candles.length - 1].c;
  // TK Cross — sinyal entry Ichimoku paling valid
  const prevTenkan = candles.length >= 10
    ? (Math.max(...candles.slice(-10,-1).map(c=>c.h)) + Math.min(...candles.slice(-10,-1).map(c=>c.l))) / 2
    : tenkan;
  const prevKijun = candles.length >= 27
    ? (Math.max(...candles.slice(-27,-1).map(c=>c.h)) + Math.min(...candles.slice(-27,-1).map(c=>c.l))) / 2
    : kijun;
  const tkBullCross = prevTenkan < prevKijun && tenkan > kijun;
  const tkBearCross = prevTenkan > prevKijun && tenkan < kijun;
  // Chikou span: harga kini vs harga 26 bar lalu
  const price26ago = candles.length >= 26 ? candles[candles.length - 26].c : null;
  const chikouBull = price26ago !== null && cl > price26ago;
  return {
    tenkan, kijun, senkouA: sA, senkouB: sB, close: cl,
    aboveCloud: cl > Math.max(sA, sB),
    belowCloud: cl < Math.min(sA, sB),
    tkBullCross, tkBearCross, chikouBull,
    tkBull: tenkan > kijun,
  };
}

// Volume — tetap sama (sudah benar)
function calcVolume(candles) {
  const vols  = candles.map(c => c.v);
  const avg20 = calcSMA(vols, 20) || 1;
  const avg5  = calcSMA(vols.slice(-5), 5) || 1;
  // Volume trend: apakah volume meningkat atau menurun
  const avg3  = calcSMA(vols.slice(-3), 3) || 1;
  return { avg20, avg5, avg3, ratio: avg5 / avg20, recentRatio: avg3 / avg20 };
}

// ══════════════════════════════════════════════════════════
// CANDLESTICK PATTERN DETECTION
// ══════════════════════════════════════════════════════════

function detectCandlePatterns(candles) {
  if (!candles || candles.length < 3) return { patterns: [], score: 0 };

  const patterns = [];
  let score = 0;

  // Helper functions
  const body    = c => Math.abs(c.c - c.o);
  const range   = c => c.h - c.l;
  const isBull  = c => c.c > c.o;
  const isBear  = c => c.c < c.o;
  const upShadow  = c => c.h - Math.max(c.c, c.o);
  const downShadow = c => Math.min(c.c, c.o) - c.l;
  const bodyPct   = c => range(c) > 0 ? body(c) / range(c) : 0;
  const midPoint  = c => (c.h + c.l) / 2;

  const c0 = candles[candles.length - 1]; // candle terbaru
  const c1 = candles[candles.length - 2]; // 1 candle sebelumnya
  const c2 = candles[candles.length - 3]; // 2 candle sebelumnya
  const c3 = candles.length >= 4 ? candles[candles.length - 4] : c2;
  const atr = calcATR(candles) || (c0.h - c0.l);

  // ── SINGLE CANDLE PATTERNS ──

  // Doji: body sangat kecil vs range (<10%)
  if (bodyPct(c0) < 0.1 && range(c0) > 0) {
    const upSh = upShadow(c0), downSh = downShadow(c0);
    if (downSh > upSh * 3 && downSh > body(c0) * 2) {
      // Dragonfly Doji: ekor bawah panjang = bullish reversal
      patterns.push({ name: 'Dragonfly Doji', type: 'bull', strength: 2, desc: 'Ekor bawah panjang, potensi reversal naik' });
      score += 2;
    } else if (upSh > downSh * 3 && upSh > body(c0) * 2) {
      // Gravestone Doji: ekor atas panjang = bearish reversal
      patterns.push({ name: 'Gravestone Doji', type: 'bear', strength: 2, desc: 'Ekor atas panjang, potensi reversal turun' });
      score -= 2;
    } else {
      patterns.push({ name: 'Doji', type: 'neut', strength: 1, desc: 'Pasar ragu-ragu, tunggu konfirmasi' });
    }
  }

  // Marubozu Bullish: body penuh, hampir tidak ada shadow
  if (isBull(c0) && bodyPct(c0) > 0.92 && body(c0) > atr * 0.8) {
    patterns.push({ name: 'Marubozu Bullish', type: 'bull', strength: 3, desc: 'Candle bullish kuat tanpa shadow, buyer dominan' });
    score += 3;
  }

  // Marubozu Bearish
  if (isBear(c0) && bodyPct(c0) > 0.92 && body(c0) > atr * 0.8) {
    patterns.push({ name: 'Marubozu Bearish', type: 'bear', strength: 3, desc: 'Candle bearish kuat tanpa shadow, seller dominan' });
    score -= 3;
  }

  // Hammer: ekor bawah panjang, body kecil di atas (after downtrend = bullish)
  const isHammer = downShadow(c0) > body(c0) * 2 && upShadow(c0) < body(c0) * 0.5 && body(c0) > 0;
  if (isHammer) {
    const downTrend = c1.c < c2.c && c2.c < c3.c;
    if (downTrend) {
      patterns.push({ name: 'Hammer', type: 'bull', strength: 3, desc: 'Ekor bawah panjang setelah downtrend — reversal bullish' });
      score += 3;
    } else {
      patterns.push({ name: 'Hanging Man', type: 'bear', strength: 2, desc: 'Hammer setelah uptrend — reversal bearish' });
      score -= 2;
    }
  }

  // Inverted Hammer / Shooting Star
  const isInvHammer = upShadow(c0) > body(c0) * 2 && downShadow(c0) < body(c0) * 0.5 && body(c0) > 0;
  if (isInvHammer) {
    const downTrend = c1.c < c2.c;
    if (downTrend) {
      patterns.push({ name: 'Inverted Hammer', type: 'bull', strength: 2, desc: 'Ekor atas panjang setelah downtrend — potensi reversal' });
      score += 2;
    } else {
      patterns.push({ name: 'Shooting Star', type: 'bear', strength: 3, desc: 'Ekor atas panjang setelah uptrend — reversal bearish kuat' });
      score -= 3;
    }
  }

  // Spinning Top: body kecil, shadow kedua arah seimbang
  if (bodyPct(c0) > 0.1 && bodyPct(c0) < 0.35 &&
      upShadow(c0) > body(c0) * 0.8 && downShadow(c0) > body(c0) * 0.8) {
    patterns.push({ name: 'Spinning Top', type: 'neut', strength: 1, desc: 'Ketidakpastian pasar, perlu konfirmasi arah' });
  }

  // ── TWO CANDLE PATTERNS ──

  // Bullish Engulfing: candle bull besar menelan candle bear sebelumnya
  if (isBull(c0) && isBear(c1) &&
      c0.o < c1.c && c0.c > c1.o &&         // body c0 menelan body c1
      body(c0) > body(c1) * 1.0) {            // body c0 lebih besar
    const str = body(c0) > body(c1) * 1.5 ? 4 : 3;
    patterns.push({ name: 'Bullish Engulfing', type: 'bull', strength: str, desc: 'Candle bull menelan candle bear — reversal kuat' });
    score += str;
  }

  // Bearish Engulfing
  if (isBear(c0) && isBull(c1) &&
      c0.o > c1.c && c0.c < c1.o &&
      body(c0) > body(c1) * 1.0) {
    const str = body(c0) > body(c1) * 1.5 ? 4 : 3;
    patterns.push({ name: 'Bearish Engulfing', type: 'bear', strength: str, desc: 'Candle bear menelan candle bull — reversal kuat' });
    score -= str;
  }

  // Bullish Harami: candle bull kecil di dalam body candle bear besar
  if (isBull(c0) && isBear(c1) &&
      c0.o > c1.c && c0.c < c1.o &&
      body(c0) < body(c1) * 0.5) {
    patterns.push({ name: 'Bullish Harami', type: 'bull', strength: 2, desc: 'Candle bull kecil dalam candle bear — potensi reversal' });
    score += 2;
  }

  // Bearish Harami
  if (isBear(c0) && isBull(c1) &&
      c0.o < c1.c && c0.c > c1.o &&
      body(c0) < body(c1) * 0.5) {
    patterns.push({ name: 'Bearish Harami', type: 'bear', strength: 2, desc: 'Candle bear kecil dalam candle bull — potensi reversal' });
    score -= 2;
  }

  // Piercing Line: candle bull menutup di atas 50% body candle bear sebelumnya
  if (isBull(c0) && isBear(c1) &&
      c0.o < c1.l &&                            // open di bawah low c1
      c0.c > (c1.o + c1.c) / 2 &&              // close di atas midpoint c1
      c0.c < c1.o) {                            // tapi belum menutup penuh (bukan engulfing)
    patterns.push({ name: 'Piercing Line', type: 'bull', strength: 3, desc: 'Tembus 50% candle bear — reversal bullish signifikan' });
    score += 3;
  }

  // Dark Cloud Cover: kebalikan piercing line
  if (isBear(c0) && isBull(c1) &&
      c0.o > c1.h &&
      c0.c < (c1.o + c1.c) / 2 &&
      c0.c > c1.o) {
    patterns.push({ name: 'Dark Cloud Cover', type: 'bear', strength: 3, desc: 'Tembus 50% candle bull — reversal bearish signifikan' });
    score -= 3;
  }

  // Tweezer Bottom: dua low hampir sama = support kuat
  if (Math.abs(c0.l - c1.l) < atr * 0.05 && isBull(c0) && isBear(c1)) {
    patterns.push({ name: 'Tweezer Bottom', type: 'bull', strength: 2, desc: 'Dua low identik — support kuat, potensi reversal' });
    score += 2;
  }

  // Tweezer Top: dua high hampir sama = resistance kuat
  if (Math.abs(c0.h - c1.h) < atr * 0.05 && isBear(c0) && isBull(c1)) {
    patterns.push({ name: 'Tweezer Top', type: 'bear', strength: 2, desc: 'Dua high identik — resistance kuat, potensi reversal' });
    score -= 2;
  }

  // ── THREE CANDLE PATTERNS ──

  // Morning Star: bear besar → doji/kecil → bull besar (classic reversal)
  if (isBear(c2) && body(c2) > atr * 0.6 &&   // candle bear besar
      body(c1) < body(c2) * 0.35 &&            // candle kecil/doji di tengah
      isBull(c0) && body(c0) > atr * 0.5 &&    // candle bull besar
      c0.c > (c2.o + c2.c) / 2) {              // close di atas midpoint c2
    patterns.push({ name: 'Morning Star', type: 'bull', strength: 5, desc: 'Pola reversal 3 candle paling kuat — strong buy signal' });
    score += 5;
  }

  // Evening Star: kebalikan morning star
  if (isBull(c2) && body(c2) > atr * 0.6 &&
      body(c1) < body(c2) * 0.35 &&
      isBear(c0) && body(c0) > atr * 0.5 &&
      c0.c < (c2.o + c2.c) / 2) {
    patterns.push({ name: 'Evening Star', type: 'bear', strength: 5, desc: 'Pola reversal 3 candle paling kuat — strong sell signal' });
    score -= 5;
  }

  // Three White Soldiers: 3 candle bull berturut, makin tinggi
  if (isBull(c0) && isBull(c1) && isBull(c2) &&
      c0.c > c1.c && c1.c > c2.c &&            // makin tinggi
      c0.o > c2.o &&                            // open makin tinggi
      body(c0) > atr * 0.4 && body(c1) > atr * 0.4 && body(c2) > atr * 0.4 &&  // body tidak kecil
      upShadow(c0) < body(c0) * 0.3) {          // shadow atas kecil
    patterns.push({ name: 'Three White Soldiers', type: 'bull', strength: 4, desc: '3 candle bull kuat berturut — momentum bullish sangat kuat' });
    score += 4;
  }

  // Three Black Crows: kebalikan
  if (isBear(c0) && isBear(c1) && isBear(c2) &&
      c0.c < c1.c && c1.c < c2.c &&
      c0.o < c2.o &&
      body(c0) > atr * 0.4 && body(c1) > atr * 0.4 && body(c2) > atr * 0.4 &&
      downShadow(c0) < body(c0) * 0.3) {
    patterns.push({ name: 'Three Black Crows', type: 'bear', strength: 4, desc: '3 candle bear kuat berturut — momentum bearish sangat kuat' });
    score -= 4;
  }

  // Three Inside Up: Bullish Harami + konfirmasi candle bull
  if (isBear(c2) && isBull(c1) &&
      c1.o > c2.c && c1.c < c2.o &&    // harami di c2/c1
      body(c1) < body(c2) * 0.5 &&
      isBull(c0) && c0.c > c1.c) {     // konfirmasi
    patterns.push({ name: 'Three Inside Up', type: 'bull', strength: 3, desc: 'Harami bullish + konfirmasi — reversal tervalidasi' });
    score += 3;
  }

  // Three Inside Down
  if (isBull(c2) && isBear(c1) &&
      c1.o < c2.c && c1.c > c2.o &&
      body(c1) < body(c2) * 0.5 &&
      isBear(c0) && c0.c < c1.c) {
    patterns.push({ name: 'Three Inside Down', type: 'bear', strength: 3, desc: 'Harami bearish + konfirmasi — reversal tervalidasi' });
    score -= 3;
  }

  return { patterns, score };
}

// ══════════════════════════════════════════════════════════
// CHART PATTERN DETECTION (berbasis swing high/low)
// ══════════════════════════════════════════════════════════

function detectChartPatterns(candles) {
  if (!candles || candles.length < 30) return { patterns: [], score: 0 };

  const patterns = [];
  let score = 0;
  const atr = calcATR(candles) || 1;
  const cl = candles[candles.length - 1];

  // Helper: cari swing high/low lokal
  function findSwings(arr, lookback = 5) {
    const highs = [], lows = [];
    for (let i = lookback; i < arr.length - lookback; i++) {
      const window = arr.slice(i - lookback, i + lookback + 1);
      if (arr[i].h === Math.max(...window.map(c => c.h))) highs.push({ idx: i, val: arr[i].h, candle: arr[i] });
      if (arr[i].l === Math.min(...window.map(c => c.l))) lows.push({ idx: i, val: arr[i].l, candle: arr[i] });
    }
    return { highs, lows };
  }

  const recent = candles.slice(-60);
  const { highs, lows } = findSwings(recent, 4);
  const tolerance = atr * 0.6; // toleransi untuk "hampir sama"

  // ── DOUBLE TOP ──
  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    if (Math.abs(h1.val - h2.val) < tolerance &&   // dua high hampir sama
        h2.idx > h1.idx + 5 &&                     // jarak minimal 5 candle
        cl.c < h2.val - atr * 0.5) {               // harga sudah mulai turun dari high
      const neckline = Math.min(...recent.slice(h1.idx, h2.idx).map(c => c.l));
      const target = h2.val - (h2.val - neckline) * 1.0; // target = neckline - tinggi pola
      patterns.push({
        name: 'Double Top', type: 'bear', strength: 4,
        desc: `Dua high identik di ~$${Math.round(h2.val).toLocaleString()} — target $${Math.round(target).toLocaleString()}`
      });
      score -= 4;
    }
  }

  // ── DOUBLE BOTTOM ──
  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    if (Math.abs(l1.val - l2.val) < tolerance &&
        l2.idx > l1.idx + 5 &&
        cl.c > l2.val + atr * 0.5) {
      const neckline = Math.max(...recent.slice(l1.idx, l2.idx).map(c => c.h));
      const target = neckline + (neckline - l2.val);
      patterns.push({
        name: 'Double Bottom', type: 'bull', strength: 4,
        desc: `Dua low identik di ~$${Math.round(l2.val).toLocaleString()} — target $${Math.round(target).toLocaleString()}`
      });
      score += 4;
    }
  }

  // ── HEAD AND SHOULDERS ──
  if (highs.length >= 3) {
    const h1 = highs[highs.length - 3];
    const h2 = highs[highs.length - 2]; // kepala = highest
    const h3 = highs[highs.length - 1];
    if (h2.val > h1.val && h2.val > h3.val &&           // kepala lebih tinggi
        Math.abs(h1.val - h3.val) < tolerance * 1.5 &&  // dua bahu hampir sama
        h2.idx > h1.idx + 3 && h3.idx > h2.idx + 3 &&
        cl.c < h3.val - atr * 0.3) {
      patterns.push({
        name: 'Head & Shoulders', type: 'bear', strength: 5,
        desc: `Pola H&S terbentuk — sinyal reversal bearish paling kuat`
      });
      score -= 5;
    }
  }

  // ── INVERSE HEAD AND SHOULDERS ──
  if (lows.length >= 3) {
    const l1 = lows[lows.length - 3];
    const l2 = lows[lows.length - 2]; // kepala = lowest
    const l3 = lows[lows.length - 1];
    if (l2.val < l1.val && l2.val < l3.val &&
        Math.abs(l1.val - l3.val) < tolerance * 1.5 &&
        l2.idx > l1.idx + 3 && l3.idx > l2.idx + 3 &&
        cl.c > l3.val + atr * 0.3) {
      patterns.push({
        name: 'Inv. Head & Shoulders', type: 'bull', strength: 5,
        desc: `Pola Inv. H&S — sinyal reversal bullish paling kuat`
      });
      score += 5;
    }
  }

  // ── ASCENDING TRIANGLE (Bullish) ──
  // Highs flat, lows makin tinggi
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows  = lows.slice(-3);
    const highFlat    = recentHighs.every(h => Math.abs(h.val - recentHighs[0].val) < tolerance);
    const lowsRising  = recentLows.length >= 2 && recentLows[recentLows.length-1].val > recentLows[0].val + atr * 0.3;
    if (highFlat && lowsRising && cl.c > recentHighs[0].val - tolerance) {
      patterns.push({
        name: 'Ascending Triangle', type: 'bull', strength: 3,
        desc: `Resistance flat, support naik — breakout bullish kemungkinan besar`
      });
      score += 3;
    }
  }

  // ── DESCENDING TRIANGLE (Bearish) ──
  if (highs.length >= 2 && lows.length >= 2) {
    const recentHighs = highs.slice(-3);
    const recentLows  = lows.slice(-3);
    const lowFlat     = recentLows.every(l => Math.abs(l.val - recentLows[0].val) < tolerance);
    const highsFalling = recentHighs.length >= 2 && recentHighs[recentHighs.length-1].val < recentHighs[0].val - atr * 0.3;
    if (lowFlat && highsFalling && cl.c < recentLows[0].val + tolerance) {
      patterns.push({
        name: 'Descending Triangle', type: 'bear', strength: 3,
        desc: `Support flat, resistance turun — breakout bearish kemungkinan besar`
      });
      score -= 3;
    }
  }

  // ── RISING WEDGE (Bearish) ──
  // Highs dan lows keduanya naik tapi slope high < slope low (menyempit ke atas)
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2],   l2 = lows[lows.length - 1];
    const highSlope = (h2.val - h1.val) / (h2.idx - h1.idx + 1);
    const lowSlope  = (l2.val - l1.val) / (l2.idx - l1.idx + 1);
    if (highSlope > 0 && lowSlope > 0 && lowSlope > highSlope * 1.3 &&
        Math.abs(highSlope) > atr * 0.05) {
      patterns.push({
        name: 'Rising Wedge', type: 'bear', strength: 3,
        desc: `Wedge naik menyempit — sering diakhiri breakdown bearish`
      });
      score -= 3;
    }
  }

  // ── FALLING WEDGE (Bullish) ──
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2],   l2 = lows[lows.length - 1];
    const highSlope = (h2.val - h1.val) / (h2.idx - h1.idx + 1);
    const lowSlope  = (l2.val - l1.val) / (l2.idx - l1.idx + 1);
    if (highSlope < 0 && lowSlope < 0 && lowSlope < highSlope * 1.3 &&
        Math.abs(lowSlope) > atr * 0.05) {
      patterns.push({
        name: 'Falling Wedge', type: 'bull', strength: 3,
        desc: `Wedge turun menyempit — sering diakhiri breakout bullish`
      });
      score += 3;
    }
  }

  // ── BULL FLAG ──
  // Pole: kenaikan tajam. Flag: konsolidasi kecil ke bawah
  const last20 = candles.slice(-20);
  const last5  = candles.slice(-5);
  const poleStart = candles.slice(-20, -10);
  if (poleStart.length >= 5) {
    const poleGain = (poleStart[poleStart.length-1].c - poleStart[0].c) / poleStart[0].c;
    const flagRange = (Math.max(...last5.map(c=>c.h)) - Math.min(...last5.map(c=>c.l))) / cl.c;
    const flagSlope = last5[last5.length-1].c - last5[0].c; // sedikit turun
    if (poleGain > 0.03 && flagRange < 0.015 && flagSlope < 0) {
      patterns.push({
        name: 'Bull Flag', type: 'bull', strength: 3,
        desc: `Konsolidasi kecil setelah kenaikan tajam — breakout bullish imminent`
      });
      score += 3;
    }

    // ── BEAR FLAG ──
    if (poleGain < -0.03 && flagRange < 0.015 && flagSlope > 0) {
      patterns.push({
        name: 'Bear Flag', type: 'bear', strength: 3,
        desc: `Konsolidasi kecil setelah penurunan tajam — breakdown bearish imminent`
      });
      score -= 3;
    }
  }

  // ── SUPPORT & RESISTANCE LEVELS ──
  // Dynamic S/R dari swing lows/highs yang sering disentuh
  const srLevels = [];
  const allLevels = [...highs.map(h=>h.val), ...lows.map(l=>l.val)];
  allLevels.forEach(lv => {
    const nearby = allLevels.filter(v => Math.abs(v - lv) < tolerance);
    if (nearby.length >= 2 && !srLevels.some(s => Math.abs(s.level - lv) < tolerance)) {
      srLevels.push({ level: lv, touches: nearby.length });
    }
  });

  // Cek apakah harga saat ini dekat S/R kuat
  const nearSupport = srLevels.find(s => s.level < cl.c && cl.c - s.level < atr * 1.5 && s.touches >= 2);
  const nearResist  = srLevels.find(s => s.level > cl.c && s.level - cl.c < atr * 1.5 && s.touches >= 2);

  if (nearSupport) {
    patterns.push({
      name: 'Near Support', type: 'bull', strength: 2,
      desc: `Dekat support kuat $${Math.round(nearSupport.level).toLocaleString()} (${nearSupport.touches}x disentuh)`
    });
    score += 2;
  }
  if (nearResist) {
    patterns.push({
      name: 'Near Resistance', type: 'bear', strength: 2,
      desc: `Dekat resistance kuat $${Math.round(nearResist.level).toLocaleString()} (${nearResist.touches}x disentuh)`
    });
    score -= 2;
  }

  return { patterns, score, srLevels };
}

// ══════════════════════════════════════════════════════════
// CANDLE CONFIRMATION (validasi signal dengan candle berikutnya)
// ══════════════════════════════════════════════════════════

// ── HITUNG HARGA KONFIRMASI CANDLE ──
// Jika candle saat ini belum terkonfirmasi, hitung harga minimum
// yang harus di-close candle berikutnya agar dianggap konfirmasi.
// Return: { price, reason, type: 'confirmation_limit' }
function calcConfirmationEntry(candles, direction, atr) {
  if (!candles || candles.length < 3) return null;
  const c0 = candles[candles.length - 1]; // candle terbaru (belum tutup sempurna)
  const c1 = candles[candles.length - 2];
  const _atr = atr || Math.abs(c0.h - c0.l);

  if (direction === 'LONG') {
    // Konfirmasi LONG: candle berikutnya harus close DI ATAS level kunci
    // Level kunci = high candle bearish terakhir (c0/c1) atau midpoint
    const keyLevel = c0.c > c0.o
      ? c0.c                          // candle sekarang sudah bullish → konfirmasi di close-nya
      : Math.max(c0.o, c1.h);        // candle bearish → tunggu break above high prev candle
    // Tambah sedikit buffer (0.05% ATR) agar tidak false trigger
    const confPrice = keyLevel + _atr * 0.1;
    const reason = c0.c > c0.o
      ? `Break & close di atas $${Math.round(c0.c).toLocaleString()} (close candle ini)`
      : `Break & close di atas $${Math.round(keyLevel).toLocaleString()} (high prev candle)`;
    return { price: confPrice, reason, type: 'confirmation_limit', keyLevel };
  } else if (direction === 'SHORT') {
    // Konfirmasi SHORT: candle berikutnya harus close DI BAWAH level kunci
    const keyLevel = c0.c < c0.o
      ? c0.c
      : Math.min(c0.o, c1.l);
    const confPrice = keyLevel - _atr * 0.1;
    const reason = c0.c < c0.o
      ? `Break & close di bawah $${Math.round(c0.c).toLocaleString()} (close candle ini)`
      : `Break & close di bawah $${Math.round(keyLevel).toLocaleString()} (low prev candle)`;
    return { price: confPrice, reason, type: 'confirmation_limit', keyLevel };
  }
  return null;
}

function confirmCandleSignal(candles, direction) {
  if (!candles || candles.length < 3) return { confirmed: false, strength: 0, notes: [] };

  const notes = [];
  let strength = 0;
  const c0  = candles[candles.length - 1]; // candle terbaru
  const c1  = candles[candles.length - 2];
  const atr = calcATR(candles) || 1;
  const vols = candles.map(c => c.v);
  const avgVol = calcSMA(vols.slice(-20), 20) || 1;
  const lastVol = c0.v;

  if (direction === 'LONG') {
    // 1. Candle terbaru bullish?
    if (c0.c > c0.o) {
      strength += 1;
      notes.push('✅ Candle terbaru menutup bullish');
    } else {
      notes.push('⚠️ Candle terbaru masih bearish');
    }

    // 2. Close di atas midpoint range?
    const mid = (c0.h + c0.l) / 2;
    if (c0.c > mid) {
      strength += 1;
      notes.push('✅ Close di atas midpoint candle');
    }

    // 3. Volume konfirmasi — volume candle bullish > rata-rata
    if (lastVol > avgVol * 1.2 && c0.c > c0.o) {
      strength += 2;
      notes.push(`✅ Volume spike bullish (${(lastVol/avgVol).toFixed(1)}x avg)`);
    } else if (lastVol < avgVol * 0.7) {
      strength -= 1;
      notes.push('⚠️ Volume rendah — kurang meyakinkan');
    }

    // 4. Higher close dari candle sebelumnya?
    if (c0.c > c1.c) {
      strength += 1;
      notes.push('✅ Higher close dari candle sebelumnya');
    }

    // 5. Tidak ada upper shadow besar (seller tidak mengambil alih di akhir)
    const upSh = c0.h - Math.max(c0.c, c0.o);
    if (upSh < (c0.c - c0.o) * 0.5) {
      strength += 1;
      notes.push('✅ Upper shadow kecil — buyer in control');
    } else if (upSh > (c0.h - c0.l) * 0.4) {
      strength -= 1;
      notes.push('⚠️ Upper shadow besar — ada penolakan di high');
    }

    // 6. Body size cukup besar?
    if (Math.abs(c0.c - c0.o) > atr * 0.3) {
      strength += 1;
      notes.push('✅ Body candle cukup kuat');
    }

  } else if (direction === 'SHORT') {
    if (c0.c < c0.o) {
      strength += 1;
      notes.push('✅ Candle terbaru menutup bearish');
    } else {
      notes.push('⚠️ Candle terbaru masih bullish');
    }

    const mid = (c0.h + c0.l) / 2;
    if (c0.c < mid) {
      strength += 1;
      notes.push('✅ Close di bawah midpoint candle');
    }

    if (lastVol > avgVol * 1.2 && c0.c < c0.o) {
      strength += 2;
      notes.push(`✅ Volume spike bearish (${(lastVol/avgVol).toFixed(1)}x avg)`);
    } else if (lastVol < avgVol * 0.7) {
      strength -= 1;
      notes.push('⚠️ Volume rendah — kurang meyakinkan');
    }

    if (c0.c < c1.c) {
      strength += 1;
      notes.push('✅ Lower close dari candle sebelumnya');
    }

    const downSh = Math.min(c0.c, c0.o) - c0.l;
    if (downSh < Math.abs(c0.o - c0.c) * 0.5) {
      strength += 1;
      notes.push('✅ Lower shadow kecil — seller in control');
    } else if (downSh > (c0.h - c0.l) * 0.4) {
      strength -= 1;
      notes.push('⚠️ Lower shadow besar — ada support di low');
    }

    if (Math.abs(c0.c - c0.o) > atr * 0.3) {
      strength += 1;
      notes.push('✅ Body candle cukup kuat');
    }
  }

  const confirmed = strength >= 3;
  const level = strength >= 5 ? 'KUAT' : strength >= 3 ? 'CUKUP' : strength >= 1 ? 'LEMAH' : 'TIDAK';

  return { confirmed, strength, level, notes };
}

// ── FETCH EXTERNAL DATA ──
async function fetchMarketMomentum(symbol) {
  // Mengambil data price momentum & community sentiment dari CoinGecko
  // (bukan analisis berita teks — label di UI sudah diubah menjadi "Momentum")
  const coinMap = {BTCUSDT:'bitcoin',ETHUSDT:'ethereum',SOLUSDT:'solana',BNBUSDT:'binancecoin',XRPUSDT:'ripple',XAUUSD:'gold'};
  // XAUUSD pakai CoinGecko 'gold'; pair tidak dikenal fallback ke bitcoin
  const coinId = coinMap[symbol] || 'bitcoin';
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false`);
    const d = await r.json();
    const priceChange24h = d.market_data?.price_change_percentage_24h || 0;
    const priceChange7d  = d.market_data?.price_change_percentage_7d  || 0;
    const priceChange30d = d.market_data?.price_change_percentage_30d || 0;
    const sentimentUp    = d.sentiment_votes_up_percentage || 50;
    const marketCapChange = d.market_data?.market_cap_change_percentage_24h || 0;
    // Momentum score: weight lebih ke perubahan harga multi-timeframe
    const score = (priceChange24h * 0.4 + priceChange7d * 0.3 + priceChange30d * 0.1 + (sentimentUp - 50) * 0.2 + marketCapChange * 0.1);
    return { score, priceChange24h, priceChange7d, sentimentUp };
  } catch(e) { return null; }
}

// ── ANALISIS UTAMA ──
// ══════════════════════════════════════════════════════════
// ICT / SMC ENGINE — Liquidity Sweep + FVG + ChoCh + OB
// ══════════════════════════════════════════════════════════

// 1. Deteksi Swing High / Swing Low
function detectSwings(candles, lookback = 5) {
  const highs = [], lows = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const slice = candles.slice(i - lookback, i + lookback + 1);
    const maxH = Math.max(...slice.map(c => c.h));
    const minL = Math.min(...slice.map(c => c.l));
    if (candles[i].h === maxH) highs.push({ idx: i, price: candles[i].h, candle: candles[i] });
    if (candles[i].l === minL) lows.push({ idx: i, price: candles[i].l, candle: candles[i] });
  }
  return { highs, lows };
}

// 2. Deteksi Liquidity Sweep (stop hunt)
// Sweep terjadi: harga menembus swing sebelumnya lalu langsung berbalik
function detectLiquiditySweep(candles, swings) {
  const result = { bullSweep: false, bearSweep: false, sweepLevel: null, sweepIdx: null };
  if (candles.length < 10) return result;

  // Cek beberapa candle terakhir (bukan hanya 1) untuk sweep yang lebih baru
  const lookbackCandles = candles.slice(-5);

  // Bull sweep: harga mencapai swing low sebelumnya, lalu close kembali di atas
  // = stop-loss seller disweep, reversal bullish
  if (swings.lows.length >= 2) {
    const recentLow = swings.lows[swings.lows.length - 2]; // swing low sebelumnya
    if (recentLow) {
      const sweepCandle = lookbackCandles.find(c => c.l <= recentLow.price && c.c > recentLow.price);
      if (sweepCandle) {
        result.bullSweep = true;
        result.sweepLevel = recentLow.price;
        result.sweepIdx = candles.length - 1;
        result.sweepCandle = sweepCandle;
      }
    }
  }

  // Bear sweep: harga mencapai swing high sebelumnya, lalu close kembali di bawah
  if (swings.highs.length >= 2) {
    const recentHigh = swings.highs[swings.highs.length - 2];
    if (recentHigh) {
      const sweepCandle = lookbackCandles.find(c => c.h >= recentHigh.price && c.c < recentHigh.price);
      if (sweepCandle) {
        result.bearSweep = true;
        result.sweepLevel = recentHigh.price;
        result.sweepIdx = candles.length - 1;
        result.sweepCandle = sweepCandle;
      }
    }
  }

  return result;
}

// 3. Deteksi ChoCh / MSS (Change of Character / Market Structure Shift)
// ChoCh: harga break struktur minor setelah sweep
function detectChoCh(candles, direction, swings) {
  if (candles.length < 15) return { choch: false, mss: false, breakLevel: null };

  const last = candles[candles.length - 1];
  const prev8 = candles.slice(-10, -1); // lebih lebar: 10 candle sebelum terakhir

  if (direction === 'LONG') {
    // Setelah bull sweep: cari candle yang break di atas recent swing high minor
    const recentMiniHigh = Math.max(...prev8.map(c => c.h));
    const choch = last.c > recentMiniHigh; // close di atas struktur terakhir
    const mss = choch && swings.highs.length >= 1 && last.c > swings.highs[swings.highs.length - 1].price;
    return { choch, mss, breakLevel: recentMiniHigh };
  } else {
    const recentMiniLow = Math.min(...prev8.map(c => c.l));
    const choch = last.c < recentMiniLow;
    const mss = choch && swings.lows.length >= 1 && last.c < swings.lows[swings.lows.length - 1].price;
    return { choch, mss, breakLevel: recentMiniLow };
  }
}

// 4. Deteksi Fair Value Gap (FVG / Imbalance)
// FVG: gap antara candle i-2 dan candle i, candle i-1 adalah momentum candle
function detectFVG(candles, direction) {
  const fvgs = [];
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2]; // candle sebelum momentum
    const c1 = candles[i - 1]; // momentum candle (besar)
    const c2 = candles[i];     // candle setelah

    if (direction === 'LONG') {
      // Bullish FVG: low candle ke-3 > high candle ke-1 (gap ke atas)
      if (c2.l > c0.h) {
        fvgs.push({
          top: c2.l, bottom: c0.h,
          mid: (c2.l + c0.h) / 2,
          idx: i, filled: false,
          type: 'bull'
        });
      }
    } else {
      // Bearish FVG: high candle ke-3 < low candle ke-1
      if (c2.h < c0.l) {
        fvgs.push({
          top: c0.l, bottom: c2.h,
          mid: (c0.l + c2.h) / 2,
          idx: i, filled: false,
          type: 'bear'
        });
      }
    }
  }

  // Filter: hanya FVG yang belum terisi (unmitigated)
  // FVG terisi jika candle setelahnya masuk ke zona FVG
  const unmitigated = fvgs.filter(fvg => {
    const afterCandles = candles.slice(fvg.idx + 1);
    if (afterCandles.length === 0) return true;
    if (fvg.type === 'bull') {
      return !afterCandles.some(c => c.l <= fvg.top); // belum diisi (harga belum kembali mengisi gap)
    } else {
      return !afterCandles.some(c => c.h >= fvg.bottom); // belum diisi dari bawah
    }
  });

  // Ambil FVG terdekat dengan harga saat ini
  const current = candles[candles.length - 1].c;
  unmitigated.sort((a, b) => Math.abs(a.mid - current) - Math.abs(b.mid - current));

  return { all: fvgs, unmitigated, nearest: unmitigated[0] || null };
}

// 5. Deteksi Order Block (OB)
// OB: candle bearish terakhir sebelum impulse bullish (atau sebaliknya)
function detectOrderBlock(candles, direction) {
  const obs = [];
  const minBodyPct = 0.3; // body minimal 30% dari range candle

  for (let i = 1; i < candles.length - 3; i++) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    if (range === 0) continue;

    const bodyPct = body / range;
    if (bodyPct < minBodyPct) continue;

    if (direction === 'LONG') {
      // Bearish OB sebelum bullish impulse: candle merah diikuti 2+ candle hijau naik
      const isBearish = c.c < c.o;
      if (isBearish) {
        const next1 = candles[i + 1];
        const next2 = candles[i + 2];
        if (next1.c > c.h && next2 && next2.c > next1.c) {
          obs.push({ top: c.h, bottom: c.l, mid: (c.h + c.l) / 2, idx: i, type: 'bull' });
        }
      }
    } else {
      // Bullish OB sebelum bearish impulse
      const isBullish = c.c > c.o;
      if (isBullish) {
        const next1 = candles[i + 1];
        const next2 = candles[i + 2];
        if (next1.c < c.l && next2 && next2.c < next1.c) {
          obs.push({ top: c.h, bottom: c.l, mid: (c.h + c.l) / 2, idx: i, type: 'bear' });
        }
      }
    }
  }

  // Filter OB yang belum dimitigasi
  const unmitigated = obs.filter(ob => {
    const afterCandles = candles.slice(ob.idx + 1);
    if (ob.type === 'bull') {
      return !afterCandles.some(c => c.l <= ob.top); // harga belum kembali ke dalam zona OB bullish
    } else {
      return !afterCandles.some(c => c.h >= ob.bottom); // harga belum kembali ke dalam zona OB bearish
    }
  });

  const current = candles[candles.length - 1].c;
  unmitigated.sort((a, b) => Math.abs(a.mid - current) - Math.abs(b.mid - current));

  return { all: obs, unmitigated, nearest: unmitigated.slice(-3) };
}

// 6. Hitung TP berbasis Fibonacci Extension
function calcFibExtension(candles, direction, sweepLevel) {
  if (!candles || candles.length < 20) return null;

  const last20 = candles.slice(-20);
  const swingHigh = Math.max(...last20.map(c => c.h));
  const swingLow  = Math.min(...last20.map(c => c.l));
  const range = swingHigh - swingLow;
  if (range <= 0) return null;

  const current = candles[candles.length - 1].c;

  if (direction === 'LONG') {
    const base = Math.min(sweepLevel || swingLow, current);
    const tp1raw = base + range * 0.618;
    const tp2raw = base + range * 1.0;
    const tp3raw = base + range * 1.272;
    const finalTp1 = tp1raw > current ? tp1raw : current + range * 0.382;
    const finalTp2 = tp2raw > finalTp1 ? tp2raw : finalTp1 + range * 0.2;
    return { tp1: finalTp1, tp2: finalTp2, tp3: tp3raw, range, swingHigh, swingLow };
  } else {
    const base = Math.max(sweepLevel || swingHigh, current);
    const tp1raw = base - range * 0.618;
    const tp2raw = base - range * 1.0;
    const tp3raw = base - range * 1.272;
    const finalTp1 = tp1raw < current ? tp1raw : current - range * 0.382;
    const finalTp2 = tp2raw < finalTp1 ? tp2raw : finalTp1 - range * 0.2;
    return { tp1: finalTp1, tp2: finalTp2, tp3: tp3raw, range, swingHigh, swingLow };
  }
}

// ══════════════════════════════════════════════════════════
// UPGRADE ENGINE — MTF + ADX Filter + Session + SL Structure + RR Gate
// ══════════════════════════════════════════════════════════

// 1. HTF BIAS — Tentukan tren mayor dari timeframe lebih tinggi
// Input: candles HTF (sudah di-fetch), returns 'LONG'|'SHORT'|'NEUTRAL'
function calcHTFBias(htfCandles) {
  if (!htfCandles || htfCandles.length < 50) return { bias: 'NEUTRAL', reason: 'Data HTF tidak cukup', strength: 0 };
  const closes = htfCandles.map(c => c.c);
  const current = closes[closes.length - 1];

  // EMA 21 & 50 untuk bias tren
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  // EMA 200 sebagai major trend filter
  const ema200 = calcEMA(closes, 200);
  const adx = calcADX(htfCandles, 14);

  let biasScore = 0;
  const reasons = [];

  // EMA stack: 21 > 50 > 200 = bullish, kebalikannya bearish
  if (ema21 && ema50) {
    if (ema21 > ema50) { biasScore += 2; }
    else { biasScore -= 2; }
  }
  if (ema200) {
    if (current > ema200) { biasScore += 2; reasons.push('Harga di atas EMA200 HTF'); }
    else { biasScore -= 2; reasons.push('Harga di bawah EMA200 HTF'); }
  }
  // Higher Highs / Higher Lows check (swing structure)
  const last10 = htfCandles.slice(-10);
  const highs = last10.map(c => c.h);
  const lows  = last10.map(c => c.l);
  const hhCount = highs.filter((h, i) => i > 0 && h > highs[i-1]).length;
  const llCount = lows.filter((l, i) => i > 0 && l < lows[i-1]).length;
  if (hhCount >= 6) { biasScore += 1; reasons.push('Higher Highs terdeteksi'); }
  if (llCount >= 6) { biasScore -= 1; reasons.push('Lower Lows terdeteksi'); }

  // ADX trend strength
  const trendStrong = adx && adx.adx > 20;
  if (trendStrong) {
    if (adx.diP > adx.diM) { biasScore += 1; }
    else { biasScore -= 1; }
  }

  const bias = biasScore >= 2 ? 'LONG' : biasScore <= -2 ? 'SHORT' : 'NEUTRAL';
  const strength = Math.min(100, Math.abs(biasScore) / 6 * 100);
  const mainReason = bias === 'LONG'
    ? `Tren HTF Bullish (EMA stack + struktur HH/HL)`
    : bias === 'SHORT'
    ? `Tren HTF Bearish (EMA stack + struktur LH/LL)`
    : `Tren HTF Netral — pasar sideways`;

  return { bias, strength: Math.round(strength), reason: mainReason, adxStrong: trendStrong, ema21, ema50, ema200 };
}

// 2. HTF TIMEFRAME MAP — untuk setiap LTF, HTF yang relevan
function getHTFInterval(ltfInterval) {
  const map = {
    '1m':  '15m',
    '5m':  '1h',
    '15m': '4h',
    '1h':  '4h',
    '4h':  '1d',
    '1d':  '1w'
  };
  return map[ltfInterval] || '4h';
}

// 3. ADX MARKET REGIME FILTER
// Returns: { trending, ranging, adxValue, reason }
function calcMarketRegime(candles) {
  const adx = calcADX(candles, 14);
  if (!adx) return { trending: false, ranging: true, adxValue: 0, reason: 'ADX tidak dapat dihitung' };

  const trending = adx.adx >= 20; // turunkan threshold dari 25 ke 20 agar tidak terlalu strict
  const strong   = adx.adx >= 30;
  const ranging  = adx.adx < 18;

  let reason = '';
  if (strong)        reason = `Tren kuat (ADX ${adx.adx.toFixed(1)}) — kondisi ideal entry`;
  else if (trending) reason = `Tren cukup (ADX ${adx.adx.toFixed(1)}) — entry valid dengan konfirmasi`;
  else if (ranging)  reason = `Pasar ranging (ADX ${adx.adx.toFixed(1)}) — hindari trend-following`;
  else               reason = `Transisi (ADX ${adx.adx.toFixed(1)}) — entry dengan hati-hati`;

  return { trending, ranging, strong, adxValue: adx.adx, diP: adx.diP, diM: adx.diM, reason };
}

// 4. SESSION FILTER — Kripto paling aktif di sesi London (13:00–21:00 UTC) dan NY (14:00–22:00 UTC)
function calcSessionFilter() {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  const minuteUTC = now.getUTCMinutes();
  const timeDecimal = hourUTC + minuteUTC / 60;

  // Sesi London: 07:00–16:00 UTC
  const inLondon = timeDecimal >= 7 && timeDecimal < 16;
  // Sesi New York: 13:00–22:00 UTC
  const inNY = timeDecimal >= 13 && timeDecimal < 22;
  // Overlap (paling volatile): 13:00–16:00 UTC
  const inOverlap = timeDecimal >= 13 && timeDecimal < 16;
  // Dead zone: 22:00–07:00 UTC (Asia late/early)
  const inDeadZone = timeDecimal >= 22 || timeDecimal < 5;

  const active = inLondon || inNY;
  let sessionName = '';
  if (inOverlap)       sessionName = 'London-NY Overlap 🔥';
  else if (inLondon)   sessionName = 'London Session';
  else if (inNY)       sessionName = 'New York Session';
  else if (inDeadZone) sessionName = 'Dead Zone 😴';
  else                 sessionName = 'Asia Session';

  return {
    active,
    inOverlap,
    inDeadZone,
    sessionName,
    hourUTC,
    reason: active
      ? `${sessionName} — volume & volatilitas tinggi`
      : `${sessionName} — volume rendah, signal kurang reliable`
  };
}

// 5. SL BERBASIS STRUKTUR — bukan ATR flat, tapi di bawah/atas swing terdekat
function calcStructuralSL(candles, direction, atrVal) {
  if (!candles || candles.length < 10) return null;
  const swings = detectSwings(candles, 3); // lookback 3 untuk struktur minor
  const current = candles[candles.length - 1].c;
  const buffer  = atrVal * 0.3; // buffer kecil di luar struktur

  if (direction === 'LONG') {
    // SL di bawah swing low terdekat yang di bawah harga
    const validLows = swings.lows
      .filter(s => s.price < current)
      .sort((a, b) => b.price - a.price); // sort desc, ambil yang terdekat
    if (validLows.length > 0) {
      return validLows[0].price - buffer;
    }
    // Fallback: recent lowest low dari 10 candle terakhir
    const recentLow = Math.min(...candles.slice(-10).map(c => c.l));
    return recentLow - buffer;
  } else {
    // SL di atas swing high terdekat yang di atas harga
    const validHighs = swings.highs
      .filter(s => s.price > current)
      .sort((a, b) => a.price - b.price); // sort asc, ambil yang terdekat
    if (validHighs.length > 0) {
      return validHighs[0].price + buffer;
    }
    const recentHigh = Math.max(...candles.slice(-10).map(c => c.h));
    return recentHigh + buffer;
  }
}

// 6. R:R GATE — validasi apakah signal layak diambil
// Returns: { valid, rr, reason }
function calcRRGate(entry, sl, tp, minRR = 1.5) {
  if (!entry || !sl || !tp) return { valid: false, rr: 0, reason: 'Data entry/SL/TP tidak lengkap' };
  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (risk <= 0) return { valid: false, rr: 0, reason: 'Risk = 0, SL terlalu dekat' };
  const rr = reward / risk;
  const valid = rr >= minRR;
  return {
    valid,
    rr: parseFloat(rr.toFixed(2)),
    reason: valid
      ? `R:R ${rr.toFixed(2)} ≥ ${minRR} — layak diambil ✅`
      : `R:R ${rr.toFixed(2)} < ${minRR} — terlalu rendah, skip ❌`
  };
}

// 7. ICT Master Analyzer — gabungkan semua
function runICTAnalysis(candles, atr) {
  if (!candles || candles.length < 50) return null;

  const swings = detectSwings(candles, 4);
  const sweep  = detectLiquiditySweep(candles, swings);

  let direction = null;
  let confidence = 0;
  const reasons = [];

  // Tentukan arah dari sweep
  if (sweep.bullSweep) {
    direction = 'LONG';
    confidence += 35;
    reasons.push({ label: 'Liquidity Sweep', detail: `Stop hunt di $${Math.round(sweep.sweepLevel).toLocaleString()}`, type: 'bull', weight: 'HIGH' });
  } else if (sweep.bearSweep) {
    direction = 'SHORT';
    confidence += 35;
    reasons.push({ label: 'Liquidity Sweep', detail: `Stop hunt di $${Math.round(sweep.sweepLevel).toLocaleString()}`, type: 'bear', weight: 'HIGH' });
  } else {
    // Tidak ada sweep = WAIT, tapi tetap analisa untuk context
    return {
      direction: null, confidence: 0,
      entryPrice: candles[candles.length-1].c, entryType: 'market',
      sl: null, tp: null, tp2: null, sweepLevel: null,
      choch: false, mss: false, fvgZone: null, rrRatio: '—',
      reasons: [{ label: 'No Sweep', detail: 'Belum ada liquidity sweep terdeteksi', type: 'neut', weight: 'HIGH' }]
    };
  }

  // ChoCh / MSS konfirmasi
  const choch = detectChoCh(candles, direction, swings);
  if (choch.mss) {
    confidence += 25;
    reasons.push({ label: 'MSS Confirmed', detail: `Market Structure Shift terkonfirmasi`, type: direction === 'LONG' ? 'bull' : 'bear', weight: 'HIGH' });
  } else if (choch.choch) {
    confidence += 15;
    reasons.push({ label: 'ChoCh Detected', detail: `Change of Character terdeteksi`, type: direction === 'LONG' ? 'bull' : 'bear', weight: 'MED' });
  } else {
    confidence -= 10;
    reasons.push({ label: 'No ChoCh', detail: 'Menunggu konfirmasi struktur', type: 'neut', weight: 'MED' });
  }

  // FVG entry zone
  const fvg = detectFVG(candles, direction);
  let entryPrice = null, entryType = 'market';

  if (fvg.nearest) {
    confidence += 20;
    entryPrice = fvg.nearest.mid;
    entryType = 'limit';
    reasons.push({ label: 'FVG Entry Zone', detail: `Limit @ $${Math.round(fvg.nearest.mid).toLocaleString()} (${Math.round(fvg.nearest.bottom).toLocaleString()}–${Math.round(fvg.nearest.top).toLocaleString()})`, type: direction === 'LONG' ? 'bull' : 'bear', weight: 'HIGH' });
  } else {
    // Fallback ke Order Block
    const ob = detectOrderBlock(candles, direction);
    if (ob.nearest.length > 0) {
      const nearestOB = ob.nearest[ob.nearest.length - 1];
      confidence += 12;
      entryPrice = nearestOB.mid;
      entryType = 'limit';
      reasons.push({ label: 'Order Block Entry', detail: `Limit @ $${Math.round(nearestOB.mid).toLocaleString()} (OB zone)`, type: direction === 'LONG' ? 'bull' : 'bear', weight: 'MED' });
    } else {
      entryType = 'market';
      reasons.push({ label: 'No FVG/OB', detail: 'Entry market (zona tidak ideal)', type: 'neut', weight: 'LOW' });
    }
  }

  // Stop Loss — di bawah/atas sweep candle
  const current = candles[candles.length - 1].c;
  const atrVal = atr || current * 0.005;
  let sl;
  if (direction === 'LONG') {
    sl = (sweep.sweepLevel || candles[candles.length - 1].l) - atrVal * 0.5;
  } else {
    sl = (sweep.sweepLevel || candles[candles.length - 1].h) + atrVal * 0.5;
  }

  // TP berbasis Fibonacci Extension
  const fibExt = calcFibExtension(candles, direction, sweep.sweepLevel);
  const tp1 = fibExt ? fibExt.tp1 : (direction === 'LONG' ? current + atrVal * 3 : current - atrVal * 3);
  const tp2 = fibExt ? fibExt.tp2 : null;

  reasons.push({ label: 'Fib Extension TP', detail: `TP1: $${Math.round(tp1).toLocaleString()}${tp2 ? ' | TP2: $'+Math.round(tp2).toLocaleString() : ''}`, type: direction === 'LONG' ? 'bull' : 'bear', weight: 'MED' });

  // Entry final: validasi bahwa limit order arahnya benar
  // LONG: limit harus di BAWAH harga saat ini (menunggu retest ke bawah)
  // SHORT: limit harus di ATAS harga saat ini
  const entryFinal = entryPrice || current;
  const distFromCurrent = Math.abs(entryFinal - current) / current * 100;
  const wrongSide = entryType === 'limit' && (
    (direction === 'LONG'  && entryFinal >= current) ||
    (direction === 'SHORT' && entryFinal <= current)
  );
  if (wrongSide || (entryType === 'limit' && distFromCurrent > 5)) {
    entryType = 'market';
    entryPrice = current;
    reasons.push({ label: 'Entry Adjusted', detail: wrongSide ? 'Zona tidak valid (harga sudah melewati), market entry' : `Zona terlalu jauh (${distFromCurrent.toFixed(1)}%), market entry`, type: 'neut', weight: 'LOW' });
  }

  // Sanity check ICT: pastikan SL & TP di sisi yang benar sebelum return
  const _epFinal = entryPrice || current;
  if (direction === 'LONG') {
    if (!sl || sl >= _epFinal) sl = _epFinal - atrVal * 2;
    if (!tp1 || tp1 <= _epFinal) tp1 = _epFinal + atrVal * 3;
  } else if (direction === 'SHORT') {
    if (!sl || sl <= _epFinal) sl = _epFinal + atrVal * 2;
    if (!tp1 || tp1 >= _epFinal) tp1 = _epFinal - atrVal * 3;
  }

  // R:R ratio
  const entryUsed = entryPrice || current;
  const risk = Math.abs(entryUsed - sl);
  const reward = Math.abs(tp1 - entryUsed);
  const rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '—';

  return {
    direction,
    confidence: Math.min(95, Math.max(20, confidence)),
    entryPrice: entryPrice || current,
    entryType, // 'limit' atau 'market'
    sl, tp: tp1, tp2,
    sweepLevel: sweep.sweepLevel,
    choch: choch.choch,
    mss: choch.mss,
    fvgZone: fvg.nearest,
    rrRatio,
    reasons,
    swings
  };
}

async function runSignalAnalysis() {
  const btn = document.getElementById('sig-analyze-btn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Menganalisis...`;

  try {
    // 1. Fetch LTF candles + HTF candles (untuk bias) + data eksternal
    const htfInterval = getHTFInterval(_sigTf);
    const [raw, htfRaw, fngRaw, newsData, fundingData, btcDomData] = await Promise.all([
      fetchKlines(_sigPair, _sigTf, 200),
      fetchKlines(_sigPair, htfInterval, 100).catch(() => null),
      fetchFearGreed().catch(()=>null),
      fetchMarketMomentum(_sigPair).catch(()=>null),
      fetchFundingRate(_sigPair).catch(()=>null),
      fetchBTCDominance().catch(()=>null)
    ]);
    // Normalize fng data (original function returns {current:{value,classification}, history:[]})
    let fngData = null;
    if(fngRaw && fngRaw.current) {
      fngData = {value: fngRaw.current.value, label: fngRaw.current.classification};
    } else if(fngRaw && fngRaw.value !== undefined) {
      fngData = fngRaw;
    }
    _sigCandles = raw.map(k=>({t:k[0],o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])}));
    const htfCandles = htfRaw ? htfRaw.map(k=>({t:k[0],o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])})) : null;
    const closes  = _sigCandles.map(c=>c.c);
    const current = closes[closes.length-1];

    // ── PRE-ANALYSIS FILTERS ──
    const htfBias    = calcHTFBias(htfCandles);
    const regime     = calcMarketRegime(_sigCandles);
    const session    = calcSessionFilter();

    // 2. Hitung indikator teknikal
    const sma20  = calcSMA(closes,20), sma50=calcSMA(closes,50);
    const ema12  = calcEMA(closes,12), ema26=calcEMA(closes,26), ema200=calcEMA(closes,200);
    const macd   = calcMACD(closes);
    const rsi    = calcRSI(closes);
    const stoch  = calcStochastic(_sigCandles);
    const bb     = calcBB(closes);
    const adx    = calcADX(_sigCandles);
    const atr    = calcATR(_sigCandles);
    const fib    = calcFib(_sigCandles.slice(-80));
    const ichi   = calcIchimoku(_sigCandles);
    const vol    = calcVolume(_sigCandles);

    // 2b. Pattern detection (baru)
    const candleResult = detectCandlePatterns(_sigCandles);
    const chartResult  = detectChartPatterns(_sigCandles);

    // 3. SCORING SISTEM (weighted) — semua indikator sudah proper
    let score = 0; const signals = [];

    // ── SMA Trend (weight 1.5) ──
    // Butuh SMA20 > SMA50 (golden) DAN harga di atas keduanya
    let smaS = 'neut';
    if (sma20 && sma50) {
      if (current > sma20 && current > sma50 && sma20 > sma50) { smaS = 'bull'; score += 1.5; }
      else if (current < sma20 && current < sma50 && sma20 < sma50) { smaS = 'bear'; score -= 1.5; }
    } else if (sma20) {
      smaS = current > sma20 ? 'bull' : 'bear';
      score += smaS === 'bull' ? 0.75 : -0.75;
    }
    signals.push({name:'SMA (20/50)',val:sma20?`$${Math.round(sma20).toLocaleString()}`:'—',type:smaS,badge:smaS==='bull'?'NAIK':smaS==='bear'?'TURUN':'NETRAL'});

    // ── EMA Crossover + EMA200 Filter (weight 1.5) ──
    let emaS = 'neut';
    if (ema12 && ema26) {
      emaS = ema12 > ema26 ? 'bull' : 'bear';
      score += emaS === 'bull' ? 1.0 : -1.0;
    }
    // EMA200 sebagai major trend filter (weight 0.5)
    if (ema200) {
      if (current > ema200) score += 0.5;
      else score -= 0.5;
    }
    const emaBadge = ema12 && ema26 ? (ema12 > ema26 ? 'GOLDEN' : 'DEATH') : '—';
    signals.push({name:'EMA (12/26/200)',val:ema12?`$${Math.round(ema12).toLocaleString()}`:'—',type:emaS,badge:emaBadge});

    // ── MACD — histogram + crossover (weight 2.0) ──
    let macdS = 'neut';
    if (macd) {
      // Crossover = sinyal terkuat
      if (macd.crossBull) { macdS = 'bull'; score += 2.0; }
      else if (macd.crossBear) { macdS = 'bear'; score -= 2.0; }
      // Tidak crossover: nilai histogram & posisi
      else if (macd.hist > 0 && macd.macd > 0) { macdS = 'bull'; score += 1.0; }
      else if (macd.hist < 0 && macd.macd < 0) { macdS = 'bear'; score -= 1.0; }
      else if (macd.hist > 0) { macdS = 'bull'; score += 0.5; } // hist positif tapi MACD negatif
      else if (macd.hist < 0) { macdS = 'bear'; score -= 0.5; }
    }
    const macdBadge = macd?.crossBull ? 'CROSS↑' : macd?.crossBear ? 'CROSS↓' : macdS==='bull' ? 'BUY' : macdS==='bear' ? 'SELL' : 'NETRAL';
    signals.push({name:'MACD',val:macd?macd.hist.toFixed(1):'—',type:macdS,badge:macdBadge});

    // ── Fibonacci dengan konteks tren (weight 0.75) ──
    let fibS = 'neut', fibL = '—';
    if (fib) {
      const cl = fib.cl;
      // Tentukan level terdekat
      if      (cl >= fib.r236) fibL = '23.6%';
      else if (cl >= fib.r382) fibL = '38.2%';
      else if (cl >= fib.r50)  fibL = '50%';
      else if (cl >= fib.r618) fibL = '61.8%';
      else                     fibL = '78.6%';
      // Konteks: upswing = retracement ke 38.2%-61.8% = buy zone; downswing = sebaliknya
      if (fib.isUpswing) {
        if (cl >= fib.r618 && cl <= fib.r382) { fibS = 'bull'; score += 0.75; } // buy di area retracement
        else if (cl > fib.r236) { fibS = 'bull'; score += 0.25; }               // di atas 23.6% = tren kuat
        else if (cl < fib.r786) { fibS = 'bear'; score -= 0.75; }               // breakdown fibonacci
      } else {
        if (cl <= fib.r382 && cl >= fib.r618) { fibS = 'bear'; score -= 0.75; }
        else if (cl < fib.r786) { fibS = 'bear'; score -= 0.25; }
        else if (cl > fib.r236) { fibS = 'bull'; score += 0.5; }
      }
    }
    signals.push({name:'Fibonacci',val:fibL,type:fibS,badge:fibS==='bull'?'SUPPORT':fibS==='bear'?'RESIST':'LEVEL'});

    // ── Stochastic dengan %K/%D crossover (weight 1.5) ──
    let stochS = 'neut';
    if (stoch) {
      const k = stoch.k, d = stoch.d;
      // Crossover di zona extreme = sinyal paling valid
      if (stoch.bullCross && k < 30) { stochS = 'bull'; score += 1.5; }       // golden cross di oversold
      else if (stoch.bearCross && k > 70) { stochS = 'bear'; score -= 1.5; } // dead cross di overbought
      else if (stoch.bullCross) { stochS = 'bull'; score += 0.75; }           // cross di zona normal
      else if (stoch.bearCross) { stochS = 'bear'; score -= 0.75; }
      else if (k < 20) { stochS = 'bull'; score += 1.0; }                     // deep oversold
      else if (k > 80) { stochS = 'bear'; score -= 1.0; }
      else if (k < 30) { stochS = 'bull'; score += 0.5; }
      else if (k > 70) { stochS = 'bear'; score -= 0.5; }
    }
    const stochVal = stoch ? `${stoch.k.toFixed(1)}/${stoch.d.toFixed(1)}` : '—';
    const stochBadge = stoch
      ? (stoch.bullCross ? 'CROSS↑' : stoch.bearCross ? 'CROSS↓' : stoch.k > 80 ? 'OVERBOUGHT' : stoch.k < 20 ? 'OVERSOLD' : 'NORMAL')
      : '—';
    signals.push({name:'Stochastic',val:stochVal,type:stochS,badge:stochBadge});

    // ── Bollinger Bands dengan %B (weight 1.0) ──
    let bbS = 'neut';
    if (bb) {
      // %B < 0 = di bawah lower band; %B > 1 = di atas upper band
      if (bb.pctB < 0) { bbS = 'bull'; score += 1.0; }        // close di bawah lower = oversold
      else if (bb.pctB > 1) { bbS = 'bear'; score -= 1.0; }   // close di atas upper = overbought
      else if (bb.pctB < 0.15) { bbS = 'bull'; score += 0.5; }
      else if (bb.pctB > 0.85) { bbS = 'bear'; score -= 0.5; }
      // Squeeze: BB sangat sempit = volatilitas rendah, breakout akan terjadi (netral)
    }
    const bbBadge = bb ? (bb.pctB < 0 ? 'LOWER' : bb.pctB > 1 ? 'UPPER' : bb.bw < 2 ? 'SQUEEZE' : 'MID') : '—';
    signals.push({name:'Bollinger',val:bb?`${bb.bw.toFixed(1)}%`:'—',type:bbS,badge:bbBadge});

    // ── RSI — Wilder's proper (weight 2.0) ──
    // Zone yang benar: <30 oversold, >70 overbought, 45-55 neutral
    let rsiS = 'neut';
    if (rsi !== null) {
      if (rsi < 30)      { rsiS = 'bull'; score += 2.0; }   // deeply oversold
      else if (rsi < 40) { rsiS = 'bull'; score += 1.0; }   // oversold zone
      else if (rsi < 45) { rsiS = 'bull'; score += 0.3; }   // approaching neutral from below
      else if (rsi > 70) { rsiS = 'bear'; score -= 2.0; }   // deeply overbought
      else if (rsi > 60) { rsiS = 'bear'; score -= 1.0; }   // overbought zone
      else if (rsi > 55) { rsiS = 'bear'; score -= 0.3; }   // approaching neutral from above
      // 45-55 = truly neutral, tidak ada tambahan score
    }
    const rsiBadge = rsi !== null ? (rsi > 70 ? 'OVERBOUGHT' : rsi < 30 ? 'OVERSOLD' : rsi >= 45 && rsi <= 55 ? 'NETRAL' : rsi > 55 ? 'KUAT' : 'LEMAH') : '—';
    signals.push({name:'RSI',val:rsi!==null?rsi.toFixed(1):'—',type:rsiS,badge:rsiBadge});

    // ── ADX — Wilder's proper dengan DI+/DI- (weight 1.0 konfirmator) ──
    let adxS = 'neut', adxVal = '—';
    if (adx) {
      adxVal = adx.adx.toFixed(1);
      // ADX hanya konfirmasi kekuatan tren, DI+/DI- menunjukkan arah
      if (adx.adx > 25) {
        // Tren kuat: ikuti arah DI
        adxS = adx.diP > adx.diM ? 'bull' : 'bear';
        score += adxS === 'bull' ? 1.0 : -1.0;
        // ADX sangat kuat (>40) = extra konfirmasi
        if (adx.adx > 40) score += adxS === 'bull' ? 0.5 : -0.5;
      }
      // ADX < 25 = tidak ada tren, jangan trading trend-following
    }
    const adxBadge = adx ? (adx.adx > 40 ? 'KUAT' : adx.adx > 25 ? 'TREN' : 'LEMAH') : '—';
    signals.push({name:'ADX',val:adxVal,type:adxS,badge:adxBadge});

    // ── Ichimoku dengan TK cross + chikou (weight 2.0) ──
    let ichiS = 'neut';
    if (ichi) {
      // Posisi vs Cloud (paling dasar)
      if (ichi.aboveCloud) { score += 1.0; ichiS = 'bull'; }
      else if (ichi.belowCloud) { score -= 1.0; ichiS = 'bear'; }
      // TK Cross (sinyal entry premium)
      if (ichi.tkBullCross && ichi.aboveCloud) { score += 1.0; ichiS = 'bull'; }
      else if (ichi.tkBearCross && ichi.belowCloud) { score -= 1.0; ichiS = 'bear'; }
      else if (ichi.tkBullCross) { score += 0.5; }
      else if (ichi.tkBearCross) { score -= 0.5; }
      // Chikou span konfirmasi
      if (ichi.chikouBull && ichiS === 'bull') score += 0.5;
      else if (!ichi.chikouBull && ichiS === 'bear') score -= 0.5;
    }
    const ichiLabel = ichi ? (ichi.tkBullCross ? 'TK Cross↑' : ichi.tkBearCross ? 'TK Cross↓' : ichi.aboveCloud ? 'Atas Awan' : ichi.belowCloud ? 'Bawah Awan' : 'Dalam Awan') : '—';
    const ichiBadge = ichiS === 'bull' ? (ichi?.tkBullCross ? 'CROSS↑' : 'BULLISH') : ichiS === 'bear' ? (ichi?.tkBearCross ? 'CROSS↓' : 'BEARISH') : 'NETRAL';
    signals.push({name:'Ichimoku',val:ichiLabel,type:ichiS,badge:ichiBadge});

    // ── Volume — konfirmasi dengan tren momentum (weight 0.5) ──
    const volS = vol.ratio > 1.5 ? 'bull' : vol.ratio < 0.7 ? 'bear' : 'neut';
    if (volS !== 'neut') score += volS === 'bull' ? 0.5 : -0.5;
    // Volume spike mengkonfirmasi arah gerakan harga
    if (vol.recentRatio > 2.0 && volS === 'bull') score += 0.3; // momentum sangat kuat
    signals.push({name:'ATR / Volume',val:atr?`$${atr.toFixed(1)}`:'—',type:volS,badge:vol.ratio>1.5?'SPIKE':vol.ratio<0.7?'SEPI':'NORMAL'});

    // 4. FEAR & GREED (weight 1.0) — sentimen pasar
    let fngScore = 0, fngVal='—', fngLbl='—', fngColor='#f59e0b';
    if(fngData){
      fngVal = String(fngData.value); fngLbl = fngData.label;
      if(fngData.value<25){fngScore=1.5; fngColor='#10b981'; /* Extreme fear = buy opportunity */}
      else if(fngData.value<40){fngScore=0.5; fngColor='#f59e0b';}
      else if(fngData.value>75){fngScore=-1; fngColor='#ef4444'; /* Extreme greed = danger */}
      else if(fngData.value>60){fngScore=-0.5; fngColor='#f97316';}
      score += fngScore;
    }

    // 5. MOMENTUM PASAR dari CoinGecko (price change multi-TF + community sentiment)
    let newsScore=0, newsVal='—', newsLbl='—', newsColor='#64748b';
    if(newsData){
      const s = newsData.score;
      newsVal = s>0?`+${s.toFixed(1)}`:`${s.toFixed(1)}`;
      if(s>8){newsScore=1;newsLbl='BULLISH';newsColor='#10b981';}
      else if(s>3){newsScore=0.5;newsLbl='POSITIF';newsColor='#34d399';}
      else if(s<-8){newsScore=-1;newsLbl='BEARISH';newsColor='#ef4444';}
      else if(s<-3){newsScore=-0.5;newsLbl='NEGATIF';newsColor='#f87171';}
      else{newsLbl='NETRAL';newsColor='#94a3b8';}
      score += newsScore;
    }

    // 6. Volume score display
    const volVal = vol.ratio.toFixed(2)+'x';
    const volLbl = vol.ratio>1.5?'TINGGI':vol.ratio<0.7?'RENDAH':'NORMAL';
    const volColor = vol.ratio>1.5?'#06b6d4':'#94a3b8';

    // 6b. FUNDING RATE SCORE — contrarian indicator
    let fundingScore = 0, fundingVal = '—', fundingLbl = '—', fundingColor = '#64748b';
    if (fundingData && _sigPair !== 'XAUUSD') {
      const fr = fundingData.rate;
      fundingVal = (fr >= 0 ? '+' : '') + fr.toFixed(4) + '%';
      // Funding rate ekstrem positif = terlalu banyak long → bearish contrarian
      // Funding rate ekstrem negatif = terlalu banyak short → bullish contrarian
      if (fr > 0.1)       { fundingScore = -1.5; fundingLbl = 'OVERLONG'; fundingColor = '#ef4444'; score -= 1.5; }
      else if (fr > 0.05) { fundingScore = -0.5; fundingLbl = 'LONG BIAS'; fundingColor = '#f97316'; score -= 0.5; }
      else if (fr < -0.05){ fundingScore = 1.5;  fundingLbl = 'OVERSHORT'; fundingColor = '#10b981'; score += 1.5; }
      else if (fr < -0.02){ fundingScore = 0.5;  fundingLbl = 'SHORT BIAS'; fundingColor = '#34d399'; score += 0.5; }
      else                { fundingLbl = 'NEUTRAL'; fundingColor = '#64748b'; }
    }

    // 6c. CONTEXT SCORE — BTC Dominance untuk crypto, DXY proxy untuk XAU
    let btcDomScore = 0, btcDomVal = '—', btcDomLbl = '—', btcDomColor = '#64748b';
    let btcDomCardLabel = 'BTC Dominance'; // label kartu di UI

    if (_sigPair === 'XAUUSD') {
      // ── EMAS: gunakan momentum DXY sebagai proxy ──
      // Tidak ada DXY realtime gratis, tapi kita bisa pakai data momentum global:
      // - Jika fear & greed RENDAH (< 30) + momentum negatif = safe haven demand → bullish XAU
      // - Jika fear & greed TINGGI (> 70) + momentum positif = risk-on → bearish XAU
      // - Juga pakai pergerakan BTC sebagai risk sentiment proxy (BTC naik = risk on = XAU netral/turun)
      btcDomCardLabel = 'Risk Sentiment';
      if (fngData) {
        const fg = fngData.value;
        if (fg < 25)       { btcDomScore = 1.5;  btcDomVal = fg+''; btcDomLbl = 'SAFE HAVEN 🥇'; btcDomColor = '#10b981'; score += 1.5; }
        else if (fg < 40)  { btcDomScore = 0.5;  btcDomVal = fg+''; btcDomLbl = 'FEAR → XAU+';   btcDomColor = '#34d399'; score += 0.5; }
        else if (fg > 75)  { btcDomScore = -1;   btcDomVal = fg+''; btcDomLbl = 'RISK ON → XAU-'; btcDomColor = '#ef4444'; score -= 1; }
        else if (fg > 60)  { btcDomScore = -0.5; btcDomVal = fg+''; btcDomLbl = 'GREED → XAU-';  btcDomColor = '#f97316'; score -= 0.5; }
        else               { btcDomVal = fg+''; btcDomLbl = 'NETRAL'; btcDomColor = '#64748b'; }
      }
      // Tambahan: jika momentum pasar positif kuat (crypto naik) → risk-on → XAU cenderung turun
      if (newsData && newsData.score > 8)  { score -= 0.5; }
      if (newsData && newsData.score < -8) { score += 0.5; }

    } else {
      // ── CRYPTO: BTC Dominance seperti sebelumnya ──
      const isAltcoin = _sigPair !== 'BTCUSDT';
      if (btcDomData && isAltcoin) {
        const dom = btcDomData.btcDom;
        btcDomVal = dom.toFixed(1) + '%';
        if (dom > 58)       { btcDomScore = -1;   btcDomLbl = 'BTC DOMINAN'; btcDomColor = '#ef4444'; score -= 1; }
        else if (dom > 54)  { btcDomScore = -0.5; btcDomLbl = 'BTC KUAT';    btcDomColor = '#f97316'; score -= 0.5; }
        else if (dom < 44)  { btcDomScore = 1;    btcDomLbl = 'ALTSEASON';   btcDomColor = '#10b981'; score += 1; }
        else if (dom < 48)  { btcDomScore = 0.5;  btcDomLbl = 'ALT FAVOR';   btcDomColor = '#34d399'; score += 0.5; }
        else                { btcDomLbl = 'NETRAL'; btcDomColor = '#64748b'; }
      } else if (btcDomData && _sigPair === 'BTCUSDT') {
        const dom = btcDomData.btcDom;
        btcDomVal = dom.toFixed(1) + '%';
        if (dom > 54)      { btcDomScore = 0.5;  btcDomLbl = 'BTC KUAT';  btcDomColor = '#10b981'; score += 0.5; }
        else if (dom < 44) { btcDomScore = -0.5; btcDomLbl = 'ALTSEASON'; btcDomColor = '#f97316'; score -= 0.5; }
        else               { btcDomLbl = 'NETRAL'; btcDomColor = '#64748b'; }
      }
    }

    // 6b. PATTERN SCORES — masuk ke total score
    // Candle patterns dibatasi ±6 agar tidak terlalu dominan
    const candleScoreCapped = Math.max(-6, Math.min(6, candleResult.score));
    score += candleScoreCapped;
    // Chart patterns dibatasi ±5
    const chartScoreCapped = Math.max(-5, Math.min(5, chartResult.score));
    score += chartScoreCapped;

    // 7. Tentukan arah signal
    // Max score baru: indikator 18 + candle patterns 6 + chart patterns 5 = ~29
    const maxScore = 29;
    const normScore = Math.max(-maxScore, Math.min(maxScore, score));
    const confidence = Math.round((Math.abs(normScore) / maxScore) * 100);
    // Threshold konservatif: butuh score ≥2.5
    const direction = normScore >= 2.5 ? 'LONG' : normScore <= -2.5 ? 'SHORT' : 'WAIT';

    // 7b. KONFIRMASI CANDLE — evaluasi setelah direction ditentukan
    const candleConf = confirmCandleSignal(_sigCandles, direction);

    // ── ICT / SMC ANALYSIS — Layer Utama ──
    const ict = runICTAnalysis(_sigCandles, atr);

    // Gabungkan: ICT konfirmasi atau override hasil indikator
    let finalDirection = direction;
    let finalEntry, finalSL, finalTP, finalTP2, finalEntryType, rrRatio;
    let ictConfidence = 0;
    let limitZoneText = '';

    if (ict && ict.direction) {
      if (ict.confidence >= 60) {
        finalDirection = ict.direction;
      } else if (ict.direction === direction) {
        finalDirection = direction;
      } else if (ict.confidence >= 40 && direction === 'WAIT') {
        finalDirection = ict.direction;
      } else {
        finalDirection = direction !== 'WAIT' ? direction : ict.direction;
      }
      ictConfidence = ict.confidence;
      finalEntry    = ict.entryPrice;
      finalEntryType = ict.entryType;
      finalSL       = ict.sl;
      finalTP       = ict.tp;
      finalTP2      = ict.tp2;
      rrRatio       = ict.rrRatio;
      if (ict.entryType === 'limit') {
        limitZoneText = ict.fvgZone
          ? `FVG $${Math.round(ict.fvgZone.bottom).toLocaleString()} – $${Math.round(ict.fvgZone.top).toLocaleString()}`
          : `Order Block zona`;
      }
    } else {
      finalDirection = direction;
      finalEntryType = 'market';
      finalEntry     = current;
      const _atrMult = 2;
      const _atrVal  = atr || current * 0.005;
      if (finalDirection === 'LONG')  { finalSL = finalEntry - _atrVal * _atrMult; finalTP = finalEntry + _atrVal * _atrMult * 2; }
      else if (finalDirection === 'SHORT') { finalSL = finalEntry + _atrVal * _atrMult; finalTP = finalEntry - _atrVal * _atrMult * 2; }
      else { finalSL = finalEntry - _atrVal * _atrMult; finalTP = finalEntry + _atrVal * _atrMult * 2; }
      const risk = Math.abs(finalEntry - finalSL);
      const reward = Math.abs(finalTP - finalEntry);
      rrRatio = risk > 0 ? (reward / risk).toFixed(2) : '—';
    }

    // ── FILTER 1: HTF BIAS — penalti jika berlawanan tren mayor ──
    let htfPenalty = 0;
    let htfOverride = false;
    if (htfBias.bias !== 'NEUTRAL' && finalDirection !== 'WAIT') {
      if (htfBias.bias !== finalDirection) {
        // Melawan tren HTF — sangat berbahaya
        if (htfBias.strength >= 60) {
          // HTF bias kuat berlawanan → batalkan signal, tunggu
          finalDirection = 'WAIT';
          htfOverride = true;
        } else {
          // HTF bias lemah berlawanan → penalti confidence, tetap bisa entry tapi hati-hati
          htfPenalty = -20;
        }
      }
    }

    // ── FILTER 2: ADX REGIME — skip jika pasar ranging ──
    let regimePenalty = 0;
    let regimeOverride = false;
    if (regime.ranging && finalDirection !== 'WAIT' && finalEntryType === 'market') {
      // Pasar ranging + market entry = bahaya → paksa ke limit atau skip
      if (!ict || !ict.fvgZone) {
        // Tidak ada zona ICT sebagai entry — skip market entry di pasar ranging
        regimeOverride = true;
        finalDirection = 'WAIT';
      }
      regimePenalty = -15;
    }

    // ── FILTER 3: STRUCTURAL SL — override SL dengan level struktur ──
    if (finalDirection !== 'WAIT' && atr) {
      const structSL = calcStructuralSL(_sigCandles, finalDirection, atr);
      if (structSL) {
        // Gunakan structural SL jika lebih baik (lebih jauh dari entry tapi tidak > 5%)
        const structSLPct = Math.abs(finalEntry - structSL) / finalEntry * 100;
        const currentSLPct = finalSL ? Math.abs(finalEntry - finalSL) / finalEntry * 100 : 999;
        if (structSLPct <= 5 && structSLPct > currentSLPct) {
          finalSL = structSL; // ganti ke structural SL yang lebih lebar
        } else if (!finalSL || currentSLPct < 0.3) {
          finalSL = structSL; // fallback jika SL sebelumnya terlalu sempit
        }
      }
    }

    // ── FILTER 4: R:R GATE — tolak jika R:R < 1.5 ──
    let rrGate = { valid: true, rr: parseFloat(rrRatio) || 0, reason: '' };
    if (finalDirection !== 'WAIT' && finalEntry && finalSL && finalTP) {
      rrGate = calcRRGate(finalEntry, finalSL, finalTP, 1.5);
      // Recalculate rrRatio
      rrRatio = rrGate.rr.toFixed(2);
      if (!rrGate.valid && finalEntryType === 'market') {
        // R:R buruk + market entry = tolak, coba adjust TP ke Fib extension
        const _atrVal3 = atr || current * 0.005;
        const neededReward = Math.abs(finalEntry - finalSL) * 1.5;
        finalTP = finalDirection === 'LONG'
          ? finalEntry + neededReward
          : finalEntry - neededReward;
        rrGate = calcRRGate(finalEntry, finalSL, finalTP, 1.5);
        rrRatio = rrGate.rr.toFixed(2);
      }
    }

    // ── SANITY CHECK FINAL: pastikan SL & TP di sisi yang benar dari entry ──
    if (finalDirection !== 'WAIT' && finalEntry) {
      const _atrFix = atr || current * 0.005;
      if (finalDirection === 'LONG') {
        if (!finalSL || finalSL >= finalEntry) finalSL = finalEntry - _atrFix * 2;
        if (!finalTP || finalTP <= finalEntry) finalTP = finalEntry + _atrFix * 3;
      } else if (finalDirection === 'SHORT') {
        if (!finalSL || finalSL <= finalEntry) finalSL = finalEntry + _atrFix * 2;
        if (!finalTP || finalTP >= finalEntry) finalTP = finalEntry - _atrFix * 3;
      }
    }

    // ── FILTER 5: SESSION ── (warning saja, tidak hard-block untuk kripto 24/7)
    // Kripto tetap bisa trading di dead zone, tapi confidence diturunkan
    const sessionPenalty = session.inDeadZone ? -10 : session.inOverlap ? 5 : 0;

    // ── KONFIRMASI CANDLE → LIMIT ORDER ──
    // Jika candle belum terkonfirmasi DAN kita punya arah yang jelas:
    // Override entry type ke 'confirmation_limit' — tunggu candle berikutnya konfirmasi
    let confEntry = null;
    let confLimitZoneText = '';
    if (!candleConf.confirmed && finalDirection !== 'WAIT') {
      confEntry = calcConfirmationEntry(_sigCandles, finalDirection, atr);
      if (confEntry) {
        // Hanya pakai confirmation limit jika saat ini entry-nya market
        // (jika sudah limit dari ICT/FVG, biarkan ICT yang menentukan)
        if (finalEntryType === 'market') {
          finalEntry     = confEntry.price;
          finalEntryType = 'confirmation_limit'; // tipe baru — limit nunggu konfirmasi candle
          limitZoneText  = `Konfirmasi candle @ $${Math.round(confEntry.keyLevel).toLocaleString()}`;
          confLimitZoneText = confEntry.reason;
          // Recalculate SL/TP dari confirmation entry price
          const _atrVal2 = atr || current * 0.005;
          if (finalDirection === 'LONG') {
            if (!finalSL || finalSL >= finalEntry) finalSL = finalEntry - _atrVal2 * 2;
            if (!finalTP || finalTP <= finalEntry) finalTP = finalEntry + _atrVal2 * 3;
          } else {
            if (!finalSL || finalSL <= finalEntry) finalSL = finalEntry + _atrVal2 * 2;
            if (!finalTP || finalTP >= finalEntry) finalTP = finalEntry - _atrVal2 * 3;
          }
          const _risk2 = Math.abs(finalEntry - finalSL);
          const _rew2  = Math.abs(finalTP - finalEntry);
          rrRatio = _risk2 > 0 ? (_rew2 / _risk2).toFixed(2) : '—';
        }
      }
    }

    // Hitung ulang persentase setelah semua override entry final
    const slPct  = ((Math.abs(finalEntry - finalSL) / finalEntry) * 100).toFixed(2);
    const tpPct  = ((Math.abs(finalTP - finalEntry) / finalEntry) * 100).toFixed(2);
    const distFromMarket = ((Math.abs(finalEntry - current) / current) * 100).toFixed(2);
    const bullC  = signals.filter(s => s.type === 'bull').length;
    const bearC  = signals.filter(s => s.type === 'bear').length;
    const alignC = finalDirection === 'LONG' ? bullC : finalDirection === 'SHORT' ? bearC : Math.max(bullC, bearC);
    const totalC = signals.length;
    const alignPct = totalC > 0 ? (alignC / totalC) * 100 : 50;
    const patternAlignBull = candleResult.patterns.filter(p=>p.type==='bull').length + chartResult.patterns.filter(p=>p.type==='bull').length;
    const patternAlignBear = candleResult.patterns.filter(p=>p.type==='bear').length + chartResult.patterns.filter(p=>p.type==='bear').length;
    const patternBonus = finalDirection==='LONG' ? patternAlignBull*2 : finalDirection==='SHORT' ? patternAlignBear*2 : 0;
    const confBonus = candleConf.strength > 0 ? Math.min(5, candleConf.strength) : 0;
    const sentBonus = (fngScore > 0 ? 3 : fngScore < 0 ? -3 : 0) + (newsScore > 0 ? 2 : newsScore < 0 ? -2 : 0);
    const ictBonus = ict ? Math.round(ict.confidence * 0.15) : 0;
    // Filter bonuses/penalties
    const htfBonus     = htfBias.bias === finalDirection ? 8 : htfBias.bias === 'NEUTRAL' ? 0 : -10;
    const regimeBonus  = regime.strong ? 6 : regime.trending ? 3 : regime.ranging ? -8 : 0;
    const sessionBonus = session.inOverlap ? 4 : session.inDeadZone ? -5 : 0;
    const rrBonus      = rrGate.valid ? (rrGate.rr >= 2.5 ? 6 : 3) : -8;
    const winRate = Math.min(82, Math.max(30, Math.round(
      alignPct * 0.5 + 15
      + sentBonus + patternBonus + confBonus + ictBonus
      + htfBonus + regimeBonus + sessionBonus + rrBonus
      + htfPenalty + regimePenalty + sessionPenalty
    )));

    // ── Simpan signal aktif (ICT-aware) ──
    // 'confirmation_limit' diperlakukan seperti 'limit' untuk polling
    const isAnyLimit = finalEntryType === 'limit' || finalEntryType === 'confirmation_limit';
    // Tentukan ICT plan tersedia atau tidak (untuk tombol entry saat WAIT)
    const _hasICTPlan = ict && ict.direction && (ict.entryType === 'limit' || ict.fvgZone);
    // Arah efektif: jika finalDirection WAIT tapi ICT punya plan, pakai ICT direction
    const _effectiveDir = finalDirection !== 'WAIT' ? finalDirection : (_hasICTPlan ? ict.direction : 'WAIT');
    _sigCurrentSignal = {
      direction: _effectiveDir,
      displayDirection: _effectiveDir,
      entry: finalEntry || current,
      entryType: isAnyLimit ? 'limit' : 'market',
      entryTypeRaw: finalEntryType,  // simpan tipe asli untuk UI
      limitPrice: isAnyLimit ? (finalEntry || current) : null,
      marketPrice: current,
      sl: finalSL, tp: finalTP, tp2: finalTP2,
      pair: _sigPair, tf: _sigTf,
      time: Date.now(),
      slPct: parseFloat(slPct),
      tpPct: parseFloat(tpPct),
      rrRatio,
      ictData: ict || null,
      limitZoneText: confLimitZoneText || limitZoneText,
      confEntryData: confEntry,
      candleConf,
      status: isAnyLimit ? 'waiting' : 'ready'
    };

    // ── UPDATE UI ──
    const fmt = v => '$' + Math.round(v).toLocaleString();
    const verdBadge = document.getElementById('sig-verdict-badge');
    verdBadge.className = `sig-verdict ${finalDirection.toLowerCase()}`;
    verdBadge.innerHTML = finalDirection === 'LONG'
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg> LONG — Potensi Naik`
      : finalDirection === 'SHORT'
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg> SHORT — Potensi Turun`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> WAIT — Signal Belum Jelas`;

    // Confidence bar — gabungkan ICT confidence + indikator
    const displayConf = ict ? Math.round((ict.confidence + confidence) / 2) : confidence;
    document.getElementById('sig-conf-label').textContent = `Confidence: ${finalDirection}`;
    document.getElementById('sig-conf-fill').style.width = displayConf + '%';
    document.getElementById('sig-conf-fill').style.background = finalDirection === 'LONG'
      ? 'linear-gradient(90deg,#10b981,#06b6d4)' : finalDirection === 'SHORT'
      ? 'linear-gradient(90deg,#ef4444,#f97316)' : 'linear-gradient(90deg,#f59e0b,#fbbf24)';
    document.getElementById('sig-conf-pct').textContent = displayConf + '%';

    // Entry card — tampilkan LIMIT, CONFIRMATION LIMIT, atau MARKET
    const entryEl   = document.getElementById('sig-entry');
    const entryNote = document.getElementById('sig-entry-note');
    if (finalEntryType === 'confirmation_limit') {
      entryEl.textContent = fmt(finalEntry);
      entryEl.style.color = '#a78bfa';
      entryNote.innerHTML = `<span style="background:rgba(167,139,250,.15);color:#a78bfa;padding:.05rem .35rem;border-radius:6px;font-weight:800">⏳ MENUNGGU KONFIRMASI</span> ${distFromMarket}% dari harga`;
    } else if (finalEntryType === 'limit') {
      entryEl.textContent = fmt(finalEntry);
      entryEl.style.color = '#f59e0b';
      entryNote.innerHTML = `<span style="background:rgba(245,158,11,.15);color:#f59e0b;padding:.05rem .35rem;border-radius:6px;font-weight:800">LIMIT</span> ${distFromMarket}% dari harga`;
    } else {
      entryEl.textContent = fmt(finalEntry);
      entryEl.style.color = '';
      entryNote.innerHTML = `<span style="background:rgba(16,185,129,.12);color:#10b981;padding:.05rem .35rem;border-radius:6px;font-weight:800">MARKET</span> Harga saat ini`;
    }

    document.getElementById('sig-sl').textContent     = fmt(finalSL);
    document.getElementById('sig-sl-pct').textContent = `-${slPct}%`;
    document.getElementById('sig-tp').textContent     = fmt(finalTP);
    document.getElementById('sig-tp-pct').textContent = `+${tpPct}%`;
    document.getElementById('sig-rr').textContent     = `1:${rrRatio}`;
    document.getElementById('sig-winrate').textContent = `~${winRate}%`;
    document.getElementById('sig-score').textContent   = `${alignC}/${totalC}`;

    // ── ICT ANALYSIS PANEL ──
    let ictPanel = document.getElementById('sig-ict-panel');
    if (!ictPanel) {
      ictPanel = document.createElement('div');
      ictPanel.id = 'sig-ict-panel';
      ictPanel.style.cssText = 'margin-bottom:.9rem';
      const indGrid = document.getElementById('sig-ind-grid');
      indGrid.parentNode.insertAdjacentElement('beforebegin', ictPanel);
    }
    if (ict) {
      const ictReasons = (ict.reasons || []);
      const weightColor = w => w==='HIGH'?'#ef4444':w==='MED'?'#f59e0b':'#64748b';
      const typeIcon = t => t==='bull'
        ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="#10b981"><path d="M12 4l8 16H4z"/></svg>`
        : t==='bear'
        ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="#ef4444"><path d="M12 20l8-16H4z"/></svg>`
        : `<svg width="10" height="10" viewBox="0 0 24 24" fill="#64748b"><circle cx="12" cy="12" r="8"/></svg>`;

      ictPanel.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(139,92,246,.08),rgba(6,182,212,.06));border:1px solid rgba(139,92,246,.2);border-radius:14px;padding:.85rem 1rem;margin-bottom:.75rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.65rem">
            <div style="display:flex;align-items:center;gap:.4rem">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span style="font-size:.62rem;font-weight:800;letter-spacing:.08em;color:#a78bfa;text-transform:uppercase">ICT / SMC Analysis</span>
            </div>
            <div style="display:flex;align-items:center;gap:.4rem">
              <span style="font-size:.58rem;color:#64748b">Confidence</span>
              <span style="font-size:.72rem;font-weight:900;color:${ict.direction==='LONG'?'#10b981':ict.direction==='SHORT'?'#ef4444':'#f59e0b'}">${ict.confidence}%</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:.4rem">
            ${ictReasons.map(r => `
              <div style="display:flex;align-items:flex-start;gap:.5rem;padding:.4rem .55rem;background:rgba(255,255,255,.03);border-radius:8px;border-left:2px solid ${weightColor(r.weight)}">
                <div style="margin-top:.1rem">${typeIcon(r.type)}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:.62rem;font-weight:800;color:#e2e8f0">${r.label}
                    <span style="font-size:.5rem;color:${weightColor(r.weight)};margin-left:.3rem">[${r.weight}]</span>
                  </div>
                  <div style="font-size:.57rem;color:#94a3b8;margin-top:.05rem">${r.detail}</div>
                </div>
              </div>`).join('')}
          </div>
          ${finalEntryType === 'confirmation_limit' ? `
          <div style="margin-top:.65rem;padding:.45rem .6rem;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);border-radius:8px">
            <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:.3rem">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              <div style="font-size:.6rem;font-weight:800;color:#a78bfa">LIMIT KONFIRMASI CANDLE</div>
            </div>
            <div style="font-size:.55rem;color:#94a3b8;line-height:1.5">${confLimitZoneText || confEntry?.reason || ''}</div>
            <div style="font-size:.52rem;color:#64748b;margin-top:.2rem">⚡ Order aktif setelah candle konfirmasi close di level ini</div>
          </div>` : finalEntryType === 'limit' ? `
          <div style="margin-top:.65rem;padding:.45rem .6rem;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:8px;display:flex;align-items:center;gap:.45rem">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <div>
              <div style="font-size:.6rem;font-weight:800;color:#f59e0b">LIMIT ORDER — Menunggu Retest</div>
              <div style="font-size:.55rem;color:#94a3b8">Entry di ${limitZoneText || fmt(finalEntry)} · ${distFromMarket}% dari harga saat ini</div>
            </div>
          </div>` : ''}
          ${ict.tp2 ? `
          <div style="margin-top:.5rem;display:flex;gap:.4rem">
            <div style="flex:1;padding:.35rem .5rem;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:8px;text-align:center">
              <div style="font-size:.5rem;color:#64748b;font-weight:700;text-transform:uppercase">TP1 (Fib 0.618)</div>
              <div style="font-size:.68rem;font-weight:900;color:#10b981;font-family:'Space Mono',monospace">${fmt(finalTP)}</div>
            </div>
            <div style="flex:1;padding:.35rem .5rem;background:rgba(16,185,129,.05);border:1px solid rgba(16,185,129,.12);border-radius:8px;text-align:center">
              <div style="font-size:.5rem;color:#64748b;font-weight:700;text-transform:uppercase">TP2 (Fib 1.0)</div>
              <div style="font-size:.68rem;font-weight:900;color:#34d399;font-family:'Space Mono',monospace">${fmt(ict.tp2)}</div>
            </div>
          </div>` : ''}
        </div>`;
    } else {
      ictPanel.innerHTML = `
        <div style="background:rgba(100,116,139,.06);border:1px solid rgba(100,116,139,.15);border-radius:12px;padding:.75rem 1rem;margin-bottom:.75rem;display:flex;align-items:center;gap:.6rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <div style="font-size:.62rem;font-weight:800;color:#94a3b8">ICT/SMC — Belum Ada Setup</div>
            <div style="font-size:.57rem;color:#64748b">Belum terdeteksi Liquidity Sweep. Analisis berbasis indikator teknikal.</div>
          </div>
        </div>`;
    }

    // ── FILTER PANEL UI ──
    let filterPanel = document.getElementById('sig-filter-panel');
    if (!filterPanel) {
      filterPanel = document.createElement('div');
      filterPanel.id = 'sig-filter-panel';
      filterPanel.style.cssText = 'margin-bottom:.9rem';
      const sentRowEl = document.getElementById('sig-sentiment-row');
      sentRowEl.parentNode.insertBefore(filterPanel, sentRowEl);
    }

    const fOk  = c => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const fWarn= c => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const fX   = c => `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    const filters = [
      {
        label: `HTF Bias (${getHTFInterval(_sigTf).toUpperCase()})`,
        value: htfBias.bias,
        detail: htfBias.reason,
        ok: htfBias.bias === finalDirection || htfBias.bias === 'NEUTRAL',
        warn: htfOverride,
        col: htfBias.bias === 'LONG' ? '#10b981' : htfBias.bias === 'SHORT' ? '#ef4444' : '#64748b'
      },
      {
        label: 'Market Regime (ADX)',
        value: regime.strong ? 'TRENDING KUAT' : regime.trending ? 'TRENDING' : regime.ranging ? 'RANGING ⚠️' : 'TRANSISI',
        detail: regime.reason,
        ok: regime.trending || regime.strong,
        warn: !regime.trending && !regime.strong,
        col: regime.strong ? '#10b981' : regime.trending ? '#06b6d4' : regime.ranging ? '#ef4444' : '#f59e0b'
      },
      {
        label: 'Sesi Trading',
        value: session.sessionName,
        detail: session.reason,
        ok: session.active,
        warn: session.inDeadZone,
        col: session.inOverlap ? '#10b981' : session.active ? '#06b6d4' : '#64748b'
      },
      {
        label: 'R:R Gate',
        value: `1:${rrGate.rr}`,
        detail: rrGate.reason,
        ok: rrGate.valid,
        warn: !rrGate.valid,
        col: rrGate.valid ? '#10b981' : '#ef4444'
      },
      {
        label: 'SL Berbasis Struktur',
        value: finalSL ? `$${Math.round(finalSL).toLocaleString()}` : '—',
        detail: finalSL && finalEntry ? `Jarak ${((Math.abs(finalEntry-finalSL)/finalEntry)*100).toFixed(2)}% dari entry` : 'Belum ada entry',
        ok: !!finalSL,
        warn: false,
        col: '#a78bfa'
      },
      // Funding rate — hanya untuk crypto (skip XAU)
      ...(_sigPair !== 'XAUUSD' ? [{
        label: 'Funding Rate',
        value: fundingVal,
        detail: fundingData
          ? (fundingData.rate > 0.1 ? 'Terlalu banyak long — risiko long squeeze'
           : fundingData.rate < -0.05 ? 'Terlalu banyak short — potensi short squeeze'
           : 'Funding rate wajar')
          : 'Data tidak tersedia',
        ok: fundingData ? Math.abs(fundingData.rate) < 0.08 : true,
        warn: fundingData ? Math.abs(fundingData.rate) > 0.1 : false,
        col: fundingColor
      }] : []),
      // BTC Dom untuk crypto, Risk Sentiment untuk XAU
      {
        label: btcDomCardLabel,
        value: btcDomVal,
        detail: _sigPair === 'XAUUSD'
          ? 'Fear & Greed sebagai proxy risk sentiment — rendah = safe haven demand'
          : btcDomData ? `BTC.D ${btcDomData.btcDom?.toFixed(1)}% — ${btcDomLbl}` : 'Data tidak tersedia',
        ok: btcDomScore >= 0,
        warn: btcDomScore < -0.5,
        col: btcDomColor
      }
    ];

    const passCount = filters.filter(f => f.ok).length;
    const totalFilters = filters.length;
    const filterScore  = Math.round(passCount / totalFilters * 100);
    const filterColor  = filterScore >= 80 ? '#10b981' : filterScore >= 60 ? '#f59e0b' : '#ef4444';

    filterPanel.innerHTML = `
      <div style="background:linear-gradient(135deg,rgba(6,182,212,.07),rgba(16,185,129,.05));border:1px solid rgba(6,182,212,.2);border-radius:14px;padding:.85rem 1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.7rem">
          <div style="display:flex;align-items:center;gap:.4rem">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2.2" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span style="font-size:.62rem;font-weight:800;letter-spacing:.08em;color:#06b6d4;text-transform:uppercase">Quality Filters</span>
          </div>
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:.55rem;color:#64748b">${passCount}/${totalFilters} passed</span>
            <span style="font-size:.72rem;font-weight:900;color:${filterColor}">${filterScore}%</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.35rem">
          ${filters.map(f => {
            const ic = f.warn ? fWarn('#ef4444') : f.ok ? fOk('#10b981') : fX('#94a3b8');
            const bg = f.warn ? 'rgba(239,68,68,.04)' : f.ok ? 'rgba(16,185,129,.04)' : 'rgba(100,116,139,.04)';
            const bd = f.warn ? 'rgba(239,68,68,.15)' : f.ok ? 'rgba(16,185,129,.15)' : 'rgba(100,116,139,.12)';
            return `<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem .55rem;background:${bg};border:1px solid ${bd};border-radius:8px">
              <span>${ic}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:.6rem;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:.35rem">
                  ${f.label}
                  <span style="font-size:.55rem;font-weight:800;color:${f.col};background:${f.col}18;padding:.05rem .3rem;border-radius:4px">${f.value}</span>
                </div>
                <div style="font-size:.54rem;color:#64748b;margin-top:.05rem">${f.detail}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        ${htfOverride || regimeOverride ? `
        <div style="margin-top:.6rem;padding:.4rem .55rem;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;display:flex;align-items:center;gap:.4rem">
          ${fWarn('#ef4444')}
          <span style="font-size:.58rem;color:#ef4444;font-weight:700">${htfOverride ? 'Signal ditahan: berlawanan tren HTF yang kuat' : 'Signal ditahan: pasar ranging tanpa zona ICT'}</span>
        </div>` : ''}
      </div>`;

    // Sentiment row
    const sentRow = document.getElementById('sig-sentiment-row');
    sentRow.style.display = 'flex';
    document.getElementById('sig-fng-val').textContent   = fngVal;
    document.getElementById('sig-fng-label').textContent = fngLbl;
    document.getElementById('sig-fng-label').style.background = fngColor+'28';
    document.getElementById('sig-fng-label').style.color = fngColor;
    document.getElementById('sig-news-val').textContent   = newsVal;
    document.getElementById('sig-news-label').textContent = newsLbl;
    document.getElementById('sig-news-label').style.background = newsColor+'28';
    document.getElementById('sig-news-label').style.color = newsColor;
    document.getElementById('sig-vol-val').textContent   = volVal;
    document.getElementById('sig-vol-label').textContent = volLbl;
    document.getElementById('sig-vol-label').style.background = volColor+'28';
    document.getElementById('sig-vol-label').style.color = volColor;

    // Funding rate UI
    const fundingCard = document.getElementById('sig-funding-card');
    if (fundingCard) fundingCard.style.display = (_sigPair === 'XAUUSD') ? 'none' : 'block';
    document.getElementById('sig-funding-val').textContent   = fundingVal;
    document.getElementById('sig-funding-label').textContent = fundingLbl;
    document.getElementById('sig-funding-label').style.background = fundingColor+'22';
    document.getElementById('sig-funding-label').style.color = fundingColor;

    // BTC dominance / Risk sentiment UI
    const btcDomCard = document.getElementById('sig-btcdom-card');
    const btcDomTitle = btcDomCard?.querySelector('div:first-child');
    if (btcDomTitle) btcDomTitle.textContent = btcDomCardLabel;
    document.getElementById('sig-btcdom-val').textContent   = btcDomVal;
    document.getElementById('sig-btcdom-label').textContent = btcDomLbl;
    document.getElementById('sig-btcdom-label').style.background = btcDomColor+'22';
    document.getElementById('sig-btcdom-label').style.color = btcDomColor;

    // Indicators grid
    document.getElementById('sig-ind-grid').innerHTML = signals.map(s=>`
      <div class="sig-ind-item">
        <div class="sig-ind-name">${s.name}</div>
        <div class="sig-ind-val ${s.type}" style="display:flex;align-items:center;gap:.2rem;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-size:.58rem;font-family:'Space Mono',monospace">${s.val}</span>
          <span class="sig-ind-badge badge-${s.type}">${s.badge}</span>
        </div>
      </div>`).join('');

    // ── PATTERN SECTION UI ──
    const allPatterns = [...candleResult.patterns, ...chartResult.patterns];
    let patternEl = document.getElementById('sig-pattern-section');
    if (!patternEl) {
      patternEl = document.createElement('div');
      patternEl.id = 'sig-pattern-section';
      patternEl.style.cssText = 'margin-bottom:.9rem';
      // Insert after sig-ind-grid parent
      const indGrid = document.getElementById('sig-ind-grid');
      indGrid.parentNode.insertAdjacentElement('afterend', patternEl);
    }

    // SVG icon helpers
    const svgUp    = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 4l8 16H4z"/></svg>`;
    const svgDown  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 20l8-16H4z"/></svg>`;
    const svgDiamond = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 2l10 10-10 10L2 12z"/></svg>`;
    const svgCheck = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>`;
    const svgWarn  = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const svgCandle = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0"><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="4" width="4" height="10" rx="1"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="8" y1="18" x2="8" y2="21"/><line x1="16" y1="2" x2="16" y2="4"/><line x1="16" y1="14" x2="16" y2="19"/></svg>`;
    const svgChart  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

    // Star rating as SVG dots (5 filled / hollow circles — clean & professional)
    const svgStars = (strength) => {
      const max = 5;
      const filled = Math.min(max, strength);
      return Array.from({length: max}, (_,i) => i < filled
        ? `<svg width="7" height="7" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4.5" fill="currentColor"/></svg>`
        : `<svg width="7" height="7" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`
      ).join('');
    };

    // Note line renderer: parses leading tag (ok/warn) and renders SVG + text
    const renderNote = (n) => {
      const isOk   = n.startsWith('✅');
      const isWarn = n.startsWith('⚠️');
      const text   = n.replace(/^✅\s*|^⚠️\s*/,'');
      const col    = isOk ? '#10b981' : isWarn ? '#f59e0b' : '#94a3b8';
      const icon   = isOk
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : isWarn
        ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        : '';
      return `<div style="display:flex;align-items:center;gap:.3rem;line-height:1.4">
        ${icon}
        <span style="font-size:.57rem;color:${isOk?'#94a3b8':isWarn?'#f59e0b':'#94a3b8'}">${text}</span>
      </div>`;
    };

    // Confirmation box builder
    const buildConfBox = () => {
      const col    = candleConf.confirmed ? '#10b981' : '#f59e0b';
      const bg     = candleConf.confirmed ? 'rgba(16,185,129,.07)' : 'rgba(245,158,11,.07)';
      const border = candleConf.confirmed ? 'rgba(16,185,129,.22)' : 'rgba(245,158,11,.22)';
      const lvlCol = candleConf.level==='KUAT' ? '#10b981' : candleConf.level==='CUKUP' ? '#f59e0b' : '#ef4444';
      const lvlBg  = candleConf.level==='KUAT' ? 'rgba(16,185,129,.18)' : candleConf.level==='CUKUP' ? 'rgba(245,158,11,.18)' : 'rgba(239,68,68,.18)';
      const confIcon = candleConf.confirmed
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      return `
        <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:.65rem .75rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem">
            <div style="display:flex;align-items:center;gap:.35rem">
              <span style="color:${col}">${confIcon}</span>
              <span style="font-size:.63rem;font-weight:800;color:${col}">${candleConf.confirmed ? 'Dikonfirmasi' : 'Belum Terkonfirmasi'}</span>
            </div>
            <span style="font-size:.57rem;font-weight:700;padding:.15rem .45rem;border-radius:5px;background:${lvlBg};color:${lvlCol}">${candleConf.level} ${candleConf.strength}/7</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:.25rem">
            ${candleConf.notes.map(n => renderNote(n)).join('')}
          </div>
          ${!candleConf.confirmed && confEntry && finalDirection !== 'WAIT' ? `
          <div style="margin-top:.5rem;padding:.4rem .55rem;background:rgba(167,139,250,.1);border:1px dashed rgba(167,139,250,.35);border-radius:8px">
            <div style="font-size:.58rem;font-weight:800;color:#a78bfa;margin-bottom:.15rem">⏳ Limit Konfirmasi Otomatis</div>
            <div style="font-size:.55rem;color:#94a3b8;line-height:1.5">${confEntry.reason}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.25rem">
              <span style="font-size:.5rem;color:#64748b">Harga limit konfirmasi</span>
              <span style="font-size:.65rem;font-weight:900;color:#a78bfa;font-family:'Space Mono',monospace">$${Math.round(confEntry.price).toLocaleString()}</span>
            </div>
          </div>` : ''}
        </div>`;
    };

    // Section header helper
    const sectionHeader = (svgIcon, label) =>
      `<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.55rem">
        <span style="color:#64748b">${svgIcon}</span>
        <span style="font-size:.6rem;font-weight:700;letter-spacing:.12em;color:#64748b;text-transform:uppercase">${label}</span>
      </div>`;

    if (allPatterns.length > 0) {
      patternEl.innerHTML = `
        <div style="margin-top:1.1rem">
          ${sectionHeader(svgCandle, 'Pattern Terdeteksi')}
          <div style="display:flex;flex-direction:column;gap:.4rem">
            ${allPatterns.map(p => {
              const isBull = p.type === 'bull';
              const isBear = p.type === 'bear';
              const col    = isBull ? '#10b981' : isBear ? '#ef4444' : '#f59e0b';
              const bg     = isBull ? 'rgba(16,185,129,.07)' : isBear ? 'rgba(239,68,68,.07)' : 'rgba(245,158,11,.07)';
              const border = isBull ? 'rgba(16,185,129,.22)' : isBear ? 'rgba(239,68,68,.22)' : 'rgba(245,158,11,.22)';
              const dirIcon = isBull ? `<span style="color:${col}">${svgUp}</span>` : isBear ? `<span style="color:${col}">${svgDown}</span>` : `<span style="color:${col}">${svgDiamond}</span>`;
              const isChart = chartResult.patterns.includes(p);
              const typeIcon = isChart ? svgChart : svgCandle;
              return `
              <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:.55rem .7rem;display:flex;align-items:flex-start;gap:.5rem">
                ${dirIcon}
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;margin-bottom:.2rem">
                    <span style="font-size:.65rem;font-weight:800;color:${col}">${p.name}</span>
                    <span style="display:inline-flex;align-items:center;gap:.2rem;font-size:.48rem;font-weight:700;padding:.12rem .35rem;border-radius:5px;background:${col}1a;color:${col};letter-spacing:.04em">
                      <span style="color:${col}">${typeIcon}</span>${isChart ? 'CHART' : 'CANDLE'}
                    </span>
                    <span style="display:inline-flex;align-items:center;gap:1px;color:${col}">${svgStars(p.strength)}</span>
                  </div>
                  <div style="font-size:.57rem;color:#64748b;line-height:1.45">${p.desc}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div style="margin-top:.85rem;margin-bottom:.2rem">
          ${sectionHeader(svgChart, 'Konfirmasi Candle')}
          ${buildConfBox()}
        </div>`;
    } else {
      patternEl.innerHTML = `
        <div style="margin-top:1.1rem">
          ${sectionHeader(svgCandle, 'Pattern Terdeteksi')}
          <div style="background:rgba(100,116,139,.06);border:1px solid rgba(100,116,139,.13);border-radius:10px;padding:.65rem .75rem;text-align:center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:.3rem"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div style="font-size:.6rem;color:#64748b;margin-top:.1rem">Tidak ada pattern signifikan saat ini</div>
            <div style="font-size:.55rem;color:#475569;margin-top:.2rem">Market dalam fase konsolidasi atau tren lemah</div>
          </div>
        </div>
        <div style="margin-top:.85rem;margin-bottom:.2rem">
          ${sectionHeader(svgChart, 'Konfirmasi Candle')}
          ${buildConfBox()}
        </div>`;
    }

    // Chart
    document.getElementById('sig-chart-badge').textContent = `${_sigPair} · ${_sigTf.toUpperCase()}`;
    document.getElementById('sig-chart-badge').style.color = '#10b981';
    renderSigChart(_sigCandles, finalEntry, finalSL, finalTP, finalDirection);

    // Tampilkan tombol entry jika ada signal jelas
    const entrySection = document.getElementById('sig-entry-section');
    const levSection = document.getElementById('sig-leverage-section');
    // Tampilkan tombol entry:
    // - Jika direction jelas (LONG/SHORT), selalu tampil
    // - Jika WAIT tapi ICT punya plan entry (FVG/OB/limit zone), tetap tampil sebagai limit
    const hasICTPlan = ict && ict.direction && (ict.entryType === 'limit' || ict.fvgZone);
    const show = finalDirection !== 'WAIT' || hasICTPlan;

    // Jika WAIT tapi ICT punya plan, gunakan ICT direction untuk tombol entry
    let displayDirection = finalDirection;
    if (finalDirection === 'WAIT' && hasICTPlan) {
      displayDirection = ict.direction;
      // Override entry data dari ICT
      if (!finalEntry) { finalEntry = ict.entryPrice || current; }
      if (!finalSL) { finalSL = ict.sl || (ict.direction === 'LONG' ? current * 0.97 : current * 1.03); }
      if (!finalTP) { finalTP = ict.tp || (ict.direction === 'LONG' ? current * 1.06 : current * 0.94); }
      finalEntryType = ict.entryType || 'limit';
    }

    entrySection.style.display = show ? 'block' : 'none';
    if (levSection) levSection.style.display = show ? 'block' : 'none';
    if (show) {
      const eb = document.getElementById('sig-entry-btn');
      const isLimit = finalEntryType === 'limit';
      const isConfLimit = finalEntryType === 'confirmation_limit';
      const isWaitWithPlan = finalDirection === 'WAIT' && hasICTPlan;

      eb.style.background = isConfLimit
        ? 'linear-gradient(135deg,#4c1d95,#7c3aed)'
        : isLimit || isWaitWithPlan
          ? 'linear-gradient(135deg,#92400e,#f59e0b)'
          : displayDirection === 'LONG'
            ? 'linear-gradient(135deg,#10b981,#06b6d4)'
            : 'linear-gradient(135deg,#ef4444,#f97316)';
      eb.style.boxShadow = isConfLimit
        ? '0 4px 20px rgba(124,58,237,.4)'
        : isLimit || isWaitWithPlan
          ? '0 4px 20px rgba(245,158,11,.4)'
          : displayDirection === 'LONG'
            ? '0 4px 20px rgba(16,185,129,.4)'
            : '0 4px 20px rgba(239,68,68,.4)';
      const levLabel = _sigCurrentLeverage > 1 ? ` · ${_sigCurrentLeverage}x` : '';
      if (isConfLimit) {
        eb.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          Tunggu Konfirmasi ${displayDirection}${levLabel} @ $${Math.round(finalEntry).toLocaleString()}`;
      } else if (isLimit || isWaitWithPlan) {
        eb.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Set Limit ${displayDirection}${levLabel} @ $${Math.round(finalEntry).toLocaleString()}`;
      } else {
        eb.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Market ${displayDirection}${levLabel} — ${_sigPair}`;
      }

      // Simpan displayDirection ke signal untuk dipakai saat enter
      if (_sigCurrentSignal) {
        _sigCurrentSignal.displayDirection = displayDirection;
        _sigCurrentSignal.direction = displayDirection !== 'WAIT' ? displayDirection : _sigCurrentSignal.direction;
      }
    }

    // Update stats
    renderSigStats();

  } catch(err) {
    console.error('Signal error:', err);
    document.getElementById('sig-verdict-badge').className='sig-verdict wait';
    document.getElementById('sig-verdict-badge').textContent='⚠ Gagal memuat data';
    // Tampilkan error detail di sig-chart-empty tanpa overwrite parent
    const emptyEl = document.getElementById('sig-chart-empty');
    if (emptyEl) emptyEl.innerHTML = `<div style="padding:.5rem 1rem;color:#ef4444;font-size:.65rem;font-family:monospace;text-align:center;word-break:break-all">ERROR: ${err.message}</div>`;
    const badge = document.getElementById('sig-chart-badge');
    if (badge) { badge.textContent = `${_sigPair} · ${_sigTf.toUpperCase()}`; badge.style.color = '#ef4444'; }
  }

  btn.disabled=false;
  btn.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Refresh Signal`;
}

// ── PERSIST ACTIVE TRADES ──
function saveActiveTrades() {
  // Simpan tradeData saja (intervalId tidak bisa disimpan)
  const toSave = {};
  Object.entries(_sigActiveTrades).forEach(([pair, val]) => {
    toSave[pair] = val.tradeData;
  });
  try { localStorage.setItem('sig_active_trades', JSON.stringify(toSave)); } catch(e) {}
}

function restoreActiveTrades() {
  try {
    const raw = localStorage.getItem('sig_active_trades');
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.values(saved).forEach(tradeData => {
      if (!tradeData || !tradeData.pair) return;
      startTradePolling(tradeData); // restart polling
    });
    if (Object.keys(_sigActiveTrades).length > 0) {
      renderActiveTrades();
      updateEntryBtnState();
    }
  } catch(e) {}
}

// ── CORE POLLING — dipisah agar bisa dipanggil ulang saat restore ──
function startTradePolling(tradeData) {
  const pair = tradeData.pair;
  if (_sigActiveTrades[pair]?.intervalId) clearInterval(_sigActiveTrades[pair].intervalId);
  _sigActiveTrades[pair] = { tradeData };

  // Limit order expiry: 4 jam
  const LIMIT_EXPIRY_MS = 4 * 60 * 60 * 1000;

  const intervalId = setInterval(async () => {
    try {
      const d = await fetchTicker24h(pair);
      const price = parseFloat(d?.lastPrice || d?.price || 0);
      if (!price || price < 100) return;

      if (_sigActiveTrades[pair]) _sigActiveTrades[pair].lastPrice = price;
      const td = _sigActiveTrades[pair]?.tradeData;
      if (!td) return;

      // ── STATUS: WAITING (limit order belum terisi) ──
      if (td.status === 'waiting') {
        const elapsed = Date.now() - td.entryTime;

        // Cek apakah harga sudah menyentuh zona limit
        const limitPrice = td.limitPrice || td.entry;
        const tolerance  = Math.abs(limitPrice * 0.001); // toleransi 0.1%
        const filled = td.direction === 'LONG'
          ? price <= limitPrice + tolerance   // harga turun ke zona limit (retest FVG/OB dari atas)
          : price >= limitPrice - tolerance;  // harga naik ke zona limit (retest FVG/OB dari bawah)

        if (filled) {
          // Limit terisi! Upgrade ke ACTIVE
          td.status    = 'active';
          td.filledAt  = Date.now();
          td.actualEntry = price;
          // Recalculate SL/TP dari actual fill
          const slDist = Math.abs(td.entry - td.sl);
          const tpDist = Math.abs(td.tp  - td.entry);
          td.sl = td.direction === 'LONG' ? price - slDist : price + slDist;
          td.tp = td.direction === 'LONG' ? price + tpDist : price - tpDist;
          td.entry = price; // update entry ke actual fill price
          saveActiveTrades();
          renderActiveTrades();
          toast(`✅ LIMIT TERISI! ${td.direction} ${pair} @ $${Math.round(price).toLocaleString()} — Posisi aktif`);
          return;
        }

        // Cek expired
        if (elapsed > LIMIT_EXPIRY_MS) {
          clearInterval(_sigActiveTrades[pair]?.intervalId);
          delete _sigActiveTrades[pair];
          saveActiveTrades();
          renderActiveTrades();
          toast(`⏰ Limit order ${pair} EXPIRED — harga tidak mencapai zona entry`);

          // Catat ke riwayat sebagai EXPIRED
          const record = {
            id: Date.now(), pair: td.pair, tf: td.tf,
            direction: td.direction, entry: td.limitPrice || td.entry,
            exit: price, sl: td.sl, tp: td.tp,
            result: 'EXPIRED', pnlPct: '0.00',
            duration: Math.round(elapsed / 60000), time: td.entryTime
          };
          _sigHistory.unshift(record);
          if (_sigHistory.length > 50) _sigHistory.pop();
          try { localStorage.setItem('sig_history', JSON.stringify(_sigHistory)); } catch(e) {}
          renderSigStats();
          return;
        }

        // Update card UI — tampilkan status waiting
        const card = document.getElementById('sig-trade-card-' + pair);
        if (card) {
          const limitEl  = card.querySelector('.sig-tc-current');
          const waitEl   = card.querySelector('.sig-tc-pnl');
          const distPct  = (((price - (td.limitPrice || td.entry)) / (td.limitPrice || td.entry)) * 100);
          // distSign positif berarti harga masih di atas limit (jauh dari fill), negatif berarti sudah di bawah
          const distSign = td.direction === 'LONG' ? distPct : -distPct;
          if (limitEl) limitEl.textContent = '$' + Math.round(price).toLocaleString();
          if (waitEl) {
            const absDist = Math.abs(distSign);
            const closeOrFar = distSign > 0 ? 'jauh dari limit' : 'dekat limit ▼';
            waitEl.textContent = `${distSign > 0 ? '+' : ''}${distSign.toFixed(2)}% (${closeOrFar})`;
            waitEl.style.color = Math.abs(distSign) < 0.5 ? '#10b981' : '#f59e0b';
          }
          const barEl = card.querySelector('.sig-tc-bar');
          // Progress bar: seberapa dekat harga ke limit zone
          const maxDist = Math.abs((td.limitPrice || td.entry) * 0.05); // 5% = 0% proximity
          const curDist = Math.abs(price - (td.limitPrice || td.entry));
          const proximity = Math.max(0, Math.min(100, (1 - curDist / maxDist) * 100));
          if (barEl) { barEl.style.width = proximity + '%'; barEl.style.background = `linear-gradient(90deg,#334155,${proximity > 80 ? '#10b981' : '#f59e0b'})`; }
        }
        return;
      }

      // ── STATUS: ACTIVE — polling biasa ──
      const entryRef = td.actualEntry || td.entry;
      const lev = td.leverage || 1;
      const rawPnl = td.direction === 'LONG'
        ? ((price - entryRef) / entryRef * 100)
        : ((entryRef - price) / entryRef * 100);
      const pnlPct = rawPnl * lev;

      const card = document.getElementById('sig-trade-card-' + pair);
      if (card) {
        const curEl  = card.querySelector('.sig-tc-current');
        const pnlEl  = card.querySelector('.sig-tc-pnl');
        const barEl  = card.querySelector('.sig-tc-bar');
        const tpctEl = card.querySelector('.sig-tc-tpct');
        if (curEl)  curEl.textContent  = '$' + Math.round(price).toLocaleString();
        if (pnlEl)  { pnlEl.textContent = (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%' + (lev > 1 ? ` (${lev}x)` : ''); pnlEl.style.color = pnlPct >= 0 ? '#10b981' : '#ef4444'; }
        const slRange = td.slPct * lev, tpRange = td.tpPct * lev;
        const barPct  = Math.max(0, Math.min(100, ((pnlPct + slRange) / (slRange + tpRange)) * 100));
        if (barEl)  { barEl.style.width = barPct + '%'; barEl.style.background = 'linear-gradient(90deg,#ef4444,#f59e0b,#10b981)'; }
        if (tpctEl) tpctEl.textContent = pnlPct.toFixed(2) + '%';
      }

      // Cek SL/TP
      let result = null;
      if (td.direction === 'LONG')  { if (price <= td.sl) result = 'SL'; else if (price >= td.tp) result = 'TP'; }
      else                          { if (price >= td.sl) result = 'SL'; else if (price <= td.tp) result = 'TP'; }

      if (result) {
        clearInterval(_sigActiveTrades[pair]?.intervalId);
        delete _sigActiveTrades[pair];
        saveActiveTrades();
        closeTrade({...td, entry: entryRef}, price, result);
        renderActiveTrades();
      }
    } catch(e) {}
  }, 5000);

  _sigActiveTrades[pair].intervalId = intervalId;
}

// ── ENTRY TRADE (ICT-aware: limit & market) ──
function enterTrade() {
  if (!_sigCurrentSignal) return;
  // Tolak hanya jika benar-benar tidak ada arah (WAIT tanpa ICT plan)
  const effectiveDir = _sigCurrentSignal.displayDirection || _sigCurrentSignal.direction;
  if (effectiveDir === 'WAIT' || !effectiveDir) return;
  // Pastikan direction terisi dengan nilai efektif
  _sigCurrentSignal.direction = effectiveDir;
  const sig = _sigCurrentSignal;
  const pair = sig.pair;

  if (_sigActiveTrades[pair]) {
    if (!confirm(`Sudah ada posisi untuk ${pair}. Batalkan dan buat baru?`)) return;
    clearInterval(_sigActiveTrades[pair].intervalId);
    delete _sigActiveTrades[pair];
  }

  const isLimit = sig.entryType === 'limit'; // sudah dinormalisasi
  const tradeData = {
    ...sig,
    entryTypeRaw: sig.entryTypeRaw || sig.entryType, // simpan tipe asli
    entryTime: Date.now(),
    status: isLimit ? 'waiting' : 'active',
    filledAt: isLimit ? null : Date.now(),
    actualEntry: isLimit ? null : sig.entry,
    leverage: _sigCurrentLeverage
  };

  startTradePolling(tradeData);
  saveActiveTrades();
  renderActiveTrades();
  updateEntryBtnState();

  const levLabel = _sigCurrentLeverage > 1 ? ` · ${_sigCurrentLeverage}x` : '';
  if (isLimit) {
    toast(`🟡 LIMIT ORDER ${sig.direction}${levLabel} ${pair} @ $${Math.round(sig.entry).toLocaleString()} — Menunggu harga retest zona...`);
  } else {
    toast(`✅ MARKET Entry ${sig.direction}${levLabel} ${pair} @ $${Math.round(sig.entry).toLocaleString()} — Memantau...`);
  }
}

function renderActiveTrades() {
  const container = document.getElementById('sig-active-trade');
  if (!container) return;
  const trades = Object.values(_sigActiveTrades);
  if (trades.length === 0) { container.style.display = 'none'; container.innerHTML = ''; return; }
  container.style.display = 'block';

  const waitCount   = trades.filter(t => t.tradeData?.status === 'waiting').length;
  const activeCount = trades.filter(t => t.tradeData?.status === 'active').length;
  const hdrLabel    = activeCount > 0 && waitCount > 0 ? `Aktif (${activeCount}) · Menunggu (${waitCount})`
                    : activeCount > 0 ? `Posisi Aktif (${activeCount})`
                    : `Menunggu Entry (${waitCount})`;
  const hdrColor    = activeCount > 0 ? '#10b981' : '#f59e0b';

  const cards = trades.map(({ tradeData: t }) => {
    const isWaiting = t.status === 'waiting';
    const col   = t.direction === 'LONG' ? '#10b981' : '#ef4444';
    const colBg = t.direction === 'LONG' ? 'rgba(16,185,129,.18)' : 'rgba(239,68,68,.18)';
    const lev   = t.leverage || 1;
    const levBadge = lev > 1 ? `<span style="font-size:.58rem;font-weight:800;padding:.1rem .35rem;border-radius:6px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)">${lev}x</span>` : '';
    const fmt = v => '$' + Math.round(v).toLocaleString();

    const dotColor  = isWaiting ? '#f59e0b' : '#10b981';
    const cardBorder = isWaiting ? 'rgba(245,158,11,.25)' : 'rgba(16,185,129,.2)';
    const cardBg     = isWaiting ? 'rgba(245,158,11,.04)' : 'rgba(16,185,129,.04)';

    const statusBadge = isWaiting
      ? `<span style="font-size:.55rem;font-weight:800;padding:.1rem .4rem;border-radius:6px;background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)">⏳ MENUNGGU</span>`
      : `<span style="font-size:.55rem;font-weight:800;padding:.1rem .4rem;border-radius:6px;background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3)">● AKTIF</span>`;

    const entryLabel = isWaiting ? 'Limit' : 'Entry';
    const entryVal   = isWaiting ? (t.limitPrice || t.entry) : (t.actualEntry || t.entry);
    const col3Label  = isWaiting ? 'Jarak' : `PnL${lev > 1 ? ' (' + lev + 'x)' : ''}`;

    // SL/TP display
    const slPct = t.slPct ? `-${(t.slPct).toFixed(2)}%` : '—';
    const tpPct = t.tpPct ? `+${(t.tpPct).toFixed(2)}%` : '—';

    return `
      <div id="sig-trade-card-${t.pair}" style="margin-bottom:.7rem;padding:.75rem .85rem;background:${cardBg};border:1px solid ${cardBorder};border-radius:14px;transition:border-color .3s">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem">
          <div style="display:flex;align-items:center;gap:.45rem">
            <div style="width:7px;height:7px;border-radius:50%;background:${dotColor};animation:fmb-blink 1.2s ease infinite"></div>
            <span style="font-size:.65rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${dotColor}">${t.pair}</span>
            <span style="font-size:.62rem;font-weight:800;padding:.1rem .38rem;border-radius:6px;background:${colBg};color:${col}">${t.direction}</span>
            ${levBadge}
          </div>
          <div style="display:flex;align-items:center;gap:.4rem">
            ${statusBadge}
            ${!isWaiting ? `<button onclick="openFuturesShareModal('${t.pair}')" style="background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.25);border-radius:6px;padding:.1rem .35rem;font-size:.56rem;color:#00e5ff;cursor:pointer;font-family:'Inter',sans-serif;font-weight:700">Share</button>` : ''}
            <button onclick="manualCloseTrade('${t.pair}')" style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:6px;padding:.1rem .35rem;font-size:.56rem;color:#f87171;cursor:pointer;font-family:'Inter',sans-serif;font-weight:700">${isWaiting ? 'Batal' : 'Tutup'}</button>
          </div>
        </div>

        ${isWaiting ? `
        <div style="background:rgba(${t.entryTypeRaw==='confirmation_limit'?'167,139,250':'245,158,11'},.08);border:1px solid rgba(${t.entryTypeRaw==='confirmation_limit'?'167,139,250':'245,158,11'},.15);border-radius:8px;padding:.4rem .6rem;margin-bottom:.5rem;display:flex;align-items:center;gap:.4rem">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${t.entryTypeRaw==='confirmation_limit'?'#a78bfa':'#f59e0b'}" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span style="font-size:.58rem;color:${t.entryTypeRaw==='confirmation_limit'?'#a78bfa':'#f59e0b'}">
            ${t.entryTypeRaw==='confirmation_limit'
              ? `Menunggu konfirmasi candle close di <strong>${fmt(t.limitPrice || t.entry)}</strong>`
              : `Menunggu harga retest <strong>${fmt(t.limitPrice || t.entry)}</strong>`}
            ${t.limitZoneText ? ` · ${t.limitZoneText}` : ''}
          </span>
        </div>` : ''}

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.4rem;text-align:center;margin-bottom:.5rem">
          <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:.4rem">
            <div style="font-size:.45rem;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:.12rem">${entryLabel}</div>
            <div style="font-size:.7rem;font-weight:800;font-family:'Space Mono',monospace;color:#f59e0b">${fmt(entryVal)}</div>
          </div>
          <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:.4rem">
            <div style="font-size:.45rem;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:.12rem">${isWaiting ? 'Harga Kini' : 'Harga Kini'}</div>
            <div class="sig-tc-current" style="font-size:.7rem;font-weight:800;font-family:'Space Mono',monospace;color:#f1f5f9">—</div>
          </div>
          <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:.4rem">
            <div style="font-size:.45rem;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:.12rem">${col3Label}</div>
            <div class="sig-tc-pnl" style="font-size:.7rem;font-weight:800;font-family:'Space Mono',monospace;color:#94a3b8">—</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-bottom:.45rem">
          <div style="background:rgba(239,68,68,.06);border-radius:8px;padding:.35rem .5rem;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.5rem;color:#ef4444;font-weight:700">SL</span>
            <span style="font-size:.62rem;font-weight:800;font-family:'Space Mono',monospace;color:#ef4444">${fmt(t.sl)}</span>
            <span style="font-size:.5rem;color:#64748b">${slPct}</span>
          </div>
          <div style="background:rgba(16,185,129,.06);border-radius:8px;padding:.35rem .5rem;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.5rem;color:#10b981;font-weight:700">TP</span>
            <span style="font-size:.62rem;font-weight:800;font-family:'Space Mono',monospace;color:#10b981">${fmt(t.tp)}</span>
            <span style="font-size:.5rem;color:#64748b">${tpPct}</span>
          </div>
        </div>

        <div>
          <div style="height:4px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden">
            <div class="sig-tc-bar" style="height:100%;width:${isWaiting ? '5' : '50'}%;border-radius:99px;transition:width .5s ease;background:${isWaiting ? 'linear-gradient(90deg,#334155,#f59e0b)' : 'linear-gradient(90deg,#ef4444,#f59e0b,#10b981)'}"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:.46rem;color:#64748b;margin-top:.2rem">
            <span>SL</span>
            <span class="sig-tc-tpct">${isWaiting ? 'Menunggu fill...' : '0%'}</span>
            <span>TP</span>
          </div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.65rem">
      <div style="width:7px;height:7px;border-radius:50%;background:${hdrColor};animation:fmb-blink 1s ease infinite"></div>
      <div style="font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${hdrColor}">${hdrLabel}</div>
    </div>
    ${cards}`;
}

function manualCloseTrade(pair) {
  if(!_sigActiveTrades[pair]) return;
  clearInterval(_sigActiveTrades[pair].intervalId);
  const t = _sigActiveTrades[pair].tradeData;
  delete _sigActiveTrades[pair];
  saveActiveTrades(); // update localStorage setelah manual close
  // Fetch current price and close
  fetchTicker24h(pair)
    .then(d=>{
      const price = parseFloat(d?.lastPrice || d?.price || t.entry);
      closeTrade(t, price, 'MANUAL');
    })
    .catch(()=>{ closeTrade(t, t.entry, 'MANUAL'); });
  renderActiveTrades();
  updateEntryBtnState();
}

function updateEntryBtnState() {
  const eb = document.getElementById('sig-entry-btn');
  if(!eb) return;
  const pair = _sigCurrentSignal?.pair;
  const hasActive = pair && _sigActiveTrades[pair];
  // Always allow entry — user can enter any pair
  eb.disabled = false;
  eb.style.opacity = '1';
  if(hasActive) {
    eb.textContent = '';
    eb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Re-Entry ' + pair;
  } else {
    eb.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg> Entry Posisi Sekarang';
  }
}

function closeTrade(tradeData, closePrice, result) {
  const lev = tradeData.leverage || 1;
  const rawPnl = tradeData.direction==='LONG'
    ?((closePrice-tradeData.entry)/tradeData.entry*100)
    :((tradeData.entry-closePrice)/tradeData.entry*100);
  const pnlPct = rawPnl * lev;

  // Simpan ke riwayat
  const tradeStartTime = tradeData.filledAt || tradeData.entryTime;
  const record = {
    id: Date.now(),
    pair: tradeData.pair,
    tf: tradeData.tf,
    direction: tradeData.direction,
    entry: tradeData.entry,
    exit: closePrice,
    sl: tradeData.sl,
    tp: tradeData.tp,
    result: result,
    pnlPct: pnlPct.toFixed(2),
    duration: Math.round((Date.now()-tradeStartTime)/60000),
    time: tradeData.entryTime,
    entryType: tradeData.entryType || 'market'
  };
  _sigHistory.unshift(record);
  if(_sigHistory.length > 50) _sigHistory.pop(); // max 50 riwayat
  localStorage.setItem('sig_history', JSON.stringify(_sigHistory));

  // Reset UI monitor
  // (Multi-trade: renderActiveTrades handles display)
  if(Object.keys(_sigActiveTrades).length === 0) {
    document.getElementById('sig-active-trade').style.display = 'none';
  }
  document.getElementById('sig-entry-btn').disabled = false;
  document.getElementById('sig-entry-btn').style.opacity = '1';

  // Update stats & history
  renderSigStats();
  renderSigHistory();

  // Notifikasi
  const icon = result==='TP'?'🎯':'🛑';
  toast(`${icon} ${result} HIT! ${tradeData.pair} ${tradeData.direction} — ${pnlPct>=0?'+':''}${pnlPct.toFixed(2)}%`);
  if(navigator.vibrate) navigator.vibrate(result==='TP'?[50,30,50,30,100]:[200]);
}

function clearSigHistory() {
  if(!confirm('Hapus semua riwayat signal?')) return;
  _sigHistory = [];
  localStorage.removeItem('sig_history');
  renderSigStats();
  renderSigHistory();
}

function renderSigStats() {
  const h = _sigHistory;
  const total = h.length;
  const tpHit = h.filter(x=>x.result==='TP').length;
  const slHit = h.filter(x=>x.result==='SL').length;
  const expired = h.filter(x=>x.result==='EXPIRED').length;
  const closed = tpHit + slHit; // hanya trade yang ditutup (exclude EXPIRED & MANUAL) untuk win rate
  const wr = closed>0?(tpHit/closed*100):0;

  document.getElementById('sig-stat-total').textContent = total;
  document.getElementById('sig-stat-tp').textContent    = tpHit;
  document.getElementById('sig-stat-sl').textContent    = slHit;
  document.getElementById('sig-stat-wr').textContent    = closed>0?wr.toFixed(1)+'%':'—%';
  document.getElementById('sig-wr-bar').style.width     = wr+'%';
  document.getElementById('sig-stats-total').textContent= total+' trade';
  document.getElementById('sig-wr-label').textContent   = total===0
    ?'Belum ada data riwayat'
    :`${tpHit} TP · ${slHit} SL${expired>0?' · '+expired+' Expired':''} · Win Rate ${closed>0?wr.toFixed(1)+'%':'—'}`;
  document.getElementById('sig-wr-bar').style.background =
    wr>=60?'linear-gradient(90deg,#10b981,#34d399)':
    wr>=45?'linear-gradient(90deg,#f59e0b,#10b981)':
           'linear-gradient(90deg,#ef4444,#f59e0b)';
}

function renderSigHistory() {
  const list = document.getElementById('sig-history-list');
  if (_sigHistory.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:1.2rem;color:#64748b;font-size:.75rem">Belum ada riwayat. Tekan Entry untuk mulai tracking.</div>';
    return;
  }
  // Store records in window map so share buttons can access them without nested backtick issues
  window._sigShareMap = {};
  const rows = _sigHistory.slice(0, 20).map((r, i) => {
    window._sigShareMap[i] = r;
    const isTP      = r.result === 'TP';
    const isExpired = r.result === 'EXPIRED';
    const isManual  = r.result === 'MANUAL';
    const pnl = parseFloat(r.pnlPct);
    const d = new Date(r.time);
    const dateStr = d.getDate()+'/'+(d.getMonth()+1)+' '+d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
    const icon    = isTP ? '🎯' : isExpired ? '⏰' : isManual ? '✋' : '🛑';
    const bgColor = isTP ? 'rgba(16,185,129,.06)' : isExpired ? 'rgba(100,116,139,.06)' : isManual ? 'rgba(139,92,246,.06)' : 'rgba(239,68,68,.06)';
    const bdColor = isTP ? 'rgba(16,185,129,.15)' : isExpired ? 'rgba(100,116,139,.15)' : isManual ? 'rgba(139,92,246,.15)' : 'rgba(239,68,68,.12)';
    const resColor = isTP ? '#10b981' : isExpired ? '#64748b' : isManual ? '#a78bfa' : '#ef4444';
    const pnlColor = isExpired ? '#64748b' : pnl >= 0 ? '#10b981' : '#ef4444';
    const pnlText  = isExpired ? '—' : (pnl >= 0 ? '+' : '') + r.pnlPct + '%';
    const entryTypeLabel = r.entryType === 'limit' ? ' · LIMIT' : '';
    const shareBtn = !isExpired
      ? '<button onclick="openSigHistShare('+i+')" style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(148,163,184,.7);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .18s" title="Bagikan"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>'
      : '';
    return '<div style="display:flex;align-items:center;gap:.7rem;padding:.65rem .8rem;background:'+bgColor+';border:1px solid '+bdColor+';border-radius:12px;margin-bottom:.4rem">'
      + '<div style="width:30px;height:30px;border-radius:8px;flex-shrink:0;background:'+bgColor+';display:flex;align-items:center;justify-content:center;font-size:.9rem">'+icon+'</div>'
      + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.15rem;flex-wrap:wrap">'
          + '<span style="font-size:.7rem;font-weight:800;color:#f1f5f9">'+r.pair.replace('USDT','')+'</span>'
          + '<span style="font-size:.52rem;font-weight:700;padding:.04rem .3rem;border-radius:4px;background:'+(r.direction==='LONG'?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)')+';color:'+(r.direction==='LONG'?'#10b981':'#ef4444')+'">'+r.direction+'</span>'
          + '<span style="font-size:.52rem;color:#475569">'+(r.tf||'—').toUpperCase()+entryTypeLabel+'</span>'
        + '</div>'
        + '<div style="font-size:.58rem;color:#64748b">'+dateStr+' · '+(r.duration||0)+'m</div>'
      + '</div>'
      + '<div style="text-align:right;flex-shrink:0;display:flex;align-items:center;gap:.5rem">'
        + '<div>'
          + '<div style="font-size:.78rem;font-weight:800;font-family:\'Space Mono\',monospace;color:'+pnlColor+'">'+pnlText+'</div>'
          + '<div style="font-size:.58rem;font-weight:700;color:'+resColor+'">'+r.result+'</div>'
        + '</div>'
        + shareBtn
      + '</div>'
      + '</div>';
  });
  list.innerHTML = rows.join('');
}

// ── SIGNAL HISTORY SHARE CARD ──
function openSigHistShare(idx) {
  const r = (window._sigShareMap && window._sigShareMap[idx]) || _sigHistory[idx];
  if (!r) { toast('Data tidak ditemukan'); return; }
  const modal = document.getElementById('modal-sighist-share');
  modal.style.display = 'flex';
  requestAnimationFrame(() => drawSigHistCard(r));
}
function closeSigHistShare() {
  document.getElementById('modal-sighist-share').style.display = 'none';
}
function downloadSigHistCard() {
  const canvas = document.getElementById('sighist-canvas');
  const link = document.createElement('a');
  link.download = 'z-wealth-SIGNAL-' + Date.now() + '.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.96);
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  toast('Kartu signal berhasil disimpan 🎯');
}

function drawSigHistCard(r) {
  const canvas = document.getElementById('sighist-canvas');
  const W = 1080, H = 1350;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const pnl = parseFloat(r.pnlPct) || 0;
  const isProfit = pnl >= 0;
  const isLong = r.direction === 'LONG';
  const isTP = r.result === 'TP';
  const isSL = r.result === 'SL';
  const isManual = r.result === 'MANUAL';
  const lev = r.leverage || 1;

  // Colors
  const GREEN = '#00f5a0'; const RED = '#ff4d6d';
  const CYAN = '#00d4ff'; const PURPLE = '#a855f7'; const GOLD = '#f59e0b';
  const accentColor = isProfit ? GREEN : RED;
  const accentR = isProfit ? '0,245,160' : '255,77,109';
  const dirColor = isLong ? GREEN : RED;
  const resColor = isTP ? GREEN : isSL ? RED : isManual ? '#a78bfa' : '#64748b';
  const PAD = 72;
  function ac(a){ return `rgba(${accentR},${a})`; }
  function rr(x,y,w,h,rad){
    if(w<=0||h<=0) return; rad=Math.min(rad,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+rad,y); ctx.lineTo(x+w-rad,y); ctx.quadraticCurveTo(x+w,y,x+w,y+rad);
    ctx.lineTo(x+w,y+h-rad); ctx.quadraticCurveTo(x+w,y+h,x+w-rad,y+h);
    ctx.lineTo(x+rad,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-rad);
    ctx.lineTo(x,y+rad); ctx.quadraticCurveTo(x,y,x+rad,y);
    ctx.closePath();
  }

  // ── BACKGROUND ──
  const bgG = ctx.createLinearGradient(0,0,0,H);
  if(isProfit){ bgG.addColorStop(0,'#060d10'); bgG.addColorStop(1,'#040810'); }
  else         { bgG.addColorStop(0,'#0d0608'); bgG.addColorStop(1,'#080410'); }
  ctx.fillStyle=bgG; ctx.fillRect(0,0,W,H);

  // Grid
  ctx.save(); ctx.strokeStyle=ac(0.03); ctx.lineWidth=1;
  for(let x=0;x<=W;x+=60){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<=H;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  ctx.restore();

  // Glow blobs
  if(isProfit){
    [[W*.9,H*.08,W*.6,'rgba(0,245,160,0.13)'],[W*.05,H*.85,W*.55,'rgba(168,85,247,0.1)'],[W*.5,H*.0,W*.45,'rgba(0,212,255,0.07)']].forEach(([gx,gy,gr,gc])=>{
      const g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr); g.addColorStop(0,gc); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    });
  } else {
    [[W*.85,H*.12,W*.6,'rgba(255,77,109,0.14)'],[W*.05,H*.88,W*.5,'rgba(120,20,50,0.1)']].forEach(([gx,gy,gr,gc])=>{
      const g=ctx.createRadialGradient(gx,gy,0,gx,gy,gr); g.addColorStop(0,gc); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    });
  }

  // Top rainbow bar
  const tl=ctx.createLinearGradient(0,0,W,0);
  if(isProfit){ tl.addColorStop(0,'transparent'); tl.addColorStop(.15,GREEN); tl.addColorStop(.5,CYAN); tl.addColorStop(.8,PURPLE); tl.addColorStop(1,'transparent'); }
  else         { tl.addColorStop(0,'transparent'); tl.addColorStop(.3,RED); tl.addColorStop(.7,'rgba(200,30,60,.6)'); tl.addColorStop(1,'transparent'); }
  ctx.fillStyle=tl; ctx.fillRect(0,0,W,5);

  // ── DECORATIVE: mini candlestick chart BG ──
  ctx.save();
  const cdata = isProfit ? [.2,.35,.25,.5,.4,.6,.55,.75,.65,.85,.8,1,.9] : [1,.85,.9,.7,.8,.6,.65,.45,.5,.35,.4,.2,.1];
  const chartX=W-390, chartY=175, chartW2=350, chartH2=260;
  const cww=chartW2/cdata.length;
  ctx.globalAlpha=0.10;
  cdata.forEach((v,i)=>{
    const prev=i>0?cdata[i-1]:v, isBull=v>=prev;
    const cx2=chartX+i*cww+cww*.15, bodyH=Math.max(Math.abs(v-prev)*chartH2,8);
    const bodyY2=chartY+(1-Math.max(v,prev))*chartH2;
    ctx.strokeStyle=isBull?GREEN:RED; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(cx2+cww*.35,chartY+(1-v)*chartH2-12); ctx.lineTo(cx2+cww*.35,chartY+(1-v)*chartH2+bodyH+12); ctx.stroke();
    ctx.fillStyle=isBull?GREEN:RED; rr(cx2,bodyY2,cww*.7,bodyH,3); ctx.fill();
  });
  ctx.globalAlpha=0.18; ctx.strokeStyle=accentColor; ctx.lineWidth=3;
  ctx.beginPath();
  cdata.forEach((v,i)=>{ const px=chartX+i*cww+cww*.5, py=chartY+(1-v)*chartH2; i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
  ctx.stroke();
  ctx.restore();

  // ── LOGO ──
  drawZWealthLogo(ctx, PAD, 110, 50, accentColor);
  ctx.font='400 20px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.4)';
  ctx.fillText('z-wealth.vercel.app', PAD, 142);
  const d2=new Date(r.time);
  const dtStr=d2.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+d2.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  ctx.textAlign='right'; ctx.font='400 24px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.5)';
  ctx.fillText(dtStr,W-PAD,110); ctx.textAlign='left';

  // Sep line
  const sl2=ctx.createLinearGradient(PAD,165,W-PAD,165);
  if(isProfit){ sl2.addColorStop(0,'transparent'); sl2.addColorStop(.1,ac(.7)); sl2.addColorStop(.5,`rgba(0,212,255,.35)`); sl2.addColorStop(1,'transparent'); }
  else         { sl2.addColorStop(0,ac(.7)); sl2.addColorStop(.7,ac(.1)); sl2.addColorStop(1,'transparent'); }
  ctx.strokeStyle=sl2; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(PAD,165); ctx.lineTo(W-PAD,165); ctx.stroke();

  // ── PAIR + BADGES ──
  const pairLabel2 = r.pair.replace('USDT','/USDT');
  ctx.font='900 80px "Segoe UI Black",Arial,sans-serif'; ctx.fillStyle='#ffffff';
  ctx.fillText(pairLabel2, PAD, 268);
  const pw2=ctx.measureText(pairLabel2).width;
  function badge2(text,x,y,bh,bg,border,tc){
    ctx.font='800 27px "Segoe UI",Arial,sans-serif';
    const bw2=ctx.measureText(text).width+44;
    ctx.fillStyle=bg; rr(x,y,bw2,bh,bh/2); ctx.fill();
    ctx.strokeStyle=border; ctx.lineWidth=1.5; rr(x,y,bw2,bh,bh/2); ctx.stroke();
    ctx.fillStyle=tc; ctx.fillText(text,x+bw2/2-ctx.measureText(text).width/2,y+bh*.68);
    return bw2;
  }
  const badgeY2=268-60, bh2=52;
  let bx2=PAD+pw2+28;
  const dirR2=isLong?'0,245,160':'255,77,109';
  bx2 += badge2(isLong?'▲ LONG':'▼ SHORT', bx2, badgeY2, bh2, `rgba(${dirR2},.18)`, `rgba(${dirR2},.65)`, dirColor)+14;
  const tfMap={'1m':'1M','5m':'5M','15m':'15M','1h':'1H','4h':'4H','1d':'1D'};
  bx2 += badge2(tfMap[r.tf]||r.tf?.toUpperCase()||'—', bx2, badgeY2, bh2, 'rgba(255,255,255,.06)', 'rgba(255,255,255,.18)', 'rgba(248,250,252,.75)')+14;
  if(lev>1){
    const levCol=lev>=50?RED:lev>=20?'#ff9500':'#ffcc00';
    ctx.shadowColor=levCol; ctx.shadowBlur=10;
    badge2(lev+'x', bx2, badgeY2, bh2, lev>=20?'rgba(255,70,0,.14)':'rgba(255,200,0,.11)', levCol, levCol);
    ctx.shadowBlur=0;
  }

  // ── PnL SECTION ──
  ctx.font='500 30px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.7)';
  ctx.fillText(lev>1?`PnL  ×${lev} Leverage`:'PnL Realized', PAD, 330);

  const pnlDisplay=(pnl>=0?'+':'')+pnl.toFixed(2)+'%';
  let pfs=155;
  ctx.font=`900 ${pfs}px "Segoe UI Black",Arial,sans-serif`;
  while(ctx.measureText(pnlDisplay).width>W-PAD*2-20 && pfs>80){ pfs-=6; ctx.font=`900 ${pfs}px "Segoe UI Black",Arial,sans-serif`; }
  ctx.shadowColor=accentColor; ctx.shadowBlur=80; ctx.fillStyle=accentColor;
  ctx.fillText(pnlDisplay,PAD,510); ctx.shadowBlur=35; ctx.fillText(pnlDisplay,PAD,510); ctx.shadowBlur=0;

  // Sep line 2
  const sl3=ctx.createLinearGradient(PAD,565,W-PAD,565);
  sl3.addColorStop(0,ac(.5)); sl3.addColorStop(.6,ac(.1)); sl3.addColorStop(1,'transparent');
  ctx.strokeStyle=sl3; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(PAD,565); ctx.lineTo(W-PAD,565); ctx.stroke();

  // ── STAT CARDS 2x2 ──
  const CW=(W-PAD*2-18)/2, CH=155, CG=18;
  const CY1=605, CY2=CY1+CH+CG;
  function sCard(label,value,cx,cy,vc){
    ctx.save();
    const bg=ctx.createLinearGradient(cx,cy,cx+CW,cy+CH);
    bg.addColorStop(0,'rgba(255,255,255,.065)'); bg.addColorStop(1,'rgba(255,255,255,.02)');
    ctx.fillStyle=bg; rr(cx,cy,CW,CH,20); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.09)'; ctx.lineWidth=1; rr(cx,cy,CW,CH,20); ctx.stroke();
    const sh=ctx.createLinearGradient(cx+20,cy,cx+CW-20,cy);
    sh.addColorStop(0,'transparent'); sh.addColorStop(.4,'rgba(255,255,255,.2)'); sh.addColorStop(1,'transparent');
    ctx.strokeStyle=sh; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(cx+20,cy+1); ctx.lineTo(cx+CW-20,cy+1); ctx.stroke();
    ctx.fillStyle=vc+'33'; ctx.fillRect(cx+20,cy+CH-4,CW-40,3);
    ctx.font='500 22px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.6)'; ctx.fillText(label,cx+26,cy+44);
    ctx.font='800 48px "Segoe UI Black",Arial,sans-serif';
    let fz=48; while(ctx.measureText(value).width>CW-44&&fz>24){fz-=4;ctx.font=`800 ${fz}px "Segoe UI Black",Arial,sans-serif`;}
    ctx.fillStyle=vc; ctx.shadowColor=vc; ctx.shadowBlur=12; ctx.fillText(value,cx+26,cy+116); ctx.shadowBlur=0;
    ctx.restore();
  }
  const eStr='$'+Number(r.entry||0).toLocaleString('en-US');
  const cStr=r.closePrice?'$'+Number(r.closePrice).toLocaleString('en-US'):'$'+Number(r.currentPrice||0).toLocaleString('en-US');
  const slStr='$'+Number(r.sl||0).toLocaleString('en-US');
  const tpStr='$'+Number(r.tp||0).toLocaleString('en-US');
  sCard('Harga Entry',eStr,PAD,CY1,'#e2e8f0');
  sCard('Harga Close',cStr,PAD+CW+CG,CY1,isProfit?GREEN:RED);
  sCard('Stop Loss',slStr,PAD,CY2,RED);
  sCard('Take Profit',tpStr,PAD+CW+CG,CY2,GREEN);

  // ── RESULT BANNER ──
  const RY=CY2+CH+46, RH=148, RW=W-PAD*2;
  const rbg=ctx.createLinearGradient(PAD,RY,PAD+RW,RY);
  rbg.addColorStop(0,isTP?'rgba(0,245,160,.12)':isSL?'rgba(255,77,109,.12)':'rgba(168,85,247,.1)');
  rbg.addColorStop(1,'rgba(120,40,255,.04)');
  ctx.fillStyle=rbg; rr(PAD,RY,RW,RH,20); ctx.fill();
  ctx.strokeStyle=isTP?'rgba(0,245,160,.3)':isSL?'rgba(255,77,109,.3)':'rgba(168,85,247,.3)'; ctx.lineWidth=1;
  rr(PAD,RY,RW,RH,20); ctx.stroke();

  // Result icon + text
  const icons={'TP':'🎯','SL':'🛑','MANUAL':'✋','EXPIRED':'⏰'};
  const rcy=RY+RH/2;
  ctx.font='44px serif'; ctx.fillText(icons[r.result]||'📊',PAD+18,rcy+16);
  ctx.font='800 36px "Segoe UI",Arial,sans-serif'; ctx.fillStyle=resColor;
  const resLabel=isTP?'TAKE PROFIT HIT! 🎯':isSL?'STOP LOSS HIT':isManual?'DITUTUP MANUAL':'EXPIRED';
  ctx.fillText(resLabel,PAD+78,rcy-10);
  ctx.font='400 24px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.7)';
  const durStr2=r.duration<60?r.duration+' menit':Math.floor(r.duration/60)+' jam '+(r.duration%60)+' menit';
  ctx.fillText('Durasi: '+durStr2+(lev>1?' · Leverage '+lev+'x':''),PAD+78,rcy+28);

  // Bottom
  const BOT=H-72;
  const bln2=ctx.createLinearGradient(PAD,BOT,W-PAD,BOT);
  bln2.addColorStop(0,'transparent'); bln2.addColorStop(.3,ac(.22)); bln2.addColorStop(.7,'rgba(120,40,255,.22)'); bln2.addColorStop(1,'transparent');
  ctx.strokeStyle=bln2; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(PAD,BOT); ctx.lineTo(W-PAD,BOT); ctx.stroke();
  ctx.textAlign='center'; ctx.font='400 20px "Segoe UI",Arial,sans-serif'; ctx.fillStyle='rgba(148,163,184,.2)';
  ctx.fillText('Not financial advice',W/2,BOT+38); ctx.textAlign='left';
}

// ── RENDER CANDLESTICK CHART ──
function renderSigChart(candles, entry, sl, tp, direction) {
  const empty = document.getElementById('sig-chart-empty');
  if(empty) empty.style.display='none';
  const canvas = document.getElementById('sig-canvas');
  const dpr = window.devicePixelRatio||1;
  const W = canvas.offsetWidth; const H = 240;
  canvas.width=W*dpr; canvas.height=H*dpr;

  const display = candles.slice(-60);
  const prices  = display.flatMap(c=>[c.h,c.l]);
  if(entry) prices.push(entry);
  if(sl) prices.push(sl);
  if(tp) prices.push(tp);
  const minP=Math.min(...prices.filter(p=>p&&!isNaN(p)))*.9998;
  const maxP=Math.max(...prices.filter(p=>p&&!isNaN(p)))*1.0002;
  const range=maxP-minP||1;
  const pad={t:20,b:28,l:4,r:62};
  const cW=(W-pad.l-pad.r)/display.length, cPad=cW*.15;
  const toY=p=>pad.t+((maxP-p)/range)*(H-pad.t-pad.b);

  // Clone canvas to remove old event listeners
  const nc = canvas.cloneNode(false);
  nc.id='sig-canvas'; nc.style.cssText=canvas.style.cssText;
  nc.width=W*dpr; nc.height=H*dpr;
  canvas.parentNode.replaceChild(nc, canvas);
  const c2 = nc.getContext('2d');
  c2.scale(dpr,dpr);

  function draw2(crossIdx) {
    c2.clearRect(0,0,W,H);
    // Grid
    for(let i=0;i<=5;i++){
      const y=pad.t+(i/5)*(H-pad.t-pad.b), p=maxP-(i/5)*range;
      c2.strokeStyle='rgba(255,255,255,0.04)'; c2.lineWidth=1;
      c2.beginPath(); c2.moveTo(pad.l,y); c2.lineTo(W-pad.r,y); c2.stroke();
      c2.fillStyle='rgba(100,116,139,.55)'; c2.font='8px Inter'; c2.textAlign='left';
      c2.fillText('$'+Math.round(p).toLocaleString(),W-pad.r+3,y+3);
    }
    // Zone shading & lines
    if(entry&&sl&&tp){
      const tpY=toY(tp),slY=toY(sl),entryY=toY(entry);
      const zTop=direction==='LONG'?tpY:entryY, zBot=direction==='LONG'?entryY:slY;
      const grad=c2.createLinearGradient(0,zTop,0,zBot);
      if(direction==='LONG'){grad.addColorStop(0,'rgba(16,185,129,.14)');grad.addColorStop(1,'rgba(16,185,129,.02)');}
      else{grad.addColorStop(0,'rgba(239,68,68,.02)');grad.addColorStop(1,'rgba(239,68,68,.14)');}
      c2.fillStyle=grad; c2.fillRect(pad.l,zTop,W-pad.l-pad.r,zBot-zTop);
      const dL=(y,col,dash,lbl)=>{c2.strokeStyle=col;c2.lineWidth=1.5;c2.setLineDash(dash);c2.beginPath();c2.moveTo(pad.l,y);c2.lineTo(W-pad.r,y);c2.stroke();c2.fillStyle=col;c2.font='bold 8px Inter';c2.textAlign='left';c2.fillText(lbl,W-pad.r+3,y+3);c2.setLineDash([]);};
      dL(toY(sl),'rgba(239,68,68,.8)',[4,3],'SL');
      dL(toY(tp),'rgba(16,185,129,.8)',[4,3],'TP');
      dL(toY(entry),'rgba(245,158,11,.95)',[6,2],'ENTRY');
    }
    // Candles
    display.forEach((c,i)=>{
      const x=pad.l+i*cW+cPad/2, bW=cW-cPad;
      const oY=toY(c.o), cY=toY(c.c), hY=toY(c.h), lY=toY(c.l), bull=c.c>=c.o;
      if(i===crossIdx){c2.fillStyle='rgba(255,255,255,.06)';c2.fillRect(x-cPad/2,pad.t,bW+cPad,H-pad.t-pad.b);}
      c2.strokeStyle=bull?'#10b981':'#ef4444'; c2.fillStyle=bull?'rgba(16,185,129,.82)':'rgba(239,68,68,.82)'; c2.lineWidth=1;
      c2.beginPath(); c2.moveTo(x+bW/2,hY); c2.lineTo(x+bW/2,lY); c2.stroke();
      const bt=Math.min(oY,cY), bh=Math.max(1,Math.abs(cY-oY));
      c2.fillRect(x,bt,bW,bh); c2.strokeRect(x,bt,bW,bh);
    });
    // Time labels
    c2.fillStyle='rgba(100,116,139,.45)'; c2.font='7px Inter'; c2.textAlign='center';
    [0,Math.floor(display.length*.25),Math.floor(display.length*.5),Math.floor(display.length*.75),display.length-1].forEach(i=>{
      if(display[i]){const d=new Date(display[i].t);c2.fillText(`${d.getDate()}/${d.getMonth()+1}`,pad.l+i*cW+cW/2,H-6);}
    });
    // Crosshair
    if(crossIdx>=0 && display[crossIdx]){
      const cv=display[crossIdx], cx=pad.l+crossIdx*cW+cW/2, cy=toY(cv.c), bull=cv.c>=cv.o;
      c2.strokeStyle='rgba(255,255,255,.22)'; c2.lineWidth=1; c2.setLineDash([3,3]);
      c2.beginPath(); c2.moveTo(cx,pad.t); c2.lineTo(cx,H-pad.b); c2.stroke();
      c2.beginPath(); c2.moveTo(pad.l,cy); c2.lineTo(W-pad.r,cy); c2.stroke();
      c2.setLineDash([]);
      // Price badge
      const lblY=Math.max(pad.t+8,Math.min(H-pad.b-4,cy));
      c2.fillStyle=bull?'#059669':'#dc2626';
      c2.beginPath();
      if(c2.roundRect){c2.roundRect(W-pad.r+1,lblY-8,pad.r-2,14,3);}else{c2.rect(W-pad.r+1,lblY-8,pad.r-2,14);}
      c2.fill();
      c2.fillStyle='#fff'; c2.font='bold 7.5px Inter'; c2.textAlign='left';
      c2.fillText('$'+Math.round(cv.c).toLocaleString(),W-pad.r+3,lblY+3);
      // OHLC tooltip
      const d=new Date(cv.t);
      const ds=`${d.getDate()}/${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const pct=((cv.c-cv.o)/cv.o*100);
      const lines=[ds,`O  $${Math.round(cv.o).toLocaleString()}`,`H  $${Math.round(cv.h).toLocaleString()}`,`L  $${Math.round(cv.l).toLocaleString()}`,`C  $${Math.round(cv.c).toLocaleString()}`,`${pct>=0?'+':''}${pct.toFixed(2)}%`];
      const bxW=92, lnH=12, bxH=lines.length*lnH+10;
      let bxX=cx+10; if(bxX+bxW>W-pad.r-2) bxX=cx-bxW-10;
      const bxY=Math.max(pad.t,Math.min(H-pad.b-bxH,cy-bxH/2));
      c2.fillStyle='rgba(10,18,35,.93)'; c2.strokeStyle=bull?'rgba(16,185,129,.45)':'rgba(239,68,68,.45)'; c2.lineWidth=1;
      c2.beginPath();
      if(c2.roundRect){c2.roundRect(bxX,bxY,bxW,bxH,6);}else{c2.rect(bxX,bxY,bxW,bxH);}
      c2.fill(); c2.stroke();
      lines.forEach((ln,i)=>{
        c2.fillStyle=i===0?'#64748b':i===5?(pct>=0?'#10b981':'#ef4444'):i===1?'#94a3b8':'#e2e8f0';
        c2.font=(i===0?'7':'bold 8')+'px Inter'; c2.textAlign='left';
        c2.fillText(ln,bxX+6,bxY+8+i*lnH+7);
      });
    }
  }

  draw2(-1);

  function getIdx(xPx){return Math.max(0,Math.min(display.length-1,Math.floor((xPx-pad.l)/cW)));}
  function onMove(xPx){xPx<pad.l||xPx>W-pad.r ? draw2(-1) : draw2(getIdx(xPx));}
  nc.addEventListener('mousemove',e=>{const r=nc.getBoundingClientRect();onMove((e.clientX-r.left)*(W/r.width));});
  nc.addEventListener('mouseleave',()=>draw2(-1));
  nc.addEventListener('touchstart',e=>{e.preventDefault();const r=nc.getBoundingClientRect();onMove((e.touches[0].clientX-r.left)*(W/r.width));},{passive:false});
  nc.addEventListener('touchmove',e=>{e.preventDefault();const r=nc.getBoundingClientRect();onMove((e.touches[0].clientX-r.left)*(W/r.width));},{passive:false});
  nc.addEventListener('touchend',()=>draw2(-1));
}

// Init: load history on page show
(function initSigPage(){
  renderSigStats();
  renderSigHistory();
})();


// ── LIQUIDATION HEATMAP MODAL ──
// ══════════════════════════════════════════════════════
//  LIQUIDATION HEATMAP — Chart berbasis API data
//  Mirip dengan Fear & Greed: ambil data, render di canvas
// ══════════════════════════════════════════════════════

let _liqData = null;
let _liqTF = '1h';
let _liqChart = null;

function openLiqHeatmap() {
  let modal = document.getElementById('liq-heatmap-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'liq-heatmap-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000;flex-direction:column;overflow:hidden;background:#05080f;max-height:100dvh;max-height:100vh';

    const style = document.createElement('style');
    style.textContent = `
      .liq-tf-btn {
        padding:.38rem .7rem;border-radius:100px;border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.05);color:rgba(148,163,184,.7);
        font-size:.72rem;font-weight:700;cursor:pointer;transition:all .18s;
        white-space:nowrap;font-family:'Inter',sans-serif;
        min-width:52px;text-align:center;flex-shrink:0;
        line-height:1.2;letter-spacing:.01em;
      }
      .liq-tf-btn:hover{border-color:rgba(239,68,68,.4);color:#f87171;}
      .liq-tf-active{background:linear-gradient(135deg,rgba(239,68,68,.45),rgba(249,115,22,.4))!important;border-color:rgba(239,68,68,.55)!important;color:#fff!important;}
      #liq-heatmap-modal{animation:fadeIn .2s ease;}
      #liq-chart-canvas{display:block;width:100%;height:100%;}
      .liq-price-row{display:grid;grid-template-columns:repeat(4,1fr);align-items:center;padding:.35rem .5rem;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;gap:.2rem}
      .liq-stat-box{text-align:center;padding:.3rem .2rem}
      .liq-stat-val{font-size:.85rem;font-weight:800;font-family:'Space Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .liq-stat-lbl{font-size:.55rem;color:rgba(148,163,184,.6);margin-top:.1rem;text-transform:uppercase;letter-spacing:.05em}
    `;
    document.head.appendChild(style);

    modal.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.8rem 1rem .6rem;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0">
        <div style="display:flex;align-items:center;gap:.65rem">
          <div style="width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,rgba(239,68,68,.65),rgba(249,115,22,.55));display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.15)">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6 8h2v5H6zM11 6h2v7h-2zM16 9h2v4h-2z"/></svg>
          </div>
          <div>
            <div style="font-size:.9rem;font-weight:800;color:#f1f5f9">Liquidation Heatmap</div>
            <div style="font-size:.62rem;color:rgba(148,163,184,.6)">BTC · Data zona likuidasi futures</div>
          </div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button onclick="loadLiqData()" title="Refresh" style="width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(148,163,184,.8);cursor:pointer;display:flex;align-items:center;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button onclick="closeLiqHeatmap()" style="width:30px;height:30px;border-radius:9px;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);color:#f87171;cursor:pointer;display:flex;align-items:center;justify-content:center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Timeframe -->
      <div style="display:flex;gap:.4rem;padding:.55rem 1rem;border-bottom:1px solid rgba(255,255,255,.05);flex-shrink:0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;align-items:center">
        <button class="liq-tf-btn liq-tf-active" onclick="setLiqTF(this,'1h')">1 Jam</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'4h')">4 Jam</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'12h')">12 Jam</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'1d')">1 Hari</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'3d')">3 Hari</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'7d')">7 Hari</button>
        <button class="liq-tf-btn" onclick="setLiqTF(this,'30d')">30 Hari</button>
      </div>

      <!-- Live stats row -->
      <div id="liq-stats-row" class="liq-price-row" style="display:none">
        <div class="liq-stat-box">
          <div class="liq-stat-val" id="liq-price-val" style="color:#00e5ff">$—</div>
          <div class="liq-stat-lbl">Harga BTC</div>
        </div>
        <div class="liq-stat-box">
          <div class="liq-stat-val" id="liq-long-val" style="color:#10b981">—</div>
          <div class="liq-stat-lbl">Long Liq 24h</div>
        </div>
        <div class="liq-stat-box">
          <div class="liq-stat-val" id="liq-short-val" style="color:#ef4444">—</div>
          <div class="liq-stat-lbl">Short Liq 24h</div>
        </div>
        <div class="liq-stat-box">
          <div class="liq-stat-val" id="liq-oi-val" style="color:#f59e0b">—</div>
          <div class="liq-stat-lbl">Open Interest</div>
        </div>
      </div>

      <!-- Chart area -->
      <div id="liq-chart-wrap" style="flex:1;position:relative;overflow:hidden;padding:.5rem .75rem .4rem;min-height:0">
        <!-- Loading -->
        <div id="liq-loading" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.8rem;z-index:5">
          <div style="width:40px;height:40px;border:3px solid rgba(239,68,68,.2);border-top-color:#ef4444;border-radius:50%;animation:spin .8s linear infinite"></div>
          <div style="font-size:.8rem;color:rgba(148,163,184,.7)">Mengambil data likuidasi...</div>
        </div>
        <!-- Error state -->
        <div id="liq-error" style="display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:.75rem;padding:1.5rem;text-align:center">
          <div style="font-size:2rem">⚠️</div>
          <div style="font-size:.88rem;font-weight:700;color:#f1f5f9">Gagal Memuat Data</div>
          <div id="liq-error-msg" style="font-size:.75rem;color:rgba(148,163,184,.6);line-height:1.5"></div>
          <button onclick="loadLiqData()" style="margin-top:.3rem;padding:.5rem 1.2rem;background:linear-gradient(135deg,rgba(239,68,68,.5),rgba(249,115,22,.4));border:1px solid rgba(239,68,68,.4);border-radius:10px;color:#fff;font-size:.8rem;font-weight:700;cursor:pointer">Coba Lagi</button>
          <div style="margin-top:.5rem;padding:.8rem 1rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;width:100%;max-width:280px">
            <div style="font-size:.7rem;color:rgba(148,163,184,.7);margin-bottom:.5rem">Lihat langsung di:</div>
            <a href="https://www.coinglass.com/pro/futures/LiquidationHeatMap" target="_blank" style="display:block;padding:.4rem;color:#00e5ff;font-size:.75rem;font-weight:700;text-decoration:none">→ Coinglass Heatmap</a>
            <a href="https://www.coinglass.com/LiquidationData" target="_blank" style="display:block;padding:.4rem;color:#a78bfa;font-size:.75rem;font-weight:700;text-decoration:none">→ Coinglass Liquidation Data</a>
          </div>
        </div>
        <!-- Canvas chart -->
        <canvas id="liq-chart-canvas" style="width:100%;height:100%;display:none"></canvas>
      </div>

      <!-- Legend & footer -->
      <div style="padding:.45rem 1rem;border-top:1px solid rgba(255,255,255,.05);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:.5rem">
        <div style="display:flex;align-items:center;gap:.75rem">
          <div style="display:flex;align-items:center;gap:.3rem"><div style="width:10px;height:10px;border-radius:2px;background:linear-gradient(90deg,#ef4444,#f97316)"></div><span style="font-size:.6rem;color:rgba(148,163,184,.6)">Zona Long (banyak likuidasi)</span></div>
          <div style="display:flex;align-items:center;gap:.3rem"><div style="width:10px;height:10px;border-radius:2px;background:linear-gradient(90deg,#3b82f6,#06b6d4)"></div><span style="font-size:.6rem;color:rgba(148,163,184,.6)">Zona Short</span></div>
        </div>
        <div style="font-size:.58rem;color:rgba(100,116,139,.5)">via Coinglass API</div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  loadLiqData();
}

function closeLiqHeatmap() {
  const modal = document.getElementById('liq-heatmap-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function setLiqTF(btn, tf) {
  _liqTF = tf;
  document.querySelectorAll('.liq-tf-btn').forEach(b => b.classList.remove('liq-tf-active'));
  btn.classList.add('liq-tf-active');
  loadLiqData();
}

async function loadLiqData() {
  const loading = document.getElementById('liq-loading');
  const errEl = document.getElementById('liq-error');
  const canvas = document.getElementById('liq-chart-canvas');
  const statsRow = document.getElementById('liq-stats-row');

  if (loading) loading.style.display = 'flex';
  if (errEl) errEl.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  if (statsRow) statsRow.style.display = 'none';

  try {
    // ── Map timeframe ke Binance klines interval & limit
    const tfMap = {
      '1h':  { interval: '1m',  limit: 60 },
      '4h':  { interval: '5m',  limit: 48 },
      '12h': { interval: '15m', limit: 48 },
      '1d':  { interval: '30m', limit: 48 },
      '3d':  { interval: '2h',  limit: 36 },
      '7d':  { interval: '4h',  limit: 42 },
      '30d': { interval: '1d',  limit: 30 },
    };
    const tf = tfMap[_liqTF] || tfMap['1d'];

    // ── Ambil data paralel: harga BTC + klines + OI (Bybit/OKX → Binance proxy)
    const [tickerData, klines] = await Promise.all([
      fetchTicker24h('BTCUSDT').catch(()=>null),
      fetchKlines('BTCUSDT', tf.interval, tf.limit),
    ]);

    let btcPrice = 0, btcChange = 0, openInterest = 0;

    if (tickerData) {
      btcPrice = parseFloat(tickerData.lastPrice) || 0;
      btcChange = parseFloat(tickerData.priceChangePercent) || 0;
    }

    // Fallback: ambil harga dari klines close terakhir jika ticker gagal
    if (!btcPrice && klines.length > 0) {
      btcPrice = parseFloat(klines[klines.length - 1][4]) || 0;
    }

    // OI optional dari Binance futures
    try {
      const oiData = await binanceFetch('https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT', 5000).catch(()=>null);
      if (oiData) openInterest = parseFloat(oiData.openInterest) * btcPrice || 0;
    } catch(e) {}

    if (klines.length === 0) throw new Error('Gagal memuat data klines BTC');

    // ── Hitung price range dari klines
    const closes = klines.map(k => parseFloat(k[4]));
    const highs  = klines.map(k => parseFloat(k[2]));
    const lows   = klines.map(k => parseFloat(k[3]));
    const volumes = klines.map(k => parseFloat(k[5]));
    const times  = klines.map(k => k[0]);

    const priceMin = Math.min(...lows) * 0.995;
    const priceMax = Math.max(...highs) * 1.005;

    // ── Buat price levels (seperti Coinglass heatmap: baris horizontal per level harga)
    const numLevels = 60; // jumlah baris heatmap
    const levelStep = (priceMax - priceMin) / numLevels;
    const priceLevels = Array.from({length: numLevels}, (_, i) => priceMin + i * levelStep);

    // ── Untuk setiap level harga, hitung estimasi liquidasi berdasarkan:
    //    - Seberapa sering harga mendekati level itu (volume-weighted)
    //    - Leverage typical (10x-50x): liquidasi terjadi di ±2%-10% dari entry
    //    - Long liq = di bawah area konsentrasi, short liq = di atas
    const leverages = [5, 10, 20, 25, 50, 100]; // leverage umum
    
    // Buat "open interest distribution" per level harga
    // Setiap candle punya entry zone, leveraged positions liquidate at distance = 1/leverage
    const liqLong  = new Float64Array(numLevels); // liquidasi long di level ini
    const liqShort = new Float64Array(numLevels); // liquidasi short di level ini

    klines.forEach((k, ci) => {
      const open  = parseFloat(k[1]);
      const high  = parseFloat(k[2]);
      const low   = parseFloat(k[3]);
      const close = parseFloat(k[4]);
      const vol   = volumes[ci];
      const candleRange = high - low;
      if (candleRange <= 0) return;

      // Distribusikan volume sebagai estimasi OI di zona ini
      // Long positions entered near lows, short positions near highs
      leverages.forEach(lev => {
        const liqDistLong  = close / lev; // berapa dollar turun untuk liquidasi long
        const liqDistShort = close / lev; // berapa dollar naik untuk liquidasi short

        // Long liquidation prices (below entry)
        const longEntryZone = (open + close) / 2;
        const longLiqPrice  = longEntryZone - liqDistLong;
        const shortEntryZone = (open + close) / 2;
        const shortLiqPrice  = shortEntryZone + liqDistShort;

        // Konversi ke level index
        const liLong  = Math.round((longLiqPrice - priceMin) / levelStep);
        const liShort = Math.round((shortLiqPrice - priceMin) / levelStep);

        const weight = vol / leverages.length;

        if (liLong >= 0 && liLong < numLevels) {
          liqLong[liLong] += weight * (vol / (Math.max(...volumes) + 1));
        }
        if (liShort >= 0 && liShort < numLevels) {
          liqShort[liShort] += weight * (vol / (Math.max(...volumes) + 1));
        }
      });
    });

    // ── Stats
    const totalLong  = liqLong.reduce((a, b) => a + b, 0);
    const totalShort = liqShort.reduce((a, b) => a + b, 0);
    const fmtM = v => {
      const usd = v * btcPrice / 1000;
      return usd >= 1000 ? (usd/1000).toFixed(1)+'B' : usd.toFixed(0)+'M';
    };
    const fmtOI = v => v >= 1e9 ? (v/1e9).toFixed(1)+'B' : v >= 1e6 ? (v/1e6).toFixed(0)+'M' : '—';

    const el = id => document.getElementById(id);
    if (el('liq-price-val')) el('liq-price-val').textContent = '$' + btcPrice.toLocaleString('en',{maximumFractionDigits:0});
    if (el('liq-long-val'))  el('liq-long-val').textContent  = totalLong  > 0 ? '$'+fmtM(totalLong)  : '—';
    if (el('liq-short-val')) el('liq-short-val').textContent = totalShort > 0 ? '$'+fmtM(totalShort) : '—';
    if (el('liq-oi-val'))    el('liq-oi-val').textContent    = openInterest > 0 ? '$'+fmtOI(openInterest) : '—';
    if (statsRow) statsRow.style.display = 'flex';

    if (loading) loading.style.display = 'none';
    renderLiqChart({
      priceLevels, liqLong: Array.from(liqLong), liqShort: Array.from(liqShort),
      klines, btcPrice, btcChange, priceMin, priceMax, times
    });

  } catch(e) {
    console.warn('Liq data error:', e);
    if (loading) loading.style.display = 'none';
    const errEl2 = document.getElementById('liq-error');
    const errMsg = document.getElementById('liq-error-msg');
    if (errEl2) errEl2.style.display = 'flex';
    if (errMsg) errMsg.textContent = 'Tidak dapat memuat data: ' + (e.message||'');
  }
}

function renderLiqChart(data) {
  const canvas = document.getElementById('liq-chart-canvas');
  if (!canvas) return;

  const wrap = canvas.parentElement;
  const DPR = window.devicePixelRatio || 1;
  const W_CSS = wrap.clientWidth  || window.innerWidth;
  const H_CSS = wrap.clientHeight || 380;
  canvas.width  = W_CSS * DPR;
  canvas.height = H_CSS * DPR;
  canvas.style.width  = W_CSS + 'px';
  canvas.style.height = H_CSS + 'px';
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  const W = W_CSS, H = H_CSS;

  const { priceLevels, liqLong, liqShort, klines, btcPrice, btcChange, priceMin, priceMax, times } = data;
  const numLevels = priceLevels.length;
  const numCandles = klines.length;

  // Layout
  const padL  = 10;
  const padR  = 62; // price labels
  const padT  = 28;
  const padB  = 32; // time labels
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  ctx.clearRect(0, 0, W, H);

  // ── Background dark purple (like Coinglass)
  ctx.fillStyle = '#0d0a1f';
  ctx.fillRect(0, 0, W, H);

  // ── Gradient overlay top-bottom
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, 'rgba(60,20,100,.4)');
  bgGrad.addColorStop(1, 'rgba(5,3,15,.6)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── Normalize liquidation values for color mapping
  const maxLiq = Math.max(...liqLong, ...liqShort, 0.001);

  // ── Helper: convert intensity to Coinglass-style color
  // Coinglass: dark purple (0) → blue → cyan → green → yellow (high)
  function liqColor(intensity, side) {
    // intensity 0..1
    const i = Math.min(1, intensity);
    if (i < 0.001) return null;

    if (side === 'long') {
      // Long liq: purple → red → orange → yellow (warm, dangerous zone)
      const stops = [
        [0,    [80,  20, 120]],
        [0.25, [150, 30, 80]],
        [0.5,  [200, 60, 30]],
        [0.75, [230, 120, 0]],
        [1.0,  [255, 230, 0]],
      ];
      return interpolateColor(stops, i);
    } else {
      // Short liq: dark purple → blue → cyan → teal → green
      const stops = [
        [0,    [30,  20, 100]],
        [0.25, [40,  80, 180]],
        [0.5,  [20, 160, 200]],
        [0.75, [0,  200, 160]],
        [1.0,  [50, 255, 100]],
      ];
      return interpolateColor(stops, i);
    }
  }

  function interpolateColor(stops, t) {
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i+1];
      if (t >= t0 && t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return [
          Math.round(c0[0] + f*(c1[0]-c0[0])),
          Math.round(c0[1] + f*(c1[1]-c0[1])),
          Math.round(c0[2] + f*(c1[2]-c0[2])),
        ];
      }
    }
    return stops[stops.length-1][1];
  }

  // ── Draw heatmap rows (horizontal bars, one per price level)
  const rowH = chartH / numLevels;
  const candleW = chartW / numCandles;

  // For each price level, draw a horizontal band across all candles
  // with color intensity based on liq amount + how close candle was to this level
  for (let li = 0; li < numLevels; li++) {
    const levelPrice = priceLevels[li];
    const yPos = padT + chartH - (li + 1) * rowH; // bottom = low price

    // Determine if this level has significant long or short liq
    const liqL = liqLong[li]  / maxLiq;
    const liqS = liqShort[li] / maxLiq;
    const dominant = liqL >= liqS ? 'long' : 'short';
    const intensity = Math.max(liqL, liqS);

    if (intensity < 0.005) continue; // skip near-zero

    const rgb = liqColor(intensity, dominant);
    if (!rgb) continue;

    const alpha = 0.15 + intensity * 0.75;
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
    ctx.fillRect(padL, yPos, chartW, Math.max(1, rowH + 0.5));
  }

  // ── Grid lines (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = padT + (i/6) * chartH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + chartW, y); ctx.stroke();
  }
  for (let i = 0; i <= 8; i++) {
    const x = padL + (i/8) * chartW;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + chartH); ctx.stroke();
  }

  // ── Draw candlesticks on top
  const toY = price => padT + chartH * (1 - (price - priceMin) / (priceMax - priceMin));

  klines.forEach((k, ci) => {
    const open  = parseFloat(k[1]);
    const high  = parseFloat(k[2]);
    const low   = parseFloat(k[3]);
    const close = parseFloat(k[4]);

    const x = padL + ci * candleW;
    const cW2 = Math.max(1, candleW * 0.65);
    const xCenter = x + candleW / 2;

    const yOpen  = toY(open);
    const yClose = toY(close);
    const yHigh  = toY(high);
    const yLow   = toY(low);
    const isUp   = close >= open;

    const bodyColor = isUp ? '#26a69a' : '#ef5350';
    const wickColor = isUp ? 'rgba(38,166,154,.8)' : 'rgba(239,83,80,.8)';

    // Wick
    ctx.strokeStyle = wickColor;
    ctx.lineWidth = Math.max(1, candleW * 0.12);
    ctx.beginPath();
    ctx.moveTo(xCenter, yHigh);
    ctx.lineTo(xCenter, yLow);
    ctx.stroke();

    // Body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH   = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillStyle = bodyColor;
    ctx.fillRect(xCenter - cW2/2, bodyTop, cW2, bodyH);
  });

  // ── Current price line
  if (btcPrice > 0) {
    const py = toY(btcPrice);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + chartW, py);
    ctx.stroke();
    ctx.setLineDash([]);

    // Price label box
    const label = '$' + btcPrice.toLocaleString('en', {maximumFractionDigits: 0});
    ctx.font = 'bold 10px monospace';
    const tw = ctx.measureText(label).width + 8;
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.roundRect(padL + chartW + 2, py - 8, tw + 2, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.fillText(label, padL + chartW + 5, py + 3);
  }

  // ── Price labels (right axis)
  ctx.fillStyle = 'rgba(148,163,184,.6)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  const nPriceLabels = 7;
  for (let i = 0; i <= nPriceLabels; i++) {
    const p = priceMin + (i / nPriceLabels) * (priceMax - priceMin);
    const y = toY(p);
    if (y < padT - 4 || y > padT + chartH + 4) continue;
    ctx.fillText('$' + Math.round(p).toLocaleString('en'), padL + chartW + 2, y + 3);
  }

  // ── Time labels (bottom axis)
  ctx.fillStyle = 'rgba(148,163,184,.5)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  const nTimeLabels = Math.min(6, numCandles);
  for (let i = 0; i < nTimeLabels; i++) {
    const ci2 = Math.round(i * (numCandles-1) / (nTimeLabels-1));
    const t = new Date(times[ci2]);
    const label = (t.getMonth()+1)+'/'+t.getDate()+' '+t.getHours().toString().padStart(2,'0')+':00';
    const x = padL + (ci2 + 0.5) * candleW;
    ctx.fillText(label, x, padT + chartH + 16);
  }

  // ── Color scale legend (left side, vertical)
  const scaleH = chartH * 0.5;
  const scaleY = padT + chartH * 0.25;
  const scaleW = 6;
  const scaleX = padL + 2;
  for (let i = 0; i < scaleH; i++) {
    const t = 1 - i / scaleH;
    const rgb = liqColor(t, 'long');
    if (rgb) {
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(scaleX, scaleY + i, scaleW, 1.5);
    }
  }
  ctx.fillStyle = 'rgba(148,163,184,.5)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('High', scaleX + 8, scaleY + 8);
  ctx.fillText('Low',  scaleX + 8, scaleY + scaleH);
}

// Close on back button (mobile)
window.addEventListener('popstate', () => {
  const modal = document.getElementById('liq-heatmap-modal');
  if (modal && modal.style.display !== 'none') { closeLiqHeatmap(); history.pushState(null,'',location.href); }
});


// ── PWA SERVICE WORKER REGISTRATION ──
// Daftarkan SW via Blob URL agar notifikasi bekerja tanpa file sw.js terpisah
(function() {
  if (!('serviceWorker' in navigator)) return;

  const swCode = `
    self.addEventListener('install', e => { self.skipWaiting(); });
    self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
    self.addEventListener('push', e => {
      const data = e.data ? e.data.json() : {};
      e.waitUntil(self.registration.showNotification(data.title || 'z-wealth', {
        body: data.body || 'Ada pesan baru',
        icon: data.icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'chat',
        renotify: true,
      }));
    });
    self.addEventListener('notificationclick', e => {
      e.notification.close();
      e.waitUntil(clients.matchAll({type:'window'}).then(list => {
        if (list.length) { list[0].focus(); } else { clients.openWindow('/'); }
      }));
    });
    self.addEventListener('message', e => {
      if (e.data && e.data.type === 'SHOW_NOTIF') {
        const d = e.data;
        self.registration.showNotification(d.title || 'z-wealth', {
          body: d.body || 'Ada pesan baru',
          icon: d.icon || '/icon-192.png',
          badge: '/icon-192.png',
          tag: d.tag || 'chat',
          renotify: true,
          vibrate: [200, 100, 200],
        });
      }
    });
  `;

  const blob = new Blob([swCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  navigator.serviceWorker.register(blobUrl)
    .then(reg => {
      // Blob SW hanya untuk update notification (bukan untuk kirim notif)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            setTimeout(() => toast('Update tersedia! Refresh untuk versi terbaru.'), 1000);
          }
        });
      });
    })
    .catch(err => {
      // Fallback: coba /sw.js
      console.warn('[SW] Blob registration failed, trying /sw.js:', err.message);
      const notPreview = !location.hostname.includes('claudeusercontent.com') &&
                         !location.hostname.includes('claude.ai');
      if (notPreview) {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
          .then(r => { window._swReg = r; })
          .catch(() => {});
      }
    });

  window.showSWNotification = function(title, body, tag) {
    const msg = { type:'SHOW_NOTIF', title, body, icon:'/icon-192.png', tag: tag||('chat-'+Date.now()) };
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    } else if (window._swReg && window._swReg.active) {
      window._swReg.active.postMessage(msg);
    }
  };
})();

// ── PWA INSTALL PROMPT ──
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'flex';
  // Banner sudah tampil permanen, tidak perlu show lagi
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> z-wealth berhasil diinstall! Buka dari homescreen');
  // Simpan status installed
  try { localStorage.setItem('pwa-installed', '1'); } catch(e) {}
  // Sembunyikan banner dengan animasi
  hidePWABanner();
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.style.display = 'none';
});

function hidePWABanner(animated = true) {
  const banner = document.getElementById('pwa-install-banner');
  if (!banner) return;
  if (animated) {
    banner.style.transition = 'opacity .4s, transform .4s, max-height .4s, margin .4s, padding .4s';
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-6px)';
    banner.style.maxHeight = '0';
    banner.style.marginBottom = '0';
    banner.style.overflow = 'hidden';
    setTimeout(() => banner.style.display = 'none', 420);
  } else {
    banner.style.display = 'none';
  }
}

function checkPWABanner() {
  // Cek 1: Sudah berjalan sebagai PWA (standalone mode) → sembunyikan
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true
    || document.referrer.includes('android-app://');
  if (isStandalone) { hidePWABanner(false); return; }

  // Cek 2: Sudah pernah install → sembunyikan
  try {
    if (localStorage.getItem('pwa-installed') === '1') { hidePWABanner(false); return; }
  } catch(e) {}

  // Cek 3: Browser tidak support install (misal iOS Safari, Firefox) → sembunyikan
  // Banner tetap tampil untuk Chrome/Edge Android yang support
}

// Jalankan cek saat halaman load
window.addEventListener('load', () => { checkPWABanner(); });

// Dengarkan perubahan display mode (misal user buka dari homescreen)
window.matchMedia('(display-mode: standalone)').addEventListener('change', e => {
  if (e.matches) hidePWABanner(false);
});

function triggerPWAInstall() {
  if (!deferredInstallPrompt) {
    toast('Buka di Chrome/Edge browser untuk install sebagai app');
    return;
  }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> z-wealth sedang diinstall...');
      try { localStorage.setItem('pwa-installed', '1'); } catch(e) {}
    }
    deferredInstallPrompt = null;
  });
}

/* ── BLOCK 5 ── */
//  - In-app toast (slide-down glassmorphism)
//  - Unread badge di navbar icon
//  - Sound notifikasi (Web Audio API)
//  - Browser Push Notification (jika diizinkan)
// ══════════════════════════════════════════════════════════════

const ChatNotif = (() => {
  let _unreadCount = 0;
  let _toastTimer = null;
  let _progressTimer = null;
  let _pendingRoom = null; // untuk navigasi saat toast diklik
  let _audioCtx = null;

  // ── Inisialisasi AudioContext (lazy) ──
  function getAudioCtx() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return _audioCtx;
  }

  // ── Notif Sound — lembut dan futuristik ──
  function playSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
      // Chord 2 nada: lembut ping
      [[880, 0, 0.12],[1108, 0.08, 0.1]].forEach(([freq, delay, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur + 0.05);
      });
    } catch(e) {}
  }

  // ── Browser Push Notification ──
  function requestPushPermission() {
    // Dipanggil dari user gesture — langsung minta izin
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Notifikasi aktif!', 0);
      });
    }
  }

  function sendPushNotif(title, body, roomId, roomData) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // Hanya skip jika user sedang aktif di dalam room YANG SAMA
    const isActiveInRoom = (
      !document.hidden &&
      document.getElementById('page-chat')?.classList.contains('active') &&
      document.getElementById('chat-room-screen')?.classList.contains('active') &&
      window.chatState?.currentRoomId === roomId
    );
    if (isActiveInRoom) return;

    // Kirim notif via sendBrowserNotif (SW + FCM fallback)
    try {
      sendBrowserNotif(title, body, 'chat-' + roomId, '/');
    } catch(e) {
      // Last resort
      try { new Notification(title, { body, icon: '/icon-192.png', tag: 'chat-' + roomId, renotify: true }); } catch(e2) {}
    }
  }

  // ── Unread badge di feat-btn chat ──
  function updateUnreadBadge(count) {
    _unreadCount = count;

    // Badge di feat-btn (dashboard shortcut)
    document.querySelectorAll('.feat-btn').forEach(btn => {
      if (btn.getAttribute('onclick')?.includes('chat')) {
        let dot = btn.querySelector('.chat-unread-dot');
        if (count > 0) {
          if (!dot) {
            dot = document.createElement('span');
            dot.className = 'chat-unread-dot';
            btn.appendChild(dot);
          }
        } else {
          dot?.remove();
        }
      }
    });

    // Badge numerik di nav desktop (jika ada nav-tab chat)
    document.querySelectorAll('.nav-tab').forEach(tab => {
      if (tab.getAttribute('onclick')?.includes('chat')) {
        let badge = tab.querySelector('.chat-notif-nav-badge');
        if (count > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'chat-notif-nav-badge';
            badge.style.cssText = 'margin-left:.4rem;background:#ef4444;color:#fff;border-radius:100px;font-size:.58rem;font-weight:800;padding:1px 5px;vertical-align:middle;';
            tab.appendChild(badge);
          }
          badge.textContent = count > 99 ? '99+' : count;
        } else {
          badge?.remove();
        }
      }
    });
  }

  // ── Show In-App Toast ──
  function showToast(msg, roomData) {
    const toast = document.getElementById('chat-notif-toast');
    if (!toast) return;

    // Simpan data room untuk navigasi saat klik
    _pendingRoom = roomData;

    // Isi konten
    const avatarEl = document.getElementById('chat-notif-avatar');
    const roomEl = document.getElementById('chat-notif-room');
    const senderEl = document.getElementById('chat-notif-sender');
    const textEl = document.getElementById('chat-notif-text');
    const progressEl = document.getElementById('chat-notif-progress');

    if (avatarEl) {
      avatarEl.style.background = roomData?.color || 'linear-gradient(135deg,#00b4d8,#0096c7)';
      avatarEl.textContent = roomData?.type === 'dm' ? '@' : roomData?.type === 'public' ? '#' : (roomData?.name?.charAt(0)?.toUpperCase() || '?');
    }
    if (roomEl) roomEl.textContent = roomData?.name || 'Chat';
    if (senderEl) senderEl.textContent = msg.sender_code || 'anon';
    if (textEl) {
      if (msg.content) {
        textEl.textContent = msg.content;
      } else if (msg.media_url) {
        textEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0;margin-right:.25rem"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg> Mengirim media';
      } else {
        textEl.textContent = '...';
      }
    }

    // Reset & animate
    toast.classList.remove('show');
    clearTimeout(_toastTimer);
    clearInterval(_progressTimer);

    // Reset progress bar
    if (progressEl) {
      progressEl.style.transition = 'none';
      progressEl.style.transform = 'scaleX(1)';
    }

    // Trigger show
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.classList.add('show');
        // Progress bar countdown (4 detik)
        if (progressEl) {
          setTimeout(() => {
            progressEl.style.transition = 'transform 4s linear';
            progressEl.style.transform = 'scaleX(0)';
          }, 50);
        }
      });
    });

    // Auto-dismiss setelah 4 detik
    _toastTimer = setTimeout(() => hideToast(), 4200);
  }

  function hideToast() {
    const toast = document.getElementById('chat-notif-toast');
    if (!toast) return;
    toast.classList.remove('show');
    // Inline style tidak di-set agar tidak konflik dengan animasi show berikutnya
    // HTML sudah memiliki transform:translateY(-120px) dan opacity:0 sebagai default
  }

  // ── Handler saat toast diklik ──
  window.chatNotifClick = function() {
    clearTimeout(_toastTimer);
    hideToast();
    if (_pendingRoom) {
      showPage('chat');
      const rd = _pendingRoom;
      setTimeout(() => {
        openRoom(rd.id, rd.name, rd.type, rd.color || '#00b4d8');
      }, 300);
    }
  };

  // ── Main trigger — dipanggil saat ada pesan baru ──
  function onNewMessage(msg, roomData) {
    const isSelf = msg.sender_code === (window.chatState?.myCode);
    if (isSelf) return; // Jangan notif pesan sendiri

    const isInRoom = (
      document.getElementById('page-chat')?.classList.contains('active') &&
      document.getElementById('chat-room-screen')?.classList.contains('active') &&
      window.chatState?.currentRoomId === msg.room_id
    );

    if (isInRoom) return; // Sudah di dalam room ini, tidak perlu notif

    // Update unread count
    updateUnreadBadge(_unreadCount + 1);

    // Play sound
    playSound();

    // In-app toast
    showToast(msg, roomData);

    // Push notif ditangani oleh server webhook → /api/notifications?action=chat-notify
    // Client hanya update UI — tidak kirim push agar tidak double
  }

  // ── Reset unread saat user membuka halaman chat ──
  function resetUnread() {
    updateUnreadBadge(0);
  }

  // ── Request permission saat chatBoot ──
  function init() {
    requestPushPermission();
  }

  return { onNewMessage, resetUnread, init, playSound, requestPushPermission };
})();
window.ChatNotif = ChatNotif; // FIX: expose ke window agar if(window.ChatNotif) berfungsi

// ── Prompt izin notifikasi (non-intrusive banner) ──
function showNotifPermissionPrompt() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;

  // Buat banner di bagian bawah
  const banner = document.createElement('div');
  banner.id = 'notif-permission-banner';
  banner.style.cssText = `
    position:fixed;bottom:calc(5rem + env(safe-area-inset-bottom,0px));left:1rem;right:1rem;
    transform:translateY(80px);
    z-index:8000;max-width:400px;margin:0 auto;width:auto;
    background:rgba(10,16,30,0.95);backdrop-filter:blur(24px);
    border:1px solid rgba(0,229,255,0.3);border-radius:16px;
    padding:.9rem 1.1rem;display:flex;align-items:center;gap:.8rem;
    box-shadow:0 8px 32px rgba(0,0,0,.5);
    transition:transform .4s cubic-bezier(.34,1.2,.64,1);
  `;
  banner.innerHTML = `
    <span><svg style="display:inline-block;vertical-align:middle;margin-right:.35rem;flex-shrink:0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></span>
    <div style="flex:1;min-width:0">
      <div style="font-size:.82rem;font-weight:700;color:#e2e8f0;margin-bottom:.2rem">Aktifkan Notifikasi Chat</div>
      <div style="font-size:.72rem;color:rgba(148,163,184,.8)">Agar dapat notif pesan baru dari komunitas</div>
    </div>
    <button onclick="
      if(window.ChatNotif) ChatNotif.requestPushPermission();
      document.getElementById('notif-permission-banner')?.remove();
    " style="background:var(--accent);color:#000;border:none;border-radius:10px;padding:.45rem .9rem;font-size:.78rem;font-weight:800;cursor:pointer;flex-shrink:0;white-space:nowrap">Izinkan</button>
    <button onclick="document.getElementById('notif-permission-banner')?.remove()"
      style="background:rgba(255,255,255,.08);color:rgba(148,163,184,.7);border:none;border-radius:10px;padding:.45rem .6rem;font-size:.78rem;cursor:pointer;flex-shrink:0">✕</button>
  `;
  document.body.appendChild(banner);
  // Slide up
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
    });
  });
  // Auto dismiss setelah 12 detik
  setTimeout(() => {
    if (banner.parentNode) {
      banner.style.transform = 'translateY(80px)';
      setTimeout(() => banner.remove(), 400);
    }
  }, 12000);
}

// ── PATCH: subscribeRoom — patch ini TIDAK DIPAKAI (notif via global channel) ──
// subscribeRoom tetap menggunakan definisi original di atas

// ── Global channel untuk notif background ──
let _globalMsgChannel = null;
let _roomDataCache = {}; // cache room info

function subscribeGlobalChatNotif() {
  if (!chatSB || _globalMsgChannel) return;
  _globalMsgChannel = chatSB
    .channel('global-messages-notif')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
    }, async payload => {
      const msg = payload.new;
      // Ambil room data dari cache atau fetch
      let roomData = _roomDataCache[msg.room_id];
      if (!roomData) {
        try {
          const { data } = await chatSB.from('chat_rooms').select('id,name,type,avatar_color').eq('id', msg.room_id).single();
          if (data) {
            roomData = { id: data.id, name: data.name, type: data.type, color: data.avatar_color };
            _roomDataCache[msg.room_id] = roomData;
          }
        } catch(e) {}
      }
      if (window.ChatNotif) ChatNotif.onNewMessage(msg, roomData);
    })
    .subscribe();
}

/* ── BLOCK 6 ── */
let _cameraStream = null;
let _cameraFacingMode = 'environment';

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('media-camera-input')?.click();
    return;
  }
  const modal = document.getElementById('camera-modal');
  modal.style.display = 'flex';
  await startCameraStream();
}

async function startCameraStream() {
  if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; }
  try {
    _cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _cameraFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = document.getElementById('camera-video');
    if (video) { video.srcObject = _cameraStream; video.play().catch(() => {}); }
  } catch(err) {
    try {
      _cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const video = document.getElementById('camera-video');
      if (video) { video.srcObject = _cameraStream; video.play().catch(() => {}); }
    } catch(e) {
      closeCamera();
      document.getElementById('media-camera-input')?.click();
    }
  }
}

async function flipCamera() {
  _cameraFacingMode = _cameraFacingMode === 'environment' ? 'user' : 'environment';
  await startCameraStream();
}

function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  if (!video || !canvas) return;
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (_cameraFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:3000;opacity:.8;pointer-events:none;transition:opacity .3s';
  document.body.appendChild(flash);
  setTimeout(() => { flash.style.opacity='0'; setTimeout(() => flash.remove(), 300); }, 50);
  canvas.toBlob(blob => {
    if (!blob) return;
    const file = new File([blob], `foto_${Date.now()}.jpg`, { type: 'image/jpeg' });
    closeCamera();
    onMediaSelected({ files: [file], value: '' });
  }, 'image/jpeg', 0.92);
}

function closeCamera() {
  if (_cameraStream) { _cameraStream.getTracks().forEach(t => t.stop()); _cameraStream = null; }
  const video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
  const modal = document.getElementById('camera-modal');
  if (modal) modal.style.display = 'none';
}

/* ── BLOCK 7 ── */
// ══ QR MODAL ══
let _qrStream = null;
let _qrScanInterval = null;
let _scannedCode = null;

function openQRModal() {
  document.getElementById('qr-modal').style.display = 'flex';
  switchQRTab('show');
  const code = chatState.myCode || localStorage.getItem('chat_code') || '';
  document.getElementById('qr-code-display').textContent = code || '—';
  if (code) _generateQRCode(code);
}

function closeQRModal() {
  document.getElementById('qr-modal').style.display = 'none';
  stopQRScan();
  document.getElementById('qr-scan-result').style.display = 'none';
  const errEl = document.getElementById('qr-scan-error');
  if (errEl) errEl.style.display = 'none';
  _scannedCode = null;
}

function switchQRTab(tab) {
  const isShow = tab === 'show';
  document.getElementById('qr-panel-show').style.display = isShow ? 'block' : 'none';
  document.getElementById('qr-panel-scan').style.display = isShow ? 'none' : 'block';
  // Tab show
  const ts = document.getElementById('qr-tab-show');
  ts.style.background = isShow ? 'var(--accent)' : 'transparent';
  ts.style.color = isShow ? 'var(--bg)' : 'var(--muted)';
  // Tab scan
  const tsc = document.getElementById('qr-tab-scan');
  tsc.style.background = !isShow ? 'var(--accent)' : 'transparent';
  tsc.style.color = !isShow ? 'var(--bg)' : 'var(--muted)';
  if (isShow) stopQRScan();
}

// ─── QR GENERATOR via API + canvas fallback ───
function _generateQRCode(text) {
  const canvas = document.getElementById('qr-canvas');
  if (!canvas) return;
  const size = 192;
  const ctx = canvas.getContext('2d');
  // Clear
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  // Show loading spinner
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Memuat...', size/2, size/2);

  // Use qrserver.com free API
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.onerror = () => {
    // Fallback: render code as text matrix
    _qrFallbackDraw(ctx, text, size);
  };
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&margin=2&bgcolor=ffffff&color=111111`;
}

function _qrFallbackDraw(ctx, text, size) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,size,size);
  ctx.fillStyle = '#1a1a2e';
  // 3 finder patterns
  [[6,6],[size-34,6],[6,size-34]].forEach(([x,y])=>{
    ctx.fillRect(x,y,28,28);
    ctx.fillStyle='#fff'; ctx.fillRect(x+4,y+4,20,20);
    ctx.fillStyle='#1a1a2e'; ctx.fillRect(x+8,y+8,12,12);
    ctx.fillStyle='#1a1a2e';
  });
  ctx.font='bold 8px monospace'; ctx.textAlign='center'; ctx.fillStyle='#334155';
  const chunks = text.match(/.{1,18}/g)||[text];
  chunks.forEach((c,i) => ctx.fillText(c, size/2, size/2 - chunks.length*6 + i*14));
}

function shareMyQR() {
  const code = chatState.myCode || '';
  if (navigator.share) {
    navigator.share({ title:'z-wealth Chat', text:`Kode chat anonim saya: ${code}\nAdd saya di z-wealth!` }).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(code).then(()=>toast('Kode disalin!'));
  }
}

// ── SHARE LINK: DM Invite ──
function shareChatLink() {
  const code = chatState.myCode || '';
  if (!code) { toast('Kode belum dimuat', 1); return; }
  const base = window.location.origin + window.location.pathname;
  const link = `${base}?dm=${encodeURIComponent(code)}`;
  if (navigator.share) {
    navigator.share({
      title: 'Chat di z-wealth',
      text: `Hei! DM aku di z-wealth (anonim):\n${link}`,
      url: link
    }).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(link).then(() => toast('Link DM disalin!'));
  }
}

// ── SHARE LINK: Room/Group ──
async function shareRoomLink() {
  const roomId = chatState.currentRoomId;
  const roomType = chatState.currentRoomType;
  const roomName = chatState.currentRoomName || 'Room';
  if (!roomId) { toast('Bukan di dalam room', 1); return; }

  let linkCode = roomId;
  // For group, also fetch invite code if available
  if (roomType === 'group') {
    try {
      const { data } = await chatSB.from('chat_rooms').select('invite_code').eq('id', roomId).single();
      if (data?.invite_code) linkCode = data.invite_code;
    } catch(e) {}
  }

  const base = window.location.origin + window.location.pathname;
  const param = roomType === 'dm' ? `dm=${encodeURIComponent(chatState.myCode||'')}` : `join=${encodeURIComponent(linkCode)}`;
  const link = `${base}?${param}`;
  const text = roomType === 'dm'
    ? `Hei! DM aku di z-wealth (anonim):\n${link}`
    : `Gabung di grup "${roomName}" di z-wealth:\n${link}`;

  if (navigator.share) {
    navigator.share({ title: 'z-wealth Chat', text, url: link }).catch(()=>{});
  } else {
    navigator.clipboard?.writeText(link).then(() => toast('Link disalin!'));
  }
}

// ── DOWNLOAD QR VISUAL CARD (with z-wealth watermark) ──
function downloadQRCard() {
  const code = chatState.myCode || localStorage.getItem('chat_code') || '';
  if (!code) { toast('Kode belum dimuat', 1); return; }

  const W = 480, H = 640;
  const canvas = document.getElementById('qr-card-canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ─── BACKGROUND GRADIENT ───
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#050810');
  bg.addColorStop(0.5, '#0b1120');
  bg.addColorStop(1, '#050810');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(0,229,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // ─── CARD CONTAINER ───
  const r = 28, cx = 32, cy = 32, cw = W-64, ch = H-64;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx+r, cy); ctx.lineTo(cx+cw-r, cy);
  ctx.arcTo(cx+cw, cy, cx+cw, cy+r, r);
  ctx.lineTo(cx+cw, cy+ch-r);
  ctx.arcTo(cx+cw, cy+ch, cx+cw-r, cy+ch, r);
  ctx.lineTo(cx+r, cy+ch);
  ctx.arcTo(cx, cy+ch, cx, cy+ch-r, r);
  ctx.lineTo(cx, cy+r);
  ctx.arcTo(cx, cy, cx+r, cy, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(11,17,32,0.95)';
  ctx.fill();
  // Border glow
  ctx.strokeStyle = 'rgba(0,229,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // ─── TOP ACCENT LINE ───
  const topGrad = ctx.createLinearGradient(cx, 0, cx+cw, 0);
  topGrad.addColorStop(0, 'transparent');
  topGrad.addColorStop(0.3, '#00e5ff');
  topGrad.addColorStop(0.7, '#7c3aed');
  topGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = topGrad;
  ctx.beginPath();
  ctx.moveTo(cx+r, cy); ctx.lineTo(cx+cw-r, cy); ctx.arcTo(cx+cw, cy, cx+cw, cy+r, r); ctx.lineTo(cx+cw, cy+4); ctx.lineTo(cx, cy+4); ctx.lineTo(cx, cy+r); ctx.arcTo(cx, cy, cx+r, cy, r); ctx.closePath();
  ctx.fill();

  // ─── LOGO "z-wealth" watermark ───
  ctx.font = 'italic 900 36px Inter, sans-serif';
  ctx.fillStyle = '#00e5ff';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,229,255,0.6)';
  ctx.shadowBlur = 16;
  const logoX = cx + 28, logoY = cy + 70;
  ctx.fillText('z', logoX, logoY);
  ctx.font = '300 36px Inter, sans-serif';
  ctx.fillStyle = 'rgba(0,229,255,0.4)';
  ctx.shadowBlur = 0;
  ctx.fillText('-', logoX + 22, logoY);
  ctx.font = '800 36px Inter, sans-serif';
  ctx.fillStyle = '#f0f9ff';
  ctx.fillText('wealth', logoX + 38, logoY);
  ctx.shadowBlur = 0;

  // Tagline
  ctx.font = '400 13px Inter, sans-serif';
  ctx.fillStyle = 'rgba(100,116,139,0.9)';
  ctx.textAlign = 'left';
  ctx.fillText('Bitcoin DCA Tracker · Anonim', logoX, logoY + 22);

  // ─── QR CODE (from existing canvas) ───
  const qrSrc = document.getElementById('qr-canvas');
  const qrSize = 200;
  const qrX = (W - qrSize) / 2;
  const qrY = cy + 120;

  // QR frame
  ctx.save();
  const fr = 16;
  ctx.beginPath();
  ctx.moveTo(qrX-18+fr, qrY-18); ctx.lineTo(qrX+qrSize+18-fr, qrY-18);
  ctx.arcTo(qrX+qrSize+18, qrY-18, qrX+qrSize+18, qrY-18+fr, fr);
  ctx.lineTo(qrX+qrSize+18, qrY+qrSize+18-fr);
  ctx.arcTo(qrX+qrSize+18, qrY+qrSize+18, qrX+qrSize+18-fr, qrY+qrSize+18, fr);
  ctx.lineTo(qrX-18+fr, qrY+qrSize+18);
  ctx.arcTo(qrX-18, qrY+qrSize+18, qrX-18, qrY+qrSize+18-fr, fr);
  ctx.lineTo(qrX-18, qrY-18+fr);
  ctx.arcTo(qrX-18, qrY-18, qrX-18+fr, qrY-18, fr);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  if (qrSrc && qrSrc.width > 0) {
    ctx.drawImage(qrSrc, qrX, qrY, qrSize, qrSize);
  }

  // Corner accents on QR frame
  const cc = 'rgba(0,229,255,0.7)';
  const cl = 18; const ct = 3;
  [[qrX-18, qrY-18],[qrX+qrSize+18-cl, qrY-18],[qrX-18, qrY+qrSize+18-cl],[qrX+qrSize+18-cl, qrY+qrSize+18-cl]].forEach(([bx,by], i) => {
    ctx.strokeStyle = cc; ctx.lineWidth = ct; ctx.lineCap = 'round';
    ctx.beginPath();
    if (i===0) { ctx.moveTo(bx+cl,by); ctx.lineTo(bx,by); ctx.lineTo(bx,by+cl); }
    else if (i===1) { ctx.moveTo(bx,by); ctx.lineTo(bx+cl,by); ctx.lineTo(bx+cl,by+cl); }
    else if (i===2) { ctx.moveTo(bx+cl,by+cl); ctx.lineTo(bx,by+cl); ctx.lineTo(bx,by); }
    else { ctx.moveTo(bx,by+cl); ctx.lineTo(bx+cl,by+cl); ctx.lineTo(bx+cl,by); }
    ctx.stroke();
  });

  // ─── CODE DISPLAY ───
  const codeY = qrY + qrSize + 52;
  // Pill background
  const pillW = 280, pillH = 44, pillX = (W-pillW)/2, pillY2 = codeY - 16;
  ctx.fillStyle = 'rgba(0,229,255,0.07)';
  ctx.strokeStyle = 'rgba(0,229,255,0.25)';
  ctx.lineWidth = 1;
  _roundRect(ctx, pillX, pillY2, pillW, pillH, 12);
  ctx.fill(); ctx.stroke();

  ctx.font = 'bold 15px "Space Mono", monospace';
  ctx.fillStyle = '#00e5ff';
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,229,255,0.4)';
  ctx.shadowBlur = 10;
  ctx.fillText(code, W/2, codeY + 12);
  ctx.shadowBlur = 0;

  ctx.font = '400 11px Inter, sans-serif';
  ctx.fillStyle = 'rgba(100,116,139,0.8)';
  ctx.fillText('Kode Chat Anonim · z-wealth', W/2, codeY + 32);

  // ─── BOTTOM WATERMARK ───
  const wY = cy + ch - 28;
  ctx.font = 'italic 900 22px Inter, sans-serif';
  ctx.fillStyle = 'rgba(0,229,255,0.12)';
  ctx.textAlign = 'center';
  ctx.fillText('z-wealth', W/2, wY);

  ctx.font = '400 10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(100,116,139,0.4)';
  ctx.fillText('z-wealth.app · Bitcoin DCA Tracker', W/2, wY + 16);

  // ─── DOWNLOAD ───
  const link = document.createElement('a');
  link.download = `z-wealth-qr-${code}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  toast('Visual card berhasil didownload! <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2z"/></svg>');
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

// ─── DEEP LINK HANDLER ───
async function _handleChatDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const dmCode = params.get('dm');
  const joinCode = params.get('join');
  if (!dmCode && !joinCode) return;

  // Clean URL without reloading
  window.history.replaceState({}, '', window.location.pathname);

  showPage('chat');
  await new Promise(r => setTimeout(r, 500)); // let chat init settle

  if (dmCode) {
    // Open DM with that code
    if (!chatSB || !chatState.myCode) return;
    if (dmCode === chatState.myCode) { toast('Itu kode kamu sendiri!', 2); return; }
    try {
      const { data: targetUser } = await chatSB.from('anon_users').select('code').eq('code', dmCode).single();
      if (!targetUser) { toast('Akun tidak ditemukan', 2); return; }
      const { data: myRooms } = await chatSB.from('room_members').select('room_id').eq('user_code', chatState.myCode);
      if (myRooms?.length) {
        const ids = myRooms.map(r=>r.room_id);
        const { data: targetRooms } = await chatSB.from('room_members').select('room_id').eq('user_code', dmCode).in('room_id', ids);
        if (targetRooms?.length) {
          const { data: existDM } = await chatSB.from('chat_rooms').select('*').eq('type','dm').in('id', targetRooms.map(r=>r.room_id)).single();
          if (existDM) { openRoom(existDM.id, dmCode, 'dm', '#7c3aed'); toast('DM dibuka! <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="13" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="17" cy="10" r="1" fill="#00e5ff" stroke="none"/></svg>'); return; }
        }
      }
      const { data: room, error } = await chatSB.from('chat_rooms').insert({
        type:'dm', name:`${chatState.myCode} ↔ ${dmCode}`, avatar_color:'#7c3aed', created_by:chatState.myCode
      }).select().single();
      if (error) { toast('Gagal buat DM', 2); return; }
      await chatSB.from('room_members').insert([
        { room_id:room.id, user_code:chatState.myCode },
        { room_id:room.id, user_code:dmCode }
      ]);
      openRoom(room.id, dmCode, 'dm', '#7c3aed');
      toast('DM baru dibuka! <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="9" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="13" cy="10" r="1" fill="#00e5ff" stroke="none"/><circle cx="17" cy="10" r="1" fill="#00e5ff" stroke="none"/></svg>');
    } catch(e) { toast('Error: '+e.message, 2); }

  } else if (joinCode) {
    // Join group by invite code or room id
    if (!chatSB || !chatState.myCode) return;
    try {
      let roomData = null;
      // Try as invite code first
      const { data: byInvite } = await chatSB.from('chat_rooms').select('*').eq('invite_code', joinCode).single();
      if (byInvite) roomData = byInvite;
      else {
        // Try as room ID
        const { data: byId } = await chatSB.from('chat_rooms').select('*').eq('id', joinCode).single();
        if (byId) roomData = byId;
      }
      if (!roomData) { toast('Room tidak ditemukan', 2); return; }
      await chatSB.from('room_members').upsert(
        { room_id: roomData.id, user_code: chatState.myCode },
        { onConflict: 'room_id,user_code' }
      );
      openRoom(roomData.id, roomData.name, roomData.type, roomData.avatar_color);
      toast(`Bergabung ke "${roomData.name}"! <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2z"/></svg>`);
    } catch(e) { toast('Error: '+e.message, 2); }
  }
}

// ─── QR SCANNER ───
async function startQRScan() {
  const placeholder = document.getElementById('qr-cam-placeholder');
  const errEl = document.getElementById('qr-scan-error');
  const result = document.getElementById('qr-scan-result');
  if (errEl) errEl.style.display = 'none';
  if (result) result.style.display = 'none';

  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('qr-gallery-input').click(); return;
  }
  try {
    _qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'environment', width:{ideal:640}, height:{ideal:640} }, audio:false
    });
    const video = document.getElementById('qr-video');
    video.srcObject = _qrStream;
    await video.play();
    if (placeholder) placeholder.style.display = 'none';
    _loadJsQRThenScan(video);
  } catch(e) {
    if (errEl) { errEl.style.display = 'flex'; document.getElementById('qr-scan-error-text').textContent = 'Tidak bisa akses kamera. Coba dari Galeri.'; }
  }
}

function _loadJsQRThenScan(video) {
  const errEl = document.getElementById('qr-scan-error');
  if (errEl) errEl.style.display = 'none';

  // Try native BarcodeDetector first (Chrome/Android)
  if ('BarcodeDetector' in window) {
    _qrDecodeLoopNative(video);
    return;
  }

  // Fallback: try multiple CDNs for jsQR
  const run = () => _qrDecodeLoop(video);
  if (window.jsQR) { run(); return; }

  const cdns = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js',
  ];

  function tryLoad(i) {
    if (i >= cdns.length) {
      const e = document.getElementById('qr-scan-error-text');
      if (e) e.textContent = 'Kamera scan tidak tersedia. Gunakan tombol Galeri untuk upload foto QR.';
      if (errEl) errEl.style.display = 'flex';
      return;
    }
    const s = document.createElement('script');
    s.src = cdns[i];
    s.onload = run;
    s.onerror = () => tryLoad(i + 1);
    document.head.appendChild(s);
  }
  tryLoad(0);
}

function _qrDecodeLoopNative(video) {
  const detector = new BarcodeDetector({formats: ['qr_code']});
  if (_qrScanInterval) clearInterval(_qrScanInterval);
  _qrScanInterval = setInterval(async () => {
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0 && barcodes[0].rawValue) {
        _handleScannedCode(barcodes[0].rawValue.trim());
      }
    } catch(e) {}
  }, 300);
}

function _qrDecodeLoop(video) {
  const canvas = document.getElementById('qr-scan-canvas');
  const ctx = canvas.getContext('2d');
  if (_qrScanInterval) clearInterval(_qrScanInterval);
  _qrScanInterval = setInterval(() => {
    if (!video || video.readyState < video.HAVE_ENOUGH_DATA) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    if (!window.jsQR) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR(data.data, data.width, data.height, {inversionAttempts:'dontInvert'});
    if (result?.data) _handleScannedCode(result.data.trim());
  }, 250);
}

function stopQRScan() {
  if (_qrScanInterval) { clearInterval(_qrScanInterval); _qrScanInterval = null; }
  if (_qrStream) { _qrStream.getTracks().forEach(t=>t.stop()); _qrStream = null; }
  const video = document.getElementById('qr-video');
  if (video) video.srcObject = null;
  const ph = document.getElementById('qr-cam-placeholder');
  if (ph) ph.style.display = 'flex';
}

function scanQRFromFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  document.getElementById('qr-scan-result').style.display = 'none';
  const errEl = document.getElementById('qr-scan-error');
  if (errEl) errEl.style.display = 'none';
  input.value = '';

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.getElementById('qr-scan-canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);

      const showErr = (msg) => {
        if (errEl) { errEl.style.display='flex'; document.getElementById('qr-scan-error-text').textContent = msg || 'QR Code tidak terdeteksi. Coba foto lebih jelas.'; }
      };

      const tryJsQR = () => {
        const imgData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR?.(imgData.data, imgData.width, imgData.height, {inversionAttempts:'attemptBoth'});
        if (result?.data) { _handleScannedCode(result.data.trim()); }
        else { showErr('QR Code tidak terdeteksi. Coba foto yang lebih jelas & terang.'); }
      };

      const loadJsQRAndDecode = () => {
        if (window.jsQR) { tryJsQR(); return; }
        const cdns = [
          'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
          'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
        ];
        const tryNext = (i) => {
          if (i >= cdns.length) { tryJsQR(); return; }
          const s = document.createElement('script');
          s.src = cdns[i];
          s.onload = tryJsQR;
          s.onerror = () => tryNext(i+1);
          document.head.appendChild(s);
        };
        tryNext(0);
      };

      // Try native BarcodeDetector first (async-safe here)
      if ('BarcodeDetector' in window) {
        try {
          const detector = new BarcodeDetector({formats:['qr_code']});
          const bitmap = await createImageBitmap(img);
          const barcodes = await detector.detect(bitmap);
          if (barcodes.length > 0 && barcodes[0].rawValue) {
            _handleScannedCode(barcodes[0].rawValue.trim());
          } else {
            // BarcodeDetector found nothing — try jsQR as backup
            loadJsQRAndDecode();
          }
        } catch(e) {
          loadJsQRAndDecode();
        }
      } else {
        loadJsQRAndDecode();
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function _handleScannedCode(code) {
  if (_scannedCode === code) return; // Jangan trigger 2x
  _scannedCode = code;
  stopQRScan();
  // Flash sukses
  const flash = document.getElementById('qr-success-flash');
  if (flash) { flash.style.display='flex'; setTimeout(()=>flash.style.display='none', 800); }
  // Show result
  document.getElementById('qr-scan-found-code').textContent = code;
  document.getElementById('qr-scan-result').style.display = 'block';
}

async function useScannedCode() {
  if (!_scannedCode) return;
  const target = _scannedCode.trim();
  if (!target || !chatSB || !chatState.myCode) { toast('Belum terhubung ke chat'); return; }
  if (target === chatState.myCode) { toast('Itu kode kamu sendiri!', 2); return; }
  closeQRModal();
  showPage('chat');
  try {
    const { data: targetUser } = await chatSB.from('anon_users').select('code').eq('code', target).single();
    if (!targetUser) { toast('Akun tidak ditemukan', 2); return; }
    const { data: myRooms } = await chatSB.from('room_members').select('room_id').eq('user_code', chatState.myCode);
    if (myRooms?.length) {
      const ids = myRooms.map(r=>r.room_id);
      const { data: targetRooms } = await chatSB.from('room_members').select('room_id').eq('user_code', target).in('room_id', ids);
      if (targetRooms?.length) {
        const { data: existDM } = await chatSB.from('chat_rooms').select('*').eq('type','dm').in('id', targetRooms.map(r=>r.room_id)).single();
        if (existDM) { openRoom(existDM.id, target, 'dm', '#7c3aed'); toast('Membuka DM'); return; }
      }
    }
    const { data: room, error } = await chatSB.from('chat_rooms').insert({
      type:'dm', name:`${chatState.myCode} ↔ ${target}`, avatar_color:'#7c3aed', created_by:chatState.myCode
    }).select().single();
    if (error) { toast('Gagal buat DM', 2); return; }
    await chatSB.from('room_members').insert([
      { room_id:room.id, user_code:chatState.myCode },
      { room_id:room.id, user_code:target }
    ]);
    openRoom(room.id, target, 'dm', '#7c3aed');
    toast('DM dibuka!');
  } catch(e) { toast('Error: '+e.message, 2); }
}

/* ── BLOCK 8 ── */
const PUSH_VAPID_PUBLIC = 'BCjuhvgFLrxeEY_lI3K2ssgr2MdZSKRSoqSXE5VaRwW_efsoQkw0Ph4QEn_F8iJPE_9rNAVGSUzA-gL6z32FnmI';

async function registerSW() {
  // Redirect ke firebase-messaging-sw.js (sistem baru)
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    window._swReg = reg;
    return reg;
  } catch(e) { console.error('[Push] SW failed:', e); return null; }
}

// requestNotifPermission sudah didefinisikan di atas (merged - UI + return value)

async function subscribePush(reg) {
  if (!reg) return null;
  try {
    let sub = await reg.pushManager.getSubscription();
    if (sub) return sub;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC),
    });
    return sub;
  } catch(e) { console.error('[Push] Subscribe failed:', e); return null; }
}

async function savePushSubscription(sub) {
  if (!sub || !chatSB || !chatState?.myCode) return;
  try {
    const subJson = sub.toJSON();
    const { error } = await chatSB.from('push_subscriptions').upsert({
      user_code:  chatState.myCode,
      endpoint:   sub.endpoint,
      p256dh:     subJson.keys?.p256dh || '',
      auth:       subJson.keys?.auth   || '',
      user_agent: navigator.userAgent.slice(0, 200),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) console.error('[Push] Save error:', error);
    else { /* Push subscription saved */ }
  } catch(e) { console.error('[Push] savePushSubscription error:', e); }
}

async function unsubscribePush() {
  try {
    if (!('serviceWorker' in navigator)) return;
    // Hapus FCM token dari localStorage
    localStorage.removeItem('zw_fcm_token');
    const reg = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    if (chatSB && chatState?.myCode) {
      await chatSB.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    }
    await sub.unsubscribe();
  } catch(e) { console.error('[Push] Unsubscribe error:', e); }
}

async function initPushNotification() {
  // Sistem push lama (Web Push API) diganti FCM — fungsi ini hanya wrapper
  // Pastikan firebase-messaging-sw.js aktif jika notif sudah diizinkan
  if (Notification.permission === 'granted') {
    try {
      await ZW_FCM.init();
      const savedToken = localStorage.getItem('zw_fcm_token');
      if (!savedToken) {
        await ZW_FCM.getToken();
      }
    } catch(e) { console.warn('[Push] ZW_FCM init error:', e); }
  }
}

function showPushPermissionBanner(reg) {
  if (localStorage.getItem('push_perm_dismissed') === '1') return;
  if (document.getElementById('_push-banner')) return;
  const banner = document.createElement('div');
  banner.id = '_push-banner';
  banner.style.cssText = `
    position:fixed;bottom:calc(5rem + env(safe-area-inset-bottom,0px));
    left:.75rem;right:.75rem;z-index:9800;
    background:rgba(6,11,24,0.97);border:1px solid rgba(0,229,255,0.3);
    border-radius:18px;padding:1rem 1.1rem;
    box-shadow:0 8px 40px rgba(0,0,0,0.6);
    display:flex;align-items:center;gap:.9rem;
    backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
    animation:slideUpBanner .4s cubic-bezier(.34,1.3,.64,1) forwards;
    max-width:480px;margin:0 auto;
  `;
  banner.innerHTML = `
    
    <div style="width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,rgba(0,229,255,.2),rgba(124,58,237,.2));border:1px solid rgba(0,229,255,.25);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:800;font-size:.88rem;color:#f0f9ff;margin-bottom:.2rem">Aktifkan Notifikasi Chat</div>
      <div style="font-size:.72rem;color:rgba(100,116,139,.9);line-height:1.45">Dapat notif HP saat ada pesan baru, bahkan saat app ditutup</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:.4rem;flex-shrink:0">
      <button id="_push-allow-btn" style="background:var(--accent);color:#050810;border:none;border-radius:10px;padding:.45rem .9rem;font-weight:800;font-size:.75rem;cursor:pointer;white-space:nowrap">Aktifkan</button>
      <button id="_push-deny-btn" style="background:transparent;color:rgba(100,116,139,.7);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:.35rem .5rem;font-size:.68rem;cursor:pointer;white-space:nowrap">Nanti saja</button>
    </div>
  `;
  document.body.appendChild(banner);
  document.getElementById('_push-allow-btn').addEventListener('click', async () => {
    banner.remove();
    const perm = await requestNotifPermission();
    if (perm === 'granted') {
      const sub = await subscribePush(reg);
      if (sub) { await savePushSubscription(sub); toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Notifikasi chat aktif!'); }
    } else { toast('Notifikasi tidak diizinkan', 2); }
  });
  document.getElementById('_push-deny-btn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('push_perm_dismissed', '1');
  });
  setTimeout(() => { if (document.getElementById('_push-banner')) banner.remove(); }, 15000);
}

/* ═══════════════════════════════════════════════════════════
   WALLET CONNECT — Read-Only · MetaMask / OKX / Phantom + BTC
   EVM tokens: Moralis API  |  BTC: Mempool.space (no key needed)
   ZERO transaksi — murni baca saldo
═══════════════════════════════════════════════════════════ */

// ── Detect available wallet providers ──
function detectProviders() {
  const providers = [];

  // ── OKX Desktop Extension: window.okxwallet
  if (window.okxwallet) {
    providers.push({ name:'OKX', evm: window.okxwallet, btc: window.okxwallet.bitcoin || null });
  }

  // ── OKX In-App Browser (Mobile Web3 Browser):
  // OKX bisa inject provider di beberapa lokasi berbeda tergantung versi app:
  // 1. window.okxwallet (sama seperti extension)
  // 2. window.ethereum dengan flag isOKExWallet/isOKX/isOkxWallet
  // 3. window.okexchain (versi lama OKX)
  // 4. window.ethereum tanpa flag khusus tapi di UA ada "OKX"
  if (
    window.ethereum &&
    (window.ethereum.isOKExWallet || window.ethereum.isOKX || window.ethereum.isOkxWallet) &&
    !window.okxwallet
  ) {
    providers.push({ name:'OKX', evm: window.ethereum, btc: null });
  }
  // OKX lama / versi tertentu: window.okexchain
  if (window.okexchain && !providers.find(p => p.name === 'OKX')) {
    providers.push({ name:'OKX', evm: window.okexchain, btc: null });
  }
  // Fallback OKX via UserAgent — OKX browser biasanya ada "OKX" di UA
  if (
    window.ethereum &&
    /OKX|OKEx|OkxWallet/i.test(navigator.userAgent) &&
    !providers.find(p => p.name === 'OKX')
  ) {
    providers.push({ name:'OKX', evm: window.ethereum, btc: null });
  }

  // ── Phantom
  if (window.phantom?.ethereum) {
    providers.push({ name:'Phantom', evm: window.phantom.ethereum, btc: window.phantom.bitcoin || null });
  }

  // ── MetaMask (extension desktop, atau MetaMask Mobile browser)
  if (window.ethereum?.isMetaMask && !window.ethereum.isOKExWallet && !window.ethereum.isOKX && !window.okxwallet && !window.phantom?.ethereum) {
    providers.push({ name:'MetaMask', evm: window.ethereum, btc: null });
  }
  // MetaMask alongside OKX/Phantom
  if (window.ethereum?.isMetaMask && (window.okxwallet || window.phantom)) {
    providers.push({ name:'MetaMask', evm: window.ethereum, btc: null });
  }

  // ── Trust Wallet in-app browser
  if (window.ethereum?.isTrust || window.ethereum?.isTrustWallet) {
    if (!providers.find(p => p.evm === window.ethereum)) {
      providers.push({ name:'Trust Wallet', evm: window.ethereum, btc: null });
    }
  }

  // ── Coinbase Wallet in-app browser
  if (window.ethereum?.isCoinbaseWallet || window.ethereum?.isCoinbaseBrowser) {
    if (!providers.find(p => p.evm === window.ethereum)) {
      providers.push({ name:'Coinbase Wallet', evm: window.ethereum, btc: null });
    }
  }

  // ── Fallback: window.ethereum apapun yang belum terdaftar (mobile wallet browser lain)
  if (!providers.length && window.ethereum) {
    // Coba deteksi nama dari userAgent
    const ua = navigator.userAgent || '';
    let name = 'Browser Wallet';
    if (/OKX/i.test(ua)) name = 'OKX';
    else if (/MetaMask/i.test(ua)) name = 'MetaMask';
    else if (/Trust/i.test(ua)) name = 'Trust Wallet';
    providers.push({ name, evm: window.ethereum, btc: null });
  }

  return providers;
}

// ── Moralis API key ──
const MORALIS_API_KEY = 'GANTI_DENGAN_API_KEY_MORALIS_KAMU';

const CHAIN_SLUG = { 1:'eth',56:'bsc',137:'polygon',42161:'arbitrum',10:'optimism',43114:'avalanche',8453:'base',250:'fantom',25:'cronos' };
const CHAIN_NAME = { 1:'Ethereum',56:'BNB Chain',137:'Polygon',42161:'Arbitrum',10:'Optimism',43114:'Avalanche',8453:'Base',250:'Fantom',25:'Cronos' };
const COINGECKO_PLATFORM = { 1:'ethereum',56:'binance-smart-chain',137:'polygon-pos',42161:'arbitrum-one',10:'optimistic-ethereum',43114:'avalanche',8453:'base',250:'fantom' };
const NATIVE_SYMBOL = { 1:'ETH',56:'BNB',137:'MATIC',42161:'ETH',10:'ETH',43114:'AVAX',8453:'ETH',250:'FTM',25:'CRO' };
const NATIVE_CG_ID  = { ETH:'ethereum',BNB:'binancecoin',MATIC:'matic-network',AVAX:'avalanche-2',FTM:'fantom',CRO:'crypto-com-chain' };
const NATIVE_ICON   = { 1:'Ξ',56:'⬡',137:'⬡',42161:'Ξ',10:'Ξ',43114:'▲',8453:'Ξ',250:'F',25:'◈' };
const NATIVE_GRAD   = { 1:'#627EEA,#8FA8F5',56:'#F3BA2F,#F5CC5E',137:'#8247E5,#A66FEF',42161:'#2D374B,#96BEDC',10:'#FF0420,#FF6B80',43114:'#E84142,#F08080',8453:'#0052FF,#4D8EFF',250:'#1969FF,#5FA4FF',25:'#002D74,#1565C0' };
const PROVIDER_COLOR = { MetaMask:'#F6851B',OKX:'#00d1b2',Phantom:'#ab9ff2','Trust Wallet':'#3375BB','Coinbase Wallet':'#0052FF',WalletConnect:'#3b99fc','Browser Wallet':'#64748b' };

function truncateAddr(addr) { if(!addr)return'—'; return addr.slice(0,6)+'…'+addr.slice(-4); }
function fmtQty(n) { if(n===null||n===undefined||isNaN(n))return'—'; if(n>=1e9)return(n/1e9).toFixed(3)+'B'; if(n>=1e6)return(n/1e6).toFixed(3)+'M'; if(n>=1e3)return(n/1e3).toFixed(3)+'K'; if(n>=1)return n.toFixed(4); return n.toFixed(8); }

// ══════════════════════════════════════════
//  BTC ADDRESS SECTION
// ══════════════════════════════════════════

function toggleBTCInput() {
  walletState.btcPanelOpen = !walletState.btcPanelOpen;
  const panel = document.getElementById('btc-input-panel');
  const btn   = document.getElementById('btn-btc-input');
  const lbl   = document.getElementById('btc-btn-label');
  if (panel) panel.style.display = walletState.btcPanelOpen ? 'block' : 'none';
  if (btn) {
    btn.style.background     = walletState.btcPanelOpen ? 'rgba(245,158,11,.15)' : 'transparent';
    btn.style.borderColor    = 'rgba(245,158,11,.5)';
  }
  if (lbl) lbl.textContent = walletState.btcPanelOpen ? '▲ BTC Address' : '+ BTC Address';
}

function isValidBTCAddress(addr) {
  return /^(bc1[ac-hj-np-z02-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(addr.trim());
}

async function addBTCAddress() {
  const input = document.getElementById('btc-addr-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) { toast('Masukkan BTC address dulu!', 1); return; }
  if (!isValidBTCAddress(raw)) { toast('Format BTC address tidak valid', 1); return; }
  if (walletState.btcAddresses.find(x => x.address === raw)) { toast('Address sudah ada', 1); return; }

  const entry = { address: raw, btc: null, valueIDR: null, valueUSD: null, loading: true };
  walletState.btcAddresses.push(entry);
  saveBTCAddresses();
  input.value = '';
  renderBTCAddrList();
  renderPort();

  await fetchBTCSingle(entry);
  renderBTCAddrList();
  renderPort();
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> BTC address ditambahkan!');
}

function removeBTCAddress(addr) {
  walletState.btcAddresses = walletState.btcAddresses.filter(x => x.address !== addr);
  saveBTCAddresses();
  renderBTCAddrList();
  renderPort();
  toast('BTC address dihapus.');
}

function saveBTCAddresses() {
  try {
    const data = walletState.btcAddresses.map(x => ({ address: x.address }));
    localStorage.setItem('zw_btc_addrs', JSON.stringify(data)); // legacy fallback
    // Juga simpan ke cloud via saveState (per-akun)
    saveState();
  } catch(e) {}
}

function loadBTCAddresses() {
  try {
    const raw = localStorage.getItem('zw_btc_addrs');
    if (!raw) return;
    const arr = JSON.parse(raw);
    arr.forEach(x => {
      if (isValidBTCAddress(x.address) && !walletState.btcAddresses.find(e => e.address === x.address)) {
        walletState.btcAddresses.push({ address: x.address, btc: null, valueIDR: null, valueUSD: null, loading: true });
      }
    });
    if (walletState.btcAddresses.length > 0) refreshAllBTC();
  } catch(e) {}
}

async function fetchBTCData(address) {
  // Try multiple APIs in order
  const apis = [
    async () => {
      const r = await fetch(`https://mempool.space/api/address/${address}`, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) throw new Error('mempool '+r.status);
      const d = await r.json();
      const satoshi = (d.chain_stats?.funded_txo_sum || 0) - (d.chain_stats?.spent_txo_sum || 0);
      const txCount = (d.chain_stats?.tx_count || 0);
      const unconfirmedTx = (d.mempool_stats?.tx_count || 0);
      return { satoshi, txCount, unconfirmedTx, source: 'mempool.space' };
    },
    async () => {
      const r = await fetch(`https://blockstream.info/api/address/${address}`, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) throw new Error('blockstream '+r.status);
      const d = await r.json();
      const satoshi = (d.chain_stats?.funded_txo_sum || 0) - (d.chain_stats?.spent_txo_sum || 0);
      const txCount = (d.chain_stats?.tx_count || 0);
      return { satoshi, txCount, unconfirmedTx: 0, source: 'blockstream.info' };
    },
    async () => {
      const r = await fetch(`https://blockchain.info/rawaddr/${address}?limit=0`, {signal: AbortSignal.timeout(8000)});
      if (!r.ok) throw new Error('blockchain.info '+r.status);
      const d = await r.json();
      return { satoshi: d.final_balance || 0, txCount: d.n_tx || 0, unconfirmedTx: 0, source: 'blockchain.info' };
    }
  ];
  for (const api of apis) {
    try { return await api(); } catch(e) { console.warn('[BTC]', e.message); }
  }
  throw new Error('All BTC APIs failed');
}

async function fetchBTCSingle(entry) {
  entry.loading = true;
  try {
    const { satoshi, txCount, unconfirmedTx, source } = await fetchBTCData(entry.address);
    entry.btc = satoshi / 1e8;
    entry.txCount = txCount;
    entry.unconfirmedTx = unconfirmedTx;
    entry.dataSource = source;

    // BTC price — try multiple sources
    try {
      const [priceIDR, priceUSD] = await fetchBTCPrice();
      entry.valueIDR = priceIDR ? entry.btc * priceIDR : null;
      entry.valueUSD = priceUSD ? entry.btc * priceUSD : null;
      entry._btcPriceIDR = priceIDR;
      entry._btcPriceUSD = priceUSD;
    } catch(e) {}
  } catch(e) {
    console.warn('[BTC] fetch error for', entry.address, e);
    entry.btc = null;
    entry.error = e.message;
  } finally {
    entry.loading = false;
  }
}

async function fetchBTCPrice() {
  // Try CoinGecko first, then fallback
  try {
    const pr = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,idr', {signal: AbortSignal.timeout(6000)});
    if (pr.ok) {
      const pd = await pr.json();
      if (pd?.bitcoin?.usd) return [pd.bitcoin.idr, pd.bitcoin.usd];
    }
  } catch(e) {}
  try {
    const pr = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', {signal: AbortSignal.timeout(6000)});
    if (pr.ok) {
      const pd = await pr.json();
      const usd = parseFloat(pd?.data?.amount);
      if (usd) return [null, usd]; // no IDR from coinbase
    }
  } catch(e) {}
  return [null, null];
}

async function refreshAllBTC() {
  if (!walletState.btcAddresses.length) return;
  // Fetch BTC price once, reuse for all
  let priceIDR = null, priceUSD = null;
  try { [priceIDR, priceUSD] = await fetchBTCPrice(); } catch(e) {}

  await Promise.all(walletState.btcAddresses.map(async entry => {
    try {
      const { satoshi, txCount, unconfirmedTx, source } = await fetchBTCData(entry.address);
      entry.btc = satoshi / 1e8;
      entry.txCount = txCount;
      entry.unconfirmedTx = unconfirmedTx;
      entry.dataSource = source;
      entry.valueIDR = priceIDR ? entry.btc * priceIDR : null;
      entry.valueUSD = priceUSD ? entry.btc * priceUSD : null;
      entry._btcPriceIDR = priceIDR;
      entry._btcPriceUSD = priceUSD;
      entry.loading = false;
      entry.error = null;
    } catch(e) { entry.loading = false; entry.error = e.message; }
  }));
  renderBTCAddrList();
  renderPort();
}

function renderBTCAddrList() {
  const el = document.getElementById('btc-addr-list');
  if (!el) return;
  if (!walletState.btcAddresses.length) { el.innerHTML = ''; return; }
  el.innerHTML = walletState.btcAddresses.map((entry, idx) => {
    const isLoading = entry.loading;
    const hasError  = !isLoading && entry.btc === null;
    const btcAmt    = !isLoading && entry.btc !== null ? entry.btc.toFixed(8) : null;
    const usdVal    = entry.valueUSD != null ? '$' + entry.valueUSD.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : null;
    const idrVal    = entry.valueIDR != null ? fmtIDR(entry.valueIDR) : null;
    const txCount   = entry.txCount != null ? entry.txCount.toLocaleString() : null;
    const priceUSD  = entry._btcPriceUSD ? '$' + entry._btcPriceUSD.toLocaleString('en-US',{maximumFractionDigits:0}) : null;
    const label     = walletState.btcAddresses.length > 1 ? `BTC Wallet #${idx+1}` : 'BTC Wallet';

    if (isLoading) return `
      <div style="background:linear-gradient(135deg,rgba(245,158,11,.08),rgba(245,158,11,.04));border:1px solid rgba(245,158,11,.3);border-radius:14px;padding:1rem 1.1rem;display:flex;align-items:center;gap:.8rem">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(245,158,11,.15);display:flex;align-items:center;justify-content:center;font-size:1rem;animation:pulse 1.5s infinite">₿</div>
        <div style="flex:1">
          <div style="font-size:.75rem;font-weight:700;color:var(--accent4);margin-bottom:.2rem">${label}</div>
          <div style="font-size:.65rem;color:var(--muted);font-family:'Space Mono',monospace">${truncateAddr(entry.address)}</div>
          <div style="margin-top:.5rem;display:flex;gap:.4rem;align-items:center">
            <div style="width:60px;height:8px;border-radius:4px;background:rgba(245,158,11,.15);animation:pulse 1.5s infinite"></div>
            <div style="font-size:.62rem;color:var(--muted)">Memuat saldo...</div>
          </div>
        </div>
      </div>`;

    if (hasError) return `
      <div style="background:linear-gradient(135deg,rgba(239,68,68,.08),rgba(239,68,68,.04));border:1px solid rgba(239,68,68,.3);border-radius:14px;padding:1rem 1.1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <div style="display:flex;align-items:center;gap:.7rem">
            <div style="width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,.15);display:flex;align-items:center;justify-content:center;font-size:1rem;color:#f87171">₿</div>
            <div>
              <div style="font-size:.75rem;font-weight:700;color:#f87171;margin-bottom:.15rem">${label}</div>
              <div style="font-size:.63rem;color:var(--muted);font-family:'Space Mono',monospace">${truncateAddr(entry.address)}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:.4rem">
            <span style="font-size:.65rem;color:#f87171;font-weight:700;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.25);border-radius:6px;padding:.15rem .5rem">Gagal Fetch</span>
            <button onclick="fetchBTCSingle(walletState.btcAddresses[${idx}]).then(()=>{renderBTCAddrList();renderPort();})" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:6px;padding:.2rem .5rem;font-size:.62rem;color:var(--accent4);cursor:pointer;font-weight:700">↺ Retry</button>
            <button onclick="removeBTCAddress('${entry.address}')" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:6px;padding:.2rem .45rem;font-size:.65rem;color:#f87171;cursor:pointer;font-weight:700">✕</button>
          </div>
        </div>
        <div style="margin-top:.6rem;font-size:.62rem;color:rgba(239,68,68,.7);background:rgba(239,68,68,.05);border-radius:6px;padding:.3rem .6rem">
          ⚠ Tidak dapat terhubung ke API. Coba lagi atau periksa koneksi internet.
        </div>
      </div>`;

    return `
      <div style="background:linear-gradient(135deg,rgba(245,158,11,.09) 0%,rgba(250,120,0,.05) 50%,rgba(11,17,32,1) 100%);border:1px solid rgba(245,158,11,.35);border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(245,158,11,.08)">
        <!-- Header row -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.8rem 1rem .5rem">
          <div style="display:flex;align-items:center;gap:.65rem">
            <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:900;color:#000;box-shadow:0 2px 10px rgba(245,158,11,.4)">₿</div>
            <div>
              <div style="font-size:.78rem;font-weight:800;color:var(--accent4);letter-spacing:.01em">${label}</div>
              <div style="display:flex;align-items:center;gap:.35rem;margin-top:.1rem">
                <span style="font-size:.6rem;color:var(--muted);font-family:'Space Mono',monospace">${truncateAddr(entry.address)}</span>
                <span style="font-size:.52rem;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.25);border-radius:4px;padding:.05rem .35rem;color:#10b981;font-weight:700">READ-ONLY</span>
              </div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:.4rem">
            <button onclick="(async()=>{walletState.btcAddresses[${idx}].loading=true;renderBTCAddrList();await fetchBTCSingle(walletState.btcAddresses[${idx}]);renderBTCAddrList();renderPort();})()" title="Refresh" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:7px;padding:.25rem .5rem;font-size:.65rem;color:var(--accent4);cursor:pointer;font-weight:700;transition:all .2s">↺</button>
            <button onclick="removeBTCAddress('${entry.address}')" title="Hapus" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:7px;padding:.25rem .45rem;font-size:.65rem;color:#f87171;cursor:pointer;font-weight:700">✕</button>
          </div>
        </div>
        <!-- Balance section -->
        <div style="padding:.3rem 1rem .7rem;border-bottom:1px solid rgba(245,158,11,.1)">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:.2rem">Total Saldo</div>
          <div style="display:flex;align-items:baseline;gap:.5rem;flex-wrap:wrap">
            <span style="font-family:'Space Mono',monospace;font-size:1.35rem;font-weight:700;color:var(--accent4)">${btcAmt} BTC</span>
            ${usdVal ? `<span style="font-size:.8rem;color:var(--muted);font-weight:500">${usdVal}</span>` : ''}
          </div>
          ${idrVal ? `<div style="font-family:'Space Mono',monospace;font-size:.75rem;color:rgba(245,158,11,.7);margin-top:.15rem">≈ ${idrVal}</div>` : ''}
        </div>
        <!-- Stats row -->
        <div style="display:flex;gap:0;padding:.55rem 1rem">
          ${priceUSD ? `
          <div style="flex:1;display:flex;flex-direction:column;gap:.1rem">
            <div style="font-size:.55rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Harga BTC</div>
            <div style="font-family:'Space Mono',monospace;font-size:.75rem;font-weight:700;color:var(--text)">${priceUSD}</div>
          </div>` : ''}
          ${txCount != null ? `
          <div style="flex:1;display:flex;flex-direction:column;gap:.1rem">
            <div style="font-size:.55rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Total TX</div>
            <div style="font-family:'Space Mono',monospace;font-size:.75rem;font-weight:700;color:var(--text)">${txCount}</div>
          </div>` : ''}
          <div style="flex:1;display:flex;flex-direction:column;gap:.1rem">
            <div style="font-size:.55rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Network</div>
            <div style="font-size:.72rem;font-weight:700;color:#10b981">● Mainnet</div>
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:.1rem;align-items:flex-end">
            <div style="font-size:.55rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Explorer</div>
            <a href="https://mempool.space/address/${entry.address}" target="_blank" style="font-size:.65rem;color:var(--accent4);text-decoration:none;font-weight:700;display:flex;align-items:center;gap:.2rem">View <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════
//  EVM WALLET (MetaMask / OKX / Phantom)
// ══════════════════════════════════════════

async function fetchAllTokens(address, chainId) {
  const chain = CHAIN_SLUG[chainId] || 'eth';
  const headers = { 'accept':'application/json','X-API-Key': MORALIS_API_KEY };
  let nativeBalance = 0;
  try {
    const r = await fetch(`https://deep-index.moralis.io/api/v2.2/${address}/balance?chain=${chain}`, { headers });
    if (r.ok) { const d = await r.json(); nativeBalance = Number(d.balance||0)/1e18; }
  } catch(e) {}
  let erc20Tokens = [];
  try {
    const r = await fetch(`https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${chain}&exclude_spam=true&exclude_unverified_contracts=true`, { headers });
    if (r.ok) {
      const d = await r.json();
      const items = Array.isArray(d) ? d : (d.result||[]);
      erc20Tokens = items.filter(t=>t.balance&&t.balance!=='0').map(t=>({
        symbol:(t.symbol||'?').toUpperCase(), name:t.name||t.symbol||'Unknown',
        address:t.token_address, balance:Number(t.balance)/Math.pow(10,Number(t.decimals||18)),
        logo:t.logo||t.thumbnail||null, decimals:Number(t.decimals||18), usdPrice:t.usd_price||null,
      }));
    }
  } catch(e) {}
  return { nativeBalance, erc20Tokens };
}

async function fetchAllTokensFallback(address) {
  let nativeBalance = 0;
  try {
    const hex = await window.ethereum.request({ method:'eth_getBalance', params:[address,'latest'] });
    nativeBalance = Number(BigInt(hex))/1e18;
  } catch(e) {}
  return { nativeBalance, erc20Tokens: [] };
}

async function fetchTokenPrices(nativeSymbol, erc20Tokens, chainId) {
  const priceMap = {};
  const cgPlatform = COINGECKO_PLATFORM[chainId] || 'ethereum';
  const nativeCGId = NATIVE_CG_ID[nativeSymbol] || 'ethereum';
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${nativeCGId}&vs_currencies=usd,idr`);
    if (r.ok) { const d = await r.json(); if(d[nativeCGId]) priceMap[nativeSymbol]=d[nativeCGId]; }
  } catch(e) {}
  const contractAddrs = erc20Tokens.filter(t=>t.address).slice(0,48).map(t=>t.address).join(',');
  if (contractAddrs) {
    try {
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/token_price/${cgPlatform}?contract_addresses=${contractAddrs}&vs_currencies=usd,idr`);
      if (r.ok) {
        const d = await r.json();
        erc20Tokens.forEach(t=>{ const a=t.address?.toLowerCase(); if(a&&d[a]) priceMap[t.symbol]=d[a]; });
      }
    } catch(e) {}
  }
  erc20Tokens.forEach(t=>{ if(!priceMap[t.symbol]&&t.usdPrice) priceMap[t.symbol]={usd:t.usdPrice,idr:t.usdPrice*(S.usdIdr||16000)}; });
  return priceMap;
}

async function fetchWalletTokens(address, chainId) {
  walletState.loading = true;
  walletState.tokens = [];
  updateWalletUI();
  renderPort();
  try {
    let result;
    const isMoralisKeySet = MORALIS_API_KEY && !MORALIS_API_KEY.includes('GANTI');
    if (isMoralisKeySet) {
      try { result = await fetchAllTokens(address, chainId); }
      catch(e) { result = await fetchAllTokensFallback(address); }
    } else {
      result = await fetchAllTokensFallback(address);
      if (walletState.tokens.length === 0) toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Set MORALIS_API_KEY untuk lihat semua ERC-20 token', 1);
    }
    const { nativeBalance, erc20Tokens } = result;
    const nativeSym = NATIVE_SYMBOL[chainId] || 'ETH';
    const allTokens = [];
    allTokens.push({ symbol:nativeSym, name:CHAIN_NAME[chainId]||nativeSym, balance:nativeBalance, isNative:true, chainId, valueUSD:null, valueIDR:null, priceUSD:null, priceIDR:null });
    erc20Tokens.forEach(t => allTokens.push({ symbol:t.symbol, name:t.name, balance:t.balance, isNative:false, address:t.address, logo:t.logo, chainId, valueUSD:null, valueIDR:null, priceUSD:t.usdPrice||null, priceIDR:t.usdPrice?t.usdPrice*(S.usdIdr||16000):null }));
    walletState.tokens = allTokens;
    walletState.loading = false;
    renderPort();
    const priceMap = await fetchTokenPrices(nativeSym, erc20Tokens, chainId);
    walletState.tokens = walletState.tokens.map(t => {
      const p = priceMap[t.symbol];
      const priceUSD = p?.usd||t.priceUSD||null, priceIDR = p?.idr||t.priceIDR||null;
      return { ...t, priceUSD, priceIDR, valueUSD:priceUSD?t.balance*priceUSD:null, valueIDR:priceIDR?t.balance*priceIDR:null };
    });
    walletState.tokens.sort((a,b) => { if(a.isNative&&!b.isNative)return -1; if(!a.isNative&&b.isNative)return 1; return(b.valueUSD||0)-(a.valueUSD||0); });
    updateWalletUI();
    renderPort();
  } catch(e) {
    console.error('[Wallet] fetchWalletTokens:', e);
    walletState.loading = false;
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Gagal memuat token wallet', 1);
    updateWalletUI(); renderPort();
  }
}

// ── OKX: also fetch BTC address automatically
async function tryFetchOKXBTC(provider) {
  try {
    if (!provider.btc) return;
    const res = await provider.btc.getAccounts();
    const btcAddr = Array.isArray(res) ? res[0] : res?.address;
    if (!btcAddr || !isValidBTCAddress(btcAddr)) return;
    if (walletState.btcAddresses.find(x => x.address === btcAddr)) return;
    const entry = { address: btcAddr, btc: null, valueIDR: null, valueUSD: null, loading: true, _auto: true };
    walletState.btcAddresses.push(entry);
    saveBTCAddresses();
    renderBTCAddrList();
    await fetchBTCSingle(entry);
    renderBTCAddrList();
    renderPort();
    toast('₿ BTC address OKX ditemukan & ditambahkan!');
  } catch(e) { console.warn('[OKX BTC]', e); }
}

// ── Phantom: also fetch BTC address automatically
async function tryFetchPhantomBTC(provider) {
  try {
    if (!provider.btc) return;
    const res = await provider.btc.requestAccounts();
    const btcAddr = Array.isArray(res) ? res[0]?.address || res[0] : null;
    if (!btcAddr || !isValidBTCAddress(btcAddr)) return;
    if (walletState.btcAddresses.find(x => x.address === btcAddr)) return;
    const entry = { address: btcAddr, btc: null, valueIDR: null, valueUSD: null, loading: true, _auto: true };
    walletState.btcAddresses.push(entry);
    saveBTCAddresses();
    renderBTCAddrList();
    await fetchBTCSingle(entry);
    renderBTCAddrList();
    renderPort();
    toast('₿ BTC address Phantom ditemukan & ditambahkan!');
  } catch(e) { console.warn('[Phantom BTC]', e); }
}

// ══════════════════════════════════════════
//  WALLET CONNECT MODAL — openWalletModal
// ══════════════════════════════════════════

// ── Debug helper: log semua provider info ke toast (aktif sementara) ──
function debugWalletEnv() {
  const info = {
    hasEthereum: !!window.ethereum,
    hasOkxwallet: !!window.okxwallet,
    hasPhantom: !!window.phantom,
    eth_isMetaMask: window.ethereum?.isMetaMask,
    eth_isOKExWallet: window.ethereum?.isOKExWallet,
    eth_isOKX: window.ethereum?.isOKX,
    eth_isOkxWallet: window.ethereum?.isOkxWallet,
    eth_isTrust: window.ethereum?.isTrust,
    eth_isTrustWallet: window.ethereum?.isTrustWallet,
    eth_isCoinbaseWallet: window.ethereum?.isCoinbaseWallet,
    okx_keys: window.okxwallet ? Object.keys(window.okxwallet).slice(0,8).join(',') : 'N/A',
    eth_keys: window.ethereum ? Object.keys(window.ethereum).filter(k => k.startsWith('is')).join(',') : 'N/A',
    ua_short: navigator.userAgent.slice(0,60),
  };
  console.log('[z-wealth wallet debug]', JSON.stringify(info, null, 2));
  // Tampilkan ringkasan ke toast
  const flags = info.eth_keys || 'tidak ada flag';
  const provider = info.hasOkxwallet ? 'window.okxwallet ✅' : (info.hasEthereum ? 'window.ethereum' : '❌ tidak ada provider');
  toast(`🔍 Provider: ${provider}<br>Flags: ${flags}`, 3);
}

function openWalletModal() {
  // ── Jika sudah di dalam mobile wallet browser, langsung connect — tidak perlu buka modal
  // Popup konfirmasi "Terima / Tolak" akan muncul otomatis dari wallet app
  // Deteksi apakah sedang di dalam mobile wallet in-app browser
  // Cek berbagai flag + UserAgent
  const ua = navigator.userAgent || '';
  const isMobileOS = /Android|iPhone|iPad|iPod/i.test(ua);
  const hasEthProvider = !!window.ethereum || !!window.okxwallet || !!window.okexchain;
  const isWalletUA = /OKX|OKEx|OkxWallet|MetaMask|TrustWallet|Trust\s?Wallet|CoinbaseBrowser/i.test(ua);
  const hasWalletFlag = !!(
    window.ethereum?.isOKExWallet || window.ethereum?.isOKX || window.ethereum?.isOkxWallet ||
    window.ethereum?.isTrust || window.ethereum?.isTrustWallet ||
    window.ethereum?.isCoinbaseWallet || window.ethereum?.isCoinbaseBrowser ||
    window.ethereum?.isMetaMask || window.okxwallet || window.okexchain
  );
  const isMobileWalletBrowser = isMobileOS && hasEthProvider && (isWalletUA || hasWalletFlag);

  if (isMobileWalletBrowser) {
    // Sudah di dalam wallet browser — langsung trigger eth_requestAccounts
    // Popup "Terima / Tolak" akan muncul otomatis dari wallet app
    connectWalletExtension(null);
    return;
  }

  const overlay = document.getElementById('wc-modal-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  }
  // Reset status msg
  const st = document.getElementById('wc-ext-status');
  if (st) { st.style.display='none'; st.textContent=''; }
}

function closeWalletModal(event, force) {
  if (!force && event && event.target !== document.getElementById('wc-modal-overlay')) return;
  const overlay = document.getElementById('wc-modal-overlay');
  if (overlay) { overlay.style.display='none'; overlay.classList.remove('open'); }
}

// ── Opsi 1: Connect via Browser Extension ──
async function connectWalletExtension(preferredName) {
  const overlay = document.getElementById('wc-modal-overlay');
  const statusEl = document.getElementById('wc-ext-status');

  const providers = detectProviders();

  // ── Deteksi apakah sedang di dalam mobile in-app browser wallet
  const isMobileWalletBrowser = !!(
    window.ethereum && (
      window.ethereum.isOKExWallet || window.ethereum.isOKX || window.ethereum.isOkxWallet ||
      window.ethereum.isTrust || window.ethereum.isTrustWallet ||
      window.ethereum.isCoinbaseWallet || window.ethereum.isCoinbaseBrowser ||
      window.ethereum.isMetaMask
    ) && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );

  // Cari provider yang dipilih, atau fallback ke yang tersedia
  let chosen = null;
  if (preferredName) {
    chosen = providers.find(p => p.name === preferredName) || null;
  }
  // Jika di mobile in-app browser dan provider tidak ketemu by name,
  // langsung pakai provider pertama yang ada (popup konfirmasi wallet akan muncul otomatis)
  if (!chosen && isMobileWalletBrowser) {
    chosen = providers[0] || { name: preferredName || 'Wallet', evm: window.ethereum, btc: null };
  }
  if (!chosen) {
    // Desktop: coba urutan prioritas
    const order = ['OKX','Phantom','MetaMask','Trust Wallet','Coinbase Wallet','Browser Wallet'];
    for (const name of order) { const p = providers.find(x=>x.name===name); if(p){chosen=p;break;} }
  }

  if (!chosen) {
    if (statusEl) {
      statusEl.style.display = 'block';
      const installLinks = {
        MetaMask: 'https://metamask.io/download/',
        OKX: 'https://www.okx.com/id/web3',
        Phantom: 'https://phantom.app/',
        'Trust Wallet': 'https://trustwallet.com/download',
        'Coinbase Wallet': 'https://www.coinbase.com/wallet/downloads'
      };
      const link = installLinks[preferredName] || '#';
      statusEl.innerHTML = `Extension <b>${preferredName||'wallet'}</b> tidak terdeteksi di browser ini.<br><small style="opacity:.8">Jika pakai HP, gunakan Opsi 2 (Wallet App).</small><br><a href="${link}" target="_blank" style="color:var(--accent);font-weight:700">Install extension →</a>`;
    }
    return;
  }

  // Tutup modal, lanjut proses connect
  if (overlay) { overlay.style.display='none'; overlay.classList.remove('open'); }

  const btn = document.getElementById('btn-connect-wallet');
  const lbl = document.getElementById('wallet-btn-label');
  if (btn) btn.disabled = true;
  if (lbl) lbl.textContent = 'Menghubungkan...';

  try {
    const evmProvider = chosen.evm;
    const accounts = await evmProvider.request({ method:'eth_requestAccounts' });
    if (!accounts || !accounts.length) { toast('Tidak ada akun yang dipilih.', 1); return; }
    const address = accounts[0];
    const chainHex = await evmProvider.request({ method:'eth_chainId' });
    const chainId = parseInt(chainHex, 16);

    walletState.connected = true;
    walletState.providerName = chosen.name;
    walletState.address = address;
    walletState.chainId = chainId;
    walletState.tokens = [];
    walletState.loading = true;

    updateWalletUI();
    toast(`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> ${chosen.name} terhubung! Memuat semua token...`);

    await fetchWalletTokens(address, chainId);
    // Simpan EVM address ke cloud agar auto-load saat login kembali
    saveState();

    if (chosen.name === 'OKX') tryFetchOKXBTC(chosen);
    if (chosen.name === 'Phantom') tryFetchPhantomBTC(chosen);

    if (walletState.refreshInterval) clearInterval(walletState.refreshInterval);
    walletState.refreshInterval = setInterval(() => {
      if (walletState.connected) fetchWalletTokens(walletState.address, walletState.chainId);
    }, 60000);
    if (walletState.btcRefreshInterval) clearInterval(walletState.btcRefreshInterval);
    walletState.btcRefreshInterval = setInterval(() => {
      if (walletState.btcAddresses.length) refreshAllBTC();
    }, 120000);

    evmProvider.on?.('accountsChanged', accs => {
      if (!accs||!accs.length) { disconnectWallet(); return; }
      walletState.address = accs[0]; updateWalletUI();
      fetchWalletTokens(accs[0], walletState.chainId);
    });
    evmProvider.on?.('chainChanged', hex => {
      walletState.chainId = parseInt(hex,16);
      walletState.tokens = [];
      fetchWalletTokens(walletState.address, walletState.chainId);
    });
  } catch(e) {
    if (e.code===4001) toast('Koneksi wallet dibatalkan.', 1);
    else toast('Gagal connect: '+(e.message||e), 2);
    if (lbl) lbl.textContent = 'Connect Wallet';
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Opsi 2: Deep Link ke Wallet App di HP ──
function openWalletApp(walletName) {
  const rawUrl   = window.location.href;
  const encUrl   = encodeURIComponent(rawUrl);
  const host     = window.location.hostname;
  const pathname = window.location.pathname;

  // ── Deep link per wallet — langsung buka dApp browser dengan URL z-Wealth ──
  const deepLinks = {

    metamask: {
      name: 'MetaMask',
      // Universal link resmi MetaMask — langsung buka dApp browser
      primary:  `https://metamask.app.link/dapp/${host}${pathname}`,
      fallback: 'https://metamask.io/download/'
    },

    okx: {
      name: 'OKX Wallet',
      // Format resmi OKX Web3 browser deep link
      // okx://wallet/dapp/url?dappUrl=<encoded> → buka dApp browser OKX langsung ke URL
      primary:  `okx://wallet/dapp/url?dappUrl=${encUrl}`,
      // HTTP universal link sebagai fallback (lebih reliable di beberapa Android)
      secondary: `https://www.okx.com/ul/szKO5i?dappUrl=${encUrl}`,
      fallback: 'https://www.okx.com/web3'
    },

    trust: {
      name: 'Trust Wallet',
      // Universal link Trust Wallet — buka dApp browser langsung ke URL
      primary:  `https://link.trustwallet.com/open_url?coin_id=60&url=${encUrl}`,
      // Custom scheme sebagai alternatif
      secondary: `trust://browser?url=${encUrl}`,
      fallback: 'https://trustwallet.com/download'
    },

    coinbase: {
      name: 'Coinbase Wallet',
      // Universal link Coinbase Wallet
      primary:  `https://go.cb-w.com/dapp?cb_url=${encUrl}`,
      secondary: `cbwallet://dapp?url=${encUrl}`,
      fallback: 'https://www.coinbase.com/wallet/downloads'
    }
  };

  const config = deepLinks[walletName];
  if (!config) return;

  // Cek apakah mobile
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) {
    toast(`📱 Fitur ini untuk HP. Di desktop pakai Opsi 1 (Extension).`, 2);
    return;
  }

  closeWalletModal(null, true);
  toast(`🚀 Membuka ${config.name}...`, 1);

  // Strategi: coba primary link dulu
  // Untuk OKX: custom scheme (okx://) paling reliable untuk buka dApp browser langsung
  // Untuk yang lain: HTTP universal link lebih reliable
  if (walletName === 'okx') {
    // Coba custom scheme okx:// dulu — ini yang buka dApp browser OKX
    // Jika gagal (app tidak ada), fallback ke secondary HTTP link
    const start = Date.now();
    window.location.href = config.primary;
    setTimeout(() => {
      // Jika masih di halaman ini setelah 1.5s, berarti custom scheme gagal
      if (Date.now() - start < 2000) {
        window.location.href = config.secondary;
      }
    }, 1500);
  } else {
    // Untuk MetaMask, Trust, Coinbase: HTTP universal link langsung (lebih reliable)
    window.location.href = config.primary;
  }
}

// ── Copy URL z-Wealth untuk dibuka di wallet browser ──
function copyZWealthURL() {
  const url = window.location.href;
  const lbl = document.getElementById('wc-copy-label');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      if (lbl) lbl.textContent = '✅ URL tersalin!';
      setTimeout(() => { if (lbl) lbl.textContent = 'Salin URL z-Wealth ini'; }, 2500);
    });
  } else {
    // Fallback untuk browser lama
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (lbl) lbl.textContent = '✅ URL tersalin!';
      setTimeout(() => { if (lbl) lbl.textContent = 'Salin URL z-Wealth ini'; }, 2500);
    } catch(e) {
      if (lbl) lbl.textContent = url;
    }
    document.body.removeChild(ta);
  }
}

// ── WalletConnect: QR modal menggunakan wc.js lokal ──
let _wcProvider = null;
let _wcConnecting = false;

async function openWalletConnect() {
  closeWalletModal(null, true);
  if (_wcConnecting) { toast('⏳ Sedang menghubungkan...', 1); return; }

  // wc.js menyimpan provider di window["@walletconnect/ethereum-provider"]
  const wcPkg = window['@walletconnect/ethereum-provider'];
  const EthereumProvider =
    wcPkg?.EthereumProvider ||
    wcPkg?.default?.EthereumProvider ||
    (typeof wcPkg === 'function' ? wcPkg : null) ||
    window.WalletConnectEthereumProvider?.EthereumProvider ||
    window.EthereumProvider;

  if (!EthereumProvider) {
    toast('❌ Library WalletConnect tidak tersedia. Coba refresh halaman.', 2);
    return;
  }

  _wcConnecting = true;
  const btn = document.getElementById('btn-connect-wallet');
  const lbl = document.getElementById('wallet-btn-label');
  if (lbl) lbl.textContent = 'Menghubungkan...';
  if (btn) btn.disabled = true;

  try {
    _wcProvider = await EthereumProvider.init({
      projectId: 'dec35dd23f44d3a833556dd8ff806420',
      chains: [1],
      optionalChains: [56, 137, 42161, 10, 43114, 8453],
      showQrModal: true,
      qrModalOptions: {
        themeMode: 'dark',
        themeVariables: {
          '--wcm-accent-color': '#00e5ff',
          '--wcm-background-color': '#0b1120',
          '--wcm-z-index': '700',
        },
        explorerRecommendedWalletIds: [
          '971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709',
          'c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96',
          '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0',
        ],
      },
      metadata: {
        name: 'z-Wealth',
        description: 'Bitcoin DCA Tracker',
        url: window.location.origin,
        icons: [window.location.origin + '/icon-192.png'],
      },
    });

    _wcProvider.on('connect', async () => {
      try {
        const accounts = _wcProvider.accounts;
        const chainId  = _wcProvider.chainId;
        if (!accounts?.[0]) return;
        walletState.connected    = true;
        walletState.providerName = 'WalletConnect';
        walletState.address      = accounts[0];
        walletState.chainId      = chainId || 1;
        walletState.tokens       = [];
        walletState.loading      = true;
        updateWalletUI();
        toast('✅ Wallet terhubung via WalletConnect!');
        await fetchWalletTokens(accounts[0], chainId || 1);
        // Simpan ke cloud agar melekat ke akun ini
        saveState();
        if (walletState.refreshInterval) clearInterval(walletState.refreshInterval);
        walletState.refreshInterval = setInterval(() => {
          if (walletState.connected) fetchWalletTokens(walletState.address, walletState.chainId);
        }, 60000);
      } catch(e) { console.error('[WC connect]', e); }
    });

    _wcProvider.on('disconnect', () => {
      if (walletState.providerName === 'WalletConnect') disconnectWallet();
    });

    await _wcProvider.connect();

  } catch(e) {
    const msg = e?.message || String(e);
    if (msg.includes('rejected') || e?.code === 4001) {
      toast('Koneksi WalletConnect dibatalkan.', 1);
    } else {
      toast('❌ WalletConnect: ' + msg, 2);
    }
  } finally {
    _wcConnecting = false;
    if (lbl) lbl.textContent = 'Connect Wallet';
    if (btn) btn.disabled = false;
  }
}


// ── connectWallet() tetap ada sebagai alias untuk backward compat ──
async function connectWallet() {
  openWalletModal();
}

function disconnectWallet() {
  walletState.connected = false;
  walletState.providerName = null;
  walletState.address = null;
  walletState.chainId = null;
  walletState.tokens = [];
  // Hapus EVM address dari cloud juga saat disconnect
  saveState();
  walletState.loading = false;
  if (walletState.refreshInterval) { clearInterval(walletState.refreshInterval); walletState.refreshInterval=null; }
  updateWalletUI();
  renderPort();
  toast('Wallet EVM terputus.');
}

function updateWalletUI() {
  const bar     = document.getElementById('wallet-status-bar');
  const btnLabel = document.getElementById('wallet-btn-label');
  const addrEl  = document.getElementById('wallet-address-display');
  const btn     = document.getElementById('btn-connect-wallet');
  const chainEl = document.getElementById('wallet-chain-display');
  const provEl  = document.getElementById('wallet-provider-badge');
  const balEl   = document.getElementById('wallet-balance-display');
  const ldEl    = document.getElementById('wallet-balance-loading');

  if (walletState.connected && walletState.address) {
    if (bar) bar.style.display = 'flex';
    if (addrEl) addrEl.textContent = truncateAddr(walletState.address);
    if (chainEl) chainEl.textContent = CHAIN_NAME[walletState.chainId]||'Chain '+walletState.chainId;
    if (provEl) {
      const col = PROVIDER_COLOR[walletState.providerName]||'#a78bfa';
      provEl.textContent = walletState.providerName||'Wallet';
      provEl.style.color = col;
      provEl.style.borderColor = col+'55';
      provEl.style.background = col+'18';
    }
    if (btnLabel) btnLabel.textContent = walletState.providerName==='Read-Only' ? 'Wallet Terhubung' : `${walletState.providerName||'Wallet'} ✓`;
    if (btn) { btn.style.background='rgba(124,58,237,.15)'; btn.style.borderColor='rgba(167,139,250,.5)'; btn.style.color='#a78bfa'; }
    if (walletState.loading && walletState.tokens.length===0) {
      if (ldEl) ldEl.style.display='inline-block';
      if (balEl) balEl.textContent='Memuat...';
    } else {
      if (ldEl) ldEl.style.display='none';
      const totalUSD = walletState.tokens.reduce((s,t)=>s+(t.valueUSD||0),0);
      const totalIDR = walletState.tokens.reduce((s,t)=>s+(t.valueIDR||0),0);
      if (balEl) {
        balEl.textContent = walletState.tokens.length+' token · $'+totalUSD.toLocaleString('en-US',{maximumFractionDigits:2});
        balEl.title = totalIDR>0?'≈ '+fmtIDR(totalIDR):'';
      }
    }
  } else {
    if (bar) bar.style.display='none';
    if (btnLabel) btnLabel.textContent='Connect Wallet';
    if (btn) { btn.style.background='transparent'; btn.style.borderColor='rgba(124,58,237,.6)'; btn.style.color='#a78bfa'; }
    if (balEl) balEl.textContent='—';
    if (ldEl) ldEl.style.display='none';
  }
}


/* ═══════════════════════════════════════════════════════════
   WALLET CHARTS — Alokasi Donut + Histori Nilai Line Chart
   Snapshot disimpan di localStorage, max 720 data points
═══════════════════════════════════════════════════════════ */

let cWalletAlloc = null;
let cWalletHist  = null;
let walletHistRange = 24; // jam
let walletSnapshotInterval = null;

// ── Warna palette untuk token ──
const WALLET_COLORS = [
  '#00e5ff','#7c3aed','#f59e0b','#10b981','#f43f5e',
  '#8b5cf6','#06b6d4','#84cc16','#fb923c','#ec4899',
  '#14b8a6','#a78bfa','#fbbf24','#34d399','#f87171',
];
const BTC_COLOR  = '#f59e0b';
const EVM_COLORS = ['#627EEA','#8247E5','#F3BA2F','#FF0420','#E84142','#0052FF','#1969FF'];

// ── Ambil semua token dari walletState sebagai flat array ──
function getWalletAllAssets() {
  const assets = [];
  // EVM tokens
  if (walletState.connected && walletState.tokens.length) {
    walletState.tokens.forEach((t, i) => {
      if (t.valueIDR && t.valueIDR > 100) { // filter dust < Rp100
        assets.push({
          label: t.symbol,
          valueIDR: t.valueIDR,
          valueUSD: t.valueUSD || 0,
          color: t.isNative ? (EVM_COLORS[i] || WALLET_COLORS[i % WALLET_COLORS.length]) : WALLET_COLORS[i % WALLET_COLORS.length],
          type: 'evm',
        });
      }
    });
  }
  // BTC addresses
  walletState.btcAddresses.forEach((b, i) => {
    if (b.valueIDR && b.valueIDR > 100) {
      assets.push({
        label: 'BTC' + (walletState.btcAddresses.length > 1 ? ` #${i+1}` : ''),
        valueIDR: b.valueIDR,
        valueUSD: b.valueUSD || 0,
        color: i === 0 ? BTC_COLOR : '#fbbf24',
        type: 'btc',
      });
    }
  });
  return assets;
}

// ── Hitung total nilai wallet dalam IDR ──
function getWalletTotalIDR() {
  const evmTotal = walletState.tokens.reduce((s, t) => s + (t.valueIDR || 0), 0);
  const btcTotal = walletState.btcAddresses.reduce((s, b) => s + (b.valueIDR || 0), 0);
  return evmTotal + btcTotal;
}
function getWalletTotalUSD() {
  const evmTotal = walletState.tokens.reduce((s, t) => s + (t.valueUSD || 0), 0);
  const btcTotal = walletState.btcAddresses.reduce((s, b) => s + (b.valueUSD || 0), 0);
  return evmTotal + btcTotal;
}

// ── Snapshot: simpan nilai total ke localStorage tiap 30 menit ──
const SNAP_KEY = 'zw_wallet_snapshots';
const SNAP_MAX = 1440; // max ~30 hari pada interval 30 menit

function saveWalletSnapshot() {
  const totalIDR = getWalletTotalIDR();
  if (totalIDR <= 0) return; // jangan simpan kalau 0
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    const snaps = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    // Hindari duplikat jika interval terlalu rapat (< 5 menit)
    if (snaps.length && (now - snaps[snaps.length-1].t) < 5 * 60 * 1000) {
      // Update snapshot terakhir saja
      snaps[snaps.length-1] = { t: now, v: Math.round(totalIDR) };
    } else {
      snaps.push({ t: now, v: Math.round(totalIDR) });
    }
    // Buang yang terlalu lama (> 30 hari)
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const trimmed = snaps.filter(s => s.t >= cutoff).slice(-SNAP_MAX);
    localStorage.setItem(SNAP_KEY, JSON.stringify(trimmed));
  } catch(e) {}
}

function loadWalletSnapshots(hoursBack) {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return [];
    const snaps = JSON.parse(raw);
    const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
    return snaps.filter(s => s.t >= cutoff);
  } catch(e) { return []; }
}

function setWalletHistRange(hours) {
  walletHistRange = hours;
  ['24','168','720'].forEach(h => {
    const btn = document.getElementById('whr-'+h);
    if (btn) btn.classList.toggle('active', h == hours);
  });
  renderWalletHistChart();
}

// ── Format label waktu singkat ──
function fmtSnapTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffH = (now - d) / 3600000;
  if (diffH < 24) return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
  return (d.getDate()) + '/' + (d.getMonth()+1) + ' ' + d.getHours().toString().padStart(2,'0') + 'h';
}

// ── Render donut alokasi ──
function renderWalletAllocChart() {
  const assets = getWalletAllAssets();
  const section = document.getElementById('wallet-chart-section');
  const legendEl = document.getElementById('wallet-alloc-legend');
  const canvasEl = document.getElementById('c-wallet-alloc');
  if (!canvasEl) return;

  if (!assets.length) {
    if (cWalletAlloc) { cWalletAlloc.destroy(); cWalletAlloc = null; }
    canvasEl.style.opacity = '.3';
    if (legendEl) legendEl.innerHTML = '<div style="font-size:.7rem;color:var(--muted);text-align:center">Belum ada data harga</div>';
    return;
  }
  canvasEl.style.opacity = '1';

  const total = assets.reduce((s, a) => s + a.valueIDR, 0);
  const labels = assets.map(a => a.label);
  const data   = assets.map(a => a.valueIDR);
  const colors = assets.map(a => a.color);

  if (cWalletAlloc) cWalletAlloc.destroy();
  const ctx = canvasEl.getContext('2d');
  cWalletAlloc = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      ...CO,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: item => {
              const val = item.raw;
              const pct = total > 0 ? (val/total*100).toFixed(1) : '0';
              return ` ${fmtIDR(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // Legend manual
  if (legendEl) {
    legendEl.innerHTML = assets.map(a => {
      const pct = total > 0 ? (a.valueIDR/total*100).toFixed(1) : '0';
      return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:.68rem;line-height:1.4">
        <div style="display:flex;align-items:center;gap:.4rem">
          <span style="width:8px;height:8px;border-radius:50%;background:${a.color};flex-shrink:0;display:inline-block"></span>
          <span style="color:var(--text);font-weight:700">${a.label}</span>
        </div>
        <span style="color:var(--muted)">${pct}%</span>
      </div>`;
    }).join('');
  }
}

// ── Render line chart histori ──
function renderWalletHistChart() {
  const snaps = loadWalletSnapshots(walletHistRange);
  const canvasEl = document.getElementById('c-wallet-hist');
  if (!canvasEl) return;

  // Selalu tambahkan snapshot terkini sebagai titik terakhir
  const totalNow = getWalletTotalIDR();
  const displaySnaps = [...snaps];
  if (totalNow > 0) {
    displaySnaps.push({ t: Date.now(), v: Math.round(totalNow) });
  }

  if (displaySnaps.length < 2) {
    if (cWalletHist) { cWalletHist.destroy(); cWalletHist = null; }
    // Tampilkan placeholder jika belum ada histori
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (cWalletHist) return;
    cWalletHist = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Sekarang'],
        datasets: [{
          label: 'Total (IDR)',
          data: [totalNow > 0 ? Math.round(totalNow/1e6) : 0],
          borderColor: '#00e5ff',
          backgroundColor: 'rgba(0,229,255,.08)',
          fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#00e5ff',
        }]
      },
      options: {
        ...CO,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => ' ' + fmtIDR(item.raw * 1e6) } } },
        scales: {
          x: { ticks: TK, grid: getGR() },
          y: { ticks: { ...TK, callback: v => v >= 1000 ? (v/1000)+'M' : v+'jt' }, grid: getGR() }
        }
      }
    });
    return;
  }

  const labels = displaySnaps.map(s => fmtSnapTime(s.t));
  const data   = displaySnaps.map(s => +(s.v / 1e6).toFixed(3));

  // Hitung perubahan
  const first = data[0], last = data[data.length-1];
  const isUp  = last >= first;
  const lineColor = isUp ? '#10b981' : '#f43f5e';
  const fillColor = isUp ? 'rgba(16,185,129,.08)' : 'rgba(244,63,94,.08)';

  if (cWalletHist) cWalletHist.destroy();
  const ctx = canvasEl.getContext('2d');
  cWalletHist = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Wallet (juta IDR)',
        data,
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: .4,
        pointRadius: displaySnaps.length > 50 ? 0 : 3,
        pointBackgroundColor: lineColor,
        borderWidth: 2,
      }]
    },
    options: {
      ...CO,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => {
              const s = displaySnaps[items[0].dataIndex];
              return new Date(s.t).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
            },
            label: item => ' ' + fmtIDR(item.raw * 1e6),
          }
        }
      },
      scales: {
        x: { ticks: { ...TK, maxTicksLimit: 8, maxRotation: 0 }, grid: getGR() },
        y: {
          ticks: { ...TK, callback: v => v >= 1000 ? Math.round(v/1000)+'M' : v.toFixed(1)+'jt' },
          grid: getGR()
        }
      }
    }
  });
}

// ── Summary cards di atas chart ──
function renderWalletSummaryBar() {
  const el = document.getElementById('wallet-summary-bar');
  if (!el) return;

  const totalIDR = getWalletTotalIDR();
  const totalUSD = getWalletTotalUSD();
  const assets = getWalletAllAssets();

  // Hitung perubahan vs snapshot sebelumnya (1 jam lalu)
  const snaps1h = loadWalletSnapshots(1);
  let changePct = null, changeIDR = null;
  if (snaps1h.length >= 1) {
    const oldest = snaps1h[0].v;
    if (oldest > 0) {
      changeIDR = totalIDR - oldest;
      changePct = (changeIDR / oldest) * 100;
    }
  }

  const changeEl = changePct !== null
    ? `<div style="font-size:.7rem;font-weight:700;color:${changePct>=0?'#10b981':'#f43f5e'};margin-top:.15rem">
        ${changePct>=0?'▲':'▼'} ${Math.abs(changePct).toFixed(2)}% (1J)
       </div>`
    : `<div style="font-size:.65rem;color:var(--muted);margin-top:.15rem">Butuh histori 1J+</div>`;

  const tokenCount = assets.length;
  const hasEVM  = walletState.connected;
  const hasBTC  = walletState.btcAddresses.some(b => b.btc !== null);

  // ── Hitung Total Porto (DCA + aset manual, TIDAK termasuk wallet) ──
  const dcaValIDR   = (() => { let tb=0; S.dca.forEach(e=>tb+=e.btcAmount); return tb*(S.btcPrice||0)*(S.usdIdr||16300); })();
  const dcaInvestIDR = (() => { let ti=0; S.dca.forEach(e=>ti+=e.amountIDR); return ti; })();
  // Aset manual di porto (exclude aset auto-sync dari DCA agar tidak double count)
  const manualPortoIDR = S.port
    .filter(x => !(x.ticker?.toLowerCase()==='btc' && x._dcaManaged===true))
    .reduce((s,x) => s + x.qty * x.currentPrice, 0);
  const manualPortoInvest = S.port
    .filter(x => !(x.ticker?.toLowerCase()==='btc' && x._dcaManaged===true))
    .reduce((s,x) => s + x.qty * x.avgPrice, 0);
  const totalPortoIDR   = dcaValIDR + manualPortoIDR;
  const totalPortoInvest = dcaInvestIDR + manualPortoInvest;
  const portoPnlPct = totalPortoInvest > 0 ? (totalPortoIDR - totalPortoInvest) / totalPortoInvest * 100 : null;
  const portoColor  = portoPnlPct === null ? 'var(--muted)' : portoPnlPct >= 0 ? '#10b981' : '#f43f5e';
  const portoArrow  = portoPnlPct !== null ? (portoPnlPct >= 0 ? '▲' : '▼') : '';

  el.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(0,229,255,.08),rgba(124,58,237,.08));border:1px solid rgba(0,229,255,.2);border-radius:12px;padding:.8rem 1rem">
      <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem">Total Wallet</div>
      <div style="font-size:1.1rem;font-weight:900;color:var(--text);font-family:'Space Mono',monospace">
        ${totalIDR > 0 ? fmtIDR(Math.round(totalIDR)) : '<span style="color:var(--muted)">Memuat...</span>'}
      </div>
      <div style="font-size:.7rem;color:var(--muted);margin-top:.1rem">${totalUSD > 0 ? '$'+totalUSD.toLocaleString('en-US',{maximumFractionDigits:2}) : ''}</div>
      ${changeEl}
    </div>
    <div style="background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(245,158,11,.06));border:1px solid rgba(16,185,129,.25);border-radius:12px;padding:.8rem 1rem">
      <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem">Total Porto</div>
      <div style="font-size:1.1rem;font-weight:900;color:var(--text);font-family:'Space Mono',monospace">
        ${totalPortoIDR > 0 ? fmtIDR(Math.round(totalPortoIDR)) : '<span style="color:var(--muted)">—</span>'}
      </div>
      <div style="font-size:.68rem;color:var(--muted);margin-top:.1rem">Modal: ${totalPortoInvest > 0 ? fmtIDR(Math.round(totalPortoInvest)) : '—'}</div>
      ${portoPnlPct !== null
        ? `<div style="font-size:.7rem;font-weight:700;color:${portoColor};margin-top:.15rem">${portoArrow} ${Math.abs(portoPnlPct).toFixed(2)}%</div>`
        : `<div style="font-size:.65rem;color:var(--muted);margin-top:.15rem">DCA + Aset Manual</div>`}
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.8rem 1rem">
      <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem">Jumlah Token</div>
      <div style="font-size:1.1rem;font-weight:900;color:var(--accent);font-family:'Space Mono',monospace">${tokenCount}</div>
      <div style="font-size:.68rem;color:var(--muted);margin-top:.1rem">
        ${hasEVM ? '<span style="color:#a78bfa">● EVM</span> ' : ''}${hasBTC ? '<span style="color:#f59e0b">₿ BTC</span>' : ''}
      </div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.8rem 1rem">
      <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem">Terbesar</div>
      ${assets.length > 0
        ? `<div style="font-size:1rem;font-weight:900;color:${assets.sort((a,b)=>b.valueIDR-a.valueIDR)[0].color};font-family:'Space Mono',monospace">${assets[0].label}</div>
           <div style="font-size:.7rem;color:var(--muted);margin-top:.1rem">${fmtIDR(assets[0].valueIDR)}</div>`
        : `<div style="font-size:.85rem;color:var(--muted)">—</div>`
      }
    </div>
  `;
}

// ── Master render: panggil semua chart wallet ──
function renderWalletCharts() {
  const hasAny = (walletState.connected && walletState.address) || walletState.btcAddresses.some(b => b.btc !== null);
  const section = document.getElementById('wallet-chart-section');
  if (!section) return;

  if (!hasAny) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  renderWalletSummaryBar();
  renderWalletAllocChart();
  renderWalletHistChart();
  saveWalletSnapshot();
}

// ── Auto snapshot tiap 30 menit ──
function startWalletSnapshotInterval() {
  if (walletSnapshotInterval) clearInterval(walletSnapshotInterval);
  walletSnapshotInterval = setInterval(() => {
    if (getWalletTotalIDR() > 0) saveWalletSnapshot();
  }, 30 * 60 * 1000);
}

// ── Hook ke renderPort: tambahkan wallet charts setelah render ──
const _origRenderPort_wallet = renderPort;
renderPort = function() {
  _origRenderPort_wallet();
  renderWalletCharts();
};

// Start snapshot interval on load
startWalletSnapshotInterval();


/* ═══════════════════════════════════════════════════════════
   z-AI CHAT — Gemini 1.5 Flash via Google AI Studio API
   Streaming teks realtime · Riwayat percakapan tersimpan
═══════════════════════════════════════════════════════════ */

const AI_CHAT_SYSTEM = `Kamu adalah z-AI, asisten investasi cerdas yang terintegrasi dalam aplikasi z-wealth — aplikasi Bitcoin DCA Tracker. Kamu ahli dalam:
- Bitcoin, cryptocurrency, dan blockchain
- Strategi DCA (Dollar Cost Averaging)
- Analisis teknikal & fundamental crypto
- Manajemen risiko investasi
- Pasar keuangan Indonesia

Informasi tentang aplikasi ini:
- Nama aplikasi: z-wealth (Bitcoin DCA Tracker)
- Developer / pembuat z-wealth dan z-AI: Zulfan
- Jika ada yang bertanya tentang siapa yang membuat z-AI, z-wealth, developer-nya, pembuatnya, atau pertanyaan serupa — jawab bahwa developernya bernama Zulfan.

Gunakan bahasa Indonesia yang natural dan mudah dipahami. Jawaban terstruktur, padat, dan actionable. Gunakan emoji secukupnya. Selalu ingatkan bahwa analisis ini bukan saran investasi finansial jika relevan.`;

let aiChatHistory = [];    // [{role:'user'|'model', parts:[{text}]}]
let aiIsStreaming = false;
let aiInitialized = false;

// Gemini key telah dipindahkan ke backend (tidak boleh ada di client-side)
// Fitur prediksi sekarang menggunakan callAI (Groq → OpenRouter → Pollinations)
const _BUILT_IN_GEMINI_KEY = ''; // DEPRECATED - key tidak disimpan di client
// Groq API - gratis & cepat (Llama 3.3 70B)
const _GROQ_KEY = ''; // Key disimpan aman di server Vercel, tidak di sini
const _GROQ_URL = '/api/ai?action=groq'; // Proxy aman via Vercel serverless function
const _GROQ_MODEL = 'llama-3.3-70b-versatile';

function getGeminiKey() {
  return localStorage.getItem('zw_gemini_key') || _BUILT_IN_GEMINI_KEY;
}
function getGroqKey() {
  return 'proxy'; // Key ditangani aman oleh server Vercel
}
function saveGeminiKey() {
  const k = document.getElementById('gemini-key-input')?.value?.trim();
  if (!k) { toast('Masukkan API key dulu!', 1); return; }
  localStorage.setItem('zw_gemini_key', k);
  const warnEl = document.getElementById('pred-apikey-warning');
  if (warnEl) warnEl.style.display = 'none';
  toast('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Gemini API key disimpan!');
  runBTCPrediction();
}

function initAIChat() {
  // Load history from localStorage if not yet loaded
  if (!aiInitialized) {
    aiInitialized = true;
    try {
      const saved = localStorage.getItem('zw_ai_chat_history');
      if (saved) aiChatHistory = JSON.parse(saved);
    } catch(e) { aiChatHistory = []; }
  }

  const area = document.getElementById('ai-messages-area');
  if (!area) return;

  if (aiChatHistory.length === 0 && area.children.length === 0) {
    // Welcome message
    appendAIMessage('model', `Halo! Saya **z-AI**, asisten investasi Bitcoin kamu 🤖\n\nSaya bisa membantu kamu dengan:\n- 📈 Analisis & prediksi Bitcoin\n- 💡 Strategi DCA terbaik\n- 📊 Membaca indikator pasar\n- 🎯 Rencana investasi jangka panjang\n\nApa yang ingin kamu tanyakan hari ini?`, Date.now(), true);
  } else if (aiChatHistory.length > 0 && area.children.length === 0) {
    // Re-render history if area is empty
    aiChatHistory.forEach(msg => {
      appendAIMessage(msg.role === 'user' ? 'user' : 'model', msg.parts[0].text, Date.now(), true);
    });
  }
  area.scrollTop = area.scrollHeight;
}

function clearAIChat() {
  if (!confirm('Hapus semua riwayat chat dengan z-AI?')) return;
  aiChatHistory = [];
  localStorage.removeItem('zw_ai_chat_history');
  aiInitialized = false;
  const area = document.getElementById('ai-messages-area');
  if (area) area.innerHTML = '';
  initAIChat();
  toast('Riwayat chat dihapus.');
}

function saveAIChatHistory() {
  try {
    // Simpan max 40 pesan terakhir
    const trimmed = aiChatHistory.slice(-40);
    localStorage.setItem('zw_ai_chat_history', JSON.stringify(trimmed));
  } catch(e) {}
}

// ── Simple markdown → HTML converter ──
function aiMarkdown(text) {
  // Sanitize raw text first to prevent XSS, then apply markdown
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hul])/gm, '')
    .replace(/\n/g, '<br>')
    || safe;
}

function appendAIMessage(role, text, ts, skipHistory) {
  const area = document.getElementById('ai-messages-area');
  if (!area) return null;

  const isUser = role === 'user';
  const time = new Date(ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  const id = 'ai-msg-' + Date.now() + Math.random().toString(36).slice(2,5);

  const row = document.createElement('div');
  row.className = 'msg-row ' + (isUser ? 'mine' : 'theirs');
  row.id = id;

  if (!isUser) {
    // AI avatar
    row.innerHTML = `
      <div class="msg-avatar" style="background:linear-gradient(135deg,#0891b2,#22d3ee);flex-shrink:0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 0 2h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1 0-2h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
      </div>
      <div class="msg-bubble-wrap">
        <div class="msg-sender-name">z-AI</div>
        <div class="msg-bubble">
          <div class="ai-bubble-content" id="${id}-content">${/^\s*<[a-zA-Z]/.test(text) ? text : aiMarkdown(text)}</div>
        </div>
        <div class="msg-time">${time}</div>
      </div>`;
  } else {
    row.innerHTML = `
      <div class="msg-bubble-wrap">
        <div class="msg-sender-name">Kamu</div>
        <div class="msg-bubble">${esc(text).replace(/\n/g,'<br>')}</div>
        <div class="msg-time">${time}</div>
      </div>`;
  }

  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
  return id;
}

function showAITyping() {
  const area = document.getElementById('ai-messages-area');
  if (!area) return;

  // Build provider status pills
  function _providerPill(name, label, icon) {
    const s = _aiProviderStatus[name];
    const ready = !s || s.ok || (Date.now() - s.failedAt > _AI_COOLDOWN_MS);
    const color = ready ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.1)';
    const border = ready ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.25)';
    const textColor = ready ? '#10b981' : '#f87171';
    const dot = ready ? '#10b981' : '#ef4444';
    return `<span style="display:inline-flex;align-items:center;gap:.25rem;background:${color};border:1px solid ${border};border-radius:99px;padding:.12rem .45rem;font-size:.55rem;font-weight:700;color:${textColor};">
      <span style="width:5px;height:5px;border-radius:50%;background:${dot};flex-shrink:0"></span>${icon} ${label}
    </span>`;
  }

  const el = document.createElement('div');
  el.className = 'msg-row theirs';
  el.id = 'ai-typing-indicator';
  el.innerHTML = `
    <div class="msg-avatar" style="background:linear-gradient(135deg,#0891b2,#22d3ee)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 0 2h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1 0-2h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
    </div>
    <div class="msg-bubble-wrap">
      <div class="msg-sender-name">z-AI</div>
      <div class="msg-bubble">
        <div style="display:flex;gap:.35rem;align-items:center;padding:.1rem 0">
          <div class="ai-typing-dot"></div>
          <div class="ai-typing-dot"></div>
          <div class="ai-typing-dot"></div>
        </div>
        <div id="ai-typing-provider-status" style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.4rem;opacity:.8">
          ${_providerPill('groq','Groq','⚡')}
          ${_providerPill('openrouter','OpenRouter','🔀')}
          ${_providerPill('pollinations','Pollinations','🌐')}
        </div>
      </div>
    </div>`;
  area.appendChild(el);
  area.scrollTop = area.scrollHeight;
}

function removeAITyping() {
  document.getElementById('ai-typing-indicator')?.remove();
}

/* ══════════════════════════════════════════════════════════════
   AI PROVIDER CHAIN — Auto-fallback: Groq → OpenRouter → Pollinations
   Semua provider bebas CORS. Sistem retry otomatis jika limit.
══════════════════════════════════════════════════════════════ */

// Status tracker per provider — reset setiap 5 menit
const _aiProviderStatus = {
  groq:         { ok: true, failedAt: 0 },
  openrouter:   { ok: true, failedAt: 0 },
  pollinations: { ok: true, failedAt: 0 },
};
const _AI_COOLDOWN_MS = 5 * 60 * 1000; // 5 menit cooldown jika limit

function _aiProviderReady(name) {
  const s = _aiProviderStatus[name];
  if (s.ok) return true;
  if (Date.now() - s.failedAt > _AI_COOLDOWN_MS) { s.ok = true; return true; }
  return false;
}
function _aiProviderFail(name) {
  _aiProviderStatus[name] = { ok: false, failedAt: Date.now() };
}

// ── Provider 1: Groq via Vercel proxy (no CORS issue) ──
async function _callGroq(systemPrompt, messages, maxTokens) {
  if (!_aiProviderReady('groq')) throw new Error('Groq sedang cooldown');
  const res = await fetch(_GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      model: _GROQ_MODEL,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content || m.parts?.[0]?.text || '' }))
      ]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || ('HTTP ' + res.status);
    // Rate limit / quota
    if (res.status === 429 || res.status === 503 || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('limit')) {
      _aiProviderFail('groq');
    }
    throw new Error('Groq: ' + msg);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq: respons kosong');
  return { text, provider: 'Groq · Llama 3.3' };
}

// ── Provider 2: OpenRouter (free tier, CORS enabled, 100+ models) ──
// Model: mistralai/mistral-7b-instruct (gratis, kuat, cepat)
const _OR_URL   = '/api/ai?action=openrouter'; // Proxy aman via Vercel serverless function
const _OR_MODEL = 'mistralai/mistral-7b-instruct:free';
// Key disimpan aman di Vercel env (OPENROUTER_API_KEY), tidak di client
const _OR_KEY = '';

async function _callOpenRouter(systemPrompt, messages, maxTokens) {
  if (!_aiProviderReady('openrouter')) throw new Error('OpenRouter sedang cooldown');
  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': window.location.origin,
    'X-Title': 'z-wealth',
  };
  if (_OR_KEY) headers['Authorization'] = 'Bearer ' + _OR_KEY;

  const res = await fetch(_OR_URL, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      model: _OR_MODEL,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content || m.parts?.[0]?.text || '' }))
      ]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || ('HTTP ' + res.status);
    if (res.status === 401 || res.status === 403) {
      _aiProviderFail('openrouter');
      throw new Error('OpenRouter: API key diperlukan - daftar gratis di openrouter.ai');
    }
    if (res.status === 429 || res.status === 503 || msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('quota')) {
      _aiProviderFail('openrouter');
    }
    throw new Error('OpenRouter: ' + msg);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenRouter: respons kosong');
  return { text, provider: 'OpenRouter · Mistral 7B' };
}

// ── Provider 3: Pollinations AI (100% gratis, no key, no CORS, no signup) ──
// Menggunakan GET endpoint text.pollinations.ai (anonymous, tidak deprecated)
const _POLL_BASE = 'https://text.pollinations.ai';

async function _callPollinations(systemPrompt, messages, maxTokens) {
  if (!_aiProviderReady('pollinations')) throw new Error('Pollinations sedang cooldown');

  // Susun prompt: gabungkan system + history + user terakhir sebagai plain text
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content || m.parts?.[0]?.text || '' }))
  ];

  // Gunakan POST ke endpoint /openai yang tetap support anonymous request
  // Catatan: Hanya deprecated untuk authenticated users — anonymous tetap berjalan
  const res = await fetch(_POLL_BASE + '/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: 'openai-large',
      max_tokens: Math.min(maxTokens, 2000),
      temperature: 0.7,
      messages: allMessages
    })
  });

  if (!res.ok) {
    const msg = 'HTTP ' + res.status;
    if (res.status === 429 || res.status === 503) _aiProviderFail('pollinations');
    throw new Error('Pollinations: ' + msg);
  }

  const rawText = await res.text();

  // Cek deprecation notice sebelum parse JSON
  if (rawText.includes('IMPORTANT NOTICE') || rawText.includes('legacy text API') || rawText.includes('being deprecated')) {
    _aiProviderFail('pollinations');
    throw new Error('Pollinations: deprecation notice received');
  }

  let text = '';
  try {
    const data = JSON.parse(rawText);
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    if (content.includes('IMPORTANT NOTICE') || content.includes('legacy text API') || content.includes('being deprecated')) {
      _aiProviderFail('pollinations');
      throw new Error('Pollinations: deprecation notice received');
    }
    text = content;
  } catch(parseErr) {
    _aiProviderFail('pollinations');
    throw new Error('Pollinations: ' + (parseErr.message || 'response tidak valid'));
  }

  if (!text) {
    _aiProviderFail('pollinations');
    throw new Error('Pollinations: respons kosong');
  }
  return { text, provider: 'Pollinations · GPT-4o' };
}

// ── MAIN callAI — otomatis chain semua provider + notifikasi user ──
async function callAI(systemPrompt, messages, maxTokens = 1500) {
  const providers = [
    { name: 'groq',         label: 'Groq · Llama 3.3',       fn: () => _callGroq(systemPrompt, messages, maxTokens) },
    { name: 'openrouter',   label: 'OpenRouter · Mistral 7B', fn: () => _callOpenRouter(systemPrompt, messages, maxTokens) },
    { name: 'pollinations', label: 'Pollinations · GPT-4o',   fn: () => _callPollinations(systemPrompt, messages, maxTokens) },
  ];

  const errors = [];
  let attemptCount = 0;

  for (const p of providers) {
    if (!_aiProviderReady(p.name)) {
      errors.push(`${p.name}: cooldown`);
      continue;
    }

    // Tampilkan status switching (jika bukan provider pertama)
    if (attemptCount > 0) {
      _showAIProviderSwitch(p.label, attemptCount);
    }
    attemptCount++;

    try {
      const result = await p.fn();
      _aiProviderStatus[p.name].ok = true;

      // Jika berhasil lewat fallback, tampilkan notif sukses
      if (attemptCount > 1) {
        _showAIFallbackSuccess(result.provider);
      }

      return result;
    } catch(e) {
      console.warn(`[AI] ${p.name} gagal:`, e.message);
      errors.push(`${p.name}: ${e.message}`);

      // Notifikasi provider gagal (limit/error)
      const isLimit = /rate|limit|429|quota|overload|capacity/i.test(e.message);
      _showAIProviderFailed(p.label, isLimit);
    }
  }

  // Semua gagal
  _showAIAllFailed();
  throw new Error('Semua AI provider tidak tersedia. ' + errors.join(' | '));
}

// ── Notifikasi: provider aktif sedang switching ──
function _showAIProviderSwitch(newProviderLabel, attempt) {
  const icons = ['🔄','⚡','🌐'];
  const icon = icons[attempt - 1] || '🔄';

  // Update status bar di AI chat
  const status = document.getElementById('ai-chat-status');
  if (status) {
    status.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-right:.3rem;animation:pulse .8s infinite"></span>
      Beralih ke ${newProviderLabel}...`;
  }

  // Update provider pills di typing indicator (real-time)
  const pillsEl = document.getElementById('ai-typing-provider-status');
  if (pillsEl) {
    function _pill(name, label, picon) {
      const s = _aiProviderStatus[name];
      const ready = !s || s.ok || (Date.now() - s.failedAt > _AI_COOLDOWN_MS);
      // Highlight yang sedang aktif dicoba
      const isActive = label === newProviderLabel.split(' · ')[0] || newProviderLabel.includes(label);
      const color  = isActive  ? 'rgba(245,158,11,.2)' : ready ? 'rgba(16,185,129,.1)'  : 'rgba(239,68,68,.08)';
      const border = isActive  ? 'rgba(245,158,11,.5)' : ready ? 'rgba(16,185,129,.25)' : 'rgba(239,68,68,.2)';
      const tc     = isActive  ? '#f59e0b'             : ready ? '#10b981'              : '#f87171';
      const dot    = isActive  ? '#f59e0b'             : ready ? '#10b981'              : '#ef4444';
      const anim   = isActive  ? 'animation:pulse .8s infinite;' : '';
      return `<span style="display:inline-flex;align-items:center;gap:.25rem;background:${color};border:1px solid ${border};border-radius:99px;padding:.12rem .45rem;font-size:.55rem;font-weight:700;color:${tc};">
        <span style="width:5px;height:5px;border-radius:50%;background:${dot};flex-shrink:0;${anim}"></span>${picon} ${label}
      </span>`;
    }
    pillsEl.innerHTML =
      _pill('groq','Groq','⚡') +
      _pill('openrouter','OpenRouter','🔀') +
      _pill('pollinations','Pollinations','🌐');
  }

  // Toast kecil
  _toastAI(`${icon} Beralih ke <strong>${newProviderLabel}</strong>`, 'warn', 3000);
}

// ── Notifikasi: provider gagal ──
function _showAIProviderFailed(providerLabel, isLimit) {
  const reason = isLimit ? 'limit tercapai' : 'tidak tersedia';
  _toastAI(`⚠️ ${providerLabel} ${reason} — mencoba backup...`, 'warn', 4000);
}

// ── Notifikasi: fallback berhasil ──
function _showAIFallbackSuccess(providerLabel) {
  _toastAI(`✅ Terhubung via <strong>${providerLabel}</strong>`, 'ok', 3500);
}

// ── Notifikasi: semua provider gagal ──
function _showAIAllFailed() {
  const status = document.getElementById('ai-chat-status');
  if (status) {
    status.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;margin-right:.3rem"></span>
      Semua AI tidak tersedia saat ini`;
  }
  _toastAI('❌ Semua AI provider tidak tersedia. Coba lagi dalam beberapa menit.', 'err', 6000);
}

// ── Mini toast khusus AI (tidak ganggu toast utama) ──
let _aiToastTimer = null;
function _toastAI(msg, type = 'ok', duration = 3500) {
  // Ensure wrapper exists — full width, flex centered
  let wrap = document.getElementById('ai-toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'ai-toast-wrap';
    wrap.style.cssText = 'position:fixed;bottom:82px;left:1rem;right:1rem;z-index:9999;display:flex;justify-content:center;pointer-events:none';
    document.body.appendChild(wrap);
  }

  let el = document.getElementById('ai-provider-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ai-provider-toast';
    el.style.cssText = [
      'opacity:0',
      'transform:translateY(10px)',
      'transition:opacity .3s ease, transform .3s cubic-bezier(.34,1.4,.64,1)',
      'background:var(--surface)',
      'border:1.5px solid var(--border)',
      'border-radius:14px',
      'padding:.55rem 1rem',
      'font-size:.78rem',
      'font-weight:600',
      'color:var(--text)',
      'box-shadow:0 8px 32px rgba(0,0,0,.45)',
      'display:flex',
      'align-items:flex-start',
      'gap:.5rem',
      'pointer-events:none',
      'max-width:420px',
      'width:100%',
      'box-sizing:border-box',
      'word-break:break-word',
      'white-space:normal',
      'line-height:1.5'
    ].join(';');
    wrap.appendChild(el);
  }

  const colors = {
    ok:   { border: 'rgba(16,185,129,.5)',  dot: '#10b981' },
    warn: { border: 'rgba(245,158,11,.5)',  dot: '#f59e0b' },
    err:  { border: 'rgba(239,68,68,.5)',   dot: '#ef4444' },
  };
  const c = colors[type] || colors.ok;
  el.style.borderColor = c.border;

  // Strip HTML from msg for safe text display
  const plain = msg.replace(/<[^>]+>/g, '').trim();
  const dot = document.createElement('span');
  dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${c.dot};flex-shrink:0;display:inline-block;margin-top:4px`;
  const txt = document.createElement('span');
  txt.textContent = plain;
  el.innerHTML = '';
  el.appendChild(dot);
  el.appendChild(txt);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  clearTimeout(_aiToastTimer);
  _aiToastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
  }, duration);
}

// ── callAIRaw — untuk fungsi yang butuh format JSON (news translate, dll) ──
// Sama seperti callAI tapi hanya 1 pesan user, tanpa system role terpisah
async function callAIRaw(userPrompt, maxTokens = 2000) {
  return callAI('Kamu adalah asisten AI yang membantu. Balas sesuai instruksi user.', [{ role: 'user', content: userPrompt }], maxTokens);
}

async function sendAIMessage(overrideText) {
  if (aiIsStreaming) return;
  const input = document.getElementById('ai-chat-input');
  const text = overrideText || input?.value?.trim();
  if (!text) return;

  // Show user message
  appendAIMessage('user', text, Date.now());
  if (input) { input.value = ''; if(input.style) input.style.height = ''; }

  // Hide suggestion chips after first message
  const chips = document.getElementById('ai-suggestions');
  if (chips) chips.style.display = 'none';

  // Add to history (Gemini format)
  aiChatHistory.push({ role: 'user', parts: [{ text }] });

  // Show typing
  aiIsStreaming = true;
  showAITyping();

  const status = document.getElementById('ai-chat-status');
  if (status) status.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f59e0b;margin-right:.3rem;animation:pulse 1s infinite"></span>z-AI sedang mengetik...';

  const btn = document.getElementById('ai-send-btn');
  if (btn) btn.disabled = true;

  try {
    let systemContext = AI_CHAT_SYSTEM;
    if (S.btcPrice) {
      systemContext += `\n\nData realtime saat ini:\n- Harga BTC: $${S.btcPrice.toLocaleString()}\n- BTC/IDR: ${fmtIDR(S.btcPrice * (S.usdIdr||16000))}\n- Kurs USD/IDR: ${S.usdIdr?.toLocaleString()||'16.000'}`;
    }

    // Convert history to universal format for callAI
    const messages = aiChatHistory.slice(-20).map(m => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.parts?.[0]?.text || m.content || '' }));

    const result = await callAI(systemContext, messages);

    removeAITyping();
    appendAIMessage('model', result.text, Date.now());
    aiChatHistory.push({ role: 'model', parts: [{ text: result.text }] });
    saveAIChatHistory();

    if (status) status.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;margin-right:.3rem;box-shadow:0 0 6px #10b981"></span>Powered by ${result.provider} · Siap membantu`;

  } catch(e) {
    console.error('[z-AI]', e);
    removeAITyping();
    appendAIMessage('model',
      '⚠️ **Semua AI tidak tersedia saat ini**\n\nGroq, OpenRouter, dan Pollinations sedang tidak bisa dihubungi. Kemungkinan sedang *rate-limit* atau ada masalah koneksi.\n\n⏱ Coba lagi dalam ~5 menit ya.',
      Date.now()
    );
    if (status) status.innerHTML = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;margin-right:.3rem"></span>Semua AI tidak tersedia · Coba lagi nanti';
  } finally {
    aiIsStreaming = false;
    if (btn) btn.disabled = false;
  }
}

function aiChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
}

function aiChipSend(btn) {
  const text = btn.getAttribute('data-prompt') || btn.textContent.trim();
  sendAIMessage(text);
}


/* ═══════════════════════════════════════════════════════════
   PREDIKSI HARGA BITCOIN — CoinGecko + Fear&Greed + Gemini
═══════════════════════════════════════════════════════════ */

let cPredPrice = null;
let predData = null;

async function runBTCPrediction() {
  const warningEl = document.getElementById('pred-apikey-warning');
  if (warningEl) warningEl.style.display = 'none'; // Key ditangani server Groq

  const btn = document.getElementById('pred-refresh-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Memuat...'; }

  // Reset UI
  document.getElementById('pred-verdict').className = 'pred-verdict loading';
  document.getElementById('pred-verdict-icon').textContent = '⏳';
  document.getElementById('pred-verdict-text').textContent = 'Menganalisis...';
  document.getElementById('pred-ai-narrative').innerHTML = '<div class="shimmer" style="width:90%"></div><div class="shimmer" style="width:75%"></div><div class="shimmer" style="width:85%"></div>';

  try {
    // 1. Fetch BTC market data from CoinGecko
    const [cgRes, fngRes, histRes] = await Promise.allSettled([
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false'),
      fetch('https://api.alternative.me/fng/?limit=7'),
      fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=30&interval=daily'),
    ]);

    let cgData = null, fngData = null, histData = null;
    if (cgRes.status==='fulfilled' && cgRes.value.ok) cgData = await cgRes.value.json();
    if (fngRes.status==='fulfilled' && fngRes.value.ok) fngData = await fngRes.value.json();
    if (histRes.status==='fulfilled' && histRes.value.ok) histData = await histRes.value.json();

    if (!cgData) throw new Error('Gagal mengambil data harga BTC');

    const md = cgData.market_data;
    const price = md.current_price.usd;
    const priceIDR = md.current_price.idr;
    const change24h = md.price_change_percentage_24h;
    const change7d = md.price_change_percentage_7d;
    const high24 = md.high_24h.usd;
    const low24 = md.low_24h.usd;
    const vol24 = md.total_volume.usd;
    const mcap = md.market_cap.usd;
    const ath = md.ath.usd;
    const athPct = ((price - ath) / ath * 100);

    // FNG
    const fngVal = fngData?.data?.[0]?.value ? parseInt(fngData.data[0].value) : null;
    const fngCat = fngData?.data?.[0]?.value_classification || '—';

    // Update price displays
    document.getElementById('pred-price-big').textContent = '$' + price.toLocaleString('en-US');
    document.getElementById('pred-price-idr').textContent = fmtIDR(priceIDR);
    const changeBadge = document.getElementById('pred-change-badge');
    changeBadge.textContent = (change24h>=0?'▲':'▼') + ' ' + Math.abs(change24h).toFixed(2) + '% (24J)';
    changeBadge.style.background = change24h>=0 ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)';
    changeBadge.style.border = change24h>=0 ? '1px solid rgba(16,185,129,.3)' : '1px solid rgba(239,68,68,.3)';
    changeBadge.style.color = change24h>=0 ? '#10b981' : '#ef4444';

    // Stats
    document.getElementById('pred-vol').textContent = '$' + (vol24/1e9).toFixed(1)+'B';
    document.getElementById('pred-mcap').textContent = '$' + (mcap/1e12).toFixed(2)+'T';
    document.getElementById('pred-high').textContent = '$' + high24.toLocaleString();
    document.getElementById('pred-low').textContent = '$' + low24.toLocaleString();

    // FNG bar
    if (fngVal !== null) {
      const fngColor = fngVal <= 24 ? '#ef4444' : fngVal <= 44 ? '#f97316' : fngVal <= 54 ? '#f59e0b' : fngVal <= 74 ? '#84cc16' : '#10b981';
      document.getElementById('fng-bar').style.width = fngVal + '%';
      document.getElementById('fng-bar').style.background = fngColor;
      document.getElementById('fng-value-text').textContent = fngVal;
      document.getElementById('fng-value-text').style.color = fngColor;
      document.getElementById('fng-category-text').textContent = fngCat;
      document.getElementById('fng-category-text').style.color = fngColor;
    }

    // Price levels (simple calc based on ATH and current)
    const r2 = Math.round(price * 1.15);
    const r1 = Math.round(price * 1.07);
    const s1 = Math.round(price * 0.93);
    const s2 = Math.round(price * 0.85);
    document.getElementById('pred-r2').textContent = '$' + r2.toLocaleString();
    document.getElementById('pred-r1').textContent = '$' + r1.toLocaleString();
    document.getElementById('pred-cur-level').textContent = '$' + price.toLocaleString();
    document.getElementById('pred-s1').textContent = '$' + s1.toLocaleString();
    document.getElementById('pred-s2').textContent = '$' + s2.toLocaleString();

    // 30-day price chart
    if (histData?.prices) {
      const labels = histData.prices.map(p => {
        const d = new Date(p[0]);
        return (d.getDate()) + '/' + (d.getMonth()+1);
      });
      const prices = histData.prices.map(p => p[1]);
      const isUpTrend = prices[prices.length-1] > prices[0];
      if (cPredPrice) cPredPrice.destroy();
      const ctx = document.getElementById('c-pred-price')?.getContext('2d');
      if (ctx) {
        cPredPrice = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [{
              label: 'BTC/USD',
              data: prices,
              borderColor: isUpTrend ? '#10b981' : '#ef4444',
              backgroundColor: isUpTrend ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)',
              fill: true, tension: .4, pointRadius: 0, borderWidth: 2,
            }]
          },
          options: {
            ...CO,
            plugins: { legend:{display:false}, tooltip:{callbacks:{label:i=>' $'+Math.round(i.raw).toLocaleString()}} },
            scales: {
              x: { ticks:{...TK,maxTicksLimit:8,maxRotation:0}, grid:getGR() },
              y: { ticks:{...TK,callback:v=>'$'+(v/1000).toFixed(0)+'K'}, grid:getGR() }
            }
          }
        });
      }
    }

    // Store for AI analysis
    predData = { price, priceIDR, change24h, change7d, high24, low24, vol24, mcap, fngVal, fngCat, ath, athPct };
    document.getElementById('pred-last-updated').textContent = 'Diperbarui: ' + new Date().toLocaleTimeString('id-ID');

    // AI Analysis with Groq
    await runGroqPrediction(predData);

  } catch(e) {
    console.error('[Prediksi]', e);
    toast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ' + e.message, 1);
    document.getElementById('pred-ai-narrative').textContent = 'Gagal memuat data: ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh'; }
  }
}

async function runGroqPrediction(data) {
  const verdictEl = document.getElementById('pred-verdict');
  const verdictIcon = document.getElementById('pred-verdict-icon');
  const verdictText = document.getElementById('pred-verdict-text');
  const narrativeEl = document.getElementById('pred-ai-narrative');
  const confFill = document.getElementById('pred-confidence-fill');
  const confVal = document.getElementById('pred-confidence-val');

  try {
    const prompt = `Kamu adalah analis Bitcoin profesional. Berikan analisis singkat dan prediksi berdasarkan data berikut:

DATA REAL-TIME:
- Harga BTC: $${data.price.toLocaleString()} (${data.change24h?.toFixed(2)}% 24J, ${data.change7d?.toFixed(2)}% 7H)
- High/Low 24J: $${data.high24?.toLocaleString()} / $${data.low24?.toLocaleString()}
- Volume 24J: $${(data.vol24/1e9)?.toFixed(1)}B
- Market Cap: $${(data.mcap/1e12)?.toFixed(2)}T
- Fear & Greed Index: ${data.fngVal} (${data.fngCat})
- ATH: $${data.ath?.toLocaleString()} (${data.athPct?.toFixed(1)}% dari ATH)

Berikan:
1. **Verdict**: BULLISH / BEARISH / NETRAL dengan alasan 1 kalimat
2. **Analisis teknikal**: 2-3 poin utama tentang kondisi pasar sekarang
3. **Proyeksi jangka pendek**: prediksi 1-2 minggu ke depan
4. **Saran untuk DCA investor**: apakah bagus untuk DCA sekarang?
5. **Risiko utama**: 1-2 risiko yang perlu diwaspadai

Format: Padat, gunakan bullet points, max 300 kata. Jawab dalam Bahasa Indonesia.`;

    const result = await callAI('Kamu adalah analis Bitcoin profesional yang memberikan analisis objektif dan bertanggung jawab.', [{ role: 'user', content: prompt }], 800);
    const aiText = result.text;

    const lower = aiText.toLowerCase();
    const isBullish = lower.includes('bullish') && !lower.includes('tidak bullish');
    const isBearish = lower.includes('bearish') && !lower.includes('tidak bearish');
    const verdict = isBullish ? 'bullish' : isBearish ? 'bearish' : 'neutral';

    verdictEl.className = 'pred-verdict ' + verdict;
    verdictIcon.innerHTML = verdict==='bullish'?'<span style="font-size:1.3rem">&#128640;</span>':verdict==='bearish'?'<span style="font-size:1.3rem">&#128059;</span>':'<span style="font-size:1.3rem">&#9878;</span>';
    verdictText.textContent = verdict==='bullish'?'BULLISH':verdict==='bearish'?'BEARISH':'NETRAL';

    const conf = Math.min(55 + Math.abs(data.change24h)*3 + (data.fngVal?Math.abs(data.fngVal-50)*0.4:0), 92);
    if(confFill) confFill.style.width = Math.round(conf)+'%';
    if(confVal) confVal.textContent = Math.round(conf)+'%';

    narrativeEl.innerHTML = '<div class="ai-bubble-content">' + aiMarkdown(aiText) + '</div>';

  } catch(e) {
    console.error('[AI Predict]', e);
    // Fallback tanpa AI jika semua gagal
    const verdict = data.change24h > 2 && data.fngVal > 50 ? 'bullish' : data.change24h < -2 && data.fngVal < 40 ? 'bearish' : 'neutral';
    verdictEl.className = 'pred-verdict ' + verdict;
    verdictIcon.innerHTML = verdict==='bullish'?'<span style="font-size:1.3rem">&#128640;</span>':verdict==='bearish'?'<span style="font-size:1.3rem">&#128059;</span>':'<span style="font-size:1.3rem">&#9878;</span>';
    verdictText.textContent = verdict==='bullish'?'BULLISH':verdict==='bearish'?'BEARISH':'NETRAL';
    const pct = Math.min(Math.abs(data.change24h) * 8 + 40, 85);
    if(confFill) confFill.style.width = pct+'%';
    if(confVal) confVal.textContent = Math.round(pct)+'%';
    narrativeEl.innerHTML = `<p><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg> Analisis data pasar (AI tidak tersedia):</p>
      <p>• Harga BTC: <strong>$${data.price.toLocaleString()}</strong> (${data.change24h>0?'+':''}${data.change24h.toFixed(2)}% 24J)</p>
      <p>• Fear & Greed: <strong>${data.fngVal||'—'} — ${data.fngCat}</strong></p>
      <p>• Perubahan 7 hari: ${data.change7d>0?'+':''}${data.change7d?.toFixed(2)||'—'}%</p>
      <p style="margin-top:.7rem;padding:.6rem;background:rgba(245,158,11,.08);border-radius:8px;font-size:.78rem;color:var(--accent4)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${e.message}</p>`;
  }
}

// Auto-run prediction when page shown — handled directly in showPage above

/* ══════════════════════════════════════════════════════
   BERITA KRIPTO — Fetch + Terjemah Groq + Sentimen
══════════════════════════════════════════════════════ */
let _newsCache = null;
let _newsFilter = 'semua';
let _newsLoading = false;

async function loadCryptoNews(forceRefresh = false) {
  if (_newsLoading && !forceRefresh) return;
  _newsLoading = true;
  if (forceRefresh) _newsCache = null;
  if (_newsCache) { renderNewsList(_newsCache); _newsLoading = false; return; }

  const btn = document.getElementById('news-refresh-btn');
  const icon = document.getElementById('news-spin-icon');
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = 'spin .8s linear infinite';

  document.getElementById('news-list').innerHTML = [1,2,3,4,5].map(() => `
    <div class="news-card loading-card">
      <div class="shimmer" style="width:70px;height:18px;border-radius:99px;margin-bottom:.5rem"></div>
      <div class="shimmer" style="width:90%;height:16px;margin-bottom:.35rem"></div>
      <div class="shimmer" style="width:70%;height:14px;margin-bottom:.5rem"></div>
      <div class="shimmer" style="width:50%;height:12px"></div>
    </div>`).join('');

  try {
    // ── Step 1: RSS Feed ──
    let rawPosts = [];
    try {
      const rssRes = await fetch('/api/news_api?action=rss');
      if (rssRes.ok) {
        const rssData = await rssRes.json();
        rawPosts = (rssData.articles || []).map(a => ({
          judul_en: a.title || '',
          source: a.source || 'News',
          url: a.url || '',
          published: a.published || new Date().toISOString(),
          coins: guessCoinsFromTitle(a.title || '')
        }));
      }
    } catch(rssErr) { console.warn('[News] RSS error:', rssErr.message); }

    // ── Step 2: Fallback AI jika RSS kosong ──
    if (!rawPosts.length) {
      const today = new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
      try {
        const fbResult = await callAIRaw(
          'Hari ini '+today+'. Buat 10 berita kripto terkini dalam Bahasa Indonesia.\n\nBalas HANYA JSON array:\n[{"judul":"...","ringkasan":"...","sentimen":"POSITIF/NEGATIF/NETRAL","coins":["BTC"],"source":"CoinDesk"}]',
          2000
        );
        let fbText = (fbResult.text||'').replace(/```json|```/g,'').trim();
        const fbMatch = fbText.match(/\[[\s\S]*\]/);
        if (fbMatch) {
          const fbParsed = JSON.parse(fbMatch[0]);
          const fbArticles = fbParsed.map((a,i)=>({
            id:i, judulID:(a.judul||'').trim(), judulEN:a.judul||'',
            ringkasan:(a.ringkasan||'').trim(),
            sentimen:(a.sentimen||'NETRAL').toUpperCase().replace(/[^A-Z]/g,'')||'NETRAL',
            coins:Array.isArray(a.coins)?a.coins:[], source:a.source||'Kripto News',
            url:null, published:new Date().toISOString()
          })).filter(a=>a.judulID.length>3);
          _newsCache = fbArticles;
          renderNewsList(fbArticles);
          return;
        }
      } catch(fbErr) { console.warn('[News] AI fallback error:', fbErr.message); }
      throw new Error('Tidak ada berita tersedia');
    }

    // ── Step 3: Deduplikasi ──
    const seen = new Set();
    rawPosts = rawPosts.filter(p => {
      if (!p.judul_en || p.judul_en.length < 5) return false;
      const key = p.judul_en.substring(0,50).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0,20);

    const beritaList = rawPosts.map((p,i) => ({...p, id:i}));

    // ── Step 4: AI terjemahkan (chain: Groq → OpenRouter → Pollinations) ──
    const prompt = 'Terjemahkan judul berita kripto berikut ke Bahasa Indonesia dan tentukan sentimennya.\n\nBalas HANYA JSON array tanpa teks lain:\n[\n  {\n    "id": 0,\n    "judul_id": "terjemahan (max 100 karakter)",\n    "ringkasan": "konteks singkat (max 120 karakter)",\n    "sentimen": "POSITIF atau NEGATIF atau NETRAL"\n  }\n]\n\nBerita:\n' + beritaList.map(b=>'['+b.id+'] '+b.judul_en).join('\n');

    const aiResult = await callAIRaw(prompt, 2500);
    let text = (aiResult.text||'').replace(/```json|```/g,'').trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Format AI tidak valid');
    const translated = JSON.parse(jsonMatch[0]);

    const articles = beritaList.map(b => {
      const t = translated.find(x=>Number(x.id)===b.id)||{};
      return {
        id:b.id, judulID:(t.judul_id||b.judul_en).trim(), judulEN:b.judul_en,
        ringkasan:(t.ringkasan||'').trim(),
        sentimen:(t.sentimen||'NETRAL').toUpperCase().replace(/[^A-Z]/g,'')||'NETRAL',
        coins:b.coins.length?b.coins:guessCoinsFromTitle(b.judul_en),
        source:b.source, url:b.url, published:b.published
      };
    }).filter(a=>a.judulID.length>3);

    _newsCache = articles;
    renderNewsList(articles);
    // Simpan berita ke DB agar cron job bisa kirim notif saat app tutup
    _syncNewsToDb(articles);

  } catch(e) {
    console.error('[News]', e);
    document.getElementById('news-list').innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;color:var(--muted)">
        <div style="font-weight:700;color:var(--text);margin-bottom:.4rem">Gagal memuat berita</div>
        <div style="font-size:.78rem;margin-bottom:1.2rem">${e.message}</div>
        <button onclick="loadCryptoNews(true)" style="background:var(--accent);color:#050810;border:none;border-radius:10px;padding:.55rem 1.4rem;font-weight:700;cursor:pointer;">Coba Lagi</button>
      </div>`;
  } finally {
    _newsLoading = false;
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = '';
  }
}


function guessCoinsFromTitle(title) {
  const t = (title || '').toLowerCase();
  const coins = [];
  if (t.includes('bitcoin') || /\bbtc\b/.test(t)) coins.push('BTC');
  if (t.includes('ethereum') || /\beth\b/.test(t)) coins.push('ETH');
  if (t.includes('solana') || /\bsol\b/.test(t)) coins.push('SOL');
  if (t.includes('xrp') || t.includes('ripple')) coins.push('XRP');
  if (t.includes('bnb') || t.includes('binance')) coins.push('BNB');
  if (t.includes('doge') || t.includes('dogecoin')) coins.push('DOGE');
  return coins;
}

function detectSentimentLocal(title) {
  const t = (title || '').toLowerCase();
  const pos = ['naik','rally','bull','rekor','adopsi','disetujui','positif','surge','rise','gain','record','adopt','approve','launch','soar','growth','etf','melonjak','tumbuh'];
  const neg = ['turun','crash','jatuh','bear','rugi','hack','diretas','banned','larangan','bangkrut','scam','penipuan','fall','drop','loss','ban','fraud','collapse','plunge','dump'];
  const posScore = pos.filter(w => t.includes(w)).length;
  const negScore = neg.filter(w => t.includes(w)).length;
  if (posScore > negScore) return 'POSITIF';
  if (negScore > posScore) return 'NEGATIF';
  return 'NETRAL';
}

function updateDashNewsHighlight(articles) {
  const allPos = articles.filter(a => a.sentimen === 'POSITIF');
  const allNeg = articles.filter(a => a.sentimen === 'NEGATIF');
  const lang = typeof currentLang !== 'undefined' ? currentLang : 'id';

  const posEl  = document.getElementById('dash-news-pos-title');
  const posSrc = document.getElementById('dash-news-pos-src');
  const negEl  = document.getElementById('dash-news-neg-title');
  const negSrc = document.getElementById('dash-news-neg-src');

  if (posEl) {
    if (allPos.length > 0) {
      posEl.textContent = allPos[0].judulID;
      posEl.style.opacity = '1';
      if (posSrc) posSrc.textContent = allPos[0].source || '';
    } else {
      posEl.textContent = T['dash.tdk_ada_bullish'] ? T['dash.tdk_ada_bullish'][lang] : 'Tidak ada berita bullish saat ini';
      posEl.style.opacity = '0.4';
    }
  }
  if (negEl) {
    if (allNeg.length > 0) {
      negEl.textContent = allNeg[0].judulID;
      negEl.style.opacity = '1';
      if (negSrc) negSrc.textContent = allNeg[0].source || '';
    } else {
      negEl.textContent = T['dash.tdk_ada_bearish'] ? T['dash.tdk_ada_bearish'][lang] : 'Tidak ada berita bearish saat ini';
      negEl.style.opacity = '0.4';
    }
  }
}

// ── NEWS NOTIFICATION SYSTEM ──
// FIX: Persist state ke localStorage agar tidak reset setiap app dibuka
const NEWS_NOTIF_COOLDOWN = 60 * 60 * 1000; // 1 jam antar notif berita
let _newsNotifLastSent = parseInt(localStorage.getItem('zw_news_notif_last') || '0');
let _newsNotifSentTitles = new Set(JSON.parse(localStorage.getItem('zw_news_notif_titles') || '[]'));

function checkAndSendNewsNotif(articles) {
  // Tidak kirim jika notif belum diizinkan
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Cooldown: minimal 30 menit antar notif berita
  const now = Date.now();
  if (now - _newsNotifLastSent < NEWS_NOTIF_COOLDOWN) return;

  const allPos = articles.filter(a => a.sentimen === 'POSITIF');
  const allNeg = articles.filter(a => a.sentimen === 'NEGATIF');

  // Ambil berita terbullish dan terbearish yang BELUM pernah dinotif
  const topBullish = allPos.find(a => !_newsNotifSentTitles.has(a.judulID));
  const topBearish = allNeg.find(a => !_newsNotifSentTitles.has(a.judulID));

  // Tidak ada berita baru → skip
  if (!topBullish && !topBearish) return;

  _newsNotifLastSent = now;
  localStorage.setItem('zw_news_notif_last', now.toString()); // FIX: persist

  // Helper: ambil teks hingga titik pertama (maks 200 karakter)
  function getUpToFirstPeriod(text, fallback) {
    if (!text) return fallback || '';
    // Cari titik, tanda tanya, atau tanda seru pertama
    const match = text.match(/^(.+?[.!?])\s/);
    if (match) return match[1].length <= 200 ? match[1] : text.slice(0, 200) + '…';
    return text.slice(0, 200) + (text.length > 200 ? '…' : '');
  }

  // Kirim notif bullish
  if (topBullish) {
    _newsNotifSentTitles.add(topBullish.judulID);
    // Batas 200 judul agar tidak meluber
    if (_newsNotifSentTitles.size > 200) {
      const first = _newsNotifSentTitles.values().next().value;
      _newsNotifSentTitles.delete(first);
    }
    localStorage.setItem('zw_news_notif_titles', JSON.stringify([..._newsNotifSentTitles])); // FIX: persist
    setTimeout(() => {
      const src = topBullish.source || 'Crypto News';
      const coins = (topBullish.coins || []).slice(0,3).join(', ');
      const bodyText = getUpToFirstPeriod(topBullish.ringkasan || topBullish.judulEN || topBullish.judulID, '');
      const bullishBody = `${coins ? '📌 ' + coins + '\n' : ''}${bodyText}${bodyText ? '\n' : ''}📰 ${src}`;
      sendBrowserNotif(
        '🟢 ' + topBullish.judulID,
        bullishBody,
        'news-bullish',
        '/'
      );
    }, 500);
  }

  // Kirim notif bearish dengan jeda 3 detik agar tidak tumpuk
  if (topBearish) {
    _newsNotifSentTitles.add(topBearish.judulID);
    if (_newsNotifSentTitles.size > 200) {
      const first = _newsNotifSentTitles.values().next().value;
      _newsNotifSentTitles.delete(first);
    }
    localStorage.setItem('zw_news_notif_titles', JSON.stringify([..._newsNotifSentTitles])); // FIX: persist
    setTimeout(() => {
      const src = topBearish.source || 'Crypto News';
      const coins = (topBearish.coins || []).slice(0,3).join(', ');
      const bodyText = getUpToFirstPeriod(topBearish.ringkasan || topBearish.judulEN || topBearish.judulID, '');
      const bearishBody = `${coins ? '📌 ' + coins + '\n' : ''}${bodyText}${bodyText ? '\n' : ''}📰 ${src}`;
      sendBrowserNotif(
        '🔴 ' + topBearish.judulID,
        bearishBody,
        'news-bearish',
        '/'
      );
    }, 3500);
  }
}

// Auto-refresh berita setiap 1 jam + cek notif
let _newsAutoRefreshInterval = null;
function startNewsAutoRefresh() {
  if (_newsAutoRefreshInterval) return; // sudah jalan

  // FIX: Langsung cek notif saat pertama kali dipanggil (tanpa nunggu 1 jam)
  setTimeout(async () => {
    _newsCache = null;
    await loadCryptoNews();
  }, 5000); // 5 detik setelah login

  _newsAutoRefreshInterval = setInterval(async () => {
    _newsCache = null;
    await loadCryptoNews();
    // checkAndSendNewsNotif dipanggil dari dalam renderNewsList
  }, 60 * 60 * 1000); // setiap 1 jam
}

function renderNewsList(articles) {
  const pos = articles.filter(a => a.sentimen === 'POSITIF').length;
  const neg = articles.filter(a => a.sentimen === 'NEGATIF').length;
  const neu = articles.filter(a => a.sentimen === 'NETRAL').length;
  const total = articles.length || 1;

  const sentWrap = document.getElementById('news-sent-wrap');
  if (sentWrap) {
    sentWrap.style.display = 'block';
    document.getElementById('news-pos-bar').style.width = Math.round(pos/total*100) + '%';
    document.getElementById('news-pos-pct').textContent = Math.round(pos/total*100) + '%';
    document.getElementById('news-cnt-pos').textContent = pos;
    document.getElementById('news-cnt-neg').textContent = neg;
    document.getElementById('news-cnt-neu').textContent = neu;
  }

  // ── Update dashboard highlight widget (SELALU, sebelum filter/early-return) ──
  updateDashNewsHighlight(articles);
  // ── Cek dan kirim notif berita terbullish/terbearish ──
  checkAndSendNewsNotif(articles);

  let filtered = articles;
  if (_newsFilter === 'positif') filtered = articles.filter(a => a.sentimen === 'POSITIF');
  else if (_newsFilter === 'negatif') filtered = articles.filter(a => a.sentimen === 'NEGATIF');
  else if (_newsFilter === 'bitcoin') filtered = articles.filter(a =>
    (a.coins||[]).some(c => c.toUpperCase() === 'BTC') ||
    (a.judulID||'').toLowerCase().includes('bitcoin') ||
    (a.judulID||'').toLowerCase().includes('btc'));
  else if (_newsFilter === 'ethereum') filtered = articles.filter(a =>
    (a.coins||[]).some(c => c.toUpperCase() === 'ETH') ||
    (a.judulID||'').toLowerCase().includes('ethereum') ||
    (a.judulID||'').toLowerCase().includes('eth'));

  if (filtered.length === 0) {
    document.getElementById('news-list').innerHTML = `
      <div style="text-align:center;padding:2rem;color:var(--muted)">
        <div style="font-size:1.8rem;margin-bottom:.5rem"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div>
        <div>Tidak ada berita untuk filter ini</div>
      </div>`;
    return;
  }

  // Tentukan berita paling positif & paling negatif (hanya dari semua artikel, bukan filtered)
  const allPos = articles.filter(a => a.sentimen === 'POSITIF');
  const allNeg = articles.filter(a => a.sentimen === 'NEGATIF');
  const topPosId = allPos.length > 0 ? allPos[0].id : null;
  const topNegId = allNeg.length > 0 ? allNeg[0].id : null;

  const html = filtered.map(a => {
    const sClass = a.sentimen === 'POSITIF' ? 'positif' : a.sentimen === 'NEGATIF' ? 'negatif' : 'netral';
    const isTopPos = a.id === topPosId;
    const isTopNeg = a.id === topNegId;
    const highlightClass = isTopPos ? ' top-positif' : isTopNeg ? ' top-negatif' : '';
    const highlightLabel = isTopPos
      ? `<span class="news-highlight-label hl-pos">⚡ Paling Bullish</span>`
      : isTopNeg
      ? `<span class="news-highlight-label hl-neg">⚠️ Paling Bearish</span>`
      : '';
    const badgeIcon = a.sentimen === 'POSITIF' ? '<svg width="10" height="10" viewBox="0 0 10 10" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="5" cy="5" r="4.5" fill="#10b981"/></svg>' : a.sentimen === 'NEGATIF' ? '<svg width="10" height="10" viewBox="0 0 10 10" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="5" cy="5" r="4.5" fill="#ef4444"/></svg>' : '<svg width="10" height="10" viewBox="0 0 10 10" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="5" cy="5" r="4" fill="none" stroke="#64748b" stroke-width="1.5"/></svg>';
    const badgeTxt = a.sentimen === 'POSITIF' ? 'Positif' : a.sentimen === 'NEGATIF' ? 'Negatif' : 'Netral';
    const coinsHTML = (a.coins||[]).length
      ? `<div class="news-coins">${a.coins.slice(0,4).map(c=>`<span class="news-coin-tag">${c}</span>`).join('')}</div>`
      : '';
    const ringkasanHTML = a.ringkasan
      ? `<div style="font-size:.76rem;color:var(--muted);line-height:1.45;margin-bottom:.4rem">${a.ringkasan}</div>`
      : '';

    return `<div class="news-card ${sClass}${highlightClass}" onclick="openNewsModal('${a.id}')" style="cursor:pointer;">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.15rem;margin-bottom:.1rem">
        ${highlightLabel}<span class="news-sentiment-badge badge-${sClass}" style="margin-bottom:0">${badgeIcon} ${badgeTxt}</span>
      </div>
      <div class="news-title" style="margin-top:.45rem">${a.judulID}</div>
      ${ringkasanHTML}
      ${coinsHTML}
      <div class="news-meta">
        <span class="news-source-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2 2 2 0 0 0 2 2z"/><rect x="10" y="4" width="8" height="5"/><path d="M10 13h8M10 16h8"/></svg> ${a.source}</span>
        <span style="color:var(--muted);font-size:.6rem;font-style:italic">· via Groq AI</span>
        <span style="margin-left:auto;color:var(--accent);font-size:.65rem;font-weight:600">Baca →</span>
      </div>
    </div>`;
  }).join('');

  document.getElementById('news-list').innerHTML = html;
}

function filterNews(filter, btn) {
  _newsFilter = filter;
  document.querySelectorAll('.nf-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (_newsCache) renderNewsList(_newsCache);
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'Baru saja';
    if (diff < 3600) return Math.floor(diff/60) + ' menit lalu';
    if (diff < 86400) return Math.floor(diff/3600) + ' jam lalu';
    return Math.floor(diff/86400) + ' hari lalu';
  } catch(e) { return ''; }
}

// ── BTC addresses sekarang di-load per-akun di enterApp() ──
// loadBTCAddresses() masih dipakai untuk backward compat tapi dipanggil dari enterApp

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'PUSH_OPEN_ROOM' && e.data?.roomId) {
      showPage('chat');
      setTimeout(() => {
        initChat().then(() => {
          if (chatSB && e.data.roomId) {
            chatSB.from('chat_rooms').select('*').eq('id', e.data.roomId).single()
              .then(({ data: room }) => {
                if (room) openRoom(room.id, room.name, room.type, room.avatar_color);
              });
          }
        });
      }, 800);
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output  = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}


// ══════════════════════════════════════════
//  NEWS MODAL
// ══════════════════════════════════════════
let _currentNewsArticle = null;

function openNewsModal(id) {
  const article = (_newsCache || []).find(a => String(a.id) === String(id));
  if (!article) return;
  _currentNewsArticle = article;

  const sentimen = article.sentimen || 'NETRAL';
  const badgeColor  = sentimen==='POSITIF' ? '#10b981' : sentimen==='NEGATIF' ? '#ef4444' : '#64748b';
  const badgeBg     = sentimen==='POSITIF' ? 'rgba(16,185,129,.13)' : sentimen==='NEGATIF' ? 'rgba(239,68,68,.13)' : 'rgba(100,116,139,.1)';
  const badgeBorder = sentimen==='POSITIF' ? 'rgba(16,185,129,.28)' : sentimen==='NEGATIF' ? 'rgba(239,68,68,.28)' : 'rgba(100,116,139,.2)';
  const badgeTxt    = sentimen==='POSITIF' ? '● Positif' : sentimen==='NEGATIF' ? '● Negatif' : '○ Netral';

  const badge = document.getElementById('nm-badge');
  badge.textContent = badgeTxt;
  badge.style.cssText = `background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};display:inline-flex;align-items:center;gap:.3rem;padding:.22rem .7rem;border-radius:100px;font-size:.62rem;font-weight:800;letter-spacing:.04em;margin-bottom:.8rem;`;

  document.getElementById('nm-title').textContent = article.judulID;

  const coinsHtml = (article.coins||[]).map(c =>
    `<span style="background:rgba(0,229,255,.07);border:1px solid rgba(0,229,255,.18);border-radius:6px;padding:.1rem .4rem;font-size:.6rem;font-weight:800;color:var(--accent);font-family:'Space Mono',monospace;">${c}</span>`
  ).join(' ');
  document.getElementById('nm-meta').innerHTML =
    `<span style="color:var(--accent3);font-weight:700">${article.source}</span>
     <span>·</span><span class="nm-provider-label" style="font-style:italic;opacity:.7">via AI</span>
     ${coinsHtml}`;

  document.getElementById('nm-body').innerHTML =
    `<div class="nm-loading">
       <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00e5ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto .6rem"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
       Memuat isi berita...
     </div>`;

  document.getElementById('news-modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  _generateNewsBody(article);
}

async function _generateNewsBody(article) {
  try {
    const prompt = `Tulis isi berita kripto dalam Bahasa Indonesia yang informatif dan natural berdasarkan judul ini:

"${article.judulID}"

Sumber: ${article.source}
Sentimen: ${article.sentimen}
${article.ringkasan ? 'Ringkasan: ' + article.ringkasan : ''}

Tulis 3-4 paragraf isi berita dengan gaya jurnalistik. Jangan tulis ulang judulnya. Langsung isi beritanya saja.`;

    const result = await callAI(
      'Kamu adalah jurnalis kripto profesional yang menulis berita informatif dan akurat dalam Bahasa Indonesia.',
      [{ role: 'user', content: prompt }],
      700
    );

    document.getElementById('nm-body').textContent = result.text;
    // Update provider label
    const meta = document.getElementById('nm-meta');
    if (meta) {
      const providerSpan = meta.querySelector('.nm-provider-label');
      if (providerSpan) providerSpan.textContent = 'via ' + result.provider;
    }
  } catch(e) {
    document.getElementById('nm-body').innerHTML =
      `<span style="font-size:.82rem;line-height:1.65;">${article.ringkasan || 'Tidak dapat memuat isi berita.'}</span>
       <br><br><span style="font-size:.75rem;opacity:.6">Gunakan tombol "Lihat Berita Asli" untuk membaca di sumber aslinya.</span>`;
  }
}

function closeNewsModal(event, force) {
  if (!force && event && event.target !== document.getElementById('news-modal-overlay')) return;
  document.getElementById('news-modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

function searchNewsOnline() {
  if (!_currentNewsArticle) return;
  const url = _currentNewsArticle.url;
  if (url) {
    window.open(url, '_blank');
  } else {
    // fallback jika tidak ada URL
    const q = encodeURIComponent(_currentNewsArticle.judulEN || _currentNewsArticle.judulID);
    window.open('https://news.google.com/search?q=' + q + '&hl=id', '_blank');
  }
}

/* ── BLOCK 9 ── */
/* ══════════════════════════════════════════════════════
   Z-WEALTH · UX ENHANCEMENT SCRIPT v3.0
   Runs after page load — pure UX improvements
══════════════════════════════════════════════════════ */
(function() {
  'use strict';

  /* ── 1. RIPPLE EFFECT ── */
  function createRipple(e, el) {
    const rect = el.getBoundingClientRect();
    const x = (e.clientX || (rect.left + rect.width/2)) - rect.left;
    const y = (e.clientY || (rect.top + rect.height/2)) - rect.top;
    const size = Math.max(rect.width, rect.height) * 1.5;
    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';

    const isDark = !document.body.hasAttribute('data-theme') || document.body.dataset.theme !== 'light';
    const isAccent = el.classList.contains('btn-primary') || el.classList.contains('lbtn') ||
                     el.classList.contains('ltab') || el.classList.contains('ob-btn-next');
    ripple.style.cssText = `
      width:${size}px; height:${size}px;
      left:${x - size/2}px; top:${y - size/2}px;
      background: ${isAccent ? 'rgba(255,255,255,.2)' : isDark ? 'rgba(0,229,255,.12)' : 'rgba(0,100,200,.1)'};
    `;
    el.classList.add('ripple-host');
    el.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }

  document.addEventListener('pointerdown', function(e) {
    const target = e.target.closest(
      'button, .btn, .lbtn, .lbtn-ghost, .ltab, .bnav-item, ' +
      '.feat-btn, .fmo-btn, .nav-tab, .tf-btn, .ob-btn-next, ' +
      '.ob-btn-skip, .logout-btn, .export-pdf-btn, .acct-badge'
    );
    if (target && !target.disabled) createRipple(e, target);
  }, { passive: true });

  /* ── 2. SCROLL TO TOP BUTTON ── */
  function setupScrollTop() {
    const btn = document.createElement('button');
    btn.id = 'zw-scroll-top';
    btn.setAttribute('aria-label', 'Scroll ke atas');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    btn.onclick = () => {
      const active = document.querySelector('.page.active');
      if (active) active.scrollIntoView({ behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.body.appendChild(btn);

    window.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 320);
    }, { passive: true });

    // Also watch page content scroll
    document.addEventListener('scroll', () => {
      btn.classList.toggle('visible', window.scrollY > 320);
    }, { passive: true, capture: true });
  }

  /* ── 3. ANIMATED NUMBER COUNTER ── */
  function animateNumber(el, start, end, duration, formatter) {
    if (!el || isNaN(end)) return;
    const startTime = performance.now();
    const diff = end - start;

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out expo
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = start + diff * ease;
      if (formatter) {
        const raw = formatter(current);
        if (el.dataset.formatted !== raw) {
          el.dataset.formatted = raw;
          // Don't replace the full content if there's inner HTML structure
          if (el.children.length === 0) el.textContent = raw;
        }
      }
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ── 4. SHAKE ON ERROR ── */
  window.zwShakeError = function(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth; // reflow
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  };

  /* ── 5. TOOLTIPS — Add to icon-only buttons ── */
  function addTooltips() {
    const tips = [
      ['#pwa-install-btn', 'Install sebagai aplikasi'],
      ['.theme-toggle', 'Ganti tema gelap/terang'],
      ['.export-pdf-btn', 'Export laporan PDF'],
      ['.logout-btn', 'Logout akun'],
      ['[title="Info Akun"]', null], // already has title
    ];

    tips.forEach(([sel, tip]) => {
      if (!tip) return;
      document.querySelectorAll(sel).forEach(el => {
        if (!el.dataset.tip) el.dataset.tip = tip;
      });
    });
  }

  /* ── 6. BTC PRICE FLASH ANIMATION ── */
  let _lastBtcPrice = null;
  function watchBtcPrice() {
    const priceEl = document.getElementById('nav-btc');
    if (!priceEl) return;

    const observer = new MutationObserver(() => {
      const text = priceEl.textContent;
      const current = parseFloat(text.replace(/[$,]/g, ''));
      if (!isNaN(current) && _lastBtcPrice !== null && _lastBtcPrice !== current) {
        // Flash the dashboard BTC value too
        const dashEl = document.getElementById('d-btc');
        if (dashEl) {
          dashEl.classList.remove('value-up', 'value-down');
          void dashEl.offsetWidth;
          dashEl.classList.add(current > _lastBtcPrice ? 'value-up' : 'value-down');
        }
      }
      if (!isNaN(current)) _lastBtcPrice = current;
    });

    observer.observe(priceEl, { childList: true, characterData: true, subtree: true });
  }

  /* ── 7. SMOOTH MODAL OPEN/CLOSE ENHANCEMENT ── */
  function patchModalClose() {
    // Enhanced close on backdrop click with animation
    document.querySelectorAll('.overlay').forEach(overlay => {
      overlay.addEventListener('click', function(e) {
        if (e.target === this) {
          // Add closing animation to the modal before it closes
          const modal = this.querySelector('.modal');
          if (modal) {
            modal.style.transform = 'scale(.96) translateY(10px)';
            modal.style.opacity = '0';
            modal.style.transition = 'transform .18s ease, opacity .18s ease';
          }
        }
      });
    });
  }

  /* ── 8. FEAT BTN MAGNETIC HOVER (desktop only) ── */
  function magneticButtons() {
    if (window.matchMedia('(hover: none)').matches) return;

    document.addEventListener('mousemove', function(e) {
      document.querySelectorAll('.feat-btn, .fmo-btn').forEach(btn => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const radius = 80;

        if (dist < radius) {
          const strength = (1 - dist/radius) * 6;
          btn.style.transform = `translate(${dx * strength / dist}px, ${dy * strength / dist}px) translateY(-3px) scale(1.02)`;
        } else if (btn.style.transform && btn.style.transform !== '') {
          btn.style.transform = '';
        }
      });
    }, { passive: true });

    document.addEventListener('mouseleave', () => {
      document.querySelectorAll('.feat-btn, .fmo-btn').forEach(btn => {
        btn.style.transform = '';
      });
    });
  }

  /* ── 9. INPUT FOCUS ENHANCEMENT ── */
  function enhanceInputs() {
    document.querySelectorAll('.fi, .fs, .sinput').forEach(input => {
      const fg = input.closest('.fg');
      if (!fg) return;

      input.addEventListener('focus', () => {
        fg.style.zIndex = '10';
        fg.style.position = 'relative';
      });
      input.addEventListener('blur', () => {
        fg.style.zIndex = '';
      });
    });
  }

  /* ── 10. STAT CARD NUMBER COUNTER ON PAGE SHOW ── */
  function patchShowPage() {
    const origShowPage = window.showPage;
    if (!origShowPage) return;

    window.showPage = function(id) {
      // Run original
      origShowPage.apply(this, arguments);

      // Animate numbers on dashboard
      if (id === 'dashboard') {
        setTimeout(() => {
          // Find numeric stat values and animate them
          document.querySelectorAll('#page-dashboard .sval').forEach(el => {
            const text = el.textContent;
            if (text.includes('Rp') || text.includes('BTC') || text.includes('%')) {
              el.style.transition = 'opacity .1s ease';
              el.style.opacity = '0';
              setTimeout(() => {
                el.style.opacity = '1';
              }, 50 + Math.random() * 150);
            }
          });
        }, 50);
      }
    };
  }

  /* ── 11. LONG PRESS CONTEXT (mobile) ── */
  function longPressHint() {
    let timer;
    document.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.stat-card');
      if (!card || window.innerWidth > 640) return;
      timer = setTimeout(() => {
        card.style.transform = 'scale(.97)';
        card.style.boxShadow = '0 0 0 2px rgba(0,229,255,.3)';
        setTimeout(() => {
          card.style.transform = '';
          card.style.boxShadow = '';
        }, 400);
      }, 400);
    }, { passive: true });
    document.addEventListener('pointerup', () => clearTimeout(timer), { passive: true });
    document.addEventListener('pointermove', () => clearTimeout(timer), { passive: true });
  }

  /* ── 12. SMOOTH PAGE HEIGHT TRANSITION ── */
  function smoothPageHeight() {
    const style = document.createElement('style');
    style.textContent = `
      #page-dashboard, #page-dca, #page-portfolio,
      #page-simulation, #page-cashflow {
        min-height: calc(100vh - 60px);
      }
    `;
    document.head.appendChild(style);
  }

  /* ── 13. KEYBOARD SHORTCUT HINTS ── */
  function keyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // ESC closes modals
      if (e.key === 'Escape') {
        const openOverlay = document.querySelector('.overlay.open');
        if (openOverlay) {
          const closeBtn = openOverlay.querySelector('[onclick*="closeModal"], [onclick*="close"]');
          if (closeBtn) closeBtn.click();
        }
      }
    });
  }

  /* ── 14. ENHANCED TOAST ── */
  function patchToast() {
    const origToast = window.toast;
    if (!origToast) return;
    window.toast = function(msg, err, dur) {
      // Add type-specific styling via class
      origToast.apply(this, arguments);
    };
  }

  /* ── 15. PREFETCH ON HOVER (desktop tab navigation) ── */
  function prefetchPages() {
    if (window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('mouseenter', function() {
        // Warm up by pre-rendering if needed
        const onclick = this.getAttribute('onclick') || '';
        const match = onclick.match(/showPage\('([^']+)'\)/);
        if (match && match[1]) {
          const pageEl = document.getElementById('page-' + match[1]);
          if (pageEl && !pageEl.classList.contains('active')) {
            // Trigger a tiny opacity change to pre-paint
            pageEl.style.willChange = 'transform, opacity';
          }
        }
      });
      tab.addEventListener('mouseleave', function() {
        const onclick = this.getAttribute('onclick') || '';
        const match = onclick.match(/showPage\('([^']+)'\)/);
        if (match && match[1]) {
          const pageEl = document.getElementById('page-' + match[1]);
          if (pageEl) pageEl.style.willChange = '';
        }
      });
    });
  }

  /* ── INIT ── */
  function init() {
    setupScrollTop();
    addTooltips();
    watchBtcPrice();
    patchModalClose();
    magneticButtons();
    enhanceInputs();
    patchShowPage();
    longPressHint();
    smoothPageHeight();
    keyboardShortcuts();
    patchToast();
    prefetchPages();

    // Add ripple-host to all interactive containers
    document.querySelectorAll('.feat-btn, .fmo-btn, .stat-card').forEach(el => {
      el.classList.add('ripple-host');
    });

    // Observe for dynamically added elements
    const mo = new MutationObserver(() => {
      document.querySelectorAll('.feat-btn:not(.ripple-host), .fmo-btn:not(.ripple-host)').forEach(el => {
        el.classList.add('ripple-host');
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Delay slightly to let app init first
    setTimeout(init, 300);
  }
})();

/* ── BLOCK 10 ── */
/* ═══════════════════════════════════════════════════════════════════
   Z-WEALTH i18n ENGINE v2.0 — KOMPREHENSIF
   Strategi: querySelector + textContent/innerHTML replacement
   Covers: semua halaman, modals, forms, loading screen, fitur modal
═══════════════════════════════════════════════════════════════════ */
(function () {

/* ───────────────────────────────────────────────
   KAMUS TERJEMAHAN LENGKAP
   Format: { id: '...', en: '...' }
─────────────────────────────────────────────────*/
var T = {

  /* ── LOADING / ONBOARDING ── */
  'loading.tagline':     { id: 'Financial Command Center', en: 'Financial Command Center' },
  'loading.memuat':      { id: 'Memuat...', en: 'Loading...' },
  'onboard.fitur_utama': { id: 'Fitur Utama', en: 'Key Features' },
  'onboard.lewati':      { id: 'Lewati', en: 'Skip' },
  'onboard.selanjutnya': { id: 'Selanjutnya', en: 'Next' },
  'onboard.geser':       { id: '⟵ geser untuk navigasi ⟶', en: '⟵ swipe to navigate ⟶' },
  'onboard.buat_akun':   { id: 'Buat Akun Baru', en: 'Create New Account' },
  'onboard.sudah_punya': { id: 'Sudah punya seed?', en: 'Already have a seed?' },
  'onboard.login_sini':  { id: 'Login di sini', en: 'Login here' },
  'onboard.catat_seed':  { id: 'Screenshot atau catat ketiga kata ini!', en: 'Screenshot or write down these three words!' },
  'onboard.app_tidak':   { id: 'Aplikasi tidak menyimpan seed-mu. Hilang = tidak bisa masuk lagi.', en: 'The app does not store your seed. Lost = no access ever again.' },
  'onboard.sudah_catat': { id: 'Sudah saya catat →', en: 'I wrote it down →' },
  'onboard.verif_seed':  { id: 'Verifikasi Seed', en: 'Verify Seed' },
  'onboard.pilih_kata':  { id: 'Pilih kata ke-? dari seed phrase kamu', en: 'Select word #? from your seed phrase' },
  'onboard.pastikan':    { id: 'Pastikan kamu benar-benar sudah mencatatnya', en: 'Make sure you have actually written it down' },
  'onboard.pilih_jwb':   { id: 'Pilih jawaban yang benar untuk melanjutkan', en: 'Select the correct answer to continue' },
  'onboard.seed_verif':  { id: 'Seed Terverifikasi!', en: 'Seed Verified!' },
  'onboard.akun_siap':   { id: 'Akun kamu sudah siap.', en: 'Your account is ready.' },
  'onboard.selamat':     { id: 'Selamat datang di z-wealth!', en: 'Welcome to z-wealth!' },
  'onboard.masuk_app':   { id: 'Masuk ke App', en: 'Enter App' },
  'onboard.generate':    { id: 'Generate ulang', en: 'Regenerate' },

  /* LOGIN */
  'login.tagline':   { id: 'Financial Command Center · Login dengan 3 kata seed phrase', en: 'Financial Command Center · Login with your 3-word seed phrase' },
  'login.akun_baru': { id: 'Akun Baru', en: 'New Account' },
  'login.punya_seed':{ id: 'Sudah Punya Seed', en: 'Have a Seed' },
  'login.masukkan':  { id: 'Masukkan', en: 'Enter' },
  'login.3kata':     { id: '3 kata seed phrase', en: 'your 3-word seed phrase' },
  'login.kamu':      { id: 'kamu.', en: '' },
  'login.tdk_ditemukan': { id: 'Akun tidak ditemukan', en: 'Account not found' },
  'login.masuk_btn': { id: 'Masuk →', en: 'Login →' },
  'login.belum_punya':{ id: 'Belum punya?', en: "Don't have one?" },
  'login.buat_baru': { id: 'Buat akun baru', en: 'Create new account' },
  'login.buat_masuk':{ id: 'Buat Akun & Masuk →', en: 'Create Account & Login →' },
  'login.simpan_seed':{ id: 'SIMPAN SEED PHRASE INI!', en: 'SAVE THIS SEED PHRASE!' },
  'login.screenshot': { id: 'Screenshot atau catat ketiga kata ini. Tidak bisa dipulihkan jika hilang.', en: 'Screenshot or write down these three words. Cannot be recovered if lost.' },
  'login.sudah_catat':{ id: 'Saya sudah mencatat dan mengerti tidak bisa dipulihkan', en: 'I have written it down and understand it cannot be recovered' },
  'login.generate':  { id: 'Generate Ulang', en: 'Regenerate' },
  'login.seed_label':{ id: 'Seed phrase kamu:', en: 'Your seed phrase:' },
  'login.3kata_ini': { id: 'ini adalah kunci akun kamu. Data tersimpan di cloud, bisa diakses dari device manapun.', en: 'this is your account key. Data stored in cloud, accessible from any device.' },

  /* ── NAV ── */
  'nav.dashboard':  { id: 'Dashboard',   en: 'Dashboard' },
  'nav.dca':        { id: 'DCA Tracker', en: 'DCA Tracker' },
  'nav.portfolio':  { id: 'Portofolio',  en: 'Portfolio' },
  'nav.simulation': { id: 'Simulasi',    en: 'Simulation' },
  'nav.cashflow':   { id: 'Arus Kas',    en: 'Cash Flow' },
  'nav.ai':         { id: 'z-AI Chat',   en: 'z-AI Chat' },
  'nav.akun':       { id: 'Akun',        en: 'Account' },

  /* ── BOTTOM NAV ── */
  'bnav.home':  { id: 'Home',     en: 'Home' },
  'bnav.dca':   { id: 'DCA',      en: 'DCA' },
  'bnav.porto': { id: 'Porto',    en: 'Porto' },
  'bnav.sim':   { id: 'Simulasi', en: 'Simulate' },
  'bnav.kas':   { id: 'Kas',      en: 'Cash' },
  'bnav.ai':    { id: 'z-AI',     en: 'z-AI' },

  /* ── DASHBOARD ── */
  'feat.tema':     { id: 'Ganti Tema\nWarna',             en: 'Change\nTheme' },
  'feat.ai_chat':  { id: 'z-AI\nAsisten Chat',            en: 'z-AI\nChat Assistant' },
  'feat.chat':     { id: 'Chat\nKomunitas',                en: 'Community\nChat' },
  'feat.prediksi': { id: 'Prediksi AI\nMasa Depan',        en: 'AI Price\nPrediction' },
  'feat.alert':    { id: 'Price Alert &\nPengingat DCA',   en: 'Price Alert &\nDCA Reminder' },
  'feat.berita':   { id: 'Berita\nKripto',                 en: 'Crypto\nNews' },
  'feat.liq_heatmap': { id: 'Liquidation\nHeatmap BTC',   en: 'Liquidation\nHeatmap BTC' },
  'feat.signal_ai':   { id: 'Signal AI\nFutures BTC',     en: 'AI Signal\nBTC Futures' },
  'feat.soon':     { id: 'Segera\nHadir',                  en: 'Coming\nSoon' },
  'feat.in_dev':   { id: 'Dalam pengembangan',             en: 'Under development' },
  'feat.btc_edu':  { id: 'Apa itu Bitcoin? & Tesis Investasi', en: 'What is Bitcoin? & Investment Thesis' },
  'feat.btc_edu_sub': { id: 'Panduan lengkap · Proyeksi 2045 · Whitepaper Satoshi', en: 'Complete guide · 2045 Projection · Satoshi Whitepaper' },
  'feat.donate':     { id: 'Dukung Developer untuk Pengembangan App ini', en: 'Support Developer for App Development' },
  'feat.donate_sub': { id: 'Dukung lewat Saweria · saweria.co/zwealth', en: 'Support via Saweria · saweria.co/zwealth' },
  'dash.fitur_tambahan': { id: 'Fitur Tambahan & Segera Hadir', en: 'Extra Features & Coming Soon' },

  'dash.title':         { id: 'Command Center',    en: 'Command Center' },
  'dash.total_aset':    { id: 'Total Aset',         en: 'Total Assets' },
  'dash.total_invest':  { id: 'Total Investasi',    en: 'Total Invested' },
  'dash.modal_invest':  { id: 'Modal diinvestasikan', en: 'Capital Invested' },
  'dash.total_pnl':     { id: 'Total P&L',          en: 'Total P&L' },
  'dash.btc_price':     { id: 'Bitcoin Price',       en: 'Bitcoin Price' },
  'dash.total_btc':     { id: 'Total BTC',           en: 'Total BTC' },
  'dash.dca_entries':   { id: 'DCA Entries',         en: 'DCA Entries' },
  'dash.fitur':         { id: 'Fitur',               en: 'Features' },
  'dash.fitur_lainnya': { id: 'Fitur Lainnya',       en: 'More Features' },
  'dash.segera_hadir':  { id: 'Segera Hadir!',       en: 'Coming Soon!' },
  'dash.dalam_dev':     { id: 'Fitur ini sedang dalam pengembangan.', en: 'This feature is under development.' },
  'dash.nantikan':      { id: 'Nantikan update selanjutnya!', en: 'Stay tuned for the next update!' },
  'dash.oke':           { id: 'Oke, Ditunggu!',      en: 'Got it!' },
  'dash.pesan_terbaru': { id: 'PESAN TERBARU',        en: 'LATEST MESSAGES' },
  'dash.muat_ulang':    { id: 'muat ulang',           en: 'reload' },
  'dash.memuat_pesan':  { id: 'Memuat pesan...',      en: 'Loading messages...' },
  'dash.sorotan_berita': { id: 'SOROTAN BERITA',           en: 'NEWS HIGHLIGHTS' },
  'dash.paling_bullish': { id: '⚡ Paling Bullish',         en: '⚡ Most Bullish' },
  'dash.paling_bearish': { id: '⚠️ Paling Bearish',         en: '⚠️ Most Bearish' },
  'dash.memuat_berita':  { id: 'Memuat berita...',           en: 'Loading news...' },
  'dash.tdk_ada_bullish':{ id: 'Tidak ada berita bullish saat ini', en: 'No bullish news right now' },
  'dash.tdk_ada_bearish':{ id: 'Tidak ada berita bearish saat ini', en: 'No bearish news right now' },
  'dash.lihat_semua':    { id: 'Lihat semua',                en: 'View all' },
  'dash.pesan_terbaru':  { id: 'PESAN TERBARU',              en: 'LATEST MESSAGES' },
  'dash.muat_ulang':     { id: 'muat ulang',                 en: 'reload' },
  'dash.memuat_pesan':   { id: 'Memuat pesan...',            en: 'Loading messages...' },
  'dash.buka_chat':      { id: 'Buka Chat Komunitas',        en: 'Open Community Chat' },
  'dash.install_app':    { id: 'Install z-wealth App',       en: 'Install z-wealth App' },
  'dash.install_sub':    { id: 'Akses lebih cepat dari homescreen HP kamu', en: 'Faster access from your phone homescreen' },
  'dash.fear_greed':    { id: 'Fear &amp; Greed Index', en: 'Fear &amp; Greed Index' },
  'dash.kemarin':       { id: 'Kemarin',               en: 'Yesterday' },
  'dash.7hari':         { id: '7 Hari lalu',            en: '7 Days ago' },
  'dash.30hari':        { id: '30 Hari lalu',           en: '30 Days ago' },
  'dash.port_alloc':    { id: 'Portfolio Allocation',  en: 'Portfolio Allocation' },
  'dash.pnl_timeline':  { id: 'P&L Timeline',          en: 'P&L Timeline' },
  'dash.tx_terbaru':    { id: 'Transaksi Terbaru',      en: 'Recent Transactions' },
  'dash.lihat_semua':   { id: 'Lihat Semua',            en: 'View All' },
  'dash.bagikan_chart': { id: 'Bagikan Chart',           en: 'Share Chart' },
  'dash.bagikan_btc':   { id: 'Bagikan Chart BTC',       en: 'Share BTC Chart' },
  'dash.simpan_gambar': { id: 'SIMPAN GAMBAR',            en: 'SAVE IMAGE' },
  'dash.return_periode':{ id: 'Return periode',           en: 'Period Return' },
  'dash.via_kraken':    { id: 'via Kraken · auto refresh 60s', en: 'via Kraken · auto refresh 60s' },
  'dash.memuat_chart':  { id: 'Memuat chart...',          en: 'Loading chart...' },

  /* ── DCA ── */
  'dca.title':        { id: 'DCA Tracker',                          en: 'DCA Tracker' },
  'dca.sub':          { id: 'Catat setiap pembelian Bitcoin kamu',  en: 'Record every Bitcoin purchase you make' },
  'dca.ringkasan':    { id: 'Ringkasan',                            en: 'Summary' },
  'dca.bagikan':      { id: 'Bagikan Posisi',                       en: 'Share Position' },
  'dca.tambah_tx':    { id: '+ Tambah Transaksi',                   en: '+ Add Transaction' },
  'dca.nilai_skrg':   { id: 'Nilai Sekarang',                       en: 'Current Value' },
  'dca.avg_buy':      { id: 'Average Buy Price',                    en: 'Average Buy Price' },
  'dca.performa':     { id: 'Performa Per Pembelian',               en: 'Performance Per Purchase' },
  'dca.via_kraken':   { id: 'via Kraken · live',                    en: 'via Kraken · live' },
  'dca.histori':      { id: 'Histori',                              en: 'History' },
  'dca.hapus_semua':  { id: 'Hapus Semua',                          en: 'Delete All' },
  'dca.memuat':       { id: 'Memuat chart...',                      en: 'Loading chart...' },
  'dca.harga_usd':    { id: 'Harga (USD)',                          en: 'Price (USD)' },
  'dca.harga_idr':    { id: 'Harga (IDR)',                          en: 'Price (IDR)' },
  'dca.modal_idr':    { id: 'Modal (IDR)',                          en: 'Capital (IDR)' },
  'dca.nilai_kini':   { id: 'Nilai Kini',                           en: 'Current Value' },
  'dca.return_pct':   { id: 'Return%',                              en: 'Return%' },
  'dca.catatan':      { id: 'Catatan',                              en: 'Notes' },
  'dca.vs_avg':       { id: 'vs Avg Buy',                           en: 'vs Avg Buy' },

  /* ── PORTFOLIO ── */
  'port.title':       { id: 'Portofolio',                       en: 'Portfolio' },
  'port.sub':         { id: 'Semua aset investasi kamu',        en: 'All your investment assets' },
  'port.aset':        { id: 'Aset',                             en: 'Assets' },
  'port.tambah_aset': { id: 'Tambah Aset',                     en: 'Add Asset' },
  'port.connect_wallet':{ id: 'Connect Wallet',                 en: 'Connect Wallet' },
  'port.btc_addr':    { id: '+ BTC Address',                   en: '+ BTC Address' },
  'port.aman':        { id: '100% AMAN · READ-ONLY',           en: '100% SAFE · READ-ONLY' },
  'port.fitur_ini':   { id: 'Fitur ini',                       en: 'This feature' },
  'port.hanya_baca':  { id: 'hanya membaca',                   en: 'only reads' },
  'port.saldo_pub':   { id: 'saldo wallet Bitcoin kamu secara publik — seperti melihat data di blockchain explorer.', en: 'your Bitcoin wallet balance publicly — like viewing data on a blockchain explorer.' },
  'port.no_privkey':  { id: 'Tidak ada akses ke private key',  en: 'No access to private key' },
  'port.no_privkey2': { id: ', tidak bisa kirim atau terima transaksi, tidak bisa approve apapun. \n          Address Bitcoin bersifat publik dan aman untuk dibagikan. Data diambil langsung dari blockchain via Mempool.space.', en: ', cannot send or receive transactions, cannot approve anything. Bitcoin addresses are public and safe to share. Data fetched directly from blockchain via Mempool.space.' },
  'port.btc_addr_ro': { id: 'Bitcoin Address (Read-Only)',     en: 'Bitcoin Address (Read-Only)' },
  'port.data_dari':   { id: 'Data dari',                       en: 'Data from' },
  'port.no_api':      { id: '· Tanpa API key · Saldo realtime · Hanya baca', en: '· No API key · Realtime balance · Read only' },
  'port.disconnect':  { id: 'Disconnect',                      en: 'Disconnect' },
  'port.alokasi':     { id: 'Alokasi Wallet',                  en: 'Wallet Allocation' },
  'port.histori_nilai':{ id: 'Histori Nilai Total',            en: 'Total Value History' },
  'port.snapshot':    { id: 'Snapshot otomatis tiap 30 menit · disimpan lokal', en: 'Auto snapshot every 30 minutes · stored locally' },
  'port.belum_ada':   { id: 'Belum ada aset',                  en: 'No assets yet' },
  'port.tambah_kamu': { id: 'Tambah aset kamu',                en: 'Add your assets' },
  'port.detail':      { id: 'Detail',                          en: 'Detail' },
  'port.qty':         { id: 'Qty',                             en: 'Qty' },
  'port.harga_kini':  { id: 'Harga Kini',                     en: 'Current Price' },
  'port.nilai':       { id: 'Nilai',                           en: 'Value' },
  'port.alokasi_col': { id: 'Alokasi',                         en: 'Allocation' },

  /* ── SIMULASI ── */
  'sim.title':        { id: 'Simulasi DCA',                                         en: 'DCA Simulation' },
  'sim.sub':          { id: 'Harga historis real dari Kraken/CoinGecko — bukan estimasi', en: 'Real historical prices from Kraken/CoinGecko — not estimates' },
  'sim.param':        { id: 'Parameter Simulasi',                                   en: 'Simulation Parameters' },
  'sim.dca_periode':  { id: 'DCA per periode (IDR)',                                en: 'DCA per period (IDR)' },
  'sim.tgl_mulai':    { id: 'Tanggal Mulai DCA',                                   en: 'DCA Start Date' },
  'sim.harga_dari':   { id: 'Harga diambil dari Kraken atau CoinGecko',            en: 'Prices fetched from Kraken or CoinGecko' },
  'sim.tgl_akhir':    { id: 'Tanggal Akhir',                                       en: 'End Date' },
  'sim.kosongkan':    { id: 'Kosongkan = sampai hari ini',                         en: 'Leave empty = until today' },
  'sim.frekuensi':    { id: 'Frekuensi DCA',                                       en: 'DCA Frequency' },
  'sim.bulanan':      { id: 'Bulanan (tanggal sama)',                              en: 'Monthly (same date)' },
  'sim.2minggu':      { id: '2 Minggu Sekali',                                    en: 'Every 2 Weeks' },
  'sim.mingguan':     { id: 'Mingguan',                                            en: 'Weekly' },
  'sim.harian':       { id: 'Harian',                                              en: 'Daily' },
  'sim.kurs':         { id: 'Kurs USD/IDR',                                        en: 'USD/IDR Rate' },
  'sim.hitung':       { id: 'Hitung Simulasi',                                     en: 'Run Simulation' },
  'sim.nilai_port':   { id: 'Nilai Portofolio',                                    en: 'Portfolio Value' },
  'sim.total_modal':  { id: 'Total Modal',                                         en: 'Total Capital' },
  'sim.profit_roi':   { id: 'Profit / ROI',                                        en: 'Profit / ROI' },
  'sim.avg_buy':      { id: 'Avg Buy Price',                                       en: 'Avg Buy Price' },
  'sim.periode':      { id: 'Periode',                                             en: 'Period' },
  'sim.btc_terkumpul':{ id: 'BTC Terkumpul',                                       en: 'BTC Accumulated' },
  'sim.growth':       { id: 'Growth Curve',                                        en: 'Growth Curve' },
  'sim.detail_per':   { id: 'Detail Per Periode',                                  en: 'Detail Per Period' },
  'sim.harga_btc':    { id: 'Harga BTC',                                           en: 'BTC Price' },
  'sim.btc_dibeli':   { id: 'BTC Dibeli',                                          en: 'BTC Bought' },

  /* ── CASHFLOW ── */
  'cash.title':       { id: 'Arus Kas',                        en: 'Cash Flow' },
  'cash.sub':         { id: 'Catat pemasukan dan pengeluaran', en: 'Record income and expenses' },
  'cash.ringkasan':   { id: 'Ringkasan',                       en: 'Summary' },
  'cash.tambah_tx':   { id: '+ Tambah Transaksi',             en: '+ Add Transaction' },
  'cash.pemasukan':   { id: 'Pemasukan',                       en: 'Income' },
  'cash.pengeluaran': { id: 'Pengeluaran',                     en: 'Expenses' },
  'cash.saldo_bersih':{ id: 'Saldo Bersih',                   en: 'Net Balance' },
  'cash.pct_invest':  { id: '% Investasi',                    en: '% Invested' },
  'cash.monthly':     { id: 'Cashflow Bulanan',               en: 'Monthly Cashflow' },
  'cash.transaksi':   { id: 'Transaksi',                      en: 'Transactions' },
  'cash.kategori':    { id: 'Kategori',                       en: 'Category' },
  'cash.deskripsi':   { id: 'Deskripsi',                      en: 'Description' },
  'cash.tipe':        { id: 'Tipe',                           en: 'Type' },
  'cash.jumlah':      { id: 'Jumlah',                         en: 'Amount' },

  /* ── COMMON TABLE HEADERS ── */
  'th.tanggal':   { id: 'Tanggal',    en: 'Date' },
  'th.harga_beli':{ id: 'Harga Beli', en: 'Buy Price' },
  'th.modal_idr': { id: 'Modal IDR',  en: 'Capital IDR' },
  'th.nilai_kini':{ id: 'Nilai Kini', en: 'Current Value' },
  'th.pnl':       { id: 'P&L',        en: 'P&L' },
  'th.catatan':   { id: 'Catatan',    en: 'Notes' },
  'th.tipe':      { id: 'Tipe',       en: 'Type' },
  'th.kategori':  { id: 'Kategori',   en: 'Category' },

  /* ── ALERTS PAGE ── */
  'alert.title':      { id: 'Alert &amp; Pengingat DCA',       en: 'Alert &amp; DCA Reminder' },
  'alert.sub':        { id: 'Set alert harga dan jadwal DCA otomatis', en: 'Set price alerts and automatic DCA schedule' },
  'alert.price_alert':{ id: 'Price Alert BTC',                 en: 'BTC Price Alert' },
  'alert.new_alert':  { id: '+ Alert Baru',                    en: '+ New Alert' },
  'alert.harga_skrg': { id: 'Harga BTC Saat Ini',             en: 'Current BTC Price' },
  'alert.belum_ada':  { id: 'Belum Ada Alert',                 en: 'No Alerts Yet' },
  'alert.buat_alert': { id: 'Buat alert harga untuk mendapat notifikasi', en: 'Create a price alert to get notifications' },
  'alert.pengingat':  { id: 'Pengingat DCA',                   en: 'DCA Reminder' },
  'alert.frekuensi':  { id: 'Frekuensi Pengingat',            en: 'Reminder Frequency' },
  'alert.setiap_hari':{ id: 'Setiap Hari',                    en: 'Every Day' },
  'alert.setiap_minggu':{ id: 'Setiap Minggu',               en: 'Every Week' },
  'alert.setiap_bulan':{ id: 'Setiap Bulan (pilih tanggal)', en: 'Every Month (pick date)' },
  'alert.tgl_spesifik':{ id: 'Tanggal &amp; Waktu Spesifik', en: 'Specific Date &amp; Time' },
  'alert.jam':        { id: 'Jam Pengingat',                  en: 'Reminder Time' },
  'alert.hari':       { id: 'Hari',                           en: 'Day' },
  'alert.senin':      { id: 'Senin',    en: 'Monday' },
  'alert.selasa':     { id: 'Selasa',   en: 'Tuesday' },
  'alert.rabu':       { id: 'Rabu',     en: 'Wednesday' },
  'alert.kamis':      { id: 'Kamis',    en: 'Thursday' },
  'alert.jumat':      { id: 'Jumat',    en: 'Friday' },
  'alert.sabtu':      { id: 'Sabtu',    en: 'Saturday' },
  'alert.minggu':     { id: 'Minggu',   en: 'Sunday' },
  'alert.tgl_bulan':  { id: 'Tanggal dalam Bulan',            en: 'Day of Month' },
  'alert.pilih_tgl':  { id: 'Pilih Tanggal &amp; Jam',       en: 'Pick Date &amp; Time' },
  'alert.sekali':     { id: 'Pengingat sekali pada waktu yang kamu pilih', en: 'One-time reminder at your chosen time' },
  'alert.nominal':    { id: 'Nominal DCA (opsional)',         en: 'DCA Amount (optional)' },
  'alert.simpan_pengingat':{ id: 'Simpan Pengingat',          en: 'Save Reminder' },
  'alert.pengingat_aktif':{ id: 'Pengingat Aktif',            en: 'Active Reminders' },
  'alert.belum_pengingat':{ id: 'Belum Ada Pengingat',        en: 'No Reminders Yet' },
  'alert.set_jadwal': { id: 'Set jadwal DCA kamu di atas',   en: 'Set your DCA schedule above' },
  'alert.aktifkan':   { id: 'Aktifkan Notifikasi',            en: 'Enable Notifications' },
  'alert.izinkan_sub':{ id: 'Izinkan notifikasi agar alert dan pengingat bisa bekerja saat app di background', en: 'Allow notifications so alerts and reminders work when app is in background' },
  'alert.izinkan_btn':{ id: 'Izinkan Notifikasi',            en: 'Allow Notifications' },

  /* ── MODAL PRICE ALERT ── */
  'modal_alert.title': { id: 'Buat Price Alert BTC',    en: 'Create BTC Price Alert' },
  'modal_alert.jenis': { id: 'Jenis Alert',             en: 'Alert Type' },
  'modal_alert.naik':  { id: 'Harga Naik Di Atas',     en: 'Price Rises Above' },
  'modal_alert.turun': { id: 'Harga Turun Di Bawah',   en: 'Price Drops Below' },
  'modal_alert.target':{ id: 'Target Harga (USD)',      en: 'Target Price (USD)' },
  'modal_alert.catatan':{ id: 'Catatan (opsional)',     en: 'Notes (optional)' },
  'modal_alert.batal': { id: 'Batal',                  en: 'Cancel' },
  'modal_alert.simpan':{ id: 'Simpan Alert',            en: 'Save Alert' },

  /* ── BTC EDU ── */
  'edu.title':        { id: 'Apa itu Bitcoin?',                           en: 'What is Bitcoin?' },
  'edu.subtitle':     { id: 'Panduan Lengkap &amp; Tesis Investasi 2025–2045', en: 'Complete Guide &amp; Investment Thesis 2025–2045' },
  'edu.intro':        { id: 'Bitcoin adalah uang digital terdesentralisasi pertama di dunia — tidak ada bank, tidak ada pemerintah, tidak ada perantara. Diciptakan tahun 2009 oleh', en: 'Bitcoin is the world\'s first decentralized digital money — no bank, no government, no intermediary. Created in 2009 by' },
  'edu.intro2':       { id: ', Bitcoin berjalan di atas protokol Blockchain yang transparan, aman, dan tak bisa dimanipulasi siapapun.', en: ', Bitcoin runs on the Blockchain protocol that is transparent, secure, and cannot be manipulated by anyone.' },
  'edu.supply_maks':  { id: 'Supply Maks',       en: 'Max Supply' },
  'edu.selamanya':    { id: 'Selamanya',          en: 'Forever' },
  'edu.halving_cycle':{ id: 'Halving Cycle',      en: 'Halving Cycle' },
  'edu.track_record': { id: 'Track Record',       en: 'Track Record' },
  'edu.berjalan':     { id: 'Berjalan',           en: 'Running' },
  'edu.quote':        { id: '&quot;Bitcoin adalah sistem uang elektronik peer-to-peer yang memungkinkan pembayaran langsung antar pihak tanpa melalui lembaga keuangan manapun.&quot; —', en: '&quot;Bitcoin is a peer-to-peer electronic cash system that allows direct payments between parties without going through a financial institution.&quot; —' },
  'edu.desentralisasi':{ id: 'Desentralisasi total.', en: 'Full decentralization.' },
  'edu.desent_desc':  { id: 'Bitcoin berjalan di 15.000+ node di seluruh dunia. Tidak ada satu entitas — termasuk penciptanya — yang bisa mengubah aturan atau membekukan aset siapapun.', en: 'Bitcoin runs on 15,000+ nodes worldwide. No single entity — including its creator — can change the rules or freeze anyone\'s assets.' },
  'edu.pow':          { id: 'Proof of Work (PoW).', en: 'Proof of Work (PoW).' },
  'edu.pow_desc':     { id: 'Setiap transaksi dikonfirmasi oleh ribuan miner di seluruh dunia menggunakan kekuatan komputasi nyata — menjadikan blockchain Bitcoin paling aman di dunia.', en: 'Every transaction is confirmed by thousands of miners worldwide using real computing power — making the Bitcoin blockchain the most secure in the world.' },
  'edu.supply21':     { id: 'Supply 21 juta — tak bisa diubah.', en: '21 million supply — immutable.' },
  'edu.supply21_desc':{ id: 'Tidak ada bank sentral, tidak ada quantitative easing. Bitcoin adalah satu-satunya aset di dunia yang memiliki kelangkaan dijamin oleh matematika dan kode.', en: 'No central bank, no quantitative easing. Bitcoin is the only asset in the world with scarcity guaranteed by mathematics and code.' },
  'edu.data_fund':    { id: 'Data &amp; Fundamental Kunci', en: 'Key Data &amp; Fundamentals' },
  'edu.pangsa':       { id: 'Pangsa dari total aset global — ruang tumbuh masih 99%', en: 'Share of global total assets — 99% room to grow' },
  'edu.return_tahunan':{ id: 'Return tahunan rata-rata BTC selama 10 tahun', en: 'BTC average annual return over 10 years' },
  'edu.inflow':       { id: 'Inflow Bitcoin ETF tahun pertama — kalahkan Gold ETF', en: 'Bitcoin ETF first-year inflow — beating Gold ETF' },
  'edu.return_kum':   { id: 'Return kumulatif BTC 2011–2021 vs semua aset', en: 'BTC cumulative return 2011–2021 vs all assets' },
  'edu.outperform':   { id: 'BTC outperform SEMUA aset secara historis.', en: 'BTC outperforms ALL assets historically.' },
  'edu.outperform_desc':{ id: 'Selama 10 tahun terakhir, Bitcoin menempati posisi "Highest Return" di setiap tahun kecuali 2018. Tidak ada aset lain — saham, emas, properti, obligasi — yang mendekati performa ini.', en: 'Over the last 10 years, Bitcoin held the "Highest Return" position every year except 2018. No other asset — stocks, gold, property, bonds — comes close to this performance.' },
  'edu.katalis':      { id: '4 Katalis Bullish Jangka Panjang', en: '4 Long-Term Bullish Catalysts' },
  'edu.halving':      { id: 'Halving 4 tahunan.', en: 'Quadrennial Halving.' },
  'edu.halving_desc': { id: 'Setiap ~4 tahun, reward mining dipotong 50%. Supply baru terus berkurang — sementara demand terus naik. Historis, setiap siklus post-halving Bitcoin mencetak ATH baru.', en: 'Every ~4 years, mining reward is cut 50%. New supply keeps shrinking — while demand keeps rising. Historically, every post-halving cycle Bitcoin sets new ATH.' },
  'edu.institusi':    { id: 'Adopsi institusional masif.', en: 'Massive institutional adoption.' },
  'edu.institusi_desc':{ id: 'MicroStrategy, Tesla, BlackRock, Fidelity — korporasi dan fund manajer terbesar dunia kini hold Bitcoin. Ini bukan lagi "aset spekulatif niche".', en: 'MicroStrategy, Tesla, BlackRock, Fidelity — the world\'s largest corporations and fund managers now hold Bitcoin. This is no longer a "niche speculative asset".' },
  'edu.inflation':    { id: 'Inflation rate menuju nol.', en: 'Inflation rate approaching zero.' },
  'edu.inflation_desc':{ id: 'Pada 2040, Bitcoin mendekati supply maksimum 21 juta — inflasi mendekati 0%. Di tengah hyperinflasi fiat global, ini properti moneter yang belum pernah ada dalam sejarah manusia.', en: 'By 2040, Bitcoin approaches the 21 million maximum supply — inflation near 0%. Amid global fiat hyperinflation, this is a monetary property never seen in human history.' },
  'edu.network':      { id: 'Network Effect &amp; Kelangkaan Digital.', en: 'Network Effect &amp; Digital Scarcity.' },
  'edu.network_desc': { id: "Adopsi Bitcoin lebih cepat dari internet — 300M+ user dalam 10 tahun vs internet yang butuh 25 tahun. Semakin banyak pengguna, semakin kuat jaringan (Metcalfe's Law).", en: "Bitcoin adoption is faster than the internet — 300M+ users in 10 years vs the internet's 25 years. More users = stronger network (Metcalfe's Law)." },
  'edu.proyeksi':     { id: 'Proyeksi Harga BTC Tahun 2045', en: 'BTC Price Projection for 2045' },
  'edu.berdasarkan':  { id: 'Berdasarkan', en: 'Based on' },
  'edu.oleh':         { id: 'oleh Michael Saylor dan analisis on-chain, harga BTC mengikuti pola matematis yang konsisten sejak 2010. Model ini memproyeksikan tiga skenario untuk 2045:', en: 'by Michael Saylor and on-chain analysis, BTC price follows a consistent mathematical pattern since 2010. This model projects three scenarios for 2045:' },
  'edu.mkt_bear':     { id: 'Market cap $68T',   en: 'Market cap $68T' },
  'edu.aset_bear':    { id: '2% aset global',    en: '2% global assets' },
  'edu.mkt_base':     { id: 'Market cap $280T',  en: 'Market cap $280T' },
  'edu.aset_base':    { id: '7% aset global',    en: '7% global assets' },
  'edu.mkt_bull':     { id: 'Market cap $1.030T',en: 'Market cap $1.030T' },
  'edu.aset_bull':    { id: '22% aset global',   en: '22% global assets' },
  'edu.pesimis':      { id: 'Bahkan di skenario paling pesimis (Bear), BTC di 2045 diproyeksikan mencapai $3 juta per koin. Ini bukan janji — ini output dari model matematis berbasis data 15 tahun.', en: 'Even in the most pessimistic scenario (Bear), BTC in 2045 is projected to reach $3 million per coin. This is not a promise — it is the output of a mathematical model based on 15 years of data.' },
  'edu.disclaimer':   { id: 'Bukan rekomendasi investasi. Selalu lakukan riset mandiri (DYOR).', en: 'Not investment advice. Always do your own research (DYOR).' },
  'edu.strategi':     { id: 'Strategi: Dollar Cost Averaging (DCA)', en: 'Strategy: Dollar Cost Averaging (DCA)' },
  'edu.dca_terbaik':  { id: 'DCA adalah strategi terbaik untuk investor jangka panjang.', en: 'DCA is the best strategy for long-term investors.' },
  'edu.dca_desc':     { id: 'Beli jumlah tetap secara rutin (mingguan/bulanan) tanpa mempedulikan harga. Ini menghilangkan risiko timing market dan memaksimalkan return jangka panjang. Gunakan fitur', en: 'Buy a fixed amount regularly (weekly/monthly) regardless of price. This eliminates market timing risk and maximizes long-term returns. Use the' },
  'edu.dca_tracker':  { id: 'DCA Tracker di z-wealth', en: 'DCA Tracker in z-wealth' },
  'edu.pantau':       { id: 'untuk memantau progresmu!', en: 'to track your progress!' },
  'edu.baca_wp':      { id: 'Baca Bitcoin Whitepaper (Bahasa Indonesia)', en: 'Read Bitcoin Whitepaper (English)' },

  /* ── THEME ── */
  'theme.title':      { id: 'Tema &amp; Tampilan',      en: 'Theme &amp; Display' },
  'theme.sub':        { id: 'Pilih warna dan mode tampilan favoritmu', en: 'Choose your favorite color and display mode' },
  'theme.preset':     { id: 'Preset Tema',              en: 'Theme Presets' },
  'theme.custom':     { id: 'Warna Custom',             en: 'Custom Color' },
  'theme.pilih_warna':{ id: 'Pilih Warna Aksen',        en: 'Choose Accent Color' },
  'theme.warna_desc': { id: 'Warna ini akan diterapkan ke seluruh aplikasi', en: 'This color will be applied throughout the app' },
  'theme.terapkan':   { id: 'Terapkan',                 en: 'Apply' },
  'theme.mode':       { id: 'Mode Tampilan',            en: 'Display Mode' },
  'theme.dark':       { id: 'Dark Mode',                en: 'Dark Mode' },
  'theme.light':      { id: 'Light Mode',               en: 'Light Mode' },
  'theme.preview':    { id: 'Preview',                  en: 'Preview' },
  'theme.reset':      { id: 'Reset ke Default',         en: 'Reset to Default' },

  /* ── AI CHAT ── */
  'ai.title':         { id: 'z-AI Assistant',           en: 'z-AI Assistant' },
  'ai.sub':           { id: 'Groq · OpenRouter · Pollinations — Siap membantu', en: 'Groq · OpenRouter · Pollinations — Ready to help' },
  'ai.analisis_btc':  { id: 'Analisis BTC',             en: 'BTC Analysis' },
  'ai.tips_dca':      { id: 'Tips DCA',                 en: 'DCA Tips' },
  'ai.bear_market':   { id: 'Bear Market',              en: 'Bear Market' },
  'ai.target':        { id: 'Target',                   en: 'Target' },
  'ai.fear_greed':    { id: 'Fear &amp; Greed',         en: 'Fear &amp; Greed' },
  'ai.disclaimer':    { id: 'z-AI bisa salah · Verifikasi info penting sebelum keputusan investasi', en: 'z-AI can be wrong · Verify important info before investment decisions' },

  /* ── AI SIGNAL ── */
  'signal.kembali':   { id: 'Kembali ke Dashboard',     en: 'Back to Dashboard' },
  'signal.pilih':     { id: 'Pilih pair &amp; analisis',en: 'Select pair &amp; analyze' },
  'signal.analisis':  { id: 'Analisis Signal AI',       en: 'AI Signal Analysis' },
  'signal.chart':     { id: 'Chart Candlestick',        en: 'Candlestick Chart' },
  'signal.belum':     { id: 'Belum dianalisis',         en: 'Not yet analyzed' },
  'signal.tekan':     { id: 'Tekan Analisis untuk memuat chart', en: 'Press Analyze to load chart' },
  'signal.entry':     { id: 'Entry',                    en: 'Entry' },
  'signal.harga_masuk':{ id: 'Harga masuk',             en: 'Entry price' },
  'signal.sl':        { id: 'Stop Loss',                en: 'Stop Loss' },
  'signal.tp':        { id: 'Take Profit',              en: 'Take Profit' },
  'signal.rr':        { id: 'Risk/Reward',              en: 'Risk/Reward' },
  'signal.winrate':   { id: 'Win Rate Est.',            en: 'Win Rate Est.' },
  'signal.skor':      { id: 'Skor Signal',              en: 'Signal Score' },
  'signal.10ind':     { id: 'Analisis 10 Indikator Teknikal', en: '10 Technical Indicator Analysis' },
  'signal.leverage_warning': { id: '⚠️ Leverage tinggi — risiko likuidasi besar. Gunakan dengan bijak.', en: '⚠️ High leverage — high liquidation risk. Use wisely.' },
  'signal.entry_btn': { id: 'Entry Posisi Sekarang',    en: 'Enter Position Now' },
  'signal.pantau':    { id: 'Sistem akan memantau harga real &amp; mencatat hasil ke riwayat', en: 'System will monitor real price &amp; record results to history' },
  'signal.posisi_aktif':{ id: 'Posisi Aktif',           en: 'Active Position' },
  'signal.statistik': { id: 'Statistik Akurasi Signal', en: 'Signal Accuracy Statistics' },
  'signal.total':     { id: 'Total',                    en: 'Total' },
  'signal.tp_hit':    { id: 'TP Hit',                   en: 'TP Hit' },
  'signal.sl_hit':    { id: 'SL Hit',                   en: 'SL Hit' },
  'signal.winrate_col':{ id: 'Win Rate',                en: 'Win Rate' },
  'signal.belum_riwayat':{ id: 'Belum ada data riwayat', en: 'No history data yet' },
  'signal.riwayat':   { id: 'Riwayat Signal',           en: 'Signal History' },
  'signal.belum_entry':{ id: 'Belum ada riwayat. Tekan Entry Posisi untuk mulai tracking.', en: 'No history yet. Press Enter Position to start tracking.' },
  'signal.hanya':     { id: 'Signal ini hanya bersifat', en: 'This signal is for' },
  'signal.edukatif':  { id: 'edukatif',                 en: 'educational purposes' },
  'signal.bukan_saran':{ id: 'berdasarkan analisis teknikal otomatis. Bukan saran finansial. Selalu lakukan riset sendiri sebelum trading.', en: 'based on automated technical analysis. Not financial advice. Always do your own research before trading.' },

  /* ── AI PREDICT ── */
  'predict.title':    { id: 'Prediksi AI Bitcoin',      en: 'Bitcoin AI Prediction' },
  'predict.belum':    { id: 'Belum dimuat',             en: 'Not loaded' },
  'predict.memuat':   { id: 'Memuat analisis...',       en: 'Loading analysis...' },
  'predict.keyakinan':{ id: 'Keyakinan AI',             en: 'AI Confidence' },
  'predict.vol24':    { id: 'Volume 24J',               en: '24H Volume' },
  'predict.total_tx': { id: 'Total transaksi global',   en: 'Total global transactions' },
  'predict.mktcap':   { id: 'Market Cap',               en: 'Market Cap' },
  'predict.kap_pasar':{ id: 'Kapitalisasi pasar',       en: 'Market capitalization' },
  'predict.high24':   { id: 'High 24J',                 en: '24H High' },
  'predict.harga_tertinggi':{ id: 'Harga tertinggi',    en: 'Highest price' },
  'predict.low24':    { id: 'Low 24J',                  en: '24H Low' },
  'predict.harga_terendah':{ id: 'Harga terendah',     en: 'Lowest price' },
  'predict.sentimen': { id: 'Sentimen Pasar',           en: 'Market Sentiment' },
  'predict.level':    { id: 'Level Harga Kunci',        en: 'Key Price Levels' },
  'predict.r1':       { id: 'Resistance 1',             en: 'Resistance 1' },
  'predict.r2':       { id: 'Resistance 2',             en: 'Resistance 2' },
  'predict.harga_skrg':{ id: 'Harga Sekarang',          en: 'Current Price' },
  'predict.s1':       { id: 'Support 1',                en: 'Support 1' },
  'predict.s2':       { id: 'Support 2',                en: 'Support 2' },
  'predict.analisis': { id: 'Analisis AI (Gemini)',      en: 'AI Analysis (Gemini)' },
  'predict.pergerakan':{ id: 'Pergerakan Harga (30H)',  en: 'Price Movement (30H)' },
  'predict.no_key':   { id: 'Gemini API Key belum diset', en: 'Gemini API Key not set' },
  'predict.key_desc': { id: 'Untuk analisis AI, masukkan Gemini API key gratis di bawah. Daftar di', en: 'For AI analysis, enter your free Gemini API key below. Register at' },
  'predict.disclaimer':{ id: 'Prediksi AI bersifat informatif, bukan saran investasi.', en: 'AI predictions are informational, not investment advice.' },
  'predict.data':     { id: 'Data: CoinGecko · Fear &amp; Greed Index · Gemini AI', en: 'Data: CoinGecko · Fear &amp; Greed Index · Gemini AI' },
  'predict.gagal':    { id: 'Gagal memuat data',        en: 'Failed to load data' },
  'predict.coba_lagi':{ id: '↺ Coba Lagi',             en: '↺ Try Again' },

  /* ── NEWS ── */
  'news.title':       { id: 'Berita Kripto',            en: 'Crypto News' },
  'news.sub':         { id: 'Terkini · Terjemahan Indonesia · Sentimen', en: 'Latest · Indonesian Translation · Sentiment' },
  'news.sentimen':    { id: 'Sentimen Berita Saat Ini', en: 'Current News Sentiment' },
  'news.positif':     { id: 'Positif',                  en: 'Positive' },
  'news.negatif':     { id: 'Negatif',                  en: 'Negative' },
  'news.netral':      { id: 'Netral',                   en: 'Neutral' },
  'news.semua':       { id: 'Semua',                    en: 'All' },
  'news.sumber':      { id: 'Sumber: RSS Feed · Diterjemahkan oleh Groq AI · Bukan saran investasi', en: 'Source: RSS Feed · Translated by Groq AI · Not investment advice' },
  'news.terjemahan':  { id: 'Terkini · Terjemahan Indonesia · Sentimen', en: 'Latest · English · Sentiment' },

  /* ── CHAT ── */
  'chat.title':       { id: 'Chat',                             en: 'Chat' },
  'chat.anon':        { id: 'Anonim · terenkripsi',            en: 'Anonymous · encrypted' },
  'chat.baru':        { id: 'Baru',                            en: 'New' },
  'chat.publik':      { id: 'Publik',                          en: 'Public' },
  'chat.grup_saya':   { id: 'Grup Saya',                       en: 'My Groups' },
  'chat.belum_grup':  { id: 'Belum ada grup.',                 en: 'No groups yet.' },
  'chat.buat_grup':   { id: 'Buat grup baru!',                 en: 'Create a new group!' },
  'chat.pesan_pribadi':{ id: 'Pesan Pribadi',                  en: 'Private Messages' },
  'chat.belum_dm':    { id: 'Belum ada DM.',                   en: 'No DMs yet.' },
  'chat.masukkan_kode':{ id: 'Masukkan kode anonim teman!',    en: 'Enter your friend\'s anonymous code!' },
  'chat.undang':      { id: 'Undang',                          en: 'Invite' },
  'chat.link':        { id: 'Link',                            en: 'Link' },
  'chat.belum_pesan': { id: 'Belum ada pesan.',               en: 'No messages yet.' },
  'chat.pertama':     { id: 'Jadilah yang pertama!',           en: 'Be the first!' },
  'chat.balas':       { id: 'Balas',                           en: 'Reply' },
  'chat.buat_join':   { id: 'Buat / Join Room',               en: 'Create / Join Room' },
  'chat.grup_baru':   { id: 'Grup Baru',                      en: 'New Group' },
  'chat.join_grup':   { id: 'Join Grup',                      en: 'Join Group' },
  'chat.dm_pribadi':  { id: 'DM Pribadi',                     en: 'Private DM' },
  'chat.nama_grup':   { id: 'Nama Grup',                      en: 'Group Name' },
  'chat.deskripsi':   { id: 'Deskripsi (opsional)',           en: 'Description (optional)' },
  'chat.warna_avatar':{ id: 'Warna Avatar',                   en: 'Avatar Color' },
  'chat.kode_undangan':{ id: 'Kode Undangan Grup',            en: 'Group Invitation Code' },
  'chat.minta_kode':  { id: 'Minta kode undangan dari pembuat grup. Kode bisa dilihat di dalam room pada tombol', en: 'Ask the group creator for the invitation code. The code can be seen inside the room on the button' },
  'chat.kode_anon':   { id: 'Kode Anonim Teman',             en: 'Friend\'s Anonymous Code' },
  'chat.kode_kamu':   { id: 'Kode anonim kamu (bagikan ke teman):', en: 'Your anonymous code (share with friends):' },
  'chat.buat_room':   { id: 'Buat Room',                      en: 'Create Room' },

  /* ── MODALS & FORMS ── */
  'modal.dca_title':  { id: '₿ Tambah Transaksi DCA',       en: '₿ Add DCA Transaction' },
  'modal.tanggal':    { id: 'Tanggal',                       en: 'Date' },
  'modal.harga_btc':  { id: 'Harga BTC (USD)',              en: 'BTC Price (USD)' },
  'modal.mengambil':  { id: '⏳ Mengambil...',               en: '⏳ Fetching...' },
  'modal.pakai_skrg': { id: 'Pakai harga sekarang',         en: 'Use current price' },
  'modal.pakai_tgl':  { id: 'Pakai harga di tanggal ini',   en: 'Use price on this date' },
  'modal.kurs':       { id: 'Kurs USD/IDR',                 en: 'USD/IDR Rate' },
  'modal.jumlah_inv': { id: 'Jumlah Investasi (IDR)',       en: 'Investment Amount (IDR)' },
  'modal.catatan':    { id: 'Catatan (opsional)',            en: 'Notes (optional)' },
  'modal.batal':      { id: 'Batal',                        en: 'Cancel' },
  'modal.simpan':     { id: 'Simpan',                       en: 'Save' },

  'modal.port_title': { id: 'Tambah Aset',                  en: 'Add Asset' },
  'modal.nama_aset':  { id: 'Nama Aset',                   en: 'Asset Name' },
  'modal.ticker':     { id: 'Ticker',                       en: 'Ticker' },
  'modal.tipe':       { id: 'Tipe',                         en: 'Type' },
  'modal.kripto':     { id: 'Kripto',                       en: 'Crypto' },
  'modal.saham':      { id: 'Saham',                        en: 'Stock' },
  'modal.emas':       { id: 'Emas',                         en: 'Gold' },
  'modal.reksadana':  { id: 'Reksadana',                   en: 'Mutual Fund' },
  'modal.lainnya':    { id: 'Lainnya',                      en: 'Other' },
  'modal.qty':        { id: 'Jumlah (qty)',                 en: 'Quantity (qty)' },
  'modal.avg_buy':    { id: 'Avg Buy (IDR)',                en: 'Avg Buy (IDR)' },
  'modal.harga_skrg': { id: 'Harga Sekarang (IDR)',        en: 'Current Price (IDR)' },

  'modal.cash_title': { id: 'Tambah Transaksi Keuangan',    en: 'Add Financial Transaction' },
  'modal.pemasukan':  { id: 'Pemasukan',                   en: 'Income' },
  'modal.pengeluaran':{ id: 'Pengeluaran',                 en: 'Expense' },
  'modal.investasi':  { id: 'Investasi',                   en: 'Investment' },
  'modal.jumlah_idr': { id: 'Jumlah (IDR)',               en: 'Amount (IDR)' },

  /* ── SEED / ACCOUNT ── */
  'acct.ganti_seed':  { id: 'Ganti Seed Phrase',            en: 'Change Seed Phrase' },
  'acct.perhatian':   { id: 'Perhatian!',                   en: 'Warning!' },
  'acct.seed_warning':{ id: 'Seed phrase lama akan tidak aktif. Pastikan kamu mencatat seed baru sebelum menutup halaman ini. Data akun tetap aman.', en: 'Old seed phrase will be deactivated. Make sure you write down the new seed before closing this page. Account data remains safe.' },
  'acct.seed_saat':   { id: 'Seed phrase saat ini:',        en: 'Current seed phrase:' },
  'acct.seed_baru':   { id: 'Seed phrase baru:',            en: 'New seed phrase:' },
  'acct.generate':    { id: 'Generate Ulang',               en: 'Regenerate' },
  'acct.konfirmasi':  { id: 'Konfirmasi Ganti',             en: 'Confirm Change' },
  'acct.berhasil':    { id: 'Seed Phrase Berhasil Diganti!', en: 'Seed Phrase Changed Successfully!' },
  'acct.catat_baru':  { id: 'Catat seed baru ini dan jangan bagikan ke siapapun.', en: 'Write down this new seed and never share it with anyone.' },
  'acct.selesai':     { id: 'Selesai',                      en: 'Done' },

  'acct.info_akun':   { id: 'Info Akun',                    en: 'Account Info' },
  'acct.seed_label':  { id: 'SEED PHRASE',                  en: 'SEED PHRASE' },
  'acct.jangan':      { id: 'Jangan bagikan ke siapapun. Gunakan untuk login dari device lain.', en: 'Never share with anyone. Use to login from another device.' },
  'acct.login_multi': { id: 'Login multi-device aktif',     en: 'Multi-device login active' },
  'acct.cukup_3':     { id: 'Cukup masukkan 3 kata seed phrase di device manapun', en: 'Just enter your 3-word seed phrase on any device' },
  'acct.tutup':       { id: 'Tutup',                        en: 'Close' },
  'acct.ganti_seed_btn':{ id: 'Ganti Seed',                en: 'Change Seed' },
  'acct.logout':      { id: 'Logout',                       en: 'Logout' },
  'acct.tersimpan':   { id: 'Tersimpan',                    en: 'Saved' },

  /* ── FITUR MODAL ── */
  'fitur.tambahan':   { id: 'Fitur Tambahan',               en: 'Additional Features' },
  'fitur.fitur_tab':  { id: 'Fitur Tambahan &amp; Segera Hadir', en: 'Additional Features &amp; Coming Soon' },
  'fitur.tersedia':   { id: 'Tersedia Sekarang',            en: 'Available Now' },
  'fitur.liq_heatmap':{ id: 'Liquidation Heatmap BTC',     en: 'BTC Liquidation Heatmap' },
  'fitur.vis_liq':    { id: 'Visualisasi likuidasi',        en: 'Liquidation visualization' },
  'fitur.signal_ai':  { id: 'Signal AI Futures BTC',       en: 'BTC Futures AI Signal' },
  'fitur.entry_exit': { id: 'Entry &amp; exit otomatis',   en: 'Automatic entry &amp; exit' },
  'fitur.segera':     { id: 'Segera Hadir',                en: 'Coming Soon' },
  'fitur.dalam_dev':  { id: 'Dalam pengembangan',          en: 'In development' },

  /* ── COMMON ── */
  'common.kembali':   { id: 'Kembali',    en: 'Back' },
  'common.home':      { id: 'Home',       en: 'Home' },
  'common.tambah':    { id: 'Tambah',     en: 'Add' },
  'common.simpan':    { id: 'Simpan',     en: 'Save' },
  'common.batal':     { id: 'Batal',      en: 'Cancel' },
  'common.hapus':     { id: 'Hapus Semua', en: 'Delete All' },
  'common.refresh':   { id: 'Refresh',    en: 'Refresh' },
  'common.loading':   { id: 'Loading...',  en: 'Loading...' },
  'common.memuat':    { id: 'Memuat...',  en: 'Loading...' },
  'common.logout':    { id: 'Logout',     en: 'Logout' },
  'common.pdf_btn':   { id: 'PDF',        en: 'PDF' },
  'common.logout_txt':{ id: 'Logout',     en: 'Logout' },
  'common.tambah_plus':{ id: '+ Tambah', en: '+ Add' },

};

/* ─────────────────────────────────────────────────
   MAPPING: querySelector → key terjemahan
   Format: [selector, key, property ('text'|'html')]
─────────────────────────────────────────────────── */
var MAPS = [

  /* ── NAV TABS ── */
  ['.nav-tab[onclick*="dashboard"]', 'nav.dashboard', 'text'],
  ['.nav-tab[onclick*="dca"]', 'nav.dca', 'text'],
  ['.nav-tab[onclick*="portfolio"]', 'nav.portfolio', 'text'],
  ['.nav-tab[onclick*="simulation"]', 'nav.simulation', 'text'],
  ['.nav-tab[onclick*="cashflow"]', 'nav.cashflow', 'text'],
  ['.nav-tab[onclick*="ai-chat"]', 'nav.ai', 'text'],

  /* ── BOTTOM NAV LABELS ── */
  ['.bnav-item[data-page="dashboard"] .bnav-label', 'bnav.home', 'text'],
  ['.bnav-item[data-page="dca"] .bnav-label', 'bnav.dca', 'text'],
  ['.bnav-item[data-page="portfolio"] .bnav-label', 'bnav.porto', 'text'],
  ['.bnav-item[data-page="simulation"] .bnav-label', 'bnav.sim', 'text'],
  ['.bnav-item[data-page="cashflow"] .bnav-label', 'bnav.kas', 'text'],
  ['.bnav-item[data-page="ai-chat"] .bnav-label', 'bnav.ai', 'text'],

  /* ── TOPSTRIP BUTTONS ── */
  ['.export-txt', 'common.pdf_btn', 'text'],
  ['.logout-txt', 'common.logout_txt', 'text'],
  ['button[onclick="showAcct()"] span', 'nav.akun', 'text'],

  /* ── DASHBOARD ── */
  ['#page-dashboard h1', 'dash.title', 'text'],
  ['#page-dashboard .ph p', 'dash.title', 'text'],

  /* ── DCA ── */
  ['#page-dca h1', 'dca.title', 'text'],
  ['#page-dca .ph p[data-i18n]', 'dca.sub', 'text'],

  /* ── PORTFOLIO ── */
  ['#page-portfolio h1', 'port.title', 'text'],
  ['#page-portfolio .ph p', 'port.sub', 'text'],

  /* ── SIMULATION ── */
  ['#page-simulation h1', 'sim.title', 'text'],
  ['#page-simulation .ph p', 'sim.sub', 'text'],

  /* ── CASHFLOW ── */
  ['#page-cashflow h1', 'cash.title', 'text'],
  ['#page-cashflow .ph p', 'cash.sub', 'text'],

  /* ── AI CHAT ── */
  ['#page-ai-chat h1', 'ai.title', 'text'],

  /* ── ALERTS ── */
  ['#page-alerts h1', 'alert.title', 'html'],
  ['#page-alerts .ph p', 'alert.sub', 'text'],

  /* ── BTC EDU ── */
  ['#page-btc-edu h1', 'edu.title', 'text'],

  /* ── THEME ── */
  ['#page-theme h1', 'theme.title', 'html'],
  ['#page-theme .ph p', 'theme.sub', 'text'],

  /* ── AI SIGNAL ── */
  ['#page-ai-signal h1', 'signal.analisis', 'text'],

  /* ── AI PREDICT ── */
  ['#page-ai-predict h1', 'predict.title', 'text'],

  /* ── NEWS ── */
  ['#page-news h1', 'news.title', 'text'],
  ['#page-news .ph p', 'news.sub', 'text'],

  /* ── FITUR MODAL ── */
  ['.fitur-modal-title span', 'fitur.tambahan', 'text'],

  /* ── MODAL DCA ── */
  ['#modal-dca .modal-title', 'modal.dca_title', 'text'],

  /* ── ACCOUNT MODAL ── */
  ['#modal-acct .modal-title', 'acct.info_akun', 'text'],
];

/* ─────────────────────────────────────────────────
   TRANSLATOR ENGINE — inner text replacement
   Strategy: walk all text nodes in the DOM dan
   replace yang match dengan dict
─────────────────────────────────────────────────── */

var currentLang = localStorage.getItem('zw_lang') || 'id';

/* Build lookup: id_text → { key, en } */
var ID_LOOKUP = {};
Object.keys(T).forEach(function(key) {
  var entry = T[key];
  var idText = entry.id.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  if (idText) {
    ID_LOOKUP[idText] = { key: key, en: entry.en };
  }
});

/* Apply via MAPS first (selector-based, reliable) */
function applyMaps(lang) {
  MAPS.forEach(function(m) {
    var sel = m[0], key = m[1], prop = m[2];
    var els = document.querySelectorAll(sel);
    els.forEach(function(el) {
      if (!T[key]) return;
      var val = T[key][lang];
      if (!val) return;
      if (prop === 'html') el.innerHTML = val;
      else el.textContent = val;
    });
  });

  /* Handle [data-i18n] elements — supports \n → <br> for feat-btn labels */
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (!T[key]) return;
    var val = T[key][lang];
    if (!val) return;
    /* If value contains \n, render as innerHTML with <br> */
    if (val.indexOf('\n') !== -1) {
      var safe = val.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      el.innerHTML = safe;
    } else {
      el.textContent = val;
    }
  });
}

/* Walk all text nodes — handles elements not in MAPS */
function walkTextNodes(root, lang) {
  if (!root) return;
  var walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName ? p.tagName.toLowerCase() : '';
        if (['script','style','textarea','code','pre'].indexOf(tag) >= 0) return NodeFilter.FILTER_REJECT;
        if (p.id && ['lang-flag','lang-flag-d','lang-label','lang-label-d','lang-toast-flag','lang-toast-msg'].indexOf(p.id) >= 0) return NodeFilter.FILTER_REJECT;
        var t = node.textContent.trim();
        if (!t || t.length < 2) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  var node;
  var changes = [];
  while ((node = walker.nextNode())) {
    var text = node.textContent.trim();
    var entry = ID_LOOKUP[text];
    if (entry && T[entry.key] && T[entry.key][lang]) {
      changes.push({ node: node, val: T[entry.key][lang] });
    }
  }
  /* Apply changes after walk to avoid TreeWalker issues */
  changes.forEach(function(c) {
    c.node.textContent = c.c_val || c.val;
  });
}

/* Reverse lookup for EN → ID (needed when switching back) */
var EN_LOOKUP = {};
Object.keys(T).forEach(function(key) {
  var entry = T[key];
  var enText = entry.en.replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  if (enText) EN_LOOKUP[enText] = { key: key, id: entry.id };
});

/* Comprehensive apply: maps + full text walk */
function applyLang(lang, animate) {
  if (animate) {
    document.body.classList.add('lang-switching');
    setTimeout(function() { document.body.classList.remove('lang-switching'); }, 400);
  }

  /* 1. Selector-based (reliable for structured elements) */
  applyMaps(lang);

  /* 2. Full text-node walk on entire document */
  /* Build correct lookup for this direction */
  var LOOKUP = lang === 'en' ? ID_LOOKUP : EN_LOOKUP;

  var walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        var p = node.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName ? p.tagName.toLowerCase() : '';
        if (['script','style','textarea','code','pre'].indexOf(tag) >= 0) return NodeFilter.FILTER_REJECT;
        if (p.classList && (p.classList.contains('Space_Mono') || p.classList.contains('slval'))) return NodeFilter.FILTER_REJECT;
        /* Skip dynamic data elements */
        if (p.id && /^(nav-btc|nav-chg|nav-acct|lang-flag|lang-label|lang-toast)/.test(p.id)) return NodeFilter.FILTER_REJECT;
        var t = node.textContent.trim();
        if (!t || t.length < 2) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  var nodes = [], texts = [];
  var n;
  while ((n = walker.nextNode())) {
    nodes.push(n);
    texts.push(n.textContent.trim());
  }

  for (var i = 0; i < nodes.length; i++) {
    var txt = texts[i];
    var found = LOOKUP[txt];
    if (found) {
      var newText = lang === 'en' ? T[found.key].en : T[found.key].id;
      if (newText && newText.replace(/&amp;/g,'&').replace(/&quot;/g,'"') !== txt) {
        nodes[i].textContent = newText.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
      }
    }
  }

  /* 3. Update lang button UI */
  var flag  = lang === 'id' ? '🇮🇩' : '🇬🇧';
  var label = lang === 'id' ? 'ID'   : 'EN';
  ['','‑d'].forEach(function(s) {
    var f = document.getElementById('lang-flag' + s);
    var l = document.getElementById('lang-label' + s);
    if (f) f.textContent = flag;
    if (l) l.textContent = label;
  });

  /* fix the -d suffix selector (used hyphen-minus not non-breaking) */
  var fd = document.getElementById('lang-flag-d');
  var ld = document.getElementById('lang-label-d');
  if (fd) fd.textContent = flag;
  if (ld) ld.textContent = label;

  document.documentElement.lang = lang === 'id' ? 'id' : 'en';
  currentLang = lang;
  localStorage.setItem('zw_lang', lang);
}

/* ── TOAST ── */
function showToast(lang) {
  var t = document.getElementById('lang-toast');
  if (!t) return;
  document.getElementById('lang-toast-flag').textContent = lang === 'en' ? '🇬🇧' : '🇮🇩';
  document.getElementById('lang-toast-msg').textContent  = lang === 'en' ? 'Switched to English' : 'Beralih ke Bahasa Indonesia';
  t.classList.add('show');
  clearTimeout(t._tmr);
  t._tmr = setTimeout(function() { t.classList.remove('show'); }, 2200);
}

/* ── PUBLIC API ── */
window.toggleLang = function() {
  var next = currentLang === 'id' ? 'en' : 'id';
  applyLang(next, true);
  showToast(next);
};

/* Also expose so showPage() can re-apply after page switch */
window.i18n_apply = function() { applyLang(currentLang, false); };

/* ── INIT ── */
function init() { applyLang(currentLang, false); }
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* Re-apply setelah showPage() (hook ke event custom) */
var origShowPage = window.showPage;
if (origShowPage) {
  window.showPage = function() {
    origShowPage.apply(this, arguments);
    setTimeout(function() { applyLang(currentLang, false); }, 80);
  };
}

})();

/* ── BLOCK 11 ── */
/* ═══════════════════════════════════════════════════════════════
   PHANTOM MORPH NAV ENGINE v3.0
   Setiap ikon: phantom shape → scaleX/Y morph → real shape
   Sama persis seperti efek Simulasi, berlaku untuk semua!
═══════════════════════════════════════════════════════════════ */
(function(){
  var ANIM = {
    'dashboard':  'anim-home',
    'dca':        'anim-dca',
    'portfolio':  'anim-porto',
    'simulation': 'anim-sim',
    'cashflow':   'anim-kas',
    'ai-chat':    'anim-ai'
  };
  var DEACT = {
    'dashboard':  'deact-home',
    'dca':        'deact-dca',
    'portfolio':  'deact-porto',
    'simulation': 'deact-sim',
    'cashflow':   'deact-kas',
    'ai-chat':    'deact-ai'
  };
  var DURATION = {
    'dashboard':  880,
    'dca':        820,
    'portfolio':  860,
    'simulation': 880,
    'cashflow':   840,
    'ai-chat':    870
  };

  var PAIRS = {
    'dashboard':  ['.hp-a',       '.hp-b'],
    'dca':        ['.dp-a',       '.dp-b'],
    'portfolio':  ['.pp-a',       '.pp-b'],
    'simulation': ['.sim-line-a', '.sim-line-b'],
    'cashflow':   ['.kp-a',       '.kp-b'],
    'ai-chat':    ['.ap-a',       '.ap-b']
  };

  var ALL_ANIM  = Object.values(ANIM);
  var ALL_DEACT = Object.values(DEACT);

  function resetPhantom(btn, page) {
    var pair = PAIRS[page];
    if (!pair) return;
    var elA = btn.querySelector(pair[0]);
    var elB = btn.querySelector(pair[1]);
    if (elA) {
      elA.style.animation = 'none';
      elA.style.opacity = '1';
      elA.style.transform = '';
      elA.style.filter = '';
    }
    if (elB) {
      elB.style.animation = 'none';
      elB.style.opacity = '0';
      elB.style.transform = '';
      elB.style.filter = '';
      var daB = elB.getAttribute('stroke-dasharray') || elB.style.strokeDasharray;
      if (daB) elB.style.strokeDashoffset = daB;
      elB.querySelectorAll('.draw-me').forEach(function(el) {
        el.style.animation = 'none';
        var da = el.getAttribute('stroke-dasharray') || el.style.strokeDasharray;
        if (da) el.style.strokeDashoffset = da;
      });
      elB.querySelectorAll('.dot-pop').forEach(function(el) {
        el.style.animation = 'none';
        el.style.transform = 'scale(0)';
        el.style.opacity = '0';
      });
    }
  }

  function setDone(btn, page) {
    var pair = PAIRS[page];
    if (!pair) return;
    var elA = btn.querySelector(pair[0]);
    var elB = btn.querySelector(pair[1]);
    if (elA) { elA.style.opacity = '0'; }
    if (elB) {
      elB.style.opacity = '1';
      elB.style.transform = 'scale(1) rotate(0deg)';
      elB.style.strokeDashoffset = '0';
      elB.querySelectorAll('.draw-me').forEach(function(el) {
        el.style.strokeDashoffset = '0';
      });
      elB.querySelectorAll('.dot-pop').forEach(function(el) {
        el.style.transform = 'scale(1)';
        el.style.opacity = '1';
      });
    }
  }

  // Animasikan icon yang sedang aktif keluar sebelum di-reset
  function deactivateWithAnim(btn, page) {
    var deactClass = DEACT[page];
    if (!deactClass) { resetPhantom(btn, page); return; }

    // Hapus glow-pulse dulu
    btn.classList.remove('glow-pulse');
    // Trigger deactivation animation
    btn.classList.add(deactClass);

    // Setelah animasi selesai (~520ms), reset ke bentuk semula
    setTimeout(function() {
      btn.classList.remove(deactClass);
      resetPhantom(btn, page);
    }, 520);
  }

  function clearAllAnims() {
    document.querySelectorAll('.bnav-item').forEach(function(b){
      ALL_ANIM.forEach(function(c){ b.classList.remove(c); });
      ALL_DEACT.forEach(function(c){ b.classList.remove(c); });
      b.classList.remove('glow-pulse');
    });
  }

  function init(){
    document.querySelectorAll('.bnav-item').forEach(function(btn){
      var pg = btn.dataset.page;
      if (btn.classList.contains('active')) {
        setDone(btn, pg);
      } else {
        resetPhantom(btn, pg);
      }
    });

    document.querySelectorAll('.bnav-item').forEach(function(btn){
      btn.addEventListener('click', function(){
        var page = this.dataset.page;
        var animClass = ANIM[page];
        if (!animClass) return;
        var self = this;

        // Hapus semua anim class
        ALL_ANIM.forEach(function(c){ 
          document.querySelectorAll('.bnav-item').forEach(function(b){ b.classList.remove(c); });
        });

        // Animasikan icon lama (yang sebelumnya active) keluar dengan smooth
        document.querySelectorAll('.bnav-item').forEach(function(b){
          if (b !== self) {
            var bPage = b.dataset.page;
            // Cek apakah ini button yang sebelumnya setDone (punya hp-b visible)
            var pair = PAIRS[bPage];
            if (pair) {
              var elB = b.querySelector(pair[1]);
              // Jika elB opacity=1, artinya ini yang sebelumnya active → deactivate dengan animasi
              if (elB && (elB.style.opacity === '1' || b.classList.contains('active'))) {
                deactivateWithAnim(b, bPage);
              } else {
                resetPhantom(b, bPage);
              }
            }
          }
        });

        resetPhantom(self, page);

        var icon = self.querySelector('.bnav-icon');
        if (icon) void icon.offsetWidth;

        self.classList.add(animClass);

        var dur = DURATION[page] || 880;
        setTimeout(function(){
          self.classList.remove(animClass);
          setDone(self, page);
          if (self.classList.contains('active')) {
            self.classList.add('glow-pulse');
          }
        }, dur);

      }, true);
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : setTimeout(init, 50);
})();

/* ── HIDE SENSITIVE VALUES ── */
(function() {
  var HIDDEN_KEY = 'zw_vals_hidden';
  var hidden = localStorage.getItem(HIDDEN_KEY) === '1';
  var applying = false;

  function applyHiddenState() {
    if (applying) return;
    applying = true;
    // Toggle class on body — CSS handles the blur (no per-element classList churn)
    if (hidden) {
      document.body.classList.add('vals-hidden');
    } else {
      document.body.classList.remove('vals-hidden');
    }
    // Update eye icons
    var eyeOpen   = document.getElementById('eye-icon-open');
    var eyeClosed = document.getElementById('eye-icon-closed');
    if (eyeOpen)   eyeOpen.style.display   = hidden ? 'none' : '';
    if (eyeClosed) eyeClosed.style.display = hidden ? ''     : 'none';
    applying = false;
  }

  window.toggleHideValues = function() {
    hidden = !hidden;
    localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
    applyHiddenState();
  };

  // Apply immediately and also on DOMContentLoaded in case called before DOM ready
  applyHiddenState();
  document.addEventListener('DOMContentLoaded', applyHiddenState);

  // MutationObserver: re-apply whenever DOM changes (dynamic data updates)
  // Using body-level CSS class means we only need to re-apply icons if they get re-rendered
  var observer = new MutationObserver(function(mutations) {
    if (applying) return;
    // Only re-apply if something changed inside stats-grid
    var relevant = mutations.some(function(m) {
      return m.target && (
        m.target.closest ? m.target.closest('.stats-grid') : true
      );
    });
    if (relevant) applyHiddenState();
  });

  document.addEventListener('DOMContentLoaded', function() {
    var grid = document.querySelector('.stats-grid');
    if (grid) {
      observer.observe(grid, { childList: true, subtree: true, characterData: true });
    }
    // Also observe body for page switches that might re-render the dashboard
    observer.observe(document.body, { childList: true, subtree: false });
  });
})();

/* ── BLOCK 12 ── */
/* ══════════════════════════════════════════════════════
   SMOOTH ENGINE v1.0
   Ripple, haptic, modal close anim, page exit,
   tap-outside-modal, scroll reset
══════════════════════════════════════════════════════ */
(function(){
  'use strict';

  // ── Haptic (mobile vibration) ──
  function haptic(ms){ try{ navigator.vibrate&&navigator.vibrate(ms||6); }catch(e){} }

  // ── Spawn ripple wave on element ──
  function spawnRipple(el, e){
    const rect = el.getBoundingClientRect();
    const cx = e.clientX || (e.touches&&e.touches[0]&&e.touches[0].clientX) || rect.left+rect.width/2;
    const cy = e.clientY || (e.touches&&e.touches[0]&&e.touches[0].clientY) || rect.top+rect.height/2;
    const x = cx - rect.left, y = cy - rect.top;
    const size = Math.max(rect.width, rect.height) * 1.8;
    const r = document.createElement('span');
    r.className = 'ripple-wave';
    r.style.cssText = 'width:'+size+'px;height:'+size+'px;left:'+(x-size/2)+'px;top:'+(y-size/2)+'px';
    el.appendChild(r);
    r.addEventListener('animationend', function(){ r.remove(); });
  }

  // ── Attach ripple to interactive elements ──
  function initRipple(){
    var sel = '.btn,.btn-primary,.btn-ghost,.btn-del,.nav-tab,.lbtn,.bnav-item,.ltab';
    document.querySelectorAll(sel).forEach(function(el){
      if(el.dataset.rippleInit) return;
      el.dataset.rippleInit = '1';
      el.classList.add('ripple-host');
      el.addEventListener('pointerdown', function(e){ spawnRipple(el,e); haptic(6); });
    });
  }

  // ── Wrap showPage with exit animation ──
  var _origShowPage = window.showPage;
  if(_origShowPage){
    window.showPage = function(id){
      var cur = document.querySelector('.page.active:not(.page-exit)');
      if(cur){
        cur.classList.add('page-exit');
        haptic(8);
        setTimeout(function(){
          _origShowPage(id);
          cur.classList.remove('page-exit');
        }, 150);
      } else {
        _origShowPage(id);
      }
    };
  }

  // ── Wrap closeModal with exit animation ──
  var _origClose = window.closeModal;
  window.closeModal = function(id){
    var el = document.getElementById(id);
    if(!el){ if(_origClose) _origClose(id); return; }
    el.classList.add('closing');
    haptic(6);
    setTimeout(function(){
      el.classList.remove('open','closing');
    }, 195);
  };

  // ── Wrap openModal with haptic + scroll reset ──
  var _origOpen = window.openModal;
  if(_origOpen){
    window.openModal = function(id){
      _origOpen(id);
      haptic(8);
      var el = document.getElementById(id);
      if(el){ var m=el.querySelector('.modal'); if(m) m.scrollTop=0; }
    };
  }

  // ── Tap outside modal to close ──
  document.addEventListener('pointerdown', function(e){
    document.querySelectorAll('.overlay.open').forEach(function(ov){
      if(e.target === ov && ov.id) window.closeModal(ov.id);
    });
  });

  // ── Init on DOM ready, re-init on dynamic DOM changes ──
  function onReady(){
    initRipple();
    var obs = new MutationObserver(function(){ initRipple(); });
    obs.observe(document.body, {childList:true, subtree:true});
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

})();


// ═══════════════════════════════════════════════════════════════
// FINGERPRINT LOCK SYSTEM
// ═══════════════════════════════════════════════════════════════

const FP_LOCK_KEY      = 'zw_fp_lock_enabled';
const FP_LAST_ACTIVE   = 'zw_fp_last_active';   // timestamp terakhir user aktif
const FP_TIMEOUT_MS    = 1 * 60 * 1000;          // 1 menit jeda sebelum dikunci

function isFingerprintAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

function isFingerprintEnabled() {
  return localStorage.getItem(FP_LOCK_KEY) === '1';
}

// Catat waktu terakhir aktif
function fpRecordActivity() {
  if (isFingerprintEnabled()) {
    localStorage.setItem(FP_LAST_ACTIVE, Date.now().toString());
  }
}

// Apakah sudah lewat 5 menit sejak terakhir aktif?
function fpIsTimedOut() {
  const last = parseInt(localStorage.getItem(FP_LAST_ACTIVE) || '0', 10);
  if (!last) return true; // belum pernah tercatat → anggap timeout
  return (Date.now() - last) >= FP_TIMEOUT_MS;
}

function updateFpToggleUI(enabled) {
  const wrap  = document.getElementById('fp-toggle-wrap');
  const knob  = document.getElementById('fp-toggle-knob');
  const label = document.getElementById('acct-fp-label');
  const sub   = document.getElementById('acct-fp-sub');
  const icon  = document.getElementById('acct-fp-icon');
  if (!wrap || !knob) return;
  if (enabled) {
    wrap.style.background  = 'rgba(99,102,241,.45)';
    wrap.style.borderColor = 'rgba(99,102,241,.6)';
    knob.style.left        = '24px';
    knob.style.background  = '#fff';
    if (label) { label.textContent = 'Kunci Fingerprint'; label.style.color = '#818cf8'; }
    if (sub)   sub.textContent = 'Dikunci saat buka app & idle 5 menit';
    if (icon)  { icon.style.background = 'rgba(99,102,241,.18)'; icon.style.borderColor = 'rgba(99,102,241,.35)'; }
  } else {
    wrap.style.background  = 'rgba(255,255,255,.1)';
    wrap.style.borderColor = 'rgba(255,255,255,.12)';
    knob.style.left        = '3px';
    knob.style.background  = '#64748b';
    if (label) { label.textContent = 'Kunci Fingerprint'; label.style.color = 'var(--text)'; }
    if (sub)   sub.textContent = 'Kunci app dengan biometrik saat idle';
    if (icon)  { icon.style.background = 'rgba(99,102,241,.1)'; icon.style.borderColor = 'rgba(99,102,241,.22)'; }
  }
}

async function toggleFingerprintLock() {
  if (!isFingerprintAvailable()) {
    toast('⚠️ Perangkat tidak mendukung biometrik');
    return;
  }
  const wasEnabled = isFingerprintEnabled();
  if (!wasEnabled) {
    // Step 1: Register credential baru (ini yang meminta fingerprint pertama kali)
    toast('👆 Tempelkan jari ke sensor...');
    const reg = await fpRegisterCredential();
    if (!reg) {
      toast('❌ Gagal mendaftarkan fingerprint. Pastikan fingerprint aktif di pengaturan HP.');
      return;
    }
    // Step 2: Langsung aktifkan (sudah verified saat register)
    localStorage.setItem(FP_LOCK_KEY, '1');
    fpRecordActivity();
    updateFpToggleUI(true);
    toast('✅ Kunci fingerprint diaktifkan!');
  } else {
    // Nonaktifkan — hapus credential & setting
    localStorage.removeItem(FP_LOCK_KEY);
    localStorage.removeItem(FP_LAST_ACTIVE);
    localStorage.removeItem('zw_fp_cred_id');
    updateFpToggleUI(false);
    toast('🔓 Kunci fingerprint dinonaktifkan');
  }
}

// ── Register credential (saat pertama aktifkan fingerprint) ──
async function fpRegisterCredential() {
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return null;

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new Uint8Array(16);
    crypto.getRandomValues(userId);

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'z-wealth', id: location.hostname },
        user: {
          id: userId,
          name: 'zwealth-user',
          displayName: 'Z-Wealth User',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7  },  // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // hanya sensor di device (fingerprint/faceID)
          userVerification: 'required',
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: 'none',
      }
    });
    if (!cred) return null;

    // Simpan credential ID ke localStorage agar bisa dipakai saat verify
    const credIdB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    localStorage.setItem('zw_fp_cred_id', credIdB64);
    return cred;
  } catch(e) {
    console.warn('[FP] Register error:', e.name, e.message);
    return null;
  }
}

// ── Verify dengan credential yang sudah terdaftar ──
async function doBiometricAuth() {
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) return false;

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    // Cek apakah sudah ada credential terdaftar
    const credIdB64 = localStorage.getItem('zw_fp_cred_id');

    const getOptions = {
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: 'required',
        rpId: location.hostname || 'localhost',
        allowCredentials: credIdB64
          ? [{
              type: 'public-key',
              id: Uint8Array.from(atob(credIdB64), c => c.charCodeAt(0)).buffer,
              transports: ['internal'],
            }]
          : [], // fallback kosong (mungkin gagal di beberapa device)
      }
    };

    const cred = await navigator.credentials.get(getOptions);
    return !!cred;
  } catch(e) {
    console.warn('[FP] Auth error:', e.name, e.message);
    return false;
  }
}

async function unlockWithFingerprint() {
  const errEl = document.getElementById('fp-lock-err');
  const btn   = document.getElementById('fp-unlock-btn');
  if (errEl) errEl.style.display = 'none';
  if (btn) btn.disabled = true;

  // Kalau credential ID hilang (misal clear cache) — reset & minta user aktifkan ulang
  const credId = localStorage.getItem('zw_fp_cred_id');
  if (!credId) {
    // Credential hilang — coba register ulang otomatis
    const reg = await fpRegisterCredential();
    if (reg) {
      localStorage.setItem(FP_LOCK_KEY, '1');
      fpRecordActivity();
      hideLockScreen();
      if (btn) btn.disabled = false;
      return;
    }
    // Gagal register ulang — disable fp lock dan minta user aktifkan manual
    localStorage.removeItem(FP_LOCK_KEY);
    localStorage.removeItem(FP_LAST_ACTIVE);
    hideLockScreen();
    toast('⚠️ Data fingerprint hilang (cache dibersihkan?). Aktifkan ulang dari Info Akun.');
    if (btn) btn.disabled = false;
    return;
  }

  const ok = await doBiometricAuth();
  if (ok) {
    fpRecordActivity();
    hideLockScreen();
  } else {
    if (errEl) {
      errEl.style.display = 'block';
      errEl.textContent = '❌ Fingerprint tidak dikenali, coba lagi';
    }
  }
  if (btn) btn.disabled = false;
}

function showLockScreen() {
  const el = document.getElementById('fp-lock-screen');
  if (!el) return;
  el.style.display = 'flex';
  const errEl = document.getElementById('fp-lock-err');
  if (errEl) errEl.style.display = 'none';
}

function hideLockScreen() {
  const el = document.getElementById('fp-lock-screen');
  if (el) el.style.display = 'none';
}

// ── Cek lock saat app pertama kali dibuka ──
function fpCheckOnLoad() {
  if (!isFingerprintEnabled()) return;
  // Selalu kunci saat fresh open (tab/app baru dibuka)
  // atau kalau sudah lebih dari 5 menit idle
  if (fpIsTimedOut()) {
    showLockScreen();
  }
}

// Jalankan cek saat DOM siap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', fpCheckOnLoad);
} else {
  // DOM sudah siap (script dimuat di akhir)
  setTimeout(fpCheckOnLoad, 200);
}

// ── Activity tracking — reset timer setiap user interaksi ──
['touchstart','mousedown','keydown','scroll','click'].forEach(ev => {
  document.addEventListener(ev, fpRecordActivity, { passive: true });
});

// ── Visibility change: saat kembali dari background ──
document.addEventListener('visibilitychange', () => {
  if (!isFingerprintEnabled()) return;

  if (document.hidden) {
    // App masuk background — simpan timestamp saat itu
    localStorage.setItem(FP_LAST_ACTIVE, Date.now().toString());
  } else {
    // App kembali ke foreground — cek apakah sudah > 5 menit
    if (fpIsTimedOut()) {
      showLockScreen();
    }
  }
});

// ── Inisialisasi toggle UI saat modal akun dibuka ──
const _origOpenModal = window.openModal;
window.openModal = function(id) {
  _origOpenModal && _origOpenModal(id);
  if (id === 'modal-acct') {
    updateFpToggleUI(isFingerprintEnabled());
    if (!isFingerprintAvailable()) {
      const sub  = document.getElementById('acct-fp-sub');
      const wrap = document.getElementById('fp-toggle-wrap');
      if (sub)  sub.textContent = 'Perangkat tidak mendukung biometrik';
      if (wrap) wrap.style.opacity = '.35';
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// BITCOIN POWER LAW
// ═══════════════════════════════════════════════════════════════

// Power Law model by Giovanni Santostasi
// Price = 10^(a * log10(days_since_genesis) + b)
// Top band:    a=5.8, b=-17.3
// Median:      a=5.8, b=-17.7  (approx fair value)
// Bottom band: a=5.8, b=-18.1

const PL_A     = 5.8;
// Calibrated from Giovanni Santostasi model (BitBO reference Feb 2026)
// Resistance=$537K, Fair=$150K, Support=$53K at ~6264 days since genesis
const PL_TOP   = -16.292;
const PL_MID   = -16.844;
const PL_BOT   = -17.294;
const GENESIS  = new Date('2009-01-03').getTime();

function plDays(ts) {
  return (ts - GENESIS) / 86400000;
}
function plPrice(days, b) {
  return Math.pow(10, PL_A * Math.log10(days) + b);
}

let _plChart = null;
let _plHistCache = null;  // cache full BTC price history for Power Law

// ── Fetch full BTC history for Power Law — multi-source with fallback ──
async function fetchPLHistory() {
  if (_plHistCache && _plHistCache.length > 0) return _plHistCache;

  const since2013sec = Math.floor(new Date('2013-01-01').getTime() / 1000);
  const errors = [];

  // ── Source 0: Vercel proxy (server-side CoinGecko — no user rate limit, full history) ──
  try {
    const r = await fetchWithTimeout('/api/market?action=btchistory', 15000);
    if (r.ok) {
      const d = await r.json();
      if (d && d.prices && d.prices.length > 200) {
        const data = d.prices.map(([ts, p]) => ({ x: ts, y: p })).filter(p => p.y > 0);
        _plHistCache = data;
        return data;
      }
    }
    errors.push('Vercel-proxy');
  } catch(e) { errors.push('Vercel:' + e.message); }

  // ── Source 1: Kraken weekly from 2013 (~687 candles, fits 720 limit) ──
  try {
    const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080&since=${since2013sec}`;
    const r = await fetchWithTimeout(url, 12000);
    if (r.ok) {
      const d = await r.json();
      const pair = d.result && (d.result['XXBTZUSD'] || d.result['XBTUSD']);
      if (pair && pair.length > 100) {
        const data = pair.map(k => ({ x: parseInt(k[0]) * 1000, y: parseFloat(k[4]) })).filter(p => p.y > 0);
        _plHistCache = data;
        return data;
      }
    }
    errors.push('Kraken');
  } catch(e) { errors.push('Kraken:' + e.message); }

  // ── Source 2: Binance 1w klines 500 bars (~9.6 years) ──
  try {
    const r = await fetchWithTimeout('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=500', 10000);
    if (r.ok) {
      const d = await r.json();
      if (d && d.length > 50) {
        const data = d.map(k => ({ x: parseInt(k[0]), y: parseFloat(k[4]) })).filter(p => p.y > 0);
        _plHistCache = data;
        return data;
      }
    }
    errors.push('Binance');
  } catch(e) { errors.push('Binance:' + e.message); }

  // ── Source 3: CoinGecko max (direct, might work if not rate-limited) ──
  try {
    const r = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=weekly', 15000);
    if (r.ok) {
      const d = await r.json();
      if (d && d.prices && d.prices.length > 100) {
        const data = d.prices.map(([ts, p]) => ({ x: ts, y: p })).filter(p => p.y > 0);
        _plHistCache = data;
        return data;
      }
    }
    errors.push('CG-max');
  } catch(e) { errors.push('CG-max:' + e.message); }

  // ── Source 4: CoinGecko 3650 days (less likely to hit rate limits) ──
  try {
    const r = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=3650', 12000);
    if (r.ok) {
      const d = await r.json();
      if (d && d.prices && d.prices.length > 50) {
        const data = d.prices.map(([ts, p]) => ({ x: ts, y: p })).filter(p => p.y > 0);
        _plHistCache = data;
        return data;
      }
    }
    errors.push('CG-3650');
  } catch(e) { errors.push('CG-3650:' + e.message); }

  console.warn('[PL] All history sources failed:', errors);
  return [];
}

async function loadPowerLaw() {
  const canvas  = document.getElementById('pl-chart');
  const loading = document.getElementById('pl-loading');
  if (!canvas) return;

  try {
    // Fetch current price + full history in parallel
    const [histData, priceRes] = await Promise.all([
      fetchPLHistory(),
      fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', 8000)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    ]);

    // Also try Binance ticker as price fallback
    let btcNow = priceRes?.bitcoin?.usd || 0;
    if (!btcNow) {
      try {
        const br = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', 5000);
        if (br.ok) { const bd = await br.json(); btcNow = parseFloat(bd.price) || 0; }
      } catch(e) {}
    }
    // Last resort: read from live BTC price already displayed in the app
    if (!btcNow) {
      const priceEl = document.getElementById('d-btc') || document.getElementById('btc-price');
      if (priceEl) btcNow = parseFloat(priceEl.textContent.replace(/[^0-9.]/g,'')) || 0;
    }

    if (loading) loading.style.display = 'none';

    const nowTs   = Date.now();
    const nowDays = plDays(nowTs);

    // ── Band curves: 2010 → 2030 (weekly) ──
    const topBand = [], midBand = [], botBand = [];
    const step  = 7 * 86400000;
    const tStart = new Date('2012-01-01').getTime();  // sync with BTC data start
    const tEnd   = new Date('2030-12-31').getTime();
    for (let ts = tStart; ts <= tEnd; ts += step) {
      const d = plDays(ts);
      topBand.push({ x: ts, y: plPrice(d, PL_TOP) });
      midBand.push({ x: ts, y: plPrice(d, PL_MID) });
      botBand.push({ x: ts, y: plPrice(d, PL_BOT) });
    }

    // ── Actual BTC price (from multi-source history) ──
    const actualData = histData.length > 0 ? histData : [];

    // ── Current position in corridor ──
    const curTop = plPrice(nowDays, PL_TOP);
    const curBot = plPrice(nowDays, PL_BOT);
    const curMid = plPrice(nowDays, PL_MID);

    const positionPct = btcNow > 0
      ? Math.min(100, Math.max(0, Math.round(
          (Math.log10(btcNow) - Math.log10(curBot)) /
          (Math.log10(curTop) - Math.log10(curBot)) * 100
        )))
      : 50;

    // ── Update stat boxes ──
    const fmt     = v => v >= 1e6 ? '$' + (v/1e6).toFixed(2) + 'M'
                       : v >= 1e3 ? '$' + Math.round(v/1e3) + 'K'
                       : '$' + Math.round(v);
    const fmtFull = v => '$' + Math.round(v).toLocaleString('en-US');
    const el = id => document.getElementById(id);

    if (el('pl-top-val'))      el('pl-top-val').textContent      = fmt(curTop);
    if (el('pl-bot-val'))      el('pl-bot-val').textContent      = fmt(curBot);
    if (el('pl-cur-val'))      el('pl-cur-val').textContent      = btcNow > 0 ? fmtFull(btcNow) : '—';
    if (el('pl-price-badge'))  el('pl-price-badge').textContent  = btcNow > 0 ? fmtFull(btcNow) : 'Live';
    if (el('pl-position-bar')) el('pl-position-bar').style.width = positionPct + '%';
    if (el('pl-position-pct')) el('pl-position-pct').textContent = positionPct + '%';

    // ── Projections table ──
    const projEl = el('pl-projections');
    if (projEl) {
      const years = [2025, 2026, 2027, 2028, 2029, 2030];
      projEl.innerHTML = years.map(yr => {
        const d   = plDays(new Date(yr + '-06-01').getTime());
        const mid = plPrice(d, PL_MID);
        const top = plPrice(d, PL_TOP);
        const bot = plPrice(d, PL_BOT);
        return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:.6rem .75rem">
          <div style="font-size:.62rem;color:var(--muted);margin-bottom:.25rem">${yr}</div>
          <div style="font-size:.8rem;font-weight:800;color:#a78bfa">${fmt(mid)}</div>
          <div style="font-size:.58rem;color:rgba(239,68,68,.7);margin-top:.1rem">ATH zona: ${fmt(top)}</div>
          <div style="font-size:.58rem;color:rgba(16,185,129,.7)">Support: ${fmt(bot)}</div>
        </div>`;
      }).join('');
    }

    // ── Draw Chart.js ──
    if (_plChart) { _plChart.destroy(); _plChart = null; }

    const ctx = canvas.getContext('2d');
    const datasets = [
      {
        label: 'Resistance',
        data: topBand,
        borderColor: '#ef4444',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
        order: 4
      },
      {
        label: 'Fair Value',
        data: midBand,
        borderColor: 'rgba(167,139,250,.8)',
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        fill: false,
        tension: 0.1,
        order: 3
      },
      {
        label: 'Support',
        data: botBand,
        borderColor: '#10b981',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
        order: 4
      }
    ];

    // Add BTC price line only if we have data
    if (actualData.length > 0) {
      datasets.unshift({
        label: 'BTC Price',
        data: actualData,
        borderColor: '#f7931a',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
        tension: 0.1,
        order: 1
      });
    }

    _plChart = new Chart(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'x', intersect: false },  // 'x' aligns by timestamp not array index
        scales: {
          x: {
            type: 'linear',
            min: new Date('2012-01-01').getTime(),
            max: new Date('2030-12-31').getTime(),
            ticks: {
              color: 'rgba(148,163,184,.5)',
              font: { size: 9 },
              maxTicksLimit: 10,
              callback: v => {
                const d = new Date(v);
                return d.getMonth() < 2 ? String(d.getFullYear()) : '';
              }
            },
            grid: { color: 'rgba(255,255,255,.04)' }
          },
          y: {
            type: 'logarithmic',
            min: 0.01,
            ticks: {
              color: 'rgba(148,163,184,.5)',
              font: { size: 9 },
              callback: v => {
                const powers = [0.01, 0.1, 1, 10, 100, 1000, 10000, 100000, 1000000, 10000000];
                if (!powers.includes(v)) return '';
                return v >= 1e6 ? '$' + v/1e6 + 'M'
                     : v >= 1e3 ? '$' + v/1e3 + 'K'
                     : '$' + v;
              },
              maxTicksLimit: 10
            },
            grid: { color: 'rgba(255,255,255,.04)' }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: 'rgba(148,163,184,.8)',
              font: { size: 10 },
              boxWidth: 14,
              padding: 10,
              usePointStyle: true,
              pointStyleWidth: 16
            }
          },
          tooltip: {
            backgroundColor: 'rgba(10,16,30,.95)',
            titleColor: '#f1f5f9',
            bodyColor: 'rgba(148,163,184,.85)',
            borderColor: 'rgba(255,255,255,.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              title: items => new Date(items[0].raw.x).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
              label: item => {
                const v = item.raw.y;
                const fmtV = v >= 1e6 ? '$' + (v/1e6).toFixed(2) + 'M'
                           : v >= 1000 ? '$' + Math.round(v/1000) + 'K'
                           : '$' + v.toFixed(2);
                return item.dataset.label + ': ' + fmtV;
              }
            }
          }
        }
      }
    });

  } catch(e) {
    console.warn('Power Law load error:', e);
    if (loading) {
      loading.innerHTML = `<div style="text-align:center">
        <div style="color:#ef4444;font-size:.75rem;margin-bottom:.5rem">⚠️ Gagal memuat data</div>
        <button onclick="loadPowerLaw()" style="background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:.3rem .8rem;color:#f87171;cursor:pointer;font-size:.7rem;font-family:'Inter',sans-serif">↺ Coba Lagi</button>
      </div>`;
      loading.style.display = 'flex';
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CRYPTO CALENDAR — Real API (CoinMarketCal via Vercel proxy + Finnhub)
// ═══════════════════════════════════════════════════════════════
// API keys disimpan di Vercel Environment Variables:
//   CMC_API_KEY     → CoinMarketCal (via /api/calendar proxy)
//   FINNHUB_API_KEY → Finnhub (via /api/finnhub proxy)

let _calWeekOffset = 0;
let _calCache      = {};

function calGetWeekDates(offset) {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push(d);
  }
  return days;
}

function calFmtDate(d) {
  // yyyy-mm-dd
  return d.toISOString().slice(0, 10);
}

function calPrevWeek() { _calWeekOffset--; loadCryptoCalendar(); }
function calNextWeek() { _calWeekOffset++; loadCryptoCalendar(); }

function calEventColor(category) {
  const c = (category || '').toLowerCase();
  if (c.includes('token unlock') || c.includes('unlock') || c.includes('token release') || c.includes('vesting')) return '#10b981'; // hijau
  if (c.includes('listing') || c.includes('launch') || c.includes('mainnet') || c.includes('release')) return '#8b5cf6'; // ungu
  if (c.includes('macro') || c.includes('economic') || c.includes('fomc') || c.includes('cpi') || c.includes('nonfarm') || c.includes('gdp') || c.includes('employment') || c.includes('fed') || c.includes('interest') || c.includes('pmi') || c.includes('adp') || c.includes('ecb') || c.includes('pce') || c.includes('ppi')) return '#3b82f6'; // biru
  if (c.includes('conference') || c.includes('summit') || c.includes('event') || c.includes('meetup')) return '#f59e0b'; // kuning
  if (c.includes('partnership') || c.includes('exchange') || c.includes('integration')) return '#ec4899'; // pink
  if (c.includes('crypto') || c.includes('bitcoin') || c.includes('halving')) return '#f7931a'; // orange BTC
  return '#64748b'; // abu default
}

function calImpactLabel(impact) {
  const i = String(impact || '').toLowerCase();
  if (i === 'high' || i === '3' || i === 'high impact') return { label: '🔴 High Impact', color: '#ef4444' };
  if (i === 'medium' || i === '2' || i === 'moderate') return { label: '🟡 Medium', color: '#f59e0b' };
  return { label: '⚪ Low', color: '#64748b' };
}

function calShowDetail(evJson) {
  let ev;
  try {
    if (typeof evJson === 'string') {
      // Decode HTML entities injected by onclick attribute escaping
      const decoded = evJson.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      ev = JSON.parse(decoded);
    } else {
      ev = evJson;
    }
  } catch(e) { console.warn('calShowDetail parse error:', e); return; }
  const panel   = document.getElementById('cal-detail');
  const content = document.getElementById('cal-detail-content');
  if (!panel || !content) return;
  const col    = calEventColor(ev.category);
  const impact = calImpactLabel(ev.importance);
  const timeStr = ev.time ? `<div style="font-size:.68rem;color:var(--muted);margin-bottom:.4rem">🕐 ${ev.time} WIB</div>` : '';
  const prevStr = ev.previous != null ? `<span style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:.15rem .5rem;font-size:.62rem;color:var(--muted)">Prev: ${ev.previous}</span>` : '';
  const foreStr = ev.forecast != null ? `<span style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:.15rem .5rem;font-size:.62rem;color:var(--muted)">Forecast: ${ev.forecast}</span>` : '';
  const srcStr  = ev.source ? `<div style="font-size:.62rem;color:rgba(148,163,184,.4);margin-top:.4rem">Sumber: ${ev.source}</div>` : '';

  content.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.5rem;margin-bottom:.45rem">
      <div style="width:9px;height:9px;border-radius:2px;background:${col};flex-shrink:0;margin-top:3px"></div>
      <div style="font-size:.82rem;font-weight:800;color:var(--text);line-height:1.35">${ev.title}</div>
    </div>
    ${timeStr}
    ${ev.description ? `<div style="font-size:.72rem;color:rgba(203,213,225,.75);line-height:1.6;margin-bottom:.55rem">${ev.description}</div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.3rem">
      ${ev.category ? `<span style="background:${col}20;border:1px solid ${col}40;border-radius:6px;padding:.15rem .5rem;font-size:.62rem;color:${col};font-weight:600">${ev.category}</span>` : ''}
      <span style="background:${impact.color}18;border:1px solid ${impact.color}35;border-radius:6px;padding:.15rem .5rem;font-size:.62rem;color:${impact.color}">${impact.label}</span>
      ${prevStr}${foreStr}
    </div>
    ${srcStr}
  `;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Fetch CoinMarketCal via Vercel proxy /api/calendar ──
async function fetchCMCEvents(dateFrom, dateTo) {
  try {
    const url = `/api/market?action=calendar&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Proxy ' + res.status);
    const data = await res.json();
    const items = data.body || data || [];
    return items.map(ev => {
      const dateStr = (ev.date_event || ev.created_date || '').slice(0, 10);
      return {
        date: new Date(dateStr + 'T00:00:00'),
        title: ev.title?.en || ev.title || 'Crypto Event',
        description: ev.description?.en || ev.description || '',
        category: ev.categories?.[0]?.name || 'crypto',
        importance: ev.vote_count > 500 ? 'high' : ev.vote_count > 100 ? 'medium' : 'low',
        coins: (ev.coins || []).map(c => c.symbol).slice(0, 3),
        source: 'CoinMarketCal',
        proof: ev.proof || ''
      };
    });
  } catch(e) {
    console.warn('CMC fetch error:', e);
    return [];
  }
}

// ── Fetch Finnhub via Vercel proxy /api/finnhub ──
async function fetchFinnhubCalendar(dateFrom, dateTo) {
  try {
    const url = `/api/market?action=finnhub&dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Finnhub proxy ' + res.status);
    const data = await res.json();
    const items = data.economicCalendar || [];
    return items
      .filter(ev => ev.event && ev.event.length > 2) // semua event, bukan hanya High/Medium
      .map(ev => {
        const dateStr = ev.time ? ev.time.slice(0, 10) : '';
        if (!dateStr) return null;
        let timeWIB = '';
        if (ev.time && ev.time.includes('T')) {
          const utc = new Date(ev.time);
          const wib = new Date(utc.getTime() + 7 * 3600000);
          timeWIB = wib.toTimeString().slice(0, 5);
        }
        return {
          date: new Date(dateStr + 'T00:00:00'),
          title: ev.event || 'Economic Event',
          description: `Indikator ekonomi makro. Berdampak langsung pada sentimen pasar crypto global.`,
          category: 'macro',
          importance: ev.impact === 'High' ? 'high' : 'medium',
          time: timeWIB || null,
          previous: ev.prev != null ? String(ev.prev) + (ev.unit || '') : null,
          forecast: ev.estimate != null ? String(ev.estimate) + (ev.unit || '') : null,
          source: 'Finnhub',
          country: ev.country || 'US'
        };
      }).filter(Boolean);
  } catch(e) {
    console.warn('Finnhub fetch error:', e);
    return [];
  }
}

// ── Render calendar grid ──
function calRenderGrid(days, allEvents) {
  const grid    = document.getElementById('cal-grid');
  if (!grid) return;
  const dayNames   = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const today      = new Date(); today.setHours(0, 0, 0, 0);

  grid.innerHTML = days.map(date => {
    const isToday   = date.toDateString() === today.toDateString();
    const isPast    = date < today;
    const dayEvents = allEvents
      .filter(e => e.date && e.date.toDateString() === date.toDateString())
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.importance] ?? 2) - (order[b.importance] ?? 2);
      });

    const evBubbles = dayEvents.slice(0, 4).map(ev => {
      const col      = calEventColor(ev.category);
      const impDot   = ev.importance === 'high'
        ? `<span class="cal-impact-dot" style="background:${col}"></span>`
        : '';
      const safeJson = JSON.stringify(ev).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      return `<div
        class="cal-event-bubble"
        onclick="event.stopPropagation();calShowDetail('${safeJson}')"
        style="background:${col}15;border-color:${col}30;color:${col}">
        ${impDot}${ev.title}
      </div>`;
    }).join('');

    const moreCount = dayEvents.length > 4
      ? `<div style="font-size:.56rem;color:var(--muted);margin-top:.15rem;padding-left:.2rem">+${dayEvents.length - 4} event lagi</div>`
      : '';

    const cardClass = ['cal-day-card', isToday ? 'today' : '', isPast && !isToday ? 'past' : ''].filter(Boolean).join(' ');

    return `<div class="${cardClass}">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.4rem">
        <div style="font-size:.6rem;font-weight:700;color:${isToday ? '#67e8f9' : 'var(--muted)'}">
          ${dayNames[date.getDay()]}
        </div>
        <div style="font-size:.75rem;font-weight:800;
          color:${isToday ? '#67e8f9' : 'var(--text)'};
          ${isToday ? 'background:rgba(6,182,212,.18);border-radius:6px;padding:.05rem .38rem' : ''}">
          ${date.getDate()}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.18rem">
        ${dayEvents.length === 0
          ? `<div style="font-size:.6rem;color:rgba(148,163,184,.25);font-style:italic;padding:.1rem 0">No Event</div>`
          : evBubbles + moreCount}
      </div>
    </div>`;
  }).join('');
}

// ── Fetch CoinGecko Events (gratis, no key) ──
async function fetchCoinGeckoEvents(dateFrom, dateTo) {
  try {
    // CoinGecko upcoming events - gratis
    const url = `https://api.coingecko.com/api/v3/events?upcoming_events_only=false&page=1`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error('CoinGecko events ' + res.status);
    const data = await res.json();
    const from = new Date(dateFrom + 'T00:00:00');
    const to   = new Date(dateTo   + 'T23:59:59');

    return (data || [])
      .filter(ev => {
        if (!ev.start_date) return false;
        const d = new Date(ev.start_date);
        return d >= from && d <= to;
      })
      .map(ev => ({
        date: new Date(ev.start_date.slice(0,10) + 'T00:00:00'),
        title: ev.title || 'Crypto Event',
        description: ev.description || '',
        category: (ev.type || 'crypto').toLowerCase(),
        importance: 'medium',
        coins: ev.organizer_url ? [] : [],
        source: 'CoinGecko',
      }));
  } catch(e) {
    console.warn('CoinGecko events error:', e);
    return [];
  }
}

// ── Fetch Token Unlocks dari TokenUnlocks.app (gratis, no key) ──
async function fetchTokenUnlocks(dateFrom, dateTo) {
  const results = [];

  // 1. Coba TokenUnlocks.app API (gratis)
  try {
    const r = await fetch(
      `https://token.unlocks.app/api/upcoming?from=${dateFrom}&to=${dateTo}&limit=50`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const data = await r.json();
      const items = data?.data || data || [];
      for (const item of items) {
        const dateStr = (item.date || item.unlock_date || '').slice(0, 10);
        if (!dateStr) continue;
        const d = new Date(dateStr + 'T00:00:00');
        const from = new Date(dateFrom + 'T00:00:00');
        const to   = new Date(dateTo   + 'T23:59:59');
        if (d < from || d > to) continue;
        const pct   = item.percent_supply ? `(${parseFloat(item.percent_supply).toFixed(2)}% supply)` : '';
        const usd   = item.usd_value ? ` ~$${(item.usd_value/1e6).toFixed(1)}M` : '';
        results.push({
          date: d,
          title: `🔓 ${item.symbol || item.name || 'Token'} Unlock ${pct}`,
          description: `Token unlock${usd}. ${pct} dari total supply masuk ke pasar. Potensi tekanan jual (sell pressure) jangka pendek.`,
          category: 'token unlock',
          importance: parseFloat(item.percent_supply||0) > 2 ? 'high' : 'medium',
          source: 'TokenUnlocks.app',
        });
      }
      if (results.length > 0) return results;
    }
  } catch(e) {
    console.warn('[TokenUnlocks API]', e.message);
  }

  // 2. Fallback: hardcoded major token unlocks 2025-2026
  // Data dari vesting schedule publik masing-masing project
  const UNLOCKS = [
    // ARB — Arbitrum (cliff unlock besar)
    { date: '2024-03-16', symbol: 'ARB',  pct: '11.62', desc: 'Arbitrum Foundation & Team cliff unlock. Salah satu unlock terbesar dalam sejarah L2.' },
    { date: '2025-03-16', symbol: 'ARB',  pct: '3.50',  desc: 'Arbitrum vesting lanjutan — investor & team.' },
    { date: '2026-03-16', symbol: 'ARB',  pct: '3.50',  desc: 'Arbitrum vesting lanjutan.' },

    // OP — Optimism
    { date: '2024-05-31', symbol: 'OP',   pct: '2.88',  desc: 'Optimism investor & core contributor vesting.' },
    { date: '2025-05-31', symbol: 'OP',   pct: '2.88',  desc: 'Optimism vesting lanjutan.' },
    { date: '2026-05-31', symbol: 'OP',   pct: '2.88',  desc: 'Optimism vesting lanjutan.' },

    // SUI — Sui Network
    { date: '2025-05-03', symbol: 'SUI',  pct: '2.50',  desc: 'Sui Network investor vesting — 2 tahun pasca launch.' },
    { date: '2025-11-03', symbol: 'SUI',  pct: '2.50',  desc: 'Sui Network vesting lanjutan.' },
    { date: '2026-05-03', symbol: 'SUI',  pct: '2.50',  desc: 'Sui Network vesting lanjutan.' },

    // APT — Aptos
    { date: '2025-10-12', symbol: 'APT',  pct: '3.00',  desc: 'Aptos investor & core contributor vesting.' },
    { date: '2026-04-12', symbol: 'APT',  pct: '3.00',  desc: 'Aptos vesting lanjutan.' },
    { date: '2026-10-12', symbol: 'APT',  pct: '3.00',  desc: 'Aptos vesting lanjutan.' },

    // SEI
    { date: '2025-08-15', symbol: 'SEI',  pct: '5.20',  desc: 'SEI investor unlock — 2 tahun pasca mainnet.' },
    { date: '2026-02-15', symbol: 'SEI',  pct: '5.20',  desc: 'SEI vesting lanjutan.' },

    // TIA — Celestia
    { date: '2025-10-31', symbol: 'TIA',  pct: '17.00', desc: 'Celestia early backer & team cliff unlock besar. Potensi sell pressure signifikan.' },
    { date: '2026-10-31', symbol: 'TIA',  pct: '8.00',  desc: 'Celestia vesting lanjutan.' },

    // STRK — Starknet
    { date: '2025-04-15', symbol: 'STRK', pct: '4.00',  desc: 'StarkNet investor vesting.' },
    { date: '2025-10-15', symbol: 'STRK', pct: '4.00',  desc: 'StarkNet vesting lanjutan.' },
    { date: '2026-04-15', symbol: 'STRK', pct: '4.00',  desc: 'StarkNet vesting lanjutan.' },

    // JUP — Jupiter (Solana)
    { date: '2025-01-31', symbol: 'JUP',  pct: '10.00', desc: 'Jupiter team & investor cliff unlock.' },
    { date: '2026-01-31', symbol: 'JUP',  pct: '10.00', desc: 'Jupiter vesting lanjutan.' },

    // PYTH — Pyth Network
    { date: '2025-05-20', symbol: 'PYTH', pct: '5.00',  desc: 'Pyth Network investor vesting.' },
    { date: '2025-11-20', symbol: 'PYTH', pct: '5.00',  desc: 'Pyth vesting lanjutan.' },

    // ZK — zkSync
    { date: '2025-06-17', symbol: 'ZK',   pct: '8.50',  desc: 'zkSync early investor & contributor cliff unlock.' },
    { date: '2025-12-17', symbol: 'ZK',   pct: '4.00',  desc: 'zkSync vesting lanjutan.' },
    { date: '2026-06-17', symbol: 'ZK',   pct: '4.00',  desc: 'zkSync vesting lanjutan.' },

    // ENA — Ethena
    { date: '2025-04-02', symbol: 'ENA',  pct: '2.24',  desc: 'Ethena Foundation & investor vesting.' },
    { date: '2025-10-02', symbol: 'ENA',  pct: '2.24',  desc: 'Ethena vesting lanjutan.' },
    { date: '2026-04-02', symbol: 'ENA',  pct: '2.24',  desc: 'Ethena vesting lanjutan.' },

    // WIF — dogwifhat
    { date: '2025-09-01', symbol: 'WIF',  pct: '3.50',  desc: 'WIF early contributor unlock.' },

    // EIGEN — EigenLayer
    { date: '2025-09-29', symbol: 'EIGEN', pct: '5.00', desc: 'EigenLayer investor vesting — 1 tahun pasca TGE.' },
    { date: '2026-03-29', symbol: 'EIGEN', pct: '5.00', desc: 'EigenLayer vesting lanjutan.' },

    // AEVO
    { date: '2025-03-13', symbol: 'AEVO', pct: '5.00',  desc: 'AEVO team & investor vesting.' },

    // W — Wormhole
    { date: '2025-04-03', symbol: 'W',    pct: '3.33',  desc: 'Wormhole investor vesting.' },
    { date: '2025-10-03', symbol: 'W',    pct: '3.33',  desc: 'Wormhole vesting lanjutan.' },
    { date: '2026-04-03', symbol: 'W',    pct: '3.33',  desc: 'Wormhole vesting lanjutan.' },

    // HYPE — Hyperliquid
    { date: '2025-11-29', symbol: 'HYPE', pct: '2.72',  desc: 'Hyperliquid team vesting — airdrop & team allocation.' },
    { date: '2026-05-29', symbol: 'HYPE', pct: '2.72',  desc: 'HYPE vesting lanjutan.' },

    // NOT — Notcoin
    { date: '2025-05-16', symbol: 'NOT',  pct: '4.00',  desc: 'Notcoin team & investor vesting.' },
  ];

  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T23:59:59');

  for (const u of UNLOCKS) {
    const d = new Date(u.date + 'T00:00:00');
    if (d < from || d > to) continue;
    results.push({
      date: d,
      title: `🔓 ${u.symbol} Token Unlock (${u.pct}% supply)`,
      description: u.desc + ` Token masuk ke pasar — potensi sell pressure. Cek tokenomics untuk detail.`,
      category: 'token unlock',
      importance: parseFloat(u.pct) >= 5 ? 'high' : 'medium',
      source: 'Vesting Schedule',
    });
  }

  return results;
}

// ── Fetch Hardcoded macro events lengkap (FOMC, CPI, NFP, PCE, PPI, GDP, dll) ──
function fetchHardcodedMacro(dateFrom, dateTo) {
  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T23:59:59');
  const events = [];

  // Helper: push jika dalam range
  function push(dateStr, ev) {
    const d = new Date(dateStr + 'T00:00:00');
    if (d >= from && d <= to) events.push({ date: d, category: 'macro', source: 'US Gov / Fed', ...ev });
  }

  // ══════════════════════════════════════════════
  // FOMC MEETINGS — Federal Reserve (2024-2027)
  // ══════════════════════════════════════════════
  const FOMC = [
    // 2024
    '2024-01-30','2024-01-31',
    '2024-03-19','2024-03-20',
    '2024-04-30','2024-05-01',
    '2024-06-11','2024-06-12',
    '2024-07-30','2024-07-31',
    '2024-09-17','2024-09-18',
    '2024-11-06','2024-11-07',
    '2024-12-17','2024-12-18',
    // 2025
    '2025-01-28','2025-01-29',
    '2025-03-18','2025-03-19',
    '2025-04-29','2025-04-30',
    '2025-06-17','2025-06-18',
    '2025-07-29','2025-07-30',
    '2025-09-16','2025-09-17',
    '2025-10-28','2025-10-29',
    '2025-12-09','2025-12-10',
    // 2026
    '2026-01-27','2026-01-28',
    '2026-03-17','2026-03-18',
    '2026-04-28','2026-04-29',
    '2026-06-09','2026-06-10',
    '2026-07-28','2026-07-29',
    '2026-09-15','2026-09-16',
    '2026-10-27','2026-10-28',
    '2026-12-15','2026-12-16',
    // 2027
    '2027-01-26','2027-01-27',
    '2027-03-16','2027-03-17',
    '2027-04-27','2027-04-28',
    '2027-06-15','2027-06-16',
  ];
  for (const d of FOMC) {
    push(d, {
      title: 'FOMC Meeting — Federal Reserve',
      description: 'Rapat Federal Open Market Committee. Keputusan suku bunga AS berdampak langsung pada harga Bitcoin & seluruh aset berisiko global.',
      importance: 'high',
      time: '01:00',
    });
  }

  // ══════════════════════════════════════════════
  // CPI — US Inflation (bulanan, ~Rabu ke-2)
  // ══════════════════════════════════════════════
  const CPI = [
    // 2024
    '2024-01-11','2024-02-13','2024-03-12','2024-04-10',
    '2024-05-15','2024-06-12','2024-07-11','2024-08-14',
    '2024-09-11','2024-10-10','2024-11-13','2024-12-11',
    // 2025
    '2025-01-15','2025-02-12','2025-03-12','2025-04-10',
    '2025-05-13','2025-06-11','2025-07-15','2025-08-12',
    '2025-09-10','2025-10-15','2025-11-12','2025-12-10',
    // 2026
    '2026-01-14','2026-02-11','2026-03-11','2026-04-09',
    '2026-05-13','2026-06-10','2026-07-14','2026-08-12',
    '2026-09-09','2026-10-14','2026-11-11','2026-12-09',
  ];
  for (const d of CPI) {
    push(d, {
      title: 'US CPI Inflation Report',
      description: 'Consumer Price Index AS. Laporan inflasi bulanan paling berpengaruh di pasar global. CPI tinggi → Fed hawkish → tekanan turun pada crypto & saham.',
      importance: 'high',
      time: '20:30',
    });
  }

  // ══════════════════════════════════════════════
  // NFP — Non-Farm Payrolls (Jumat pertama tiap bulan)
  // ══════════════════════════════════════════════
  const NFP = [
    // 2024
    '2024-01-05','2024-02-02','2024-03-08','2024-04-05',
    '2024-05-03','2024-06-07','2024-07-05','2024-08-02',
    '2024-09-06','2024-10-04','2024-11-01','2024-12-06',
    // 2025
    '2025-01-10','2025-02-07','2025-03-07','2025-04-04',
    '2025-05-02','2025-06-06','2025-07-03','2025-08-01',
    '2025-09-05','2025-10-03','2025-11-07','2025-12-05',
    // 2026
    '2026-01-09','2026-02-06','2026-03-06','2026-04-03',
    '2026-05-01','2026-06-05','2026-07-02','2026-08-07',
    '2026-09-04','2026-10-02','2026-11-06','2026-12-04',
  ];
  for (const d of NFP) {
    push(d, {
      title: 'US NFP — Non-Farm Payrolls',
      description: 'Data tenaga kerja non-pertanian AS. Salah satu rilis ekonomi paling market-moving. NFP kuat → dolar menguat → tekanan pada Bitcoin & altcoin.',
      importance: 'high',
      time: '20:30',
    });
  }

  // ══════════════════════════════════════════════
  // PCE — Fed's Preferred Inflation Gauge (bulanan)
  // ══════════════════════════════════════════════
  const PCE = [
    // 2024
    '2024-01-26','2024-02-29','2024-03-29','2024-04-26',
    '2024-05-31','2024-06-28','2024-07-26','2024-08-30',
    '2024-09-27','2024-10-31','2024-11-27','2024-12-20',
    // 2025
    '2025-01-31','2025-02-28','2025-03-28','2025-04-30',
    '2025-05-30','2025-06-27','2025-07-31','2025-08-29',
    '2025-09-26','2025-10-31','2025-11-26','2025-12-19',
    // 2026
    '2026-01-30','2026-02-27','2026-03-27','2026-04-30',
    '2026-05-29','2026-06-26','2026-07-31','2026-08-28',
    '2026-09-25','2026-10-30','2026-11-25','2026-12-18',
  ];
  for (const d of PCE) {
    push(d, {
      title: 'US PCE Price Index',
      description: 'Personal Consumption Expenditures — indikator inflasi favorit Federal Reserve. Digunakan langsung dalam keputusan suku bunga. Sangat berpengaruh pada crypto.',
      importance: 'high',
      time: '21:30',
    });
  }

  // ══════════════════════════════════════════════
  // PPI — Producer Price Index (bulanan)
  // ══════════════════════════════════════════════
  const PPI = [
    // 2024
    '2024-01-12','2024-02-16','2024-03-14','2024-04-11',
    '2024-05-14','2024-06-13','2024-07-12','2024-08-13',
    '2024-09-12','2024-10-11','2024-11-14','2024-12-12',
    // 2025
    '2025-01-14','2025-02-13','2025-03-13','2025-04-11',
    '2025-05-15','2025-06-12','2025-07-15','2025-08-14',
    '2025-09-11','2025-10-14','2025-11-13','2025-12-11',
    // 2026
    '2026-01-15','2026-02-12','2026-03-12','2026-04-10',
    '2026-05-14','2026-06-11','2026-07-15','2026-08-13',
    '2026-09-10','2026-10-15','2026-11-12','2026-12-10',
  ];
  for (const d of PPI) {
    push(d, {
      title: 'US PPI — Producer Price Index',
      description: 'Indeks harga produsen AS. Leading indicator inflasi — naik sebelum CPI naik. Berpengaruh pada ekspektasi kebijakan Fed.',
      importance: 'medium',
      time: '20:30',
    });
  }

  // ══════════════════════════════════════════════
  // GDP — US Quarterly (setiap kuartal)
  // ══════════════════════════════════════════════
  const GDP = [
    // 2024
    '2024-01-25','2024-02-28','2024-03-28',
    '2024-04-25','2024-05-30','2024-06-27',
    '2024-07-25','2024-08-29','2024-09-26',
    '2024-10-30','2024-11-27','2024-12-19',
    // 2025
    '2025-01-30','2025-02-27','2025-03-27',
    '2025-04-30','2025-05-29','2025-06-26',
    '2025-07-30','2025-08-28','2025-09-25',
    '2025-10-29','2025-11-26','2025-12-18',
    // 2026
    '2026-01-29','2026-02-26','2026-03-26',
    '2026-04-29','2026-05-28','2026-06-25',
    '2026-07-29','2026-08-27','2026-09-24',
    '2026-10-29','2026-11-25','2026-12-17',
  ];
  for (const d of GDP) {
    push(d, {
      title: 'US GDP Report',
      description: 'Laporan Produk Domestik Bruto AS. Indikator utama kesehatan ekonomi. GDP di bawah ekspektasi → potensi stimulus/rate cut → bullish crypto.',
      importance: 'medium',
      time: '21:30',
    });
  }

  // ══════════════════════════════════════════════
  // US Jobless Claims — setiap Kamis (mingguan)
  // ══════════════════════════════════════════════
  const days = Math.ceil((to - from) / 86400000);
  for (let i = 0; i <= days; i++) {
    const d = new Date(from.getTime() + i * 86400000);
    if (d.getDay() === 4) { // Kamis
      events.push({
        date: d,
        title: 'US Jobless Claims',
        description: 'Klaim pengangguran mingguan AS. Indikator real-time kondisi pasar tenaga kerja. Meningkat signifikan → potensi dovish Fed → bullish risk assets.',
        category: 'macro',
        importance: 'medium',
        source: 'US Dept of Labor',
        time: '20:30',
      });
    }
  }

  // ══════════════════════════════════════════════
  // Bitcoin Halving
  // ══════════════════════════════════════════════
  push('2024-04-20', {
    title: '₿ Bitcoin Halving #4',
    description: 'Halving keempat Bitcoin — block reward turun dari 6.25 menjadi 3.125 BTC. Event 4 tahunan yang secara historis menjadi katalis bull run besar.',
    importance: 'high',
    category: 'crypto',
    source: 'Bitcoin Protocol',
    time: null,
  });
  // Halving berikutnya estimasi ~April 2028
  push('2028-04-17', {
    title: '₿ Bitcoin Halving #5 (Estimasi)',
    description: 'Estimasi halving kelima Bitcoin. Block reward turun dari 3.125 menjadi 1.5625 BTC. Tanggal pasti tergantung hashrate jaringan.',
    importance: 'high',
    category: 'crypto',
    source: 'Bitcoin Protocol',
    time: null,
  });

  // ══════════════════════════════════════════════
  // ISM Manufacturing PMI (Senin pertama tiap bulan)
  // ══════════════════════════════════════════════
  const ISM_MFG = [
    // 2024
    '2024-01-02','2024-02-01','2024-03-01','2024-04-01',
    '2024-05-01','2024-06-03','2024-07-01','2024-08-01',
    '2024-09-03','2024-10-01','2024-11-01','2024-12-02',
    // 2025
    '2025-01-02','2025-02-03','2025-03-03','2025-04-01',
    '2025-05-01','2025-06-02','2025-07-01','2025-08-01',
    '2025-09-02','2025-10-01','2025-11-03','2025-12-01',
    // 2026
    '2026-01-02','2026-02-02','2026-03-02','2026-04-01',
    '2026-05-01','2026-06-01','2026-07-01','2026-08-03',
    '2026-09-01','2026-10-01','2026-11-02','2026-12-01',
  ];
  for (const d of ISM_MFG) {
    push(d, {
      title: 'ISM Manufacturing PMI',
      description: 'Indeks aktivitas manufaktur AS. Di atas 50 = ekspansi, di bawah 50 = kontraksi. Leading indicator ekonomi — rilis pertama di awal bulan sebelum data lain.',
      importance: 'medium',
      time: '22:00',
    });
  }

  // ══════════════════════════════════════════════
  // ISM Services PMI (Rabu pertama tiap bulan)
  // ══════════════════════════════════════════════
  const ISM_SVC = [
    // 2024
    '2024-01-05','2024-02-05','2024-03-05','2024-04-03',
    '2024-05-03','2024-06-05','2024-07-03','2024-08-05',
    '2024-09-04','2024-10-03','2024-11-06','2024-12-04',
    // 2025
    '2025-01-07','2025-02-05','2025-03-05','2025-04-03',
    '2025-05-05','2025-06-04','2025-07-07','2025-08-06',
    '2025-09-03','2025-10-03','2025-11-05','2025-12-03',
    // 2026
    '2026-01-07','2026-02-04','2026-03-04','2026-04-01',
    '2026-05-06','2026-06-03','2026-07-01','2026-08-05',
    '2026-09-02','2026-10-07','2026-11-04','2026-12-02',
  ];
  for (const d of ISM_SVC) {
    push(d, {
      title: 'ISM Services PMI',
      description: 'Indeks aktivitas sektor jasa AS (70% ekonomi AS). Lebih berpengaruh dari ISM Manufacturing. Di atas 50 = ekspansi ekonomi → Fed tidak perlu potong rate.',
      importance: 'medium',
      time: '22:00',
    });
  }

  // ══════════════════════════════════════════════
  // ADP Non-Farm Employment (Rabu sebelum NFP)
  // ══════════════════════════════════════════════
  const ADP = [
    // 2024
    '2024-01-03','2024-02-07','2024-03-06','2024-04-03',
    '2024-05-01','2024-06-05','2024-07-03','2024-07-31',
    '2024-09-04','2024-10-02','2024-10-30','2024-12-04',
    // 2025
    '2025-01-08','2025-02-05','2025-03-05','2025-04-02',
    '2025-04-30','2025-06-04','2025-07-02','2025-07-30',
    '2025-09-03','2025-10-01','2025-10-29','2025-12-03',
    // 2026
    '2026-01-07','2026-02-04','2026-03-04','2026-04-01',
    '2026-04-29','2026-06-03','2026-07-01','2026-07-29',
    '2026-09-02','2026-09-30','2026-10-28','2026-12-02',
  ];
  for (const d of ADP) {
    push(d, {
      title: 'ADP Non-Farm Employment',
      description: 'Data tenaga kerja swasta AS dari ADP — preview 2 hari sebelum NFP resmi. Sering dipakai sebagai prediksi arah NFP. Kejutan besar di ADP biasanya menggerakkan pasar.',
      importance: 'medium',
      time: '20:15',
    });
  }

  // ══════════════════════════════════════════════
  // Unemployment Rate (bareng NFP, Jumat pertama)
  // ══════════════════════════════════════════════
  const UNEMP = [
    // 2024
    '2024-01-05','2024-02-02','2024-03-08','2024-04-05',
    '2024-05-03','2024-06-07','2024-07-05','2024-08-02',
    '2024-09-06','2024-10-04','2024-11-01','2024-12-06',
    // 2025
    '2025-01-10','2025-02-07','2025-03-07','2025-04-04',
    '2025-05-02','2025-06-06','2025-07-03','2025-08-01',
    '2025-09-05','2025-10-03','2025-11-07','2025-12-05',
    // 2026
    '2026-01-09','2026-02-06','2026-03-06','2026-04-03',
    '2026-05-01','2026-06-05','2026-07-02','2026-08-07',
    '2026-09-04','2026-10-02','2026-11-06','2026-12-04',
  ];
  for (const d of UNEMP) {
    push(d, {
      title: 'US Unemployment Rate',
      description: 'Tingkat pengangguran AS — dirilis bersamaan NFP. Naik = pasar kerja melemah → potensi Fed dovish → bullish crypto jangka menengah.',
      importance: 'medium',
      time: '20:30',
    });
  }

  // ══════════════════════════════════════════════
  // Fed Chair Speech / FOMC Minutes (2 minggu pasca rapat)
  // ══════════════════════════════════════════════
  const FOMC_MINUTES = [
    // 2024
    '2024-02-21','2024-04-10','2024-05-22','2024-07-03',
    '2024-08-21','2024-10-09','2024-11-26','2025-01-08',
    // 2025
    '2025-02-19','2025-04-09','2025-05-28','2025-07-09',
    '2025-08-20','2025-10-08','2025-11-19','2025-12-24',
    // 2026
    '2026-02-18','2026-04-08','2026-05-27','2026-07-08',
    '2026-08-19','2026-10-07','2026-11-18','2026-12-30',
  ];
  for (const d of FOMC_MINUTES) {
    push(d, {
      title: 'FOMC Minutes Rilis',
      description: 'Notulen rapat FOMC — detail diskusi internal Fed tentang suku bunga & ekonomi. Sering mengungkap sinyal kebijakan ke depan yang tidak ada di statement resmi.',
      importance: 'medium',
      time: '02:00',
      source: 'Federal Reserve',
    });
  }

  // ══════════════════════════════════════════════
  // ECB Rate Decision (Euro Central Bank, ~6 minggu sekali)
  // ══════════════════════════════════════════════
  const ECB = [
    // 2024
    '2024-01-25','2024-03-07','2024-04-11','2024-06-06',
    '2024-07-18','2024-09-12','2024-10-17','2024-12-12',
    // 2025
    '2025-01-30','2025-03-06','2025-04-17','2025-06-05',
    '2025-07-24','2025-09-11','2025-10-30','2025-12-18',
    // 2026
    '2026-01-29','2026-03-05','2026-04-16','2026-06-04',
    '2026-07-23','2026-09-10','2026-10-29','2026-12-17',
  ];
  for (const d of ECB) {
    push(d, {
      title: 'ECB Rate Decision',
      description: 'Keputusan suku bunga Bank Sentral Eropa. Euro adalah mata uang terbesar kedua di dunia — keputusan ECB mempengaruhi likuiditas global & sentimen pasar crypto.',
      importance: 'medium',
      time: '20:15',
      source: 'European Central Bank',
    });
  }

  return events;
}

async function loadCryptoCalendar() {
  const grid    = document.getElementById('cal-grid');
  const rangeEl = document.getElementById('cal-range-label');
  const weekLbl = document.getElementById('cal-week-label');
  const statusEl = document.getElementById('cal-status');
  if (!grid) return;

  const days       = calGetWeekDates(_calWeekOffset);
  const monthNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const first = days[0], last = days[6];
  const dateFrom = calFmtDate(first);
  const dateTo   = calFmtDate(last);
  const cacheKey = `${dateFrom}_${dateTo}`;

  rangeEl && (rangeEl.textContent = `${first.getDate()} ${monthNames[first.getMonth()]} – ${last.getDate()} ${monthNames[last.getMonth()]} ${last.getFullYear()}`);
  weekLbl && (weekLbl.textContent = _calWeekOffset === 0 ? 'Minggu ini' : _calWeekOffset > 0 ? `+${_calWeekOffset} minggu ke depan` : `${Math.abs(_calWeekOffset)} minggu lalu`);

  // Show skeleton loading
  grid.innerHTML = Array(7).fill(0).map(() => `
    <div class="cal-day-card">
      <div style="display:flex;justify-content:space-between;margin-bottom:.5rem">
        <div class="cal-skeleton" style="width:22px;height:8px"></div>
        <div class="cal-skeleton" style="width:16px;height:8px"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.22rem">
        <div class="cal-skeleton" style="height:18px;width:100%"></div>
        <div class="cal-skeleton" style="height:18px;width:80%"></div>
      </div>
    </div>
  `).join('');

  // Use cache if available
  if (_calCache[cacheKey]) {
    calRenderGrid(days, _calCache[cacheKey]);
    if (statusEl) statusEl.textContent = '✓ Data dari cache';
    return;
  }

  if (statusEl) statusEl.textContent = '⏳ Mengambil data real-time...';

  // Fetch semua sumber paralel
  const hardcodedEvents = fetchHardcodedMacro(dateFrom, dateTo);
  const [cmcEvents, finnhubEvents, cgEvents, tokenUnlockEvents] = await Promise.all([
    fetchCMCEvents(dateFrom, dateTo),
    fetchFinnhubCalendar(dateFrom, dateTo),
    fetchCoinGeckoEvents(dateFrom, dateTo),
    fetchTokenUnlocks(dateFrom, dateTo),
  ]);

  // Deduplicate by title+date
  const seen = new Set();
  const allEvents = [...hardcodedEvents, ...cmcEvents, ...finnhubEvents, ...cgEvents, ...tokenUnlockEvents].filter(ev => {
    if (!ev?.date) return false;
    const key = (ev.title||'').slice(0,40) + ev.date.toDateString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  _calCache[cacheKey] = allEvents;

  calRenderGrid(days, allEvents);

  if (statusEl) {
    const src = [];
    if (hardcodedEvents.length)    src.push(`${hardcodedEvents.length} macro`);
    if (tokenUnlockEvents.length)  src.push(`${tokenUnlockEvents.length} unlock`);
    if (cmcEvents.length)          src.push(`${cmcEvents.length} CMC`);
    if (finnhubEvents.length)      src.push(`${finnhubEvents.length} Finnhub`);
    if (cgEvents.length)           src.push(`${cgEvents.length} CoinGecko`);
    const total = allEvents.length;
    statusEl.textContent = total > 0 ? `✓ ${total} event · ${src.join(' · ')}` : '⚠️ Tidak ada event minggu ini';
  }
}

