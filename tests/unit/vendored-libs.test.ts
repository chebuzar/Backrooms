// Копія Basis-транскодера в public/libs/basis мусить збігатися з тією, що йде з поточною версією three:
// KTX2Loader і транскодер — одна пара; після оновлення three стара копія тихо ламає всі KTX2-текстури.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ours = 'public/libs/basis';
const upstream = 'node_modules/three/examples/jsm/libs/basis';

describe('vendored libs', () => {
  it('public/libs/basis matches three/examples/jsm/libs/basis byte for byte', () => {
    const files = readdirSync(ours);
    expect(files.sort()).toEqual(['basis_transcoder.js', 'basis_transcoder.wasm']);
    for (const f of files) {
      const same = readFileSync(`${ours}/${f}`).equals(readFileSync(`${upstream}/${f}`));
      expect(same, `${f} differs from three's copy — run: cp ${upstream}/* ${ours}/`).toBe(true);
    }
  });
});
