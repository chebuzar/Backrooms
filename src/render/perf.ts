// Лічильник плавності: час кожного кадру, «ривки» (рідкі довгі кадри) і їхня причина.
// Гравець відчуває саме ривки, а не середній FPS: 59 кадрів по 16 мс і один на 120 мс — це «смикається».
// Причину вгадуємо за тим, що three.js створив за цей кадр: нові шейдери (компіляція), буфери геометрії, текстури.
import type * as THREE from 'three/webgpu';

/** Внутрішні лічильники three.js r187 (у типах їх немає): кеш конвеєрів і зібраних шейдерів. */
interface Internals {
  _pipelines?: { caches?: Map<string, unknown> };
  _nodes?: { nodeBuilderCache?: Map<string, unknown>; _createNodeBuilder?: (ro: RenderObjectLike, m: unknown) => unknown };
}
interface RenderObjectLike { object?: { name?: string; type?: string; parent?: { name?: string } | null }; material?: { name?: string; type?: string }; lightsNode?: { getLights?: () => { type: string; id: number; castShadow: boolean }[] } }

export interface Hitch {
  /** Секунда гри від початку заміру. */
  t: number;
  ms: number;
  /** Скільки з цього часу гра рахувала сам кадр (логіка + команди рендера). Мало — отже, час пішов деінде: GPU, збирач сміття, інша вкладка. */
  cpu: number;
  /** Нових конвеєрів (шейдерів), зібраних нод-програм, геометрій, текстур за цей кадр. */
  pipelines: number;
  builds: number;
  geometries: number;
  textures: number;
  /** Для чого збирались шейдери (об'єкт/матеріал) — щоб знати, що додати в прогрів. */
  what: string[];
  /** Що гра відмітила незадовго перед ривком (вхід на рівень, поява мисливця…). */
  tag: string;
}

export interface PerfStats {
  frames: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Кадрів, довших за 2 оновлення екрана й за 2.5 звичайних: око бачить їх як ривок. */
  hitches: number;
  hitchesPerMin: number;
  /** Ривки з новими шейдерами — їх прибирає «прогрів». */
  compileHitches: number;
  worst: Hitch[];
}

const N = 1200;

export class FrameProbe {
  private readonly times = new Float32Array(N);
  private n = 0;
  private head = 0;
  private seconds = 0;
  private list: Hitch[] = [];
  private prev = { pipelines: 0, builds: 0, geometries: 0, textures: 0 };
  private tag = '';
  private tagT = -1;
  /** Медіана останніх кадрів (оновлюється раз на 30 кадрів): ривок — це кадр, помітно довший за звичайний. */
  private med = 0;

  private built: string[] = [];
  /** ?perflights: дописувати набір джерел світла до кожної збірки (діагностика зайвих перебудов). */
  lightsLog = typeof location !== 'undefined' && location.search.includes('perflights');

  constructor(private readonly renderer: THREE.WebGPURenderer) {
    this.prev = this.counters();
    // хто саме змусив three.js збирати шейдер (дешево: виклик буває лише при новому шейдері)
    const nodes = (renderer as unknown as Internals)._nodes;
    const orig = nodes?._createNodeBuilder;
    if (nodes && orig) {
      nodes._createNodeBuilder = (ro: RenderObjectLike, m: unknown) => {
        if (this.built.length < 64) {
          const o = ro.object, mat = ro.material;
          // ім'я об'єкта або найближчого названого предка (у моделях із glTF меші часто безіменні)
          let n: { name?: string; type?: string; parent?: unknown } | null | undefined = o, label = '';
          for (let k = 0; k < 5 && n && !label; k++) { label = n.name ?? ''; n = n.parent as typeof n; }
          this.built.push(`${label || o?.type || '?'}/${mat?.name || mat?.type || '?'}`);
          if (this.lightsLog) this.built.push('lights:' + (ro.lightsNode?.getLights?.() ?? []).map((l) => `${l.type}${l.id}${l.castShadow ? 's' : ''}`).join(','));
        }
        return orig.call(nodes, ro, m);
      };
    }
  }

  private counters(): { pipelines: number; builds: number; geometries: number; textures: number } {
    const r = this.renderer as unknown as Internals;
    const m = this.renderer.info.memory;
    return { pipelines: r._pipelines?.caches?.size ?? 0, builds: r._nodes?.nodeBuilderCache?.size ?? 0, geometries: m.geometries, textures: m.textures };
  }

  /** Подія гри, яку варто бачити поруч із ривком. */
  mark(tag: string): void { this.tag = tag; this.tagT = this.seconds; }

  /** Скинути заміри (наприклад, після завантаження рівня — його кадри не рахуються). */
  reset(): void { this.built = []; this.med = 0; this.n = 0; this.head = 0; this.seconds = 0; this.list = []; this.prev = this.counters(); this.tag = ''; }

  /** Медіана останніх `count` кадрів — стійка до поодиноких ривків (для вибору якості). */
  median(count = 120): number {
    const k = Math.min(count, this.n);
    if (!k) return 0;
    const a: number[] = [];
    for (let i = 0; i < k; i++) a.push(this.times[(this.head - 1 - i + N) % N] as number);
    a.sort((x, y) => x - y);
    return a[k >> 1] as number;
  }

  /** Записати кадр (викликати після рендера); refreshMs — тривалість одного оновлення екрана. */
  record(ms: number, refreshMs = 1000 / 60, cpuMs = 0): void {
    this.times[this.head] = ms;
    this.head = (this.head + 1) % N;
    this.n = Math.min(N, this.n + 1);
    this.seconds += ms / 1000;
    const c = this.counters(), p = this.prev;
    this.prev = c;
    const built = this.built;
    this.built = [];
    if (this.n < 30 || this.n % 30 === 0) this.med = this.median(90);
    // ривок: довший за 2 оновлення екрана й за 2.5 звичайних кадри (на повільному пристрої «звичайний» теж довгий)
    if (ms > Math.max(refreshMs * 2.1, 34, this.med * 2.5)) {
      this.list.push({
        t: +this.seconds.toFixed(2), ms: +ms.toFixed(1), cpu: +cpuMs.toFixed(1),
        pipelines: c.pipelines - p.pipelines, builds: c.builds - p.builds, geometries: c.geometries - p.geometries, textures: c.textures - p.textures,
        what: [...new Set(built)].slice(0, 8),
        tag: this.seconds - this.tagT < 1.5 ? this.tag : ''
      });
      if (this.list.length > 400) this.list.shift();
    }
  }

  stats(): PerfStats {
    const a = Array.from(this.times.subarray(0, this.n)).sort((x, y) => x - y), n = a.length;
    const q = (k: number) => +(a[Math.min(n - 1, Math.floor(k * n))] ?? 0).toFixed(1);
    const mean = a.reduce((s, v) => s + v, 0) / Math.max(1, n);
    return {
      frames: n, fps: +(1000 / Math.max(1e-3, mean)).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +(a[n - 1] ?? 0).toFixed(1),
      hitches: this.list.length, hitchesPerMin: +(this.list.length / Math.max(1 / 60, this.seconds / 60)).toFixed(1),
      compileHitches: this.list.filter((h) => h.pipelines > 0 || h.builds > 0).length,
      worst: [...this.list].sort((x, y) => y.ms - x.ms).slice(0, 12)
    };
  }
}
