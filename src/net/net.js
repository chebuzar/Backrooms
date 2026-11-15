// Онлайн: WebRTC через PeerJS (работает на сайте игры, по HTTPS) + голос.
// Для локальной проверки двух вкладок на одном компьютере: адрес с #localnet (BroadcastChannel).

const PREFIX = 'zakulisye-v3-';
const useLocal = () => location.hash.includes('localnet');
// внутри Claude (страница-артефакт) WebRTC и внешние сокеты запрещены — там работает встроенный канал «room»
const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// STUN + TURN (TURN нужен, когда устройства в разных сетях: мобильный интернет, школьный Wi-Fi)
const ICE = { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' }
] };
const err = (type) => { const e = new Error(type); e.type = type; return e; };

// PeerJS грузится отдельным чанком только когда игрок открывает онлайн.
let peerP = null;
function loadPeer() {
  if (!peerP) {
    peerP = import('peerjs').then((m) => m.Peer || m.default).catch((e) => { peerP = null; throw err('noscript'); });
  }
  return peerP;
}

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

class Net {
  // h: { msg(from, data), joined(id), left(id), error(e), audio(needTap) }
  constructor(h) {
    this.h = h; this.isHost = false; this.id = null; this.code = null;
    this.peer = null; this.bc = null; this.conns = new Map();
    this.stream = null; this.calls = new Map(); this.audios = new Map(); this.muted = false;
    this.room = null; this.mode = '';
  }
  get active() { return !!(this.peer || this.bc || this.room); }
  get canVoice() { return this.mode === 'peer' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

  async host(code) {
    this.leave(); this.isHost = true; this.code = code;
    if (useLocal()) { this.mode = 'local'; return this._local(true); }
    if (inClaude()) { this.mode = 'room'; return this._room(true); }
    this.mode = 'peer';
    const Peer = await loadPeer();
    return new Promise((res, rej) => {
      const p = new Peer(PREFIX + code.toLowerCase(), { debug: 0, config: ICE });
      this.peer = p; let ok = false;
      p.on('open', (id) => { this.id = id; ok = true; res(id); });
      p.on('connection', (c) => this._wire(c));
      p.on('call', (call) => this._answer(call));
      p.on('error', (e) => {
        if (!ok) { this.leave(); this.isHost = true; rej(err(e && e.type === 'unavailable-id' ? 'taken' : 'server')); }
        else this.h.error && this.h.error(e);
      });
      p.on('disconnected', () => { setTimeout(() => { try { if (!p.destroyed && p.disconnected) p.reconnect(); } catch (e) { /* ignore */ } }, 1000); });
      setTimeout(() => { if (!ok) { this.leave(); rej(err('server')); } }, 15000);
    });
  }

  async join(code) {
    this.leave(); this.isHost = false; this.code = code;
    if (useLocal()) { this.mode = 'local'; return this._local(false); }
    if (inClaude()) { this.mode = 'room'; return this._room(false); }
    this.mode = 'peer';
    const Peer = await loadPeer();
    return new Promise((res, rej) => {
      const p = new Peer(undefined, { debug: 0, config: ICE });
      this.peer = p; let ok = false, srv = false;
      const fail = (t) => { if (ok) return; ok = true; this.leave(); rej(err(t)); };
      p.on('open', (id) => {
        this.id = id; srv = true;
        const c = p.connect(PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
        c.on('open', () => { if (ok) return; ok = true; this._wire(c); res(id); });
      });
      p.on('call', (call) => this._answer(call));
      p.on('error', (e) => {
        if (!ok) fail(e && e.type === 'peer-unavailable' ? 'notfound' : srv ? 'p2p' : 'server');
        else this.h.error && this.h.error(e);
      });
      // сервер ответил, но прямое соединение так и не открылось — сеть его блокирует
      setTimeout(() => fail(srv ? 'p2p' : 'server'), 20000);
    });
  }

  _wire(c) {
    this.conns.set(c.peer, c);
    c.on('data', (d) => this.h.msg(c.peer, d));
    c.on('close', () => { this.conns.delete(c.peer); this._dropAudio(c.peer); this.h.left(c.peer); });
    c.on('error', () => { /* закрытие придёт отдельно */ });
    this.h.joined(c.peer);
  }

  // --- локальная проверка без сервера
  _local(host) {
    this.id = host ? PREFIX + this.code.toLowerCase() : 'local-' + Math.random().toString(36).slice(2, 9);
    const bc = new BroadcastChannel('zk-' + this.code);
    this.bc = bc;
    const stub = (peer) => ({ peer, open: true, send: (m) => bc.postMessage({ from: this.id, to: peer, m }) });
    bc.onmessage = (ev) => {
      const { from, to, m, hello, bye } = ev.data || {};
      if (bye) { if (this.conns.has(from)) { this.conns.delete(from); this.h.left(from); } return; }
      if (hello && this.isHost && to === this.id && !this.conns.has(from)) {
        this.conns.set(from, stub(from)); bc.postMessage({ from: this.id, to: from, ack: 1 }); this.h.joined(from); return;
      }
      if (ev.data.ack && to === this.id && !this.conns.has(from)) { this.conns.set(from, stub(from)); this.h.joined(from); this._acked && this._acked(); return; }
      if (to === this.id && m !== undefined && this.conns.has(from)) this.h.msg(from, m);
    };
    if (host) return Promise.resolve(this.id);
    return new Promise((res, rej) => {
      const hostId = PREFIX + this.code.toLowerCase();
      this._acked = () => res(this.id);
      let n = 0; const t = setInterval(() => { if (this.conns.size || ++n > 20) { clearInterval(t); if (!this.conns.size) rej(new Error('notfound')); } else bc.postMessage({ from: this.id, to: hostId, hello: 1 }); }, 250);
    });
  }

  // --- канал Claude «room»: состояние игрока лежит в его presence (виден всем в комнате)
  async _room(host) {
    let base = null;
    try { base = await Promise.race([window.claude.use('room'), sleep(10000).then(() => null)]); } catch (e) { base = null; }
    if (!base) throw err('noroom');
    let r = base;
    try { r = await base.join('zk-' + this.code.toLowerCase()); } catch (e) { r = base; }
    this.room = r; this.rq = []; this.rseq = 0; this.rs = null; this.rsseq = 0; this.rseen = new Map();
    const t0 = Date.now();
    while (!r.peers().some((p) => p.sameTab)) { if (Date.now() - t0 > 8000) { this.leave(); throw err('noroom'); } await sleep(150); }
    this.id = r.peers().find((p) => p.sameTab).peer;
    this.rHost = host;
    this._rpush();
    this.rOff = r.onPeers((ch) => {
      for (const p of ch.left) if (this.conns.has(p.peer)) { this.conns.delete(p.peer); this.rseen.delete(p.peer); this.h.left(p.peer); }
      for (const p of ch.joined) if (!p.sameTab) this._rrecv(p);
      for (const p of ch.updated) if (!p.sameTab) this._rrecv(p);
    }, () => { if (this.room === r) { for (const id of [...this.conns.keys()]) this.h.left(id); this.conns.clear(); } });
    for (const p of r.peers()) if (!p.sameTab) this._rrecv(p);
    if (host) return this.id;
    if (this.conns.size) return this.id;
    return new Promise((res, rej) => {
      this._acked = () => { this._acked = null; res(this.id); };
      setTimeout(() => { if (!this.conns.size && this._acked) { this._acked = null; this.leave(); rej(err('notfound')); } }, 12000);
    });
  }
  _rpush() {
    if (!this.room) return;
    let st = { zk: this.code, host: this.rHost ? 1 : 0, q: this.rq, s: this.rs };
    while (JSON.stringify(st).length > 3600 && this.rq.length > 1) { this.rq.shift(); st = { zk: this.code, host: this.rHost ? 1 : 0, q: this.rq, s: this.rs }; }
    this.room.presence(st).catch(() => {});
  }
  _rout(to, m, ex) {
    if (m && (m.t === 'st' || m.t === 'me')) this.rs = [++this.rsseq, to, m];
    else { this.rq.push([++this.rseq, to, m, ex || '']); if (this.rq.length > 14) this.rq.shift(); }
    this._rpush();
  }
  _rrecv(p) {
    const pr = p.presence || {};
    if (pr.zk !== this.code) return;
    let seen = this.rseen.get(p.peer);
    if (!this.conns.has(p.peer)) {
      if (this.isHost ? pr.host : !pr.host) return; // гость слушает только хоста, хост — только гостей
      this.conns.set(p.peer, { peer: p.peer, open: true, send: (m) => this._rout(p.peer, m) });
      const q0 = Array.isArray(pr.q) ? pr.q : [];
      seen = { ev: this.isHost ? -1 : q0.reduce((a, e) => Math.max(a, +e[0] || 0), 0), s: -1 };
      this.rseen.set(p.peer, seen);
      this.h.joined(p.peer);
      this._acked && this._acked();
    }
    const q = Array.isArray(pr.q) ? pr.q : [];
    for (const e of q) {
      if (!Array.isArray(e) || !(+e[0] > seen.ev)) continue;
      seen.ev = +e[0];
      if ((e[1] === '*' && e[3] !== this.id) || e[1] === this.id) this.h.msg(p.peer, e[2]);
    }
    const sv = pr.s;
    if (Array.isArray(sv) && sv[0] !== seen.s) { seen.s = sv[0]; if (sv[1] === '*' || sv[1] === this.id) this.h.msg(p.peer, sv[2]); }
  }

  send(to, msg) {
    if (this.room) { if (this.conns.has(to)) this._rout(to, msg); return; }
    const c = this.conns.get(to); if (c && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }
  broadcast(msg, except) { if (this.room) { if (this.conns.size) this._rout('*', msg, except); return; } for (const [id, c] of this.conns) if (id !== except && c.open) { try { c.send(msg); } catch (e) { /* ignore */ } } }

  // --- голос
  async micOn(ids) {
    if (!this.canVoice || !this.peer) throw new Error('novoice');
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    }
    this.muted = false; this.stream.getAudioTracks().forEach((t) => { t.enabled = true; });
    this.callAll(ids);
  }
  callAll(ids) {
    if (!this.stream || !this.peer) return;
    for (const id of ids) {
      if (id === this.id || this.calls.has(id)) continue;
      try { const call = this.peer.call(id, this.stream); if (call) { this.calls.set(id, call); call.on('close', () => this.calls.delete(id)); call.on('error', () => this.calls.delete(id)); } } catch (e) { /* ignore */ }
    }
  }
  setMuted(m) { this.muted = m; if (this.stream) this.stream.getAudioTracks().forEach((t) => { t.enabled = !m; }); }
  _answer(call) {
    try { call.answer(); } catch (e) { return; }
    call.on('stream', (st) => this._play(call.peer, st));
    call.on('close', () => this._dropAudio(call.peer));
  }
  _play(id, st) {
    let a = this.audios.get(id);
    if (!a) { a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none'; document.body.appendChild(a); this.audios.set(id, a); }
    a.srcObject = st;
    const p = a.play(); if (p && p.catch) p.catch(() => this.h.audio && this.h.audio(true));
  }
  unlockAudio() { for (const a of this.audios.values()) { const p = a.play(); if (p && p.catch) p.catch(() => {}); } }
  _dropAudio(id) { const a = this.audios.get(id); if (a) { a.srcObject = null; a.remove(); this.audios.delete(id); } const c = this.calls.get(id); if (c) { try { c.close(); } catch (e) { /* ignore */ } this.calls.delete(id); } }

  leave() {
    for (const id of [...this.audios.keys()]) this._dropAudio(id);
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.bc) { try { this.bc.postMessage({ from: this.id, bye: 1 }); this.bc.close(); } catch (e) { /* ignore */ } this.bc = null; }
    for (const c of this.conns.values()) { try { c.close && c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* ignore */ } this.peer = null; }
    if (this.room) {
      const r = this.room; this.room = null; this._acked = null;
      try { this.rOff && this.rOff(); } catch (e) { /* ignore */ }
      if (r.leave) r.leave().catch(() => {}); else r.presence({ zk: null, host: null, q: null, s: null }).catch(() => {});
    }
    this.isHost = false; this.id = null;
  }
}

export { inClaude, makeCode, Net };
