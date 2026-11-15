// Звук целиком синтезируется Web Audio: гул ламп, шаги, 3D-позиционирование.

// Мелодия музыкальной шкатулки в тайной комнате: [частота, пауза до следующей ноты]
const MELODY = [
  [659.25, 0.45], [783.99, 0.45], [1046.5, 0.9], [987.77, 0.45], [880, 0.45], [783.99, 0.9],
  [659.25, 0.45], [783.99, 0.45], [880, 0.45], [783.99, 0.45], [659.25, 0.45], [587.33, 0.45], [523.25, 1.2], [0, 0.6],
  [659.25, 0.45], [783.99, 0.45], [1046.5, 0.9], [1174.66, 0.45], [1318.5, 0.45], [1174.66, 0.9],
  [1046.5, 0.45], [987.77, 0.45], [880, 0.45], [987.77, 0.45], [1046.5, 1.6], [0, 1.4]
];

class Sound {
  constructor() { this.ctx = null; this.vol = 0.8; this.boxT = 0; this.boxI = 0; this.bellT = 3; }

  // ctxOverride — OfflineAudioContext для записи звуков в файл (scripts/audio.mjs).
  init(ctxOverride) {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C && !ctxOverride) return;
    let c = ctxOverride;
    if (!c) { try { c = new C({ latencyHint: 'interactive' }); } catch (e) { return; } }
    this.ctx = c;
    // iPhone/iPad: без этого Web Audio молчит при беззвучном режиме (Safari 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 12; comp.ratio.value = 5; comp.connect(c.destination);
    this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(comp);
    // bus — мир и игрок (идёт через «приглушение» duck и в реверб); fx — испуг и интерфейс, мимо приглушения.
    this.duck = c.createGain(); this.duck.connect(this.master);
    this.bus = c.createGain(); this.bus.connect(this.duck);
    this.fx = c.createGain(); this.fx.connect(this.master);
    this.rev = c.createConvolver(); this.revG = this.g(0.35, this.duck); this.rev.connect(this.revG);
    this.revSend = this.g(0, this.rev); this.bus.connect(this.revSend);
    this.revSize = 0; this.setReverb(2.2, 0.35);
    this.scareT = 0;
    const len = c.sampleRate * 3;
    this.wb = c.createBuffer(1, len, c.sampleRate);
    const w = this.wb.getChannelData(0); for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.bb = c.createBuffer(1, len, c.sampleRate);
    const b = this.bb.getChannelData(0); let l = 0; for (let i = 0; i < len; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = l * 3.5; }
    // гул ламп 100 Гц
    this.humG = this.g(0, this.bus);
    const hl = this.filt('lowpass', 420, 0.8); hl.connect(this.humG);
    this.osc('sawtooth', 100, 0.5, hl); this.osc('sine', 200, 0.25, this.humG); this.osc('sine', 300, 0.08, this.humG);
    const hb = this.loop(this.wb), hbf = this.filt('bandpass', 100, 6); hb.connect(hbf); hbf.connect(this.g(0.35, this.humG));
    // тон комнаты
    this.roomG = this.g(0, this.bus);
    const rt = this.loop(this.bb), rtf = this.filt('lowpass', 260, 0.7); rt.connect(rtf); rtf.connect(this.roomG);
    // помехи рядом с ним
    this.statG = this.g(0, this.bus);
    const sn = this.loop(this.wb), sf = this.filt('bandpass', 3200, 0.6); sn.connect(sf); sf.connect(this.statG);
    // звон в ушах
    this.tinG = this.g(0, this.bus); this.osc('sine', 4300, 1, this.tinG);
    // музыка меню
    this.musG = this.g(0, this.bus);
    const mf = this.filt('lowpass', 300, 2); mf.connect(this.musG);
    this.osc('sawtooth', 55, 0.3, mf); this.osc('sawtooth', 55.35, 0.3, mf); this.osc('sawtooth', 82.6, 0.2, mf); this.osc('triangle', 27.5, 0.5, mf);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.06; const lg = this.g(160, null); lfo.connect(lg); lg.connect(mf.frequency); lfo.start();
    // маяк у выхода
    this.beaP = this.panner(2.5); this.beaG = this.g(0, this.beaP);
    this.osc('sine', 660, 0.5, this.beaG); this.osc('sine', 664.5, 0.5, this.beaG); this.osc('triangle', 990, 0.12, this.beaG);
    // голос «Его»
    this.entP = this.panner(2); this.entG = this.g(0, this.entP);
    const br = this.loop(this.wb), brf = this.filt('bandpass', 520, 1.2), brg = this.g(0.5, this.entG); br.connect(brf); brf.connect(brg);
    const bl = c.createOscillator(); bl.frequency.value = 0.42; const blg = this.g(0.5, null); bl.connect(blg); blg.connect(brg.gain); bl.start();
    this.growlG = this.g(0, this.entG);
    const gf = this.filt('lowpass', 180, 3); gf.connect(this.growlG); this.osc('sawtooth', 46, 0.8, gf); this.osc('sawtooth', 47.3, 0.6, gf);
    // низкий гул в темноте
    this.rumG = this.g(0, this.bus);
    const rb = this.loop(this.bb), rbf = this.filt('lowpass', 90, 1); rb.connect(rbf); rbf.connect(this.rumG);
    this.osc('sine', 36, 0.6, this.rumG); this.osc('sawtooth', 54.5, 0.08, this.rumG);
    // шарманка цирка
    this.cirP = this.panner(4); this.cirG = this.g(0, this.cirP);
    this.cirF = this.filt('lowpass', 1700, 0.8); this.cirF.connect(this.cirG);
    this.cT = 0; this.cB = 0;
    // шкатулка
    this.boxP = this.panner(1.2); this.boxG = this.g(0, this.boxP);
    // бредёшь по воде: непрерывный плеск, громкость от скорости
    this.wadeG = this.g(0, this.bus);
    const wd = this.loop(this.wb), wdf = this.filt('bandpass', 520, 0.9); wd.connect(wdf);
    const wdg = this.g(0.6, this.wadeG); wdf.connect(wdg);
    const wl = c.createOscillator(); wl.frequency.value = 1.7; const wlg = this.g(0.45, null); wl.connect(wlg); wlg.connect(wdg.gain); wl.start();
    const wd2 = this.loop(this.wb), wdf2 = this.filt('highpass', 2600, 0.7); wd2.connect(wdf2); wdf2.connect(this.g(0.12, this.wadeG));
    if (this.pendRev) { this.setReverb(...this.pendRev); this.pendRev = null; }
  }
  // Реверб: импульсный отклик генерируется шумом с экспоненциальным спадом. sec — длина хвоста, wet — громкость.
  setReverb(sec, wet) {
    if (!this.ctx) { this.pendRev = [sec, wet]; return; }
    this.revWet = wet;
    if (Math.abs(sec - this.revSize) > 0.05) {
      const c = this.ctx, n = Math.max(1, Math.floor(c.sampleRate * sec)), b = c.createBuffer(2, n, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch); let lp = 0;
        for (let i = 0; i < n; i++) {
          const k = i / n, env = Math.pow(1 - k, 2.6) * (i < c.sampleRate * 0.012 ? i / (c.sampleRate * 0.012) : 1);
          lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * k); // хвост темнеет со временем
          d[i] = lp * env;
        }
      }
      this.rev.buffer = b; this.revSize = sec;
    }
  }
  // кривая перегруза для рыка
  shaper(k = 40) {
    const s = this.ctx.createWaveShaper(), n = 1024, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; cv[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    s.curve = cv; s.oversample = '2x'; return s;
  }
  g(v, dest) { const n = this.ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; }
  osc(type, f, v, dest) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(this.g(v, dest)); o.start(); return o; }
  loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2); return s; }
  filt(type, f, q) { const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; }
  panner(ref = 2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.4; p.maxDistance = 90;
    p.connect(this.bus); return p;
  }
  pos(p, x, y, z) {
    if (!p) return;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }
  listen(x, y, z, fx, fy, fz) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
  }
  setVol(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  suspend() { try { if (this.ctx) this.ctx.suspend(); } catch (e) { /* ignore */ } }
  resume() { try { if (this.ctx) this.ctx.resume(); } catch (e) { /* ignore */ } }
  set(n, v, tc = 0.08) { if (n) n.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }
  setBeacon(x, y, z) { if (this.ctx) this.pos(this.beaP, x, y, z); }
  setBox(x, y, z) { if (this.ctx) this.pos(this.boxP, x, y, z); }
  setCircus(x, y, z) { if (this.ctx) this.pos(this.cirP, x, y, z); }
  setEnt(x, y, z) { if (this.ctx) this.pos(this.entP, x, y, z); }

  frame(dt, s) {
    if (!this.ctx) return;
    const game = s.mode === 'game', menu = s.mode === 'menu';
    if (this.scareT > 0) this.scareT -= dt;
    this.set(this.duck, this.scareT > 0 ? 0.04 : 1, this.scareT > 0 ? 0.015 : 0.6);
    this.set(this.revSend, game ? this.revWet : menu ? 0.2 : 0, 0.3);
    this.set(this.wadeG, game ? 0.5 * (s.wade || 0) : 0, 0.12);
    this.set(this.humG, (game || menu) ? 0.05 * Math.min(1, s.power) : 0, 0.03);
    this.set(this.roomG, game ? 0.14 : menu ? 0.12 : 0, 0.5);
    this.set(this.statG, game ? 0.14 * s.prox * s.prox : 0, 0.15);
    this.set(this.tinG, game ? 0.012 * s.tin : 0, 0.5);
    this.set(this.musG, menu ? 0.09 : 0, 1.2);
    this.set(this.beaG, game && s.beacon ? 0.05 : 0, 0.4);
    this.set(this.entG, game && s.ent ? 0.55 : 0, 0.3);
    this.set(this.growlG, game && s.chase ? 0.35 : 0, 0.4);
    this.set(this.boxG, game && s.box ? 0.8 : 0, 0.6);
    this.set(this.rumG, game && s.black ? 0.9 : 0, s.black ? 0.4 : 0.8);
    this.set(this.cirG, game && s.circus ? 0.9 * Math.max(0.15, Math.min(1, s.power)) : 0, 0.5);
    if (game && s.circus) {
      this.cT -= dt;
      if (this.cT <= 0) { this.waltzBeat(this.cB++); this.cT = 0.44; }
    }
    if (game && s.box) {
      this.boxT -= dt;
      if (this.boxT <= 0) { const n = MELODY[this.boxI % MELODY.length]; this.boxI++; if (n[0]) this.pluck(n[0]); this.boxT = n[1]; }
    }
    if (menu) {
      this.bellT -= dt;
      if (this.bellT <= 0) {
        this.bellT = 5 + Math.random() * 7;
        const f = [440, 523.25, 587.33, 659.25, 392][(Math.random() * 5) | 0];
        this.tone(f, 3.5, 'sine', 0.025); this.tone(f * 2.01, 2.5, 'sine', 0.01);
      }
    }
  }
  // вальс шарманки (свой, ля минор): [бас, аккорд, мелодия на долю 1/2/3]
  waltzBeat(b) {
    const N = { A2: 110, E2: 82.41, D3: 146.83, A3: 220, C4: 261.63, E4: 329.63, G4s: 415.3, B3: 246.94, D4: 293.66, F4: 349.23, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5s: 830.61 };
    const BAR = [
      ['A2', ['C4', 'E4'], ['E5', 0, 'C5']], ['E2', ['B3', 'G4s'], ['B4', 0, 'G5s']], ['A2', ['C4', 'E4'], ['A4', 'C5', 'E5']], ['D3', ['D4', 'F4'], ['F5', 0, 'D5']],
      ['A2', ['C4', 'E4'], ['E5', 0, 'C5']], ['E2', ['B3', 'G4s'], ['D5', 'C5', 'B4']], ['A2', ['C4', 'E4'], ['A4', 0, 'E4']], ['E2', ['B3', 'G4s'], ['G5s', 'B4', 'E5']]
    ];
    const bar = BAR[((b / 3) | 0) % BAR.length], beat = b % 3, wob = 1 + (Math.random() - 0.5) * 0.012;
    if (beat === 0) this.tone(N[bar[0]] * wob, 0.4, 'triangle', 0.22, null, this.cirF);
    else for (const n of bar[1]) this.tone(N[n] * wob, 0.22, 'square', 0.035, null, this.cirF);
    const m = bar[2][beat];
    if (m) { this.tone(N[m] * wob, 0.38, 'square', 0.045, N[m] * wob * 0.995, this.cirF); this.tone(N[m] * 2 * wob, 0.3, 'sine', 0.02, null, this.cirF); }
  }
  // ---------- страх ----------
  hit() {   // резкий удар при появлении
    for (const f of [92, 97.5, 138, 146.8, 207]) this.tone(f, 1.6, 'sawtooth', 0.12, f * 0.94);
    this.noise(0.9, 'bandpass', 1400, 0.6, 0.7, null, 0.004); this.noise(1.4, 'lowpass', 180, 1, 0.9, null, 0.004);
    this.tone(2600, 0.9, 'square', 0.03, 1900);
  }
  powerDown() { this.tone(120, 1.4, 'sawtooth', 0.12, 30); this.noise(0.12, 'highpass', 3000, 0.7, 0.4); this.tone(60, 2.2, 'sine', 0.35, 28, null, 0.2); }
  breathBehind(x, z) { const p = this.at(x, 1.6, z, 0.8); if (!p) return; this.noise(0.9, 'bandpass', 700, 1.2, 0.35, p, 0.35); this.noise(1.1, 'bandpass', 520, 1.2, 0.3, p, 0.45, 1.0); }
  runSteps(x0, z0, x1, z1) {
    for (let k = 0; k < 9; k++) {
      const t = k / 8, p = this.at(x0 + (x1 - x0) * t, 0.3, z0 + (z1 - z0) * t, 2.5); if (!p) return;
      this.tone(64, 0.16, 'sine', 0.6, 36, p, k * 0.21); this.noise(0.14, 'lowpass', 320, 1, 0.35, p, 0.004, k * 0.21);
    }
  }
  screamFar(x, z) { const p = this.at(x, 1.6, z, 6); if (!p) return; for (const [f, d] of [[620, 0], [700, 0.05], [540, 0.1]]) this.tone(f, 1.4, 'sawtooth', 0.09, f * 0.55, p, d); this.noise(1.3, 'bandpass', 1500, 2, 0.12, p, 0.05); }
  scratch(x, z) { const p = this.at(x, 1.2, z, 2); if (!p) return; for (let k = 0; k < 4; k++) this.noise(0.35, 'bandpass', 3200 + Math.random() * 1500, 6, 0.22, p, 0.02, k * 0.42); }
  whisperEar() { this.noise(1.6, 'bandpass', 3000, 5, 0.1, null, 0.6); this.noise(1.2, 'bandpass', 2200, 6, 0.08, null, 0.5, 0.4); }
  voice(kind, x, z, chase) {
    const p = this.at(x, 1.9, z, 3); if (!p) return;
    const v = chase ? 1.4 : 1;
    if (kind === 'blind') { for (let k = 0; k < 4; k++) this.noise(0.04, 'bandpass', 3800, 8, 0.4 * v, p, 0.002, k * 0.12); }
    else if (kind === 'grinner') { for (let k = 0; k < 6; k++) this.tone(900 + k * 40 + Math.random() * 80, 0.09, 'triangle', 0.08 * v, 700, p, k * 0.11); }
    else if (kind === 'drowned') { for (let k = 0; k < 8; k++) this.tone(180 + Math.random() * 260, 0.07, 'sine', 0.16 * v, 90, p, k * 0.09); this.noise(0.8, 'lowpass', 400, 2, 0.12, p, 0.2); }
    else if (kind === 'swimmer') { this.noise(0.5, 'bandpass', 900, 1, 0.35 * v, p, 0.02); this.noise(0.3, 'bandpass', 2400, 1.5, 0.12, p, 0.02, 0.2); }
    else if (kind === 'puppet') { for (let k = 0; k < 5; k++) this.tone(520 - k * 45, 0.16, 'square', 0.05 * v, 400 - k * 40, p, k * 0.19); this.tone(140, 0.6, 'triangle', 0.08, 220, p, 0.1); }
    else if (kind === 'mimic') { this.mutter(p, v); }
    else if (kind === 'stalker') { this.growl(p, 1.6, 42, 0.5 * v); this.noise(1.1, 'lowpass', 260, 3, 0.22 * v, p, 0.2); }
    else if (kind === 'watcher') { this.growl(p, 2.2, 58, 0.32 * v); this.noise(1.6, 'bandpass', 420, 1.5, 0.12 * v, p, 0.5, 0.2); }
    else if (kind === 'shadow') { this.noise(1.8, 'bandpass', 1800, 9, 0.14 * v, p, 0.7); this.tone(3300, 1.6, 'sine', 0.012, 2900, p, 0.3); }
    else if (kind === 'crawler') { for (let k = 0; k < 7; k++) this.noise(0.05, 'bandpass', 1200 + Math.random() * 900, 4, 0.3 * v, p, 0.003, k * 0.07); }
    else { this.tone(70, 1.2, 'sawtooth', 0.14 * v, 44, p); this.noise(1.0, 'bandpass', 520, 1.2, 0.18 * v, p, 0.3); }
  }
  // хриплый перегруженный рык: пачка пил через перегруз, высота ползёт вниз
  growl(dest, dur, f0, vol) {
    const c = this.ctx, t = c.currentTime, sh = this.shaper(30), bp = this.filt('bandpass', 380, 0.8), g = this.g(0.0001, dest);
    sh.connect(bp); bp.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lfo = c.createOscillator(); lfo.frequency.value = 9 + Math.random() * 6; const lg = this.g(vol * 0.6, null); lfo.connect(lg); lg.connect(g.gain); lfo.start(t); lfo.stop(t + dur);
    for (const m of [1, 1.03, 1.51, 2.02]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * m * 1.15, t); o.frequency.exponentialRampToValueAtTime(f0 * m * 0.8, t + dur); o.connect(this.g(0.25, sh)); o.start(t); o.stop(t + dur + 0.05); }
  }
  // неразборчивое бормотание «человека»: гласные из фильтров
  mutter(dest, v = 1) {
    const c = this.ctx, t0 = c.currentTime, n = 5 + ((Math.random() * 4) | 0);
    for (let k = 0; k < n; k++) {
      const t = t0 + k * (0.16 + Math.random() * 0.1), d = 0.12 + Math.random() * 0.14;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(105 + Math.random() * 25, t);
      const f1 = this.filt('bandpass', 400 + Math.random() * 500, 6), f2 = this.filt('bandpass', 1100 + Math.random() * 1300, 8), g = this.g(0.0001, dest);
      o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.start(t); o.stop(t + d + 0.05);
    }
  }
  // ---------- инструменты и задания ----------
  scan() { this.tone(900, 0.5, 'sine', 0.12, 1800); this.tone(1800, 0.9, 'sine', 0.05, 900, null, 0.25); this.noise(0.6, 'bandpass', 2500, 6, 0.05, null, 0.01, 0.1); }
  ping(x, z) { const p = this.at(x, 1.2, z, 8); if (!p) return; this.tone(1320, 0.25, 'sine', 0.18, 1320, p); }
  emp() { this.tone(80, 1.2, 'sawtooth', 0.35, 30); this.tone(2400, 0.6, 'square', 0.06, 60); this.noise(0.9, 'highpass', 1800, 0.7, 0.35, null, 0.003); this.noise(1.2, 'lowpass', 300, 1, 0.5, null, 0.003); }
  zap(x, z) { const p = this.at(x, 1.5, z, 3); if (!p) return; for (let k = 0; k < 6; k++) this.noise(0.08, 'bandpass', 3000 + Math.random() * 3000, 3, 0.4, p, 0.002, k * 0.12); }
  chalk() { for (let k = 0; k < 3; k++) this.noise(0.12, 'bandpass', 2800 + k * 400, 3, 0.12, null, 0.01, k * 0.13); }
  crouch(on) { this.noise(0.15, 'lowpass', 600, 1, 0.12); this.tone(on ? 120 : 160, 0.1, 'sine', 0.1, on ? 90 : 200); }
  nv(on) { this.tone(on ? 600 : 900, 0.25, 'sine', 0.08, on ? 1600 : 300); this.noise(0.3, 'highpass', 6000, 1, 0.04); }
  part() { this.tone(660, 0.12, 'triangle', 0.18, 990); this.tone(990, 0.2, 'triangle', 0.14, 1320, null, 0.1); }
  valve(x, z) { const p = this.at(x, 1.2, z, 3); for (let k = 0; k < 4; k++) { this.noise(0.25, 'bandpass', 900 + k * 120, 8, 0.25, p, 0.02, k * 0.28); this.tone(300 + k * 30, 0.25, 'sawtooth', 0.04, 280, p, k * 0.28); } this.noise(1.2, 'bandpass', 400, 1, 0.15, p, 0.3, 1.1); }
  lever(x, z) { const p = this.at(x, 1.2, z, 3); this.tone(140, 0.2, 'square', 0.2, 60, p); this.noise(0.15, 'lowpass', 900, 1, 0.5, p, 0.002, 0.05); this.tone(60, 0.8, 'sawtooth', 0.1, 50, p, 0.2); }
  beep(ok) { if (ok) { this.tone(880, 0.12, 'square', 0.08); this.tone(1320, 0.25, 'square', 0.08, 1320, null, 0.12); } else { this.tone(220, 0.5, 'square', 0.12, 180); } }
  key0() { this.tone(1200, 0.06, 'square', 0.05); }
  alarm(t = 2.4) { for (let k = 0; k < t / 0.6; k++) { this.tone(700, 0.3, 'sawtooth', 0.06, 980, null, k * 0.6); this.tone(980, 0.3, 'sawtooth', 0.06, 700, null, k * 0.6 + 0.3); } }
  ring(x, z) { const p = this.at(x, 1.4, z, 4); if (!p) return; for (let k = 0; k < 8; k++) { this.tone(1050, 0.06, 'square', 0.07, 1050, p, k * 0.1); this.tone(1400, 0.06, 'square', 0.05, 1400, p, k * 0.1 + 0.05); } }
  knock(x, z, n = 3) { const p = this.at(x, 1.3, z, 3); if (!p) return; for (let k = 0; k < n; k++) { this.tone(90, 0.15, 'sine', 0.6, 60, p, k * 0.32); this.noise(0.1, 'lowpass', 700, 1, 0.5, p, 0.002, k * 0.32); } }
  tick(x, z) { const p = this.at(x, 1.8, z, 2); if (!p) return; this.noise(0.03, 'bandpass', 4000, 6, 0.3, p, 0.001); }
  phoneVoice() { this.noise(2.4, 'bandpass', 1200, 4, 0.12, null, 0.2); for (let k = 0; k < 7; k++) this.tone(180 + Math.random() * 60, 0.22, 'sawtooth', 0.04, 150, null, k * 0.3); }
  blinkSnd(x, z) { const p = this.at(x, 1.5, z, 2.5); if (!p) return; this.noise(0.12, 'bandpass', 4200, 2, 0.4, p, 0.002); this.tone(1800, 0.1, 'square', 0.05, 300, p); }
  chat() { this.tone(1046.5, 0.08, 'sine', 0.06); this.tone(1318.5, 0.1, 'sine', 0.05, null, null, 0.08); }
  pluck(f) {
    const c = this.ctx, t = c.currentTime;
    for (const [m, v, ty] of [[1, 0.25, 'sine'], [2, 0.08, 'triangle'], [3.01, 0.03, 'sine']]) {
      const o = c.createOscillator(); o.type = ty; o.frequency.value = f * m;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 / m);
      o.connect(g); g.connect(this.boxG); o.start(t); o.stop(t + 1.7);
    }
  }

  // ---------- одноразовые звуки ----------
  tone(f, dur, type, vol, to, dest, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.bus); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, type, f, q, vol, dest, att = 0.008, delay = 0, sweep = 0, buf = null) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = buf || this.wb;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.max(0.002, att)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || this.bus); s.start(t, Math.random() * 2, dur + 0.1);
  }
  at(x, y, z, ref = 3) {
    if (!this.ctx) return null;
    const p = this.panner(ref); this.pos(p, x, y, z);
    setTimeout(() => { try { p.disconnect(); } catch (e) { /* ignore */ } }, 7000);
    return p;
  }
  step(kind, run) {
    const v = (run ? 1.5 : 1) * 1.9;
    if (kind === 'concrete') { this.noise(0.07, 'bandpass', 1800, 1, 0.12 * v); this.tone(90, 0.06, 'sine', 0.08 * v); }
    else if (kind === 'wet') { this.noise(0.12, 'bandpass', 900, 1.2, 0.12 * v); this.tone(1200, 0.06, 'sine', 0.02 * v, 600); }
    else if (kind === 'water') { this.splash(0.9 * v); }
    else if (kind === 'puddle') { this.splash(0.45 * v); this.noise(0.09, 'lowpass', 420, 0.8, 0.12 * v); }
    else if (kind === 'balls') { for (let k = 0; k < 5; k++) this.noise(0.05, 'bandpass', 2200 + Math.random() * 2400, 3, 0.05 * v, null, 0.003, k * 0.03); this.noise(0.18, 'lowpass', 500, 1, 0.08 * v); }
    else if (kind === 'foam') { this.noise(0.1, 'lowpass', 260, 0.9, 0.22 * v); this.tone(70, 0.08, 'sine', 0.06 * v); }
    else if (kind === 'tile') { this.noise(0.06, 'bandpass', 2600, 1.4, 0.1 * v); this.noise(0.25, 'bandpass', 1800, 4, 0.02 * v, null, 0.01, 0.08); this.tone(140, 0.05, 'sine', 0.05 * v); }
    else { this.noise(0.12, 'lowpass', 380, 0.8, 0.2 * v); this.noise(0.08, 'bandpass', 1400, 2, 0.03 * v); }
  }
  // всплеск: тяжёлый плеск + капли
  splash(v = 1) {
    this.noise(0.34, 'lowpass', 1400, 0.8, 0.32 * v, null, 0.01, 0, 380);
    this.noise(0.26, 'bandpass', 2800, 1.1, 0.12 * v, null, 0.006, 0.03, 1400);
    this.tone(260, 0.16, 'sine', 0.12 * v, 90, null, 0.02);
    for (let k = 0; k < 4; k++) { const f = 1300 + Math.random() * 2200; this.tone(f, 0.07, 'sine', 0.035 * v, f * 0.6, null, 0.08 + k * 0.05 + Math.random() * 0.04); }
  }
  entStep(x, z, sp) {
    const p = this.at(x, 0.3, z, 2.5); if (!p) return;
    const v = sp > 2.5 ? 0.6 : 0.4;
    this.tone(58, 0.25, 'sine', v, 34, p); this.noise(0.22, 'lowpass', 260, 1, v * 0.5, p);
  }
  heart() { this.tone(60, 0.15, 'sine', 0.6, 40); this.tone(55, 0.12, 'sine', 0.4, 38, null, 0.16); }
  breath() { this.noise(0.8, 'bandpass', 900, 0.8, 0.07, null, 0.3); this.noise(0.9, 'bandpass', 700, 0.8, 0.05, null, 0.35, 0.9); }
  pickup() { this.tone(660, 0.25, 'sine', 0.15, 1320); this.tone(990, 0.3, 'sine', 0.06, 1980); }
  battery() { this.tone(420, 0.05, 'square', 0.05); this.tone(840, 0.09, 'square', 0.04, null, null, 0.07); }
  key() { this.tone(1200, 0.08, 'square', 0.06); this.tone(1600, 0.1, 'square', 0.06, null, null, 0.1); this.tone(2000, 0.14, 'sine', 0.06, null, null, 0.2); }
  paper() { this.noise(0.22, 'highpass', 3000, 0.7, 0.12); this.noise(0.18, 'highpass', 2600, 0.7, 0.08, null, 0.01, 0.15); }
  click() { this.noise(0.03, 'highpass', 4000, 0.7, 0.25); this.tone(2200, 0.02, 'square', 0.03); }
  ui() { this.tone(880, 0.05, 'sine', 0.05); }
  locked() { this.tone(140, 0.35, 'square', 0.07); this.tone(120, 0.3, 'square', 0.05, null, null, 0.1); }
  doorOpen() { this.noise(0.9, 'lowpass', 600, 1, 0.25); this.tone(120, 0.8, 'sawtooth', 0.08, 60); this.tone(300, 0.6, 'triangle', 0.03, 900); }
  noclip() { this.noise(1.6, 'bandpass', 200, 1.5, 0.4, null, 0.2, 0, 3200); this.tone(80, 1.6, 'sawtooth', 0.12, 30); }
  // Поимка: всё стихает, затем удар, перегруженный рык, визг, металлический скрежет.
  scream() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + 0.06, out = this.fx;
    this.scareT = 2.2;
    // 1. удар по низам
    this.tone(70, 1.6, 'sine', 1.0, 28, out, 0.06);
    this.noise(0.7, 'lowpass', 900, 0.8, 0.9, out, 0.003, 0.06, 120);
    // 2. рык: пачка пил через перегруз, высота падает, «трепет» 28 Гц
    const sh = this.shaper(60), bp = this.filt('bandpass', 900, 0.7), rg = this.g(0.0001, out);
    sh.connect(bp); bp.connect(rg);
    rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(0.42, t + 0.03); rg.gain.setValueAtTime(0.42, t + 1.1); rg.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    const trem = c.createOscillator(); trem.frequency.value = 28; const tg = this.g(0.5, null); trem.connect(tg); tg.connect(rg.gain); trem.start(t); trem.stop(t + 2);
    for (const f of [96, 101, 143, 151, 202, 289]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.25, t); o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 1.8);
      o.connect(this.g(0.22, sh)); o.start(t); o.stop(t + 2);
    }
    // 3. визг: частотная модуляция
    const car = c.createOscillator(); car.type = 'sawtooth'; car.frequency.setValueAtTime(1900, t); car.frequency.exponentialRampToValueAtTime(700, t + 1.5);
    const mod = c.createOscillator(); mod.frequency.value = 37; const md = this.g(420, null); mod.connect(md); md.connect(car.frequency);
    const sg = this.g(0.0001, out), sf = this.filt('highpass', 600, 0.7); car.connect(sf); sf.connect(sg);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.16, t + 0.05); sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    car.start(t); mod.start(t); car.stop(t + 1.7); mod.stop(t + 1.7);
    // 4. скрежет металла
    this.noise(1.3, 'bandpass', 3200, 12, 0.5, out, 0.01, 0.08, 5600);
    this.noise(1.0, 'bandpass', 2100, 9, 0.3, out, 0.01, 0.2, 1200);
  }
  // Экран смерти: низкий гул, звон в ушах, замедляющееся сердце.
  deathDrone() {
    if (!this.ctx) return;
    const out = this.fx;
    this.tone(41, 7, 'sine', 0.35, 30, out, 0.1);
    this.tone(43.5, 7, 'sine', 0.25, 31, out, 0.1);
    this.tone(4100, 6, 'sine', 0.025, 3900, out, 0.2);
    this.noise(6, 'lowpass', 300, 0.7, 0.12, out, 1.2, 0, 0, this.bb);
    [0.6, 1.7, 3.1, 4.9].forEach((d, k) => { const v = 0.55 - k * 0.1; this.tone(58, 0.16, 'sine', v, 38, out, d); this.tone(52, 0.13, 'sine', v * 0.7, 36, out, d + 0.17); });
  }
  lightsOff() { this.noise(0.06, 'highpass', 3000, 0.7, 0.3); this.tone(100, 0.4, 'square', 0.06, 40); }
  lightsOn() { this.noise(0.05, 'highpass', 3200, 0.7, 0.18); this.noise(0.04, 'highpass', 3000, 0.7, 0.14, null, 0.005, 0.09); this.tone(100, 0.2, 'square', 0.04, null, null, 0.1); }
  buzz() { this.tone(100, 0.14, 'square', 0.035); }
  spark(x, z) { const p = this.at(x, 2.6, z); if (p) { this.noise(0.25, 'highpass', 3500, 0.7, 0.5, p); this.noise(0.1, 'highpass', 5000, 0.7, 0.3, p, 0.005, 0.2); } }
  distantSteps(x, z) { const p = this.at(x, 0.3, z); if (!p) return; for (let k = 0; k < 6; k++) { this.tone(60, 0.22, 'sine', 0.55, 35, p, k * 0.5); this.noise(0.2, 'lowpass', 260, 1, 0.3, p, 0.005, k * 0.5); } }
  slam(x, z) { const p = this.at(x, 1.2, z); if (p) { this.noise(0.8, 'lowpass', 400, 1, 0.9, p); this.tone(70, 0.6, 'sine', 0.8, 40, p); } }
  creak(x, z) { const p = this.at(x, 1.5, z); if (p) { this.tone(170, 1.3, 'sawtooth', 0.06, 240, p); this.tone(340, 1.1, 'triangle', 0.03, 300, p, 0.1); } }
  whisper() { this.noise(1.4, 'bandpass', 2600, 4, 0.06, null, 0.5); this.noise(1.1, 'bandpass', 3300, 5, 0.04, null, 0.4, 0.3); }
  drip(x, z) { const p = this.at(x, 0.5, z, 1.5); if (p) this.tone(1900, 0.12, 'sine', 0.2, 1100, p); }
  wake() { this.tone(70, 2.2, 'sawtooth', 0.1, 40); this.noise(2, 'lowpass', 300, 1, 0.1, null, 0.6); }
  spotted() { this.tone(48, 1.4, 'sawtooth', 0.14, 36); this.noise(0.8, 'bandpass', 2400, 2, 0.08, null, 0.2); }
  stinger() { this.tone(50, 2.2, 'sine', 0.3, 35); this.noise(1.8, 'lowpass', 500, 1, 0.12, null, 0.3); }
  lockerIn() { this.tone(180, 0.12, 'square', 0.06, 120); this.noise(0.25, 'bandpass', 1200, 2, 0.15); this.tone(90, 0.2, 'sine', 0.2, 60, null, 0.12); }
  lockerOut() { this.noise(0.3, 'bandpass', 900, 1.5, 0.14); this.tone(220, 0.15, 'square', 0.05, 160); }
  // вход в новую зону: тихий низкий аккорд
  zone() { for (const [f, d] of [[110, 0], [164.8, 0.08], [220, 0.16]]) this.tone(f, 2.4, 'sine', 0.05, f * 0.995, null, d); this.noise(1.6, 'bandpass', 900, 3, 0.02, null, 0.6); }
  // находка: мерцающий аккорд
  find() { [392, 493.88, 587.33, 783.99].forEach((f, k) => { this.tone(f, 2.2, 'sine', 0.05, f * 1.003, null, k * 0.09); this.tone(f * 2, 1.2, 'triangle', 0.012, null, null, k * 0.09 + 0.02); }); this.noise(1.4, 'highpass', 5000, 0.7, 0.015, null, 0.3); }
  ach() { this.tone(784, 0.18, 'sine', 0.08); this.tone(1046.5, 0.3, 'sine', 0.08, null, null, 0.14); }
  secret() { [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone(f, 1.6, 'sine', 0.07, null, null, k * 0.12)); }
}

export { Sound };
