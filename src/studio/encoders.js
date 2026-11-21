// Big Street Studio — les conteneurs vidéo de l'export, écrits ici (aucune bibliothèque, aucun programme externe) :
//   WebM  (VP9 ou VP8, images encodées par WebCodecs)          — webmWriter
//   MP4   (H.264, images encodées par WebCodecs)                — mp4Writer
//   AVI   (Motion JPEG : une image JPEG par trame)             — aviWriter
//   GIF   (animé, une palette optimisée de 256 couleurs par image, tramage facultatif) — gifWriter
// Chaque « writer » écrit par sink.write(position, octets) — la position permet de réécrire les en-têtes à la fin — et rend
// { add(…), finish() }. Ce module ne touche ni au DOM ni au moteur : il se teste seul (tools/selftest.mjs, lu ensuite par ffprobe).
const te = new TextEncoder();
function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
const ascii = s => te.encode(s);
const u8 = v => Uint8Array.of(v & 255);
const u16 = v => Uint8Array.of((v >>> 8) & 255, v & 255);
const u32 = v => Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
const u64 = v => { const hi = Math.floor(v / 4294967296), lo = v >>> 0; return cat([u32(hi), u32(lo)]); };
const le16 = v => Uint8Array.of(v & 255, (v >>> 8) & 255);
const le32 = v => Uint8Array.of(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
/** Un flux d'écriture : position courante, écriture à la suite ou à une position donnée */
function out(sink) { let pos = 0; return { get pos() { return pos; }, put(b) { sink.write(pos, b); pos += b.length; }, at(p, b) { sink.write(p, b); } }; }

// ---------------------------------------------------------------- WebM (Matroska)
const ebmlId = id => { const b = []; for (let x = id; x > 0; x = Math.floor(x / 256)) b.unshift(x & 255); return Uint8Array.from(b); };
function vint(n, len = 0) {
  if (!len) { len = 1; while (n >= 2 ** (7 * len) - 1) len++; }
  const b = new Uint8Array(len); let x = n; for (let i = len - 1; i >= 0; i--) { b[i] = x % 256; x = Math.floor(x / 256); }
  b[0] |= 1 << (8 - len); return b;
}
const el = (id, ...payload) => { const p = cat(payload.flat()); return cat([ebmlId(id), vint(p.length), p]); };
const uintB = (n, w = 0) => { const b = []; let x = n; do { b.unshift(x % 256); x = Math.floor(x / 256); } while (x > 0); while (b.length < w) b.unshift(0); return Uint8Array.from(b); };
const elU = (id, n, w = 0) => el(id, uintB(n, w));
const elS = (id, s) => el(id, ascii(s));
const elF = (id, f) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, f); return el(id, b); };
const E = { EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPos: 0x53AC, Info: 0x1549A966, Tracks: 0x1654AE6B, Cluster: 0x1F43B675, Cues: 0x1C53BB6B };

/** WebM vidéo seule. o : { codec: 'V_VP9' | 'V_VP8', width, height, fps }. add(octets, horodatage µs, clé ?) */
export function webmWriter(sink, o) {
  const w = out(sink);
  w.put(el(E.EBML, elU(0x4286, 1), elU(0x42F7, 1), elU(0x42F2, 4), elU(0x42F3, 8), elS(0x4282, 'webm'), elU(0x4287, 4), elU(0x4285, 2)));
  const segAt = w.pos; w.put(cat([ebmlId(E.Segment), Uint8Array.of(0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)])); const seg0 = w.pos;
  const seekHead = (info, tracks, cues) => el(E.SeekHead, ...[[E.Info, info], [E.Tracks, tracks], [E.Cues, cues]].map(([id, p]) => el(E.Seek, el(E.SeekID, ebmlId(id)), elU(E.SeekPos, p, 8))));
  const seekAt = w.pos; w.put(seekHead(0, 0, 0));
  const info = dur => el(E.Info, elU(0x2AD7B1, 1000000), elS(0x4D80, 'Big Street Studio'), elS(0x5741, 'Big Street Studio'), elF(0x4489, dur));
  const infoAt = w.pos; w.put(info(0));
  const tracksAt = w.pos;
  w.put(el(E.Tracks, el(0xAE, elU(0xD7, 1), elU(0x73C5, 1), elU(0x83, 1), elU(0x9C, 0), elS(0x86, o.codec || 'V_VP9'), elU(0x23E383, Math.round(1e9 / o.fps)),
    el(0xE0, elU(0xB0, o.width), elU(0xBA, o.height))),
    // (piste son facultative — o.audio : { channels, rate, priv (« OpusHead ») } ; ses paquets Opus : addAudio(octets, horodatage µs), tous
    // donnés AVANT les images : ils sont glissés entre elles, à leur instant — anim.js, export.js)
    ...(o.audio ? [el(0xAE, elU(0xD7, 2), elU(0x73C5, 2), elU(0x83, 2), elU(0x9C, 0), elS(0x86, 'A_OPUS'), elU(0x56AA, 6500000), elU(0x56BB, 80000000), el(0x63A2, o.audio.priv), el(0xE1, elF(0xB5, o.audio.rate || 48000), elU(0x9F, o.audio.channels || 2)))] : [])));
  let cl = null, last = 0; const cues = [], aq = []; let ai = 0;
  const drain = before => { for (; ai < aq.length && aq[ai][1] < before; ai++) { const [d, ta] = aq[ai]; if (!cl || ta - cl.t > 30000) { flush(); cl = { t: ta, blocks: [], size: 0 }; } const rel = Math.max(0, ta - cl.t), b = el(0xA3, Uint8Array.of(0x82, (rel >> 8) & 255, rel & 255, 0x80), d); cl.blocks.push(b); cl.size += b.length; last = Math.max(last, ta + 20); } };
  const flush = () => { if (!cl) return; cues.push([cl.t, w.pos - seg0]); w.put(el(E.Cluster, elU(0xE7, cl.t), ...cl.blocks)); cl = null; };
  return {
    add(data, tsUs, key) {
      const t = Math.round(tsUs / 1000); last = Math.max(last, t + 1000 / o.fps);
      if (aq.length) drain(t);
      if (!cl || (key && cl.blocks.length) || t - cl.t > 30000 || cl.size > 16e6) { flush(); cl = { t, blocks: [], size: 0 }; }
      const rel = t - cl.t, b = el(0xA3, Uint8Array.of(0x81, (rel >> 8) & 255, rel & 255, key ? 0x80 : 0), data);
      cl.blocks.push(b); cl.size += b.length;
    },
    addAudio(data, tsUs) { aq.push([data, Math.max(0, Math.round(tsUs / 1000))]); },
    finish() {
      const end = last; drain(end + 1); last = Math.max(end, 0); flush();   // (le son ne dépasse pas la dernière image)
      const cuesAt = w.pos;
      w.put(el(E.Cues, ...cues.map(([t, p]) => el(0xBB, elU(0xB3, t), el(0xB7, elU(0xF7, 1), elU(0xF1, p))))));
      w.at(segAt + 4, cat([Uint8Array.of(0x01), uintB(w.pos - seg0, 7)]));
      w.at(seekAt, seekHead(infoAt - seg0, tracksAt - seg0, cuesAt - seg0));
      w.at(infoAt, info(last));
      return w.pos;
    },
  };
}

// ---------------------------------------------------------------- MP4 (ISO BMFF)
const box = (type, ...p) => { const b = cat(p.flat()); return cat([u32(b.length + 8), ascii(type), b]); };
const full = (type, v, f, ...p) => box(type, u8(v), u8(f >> 16), u16(f & 0xffff), ...p);
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].map(u32);
/**
 * MP4 vidéo seule, H.264 (« avcC » donné par l'encodeur dans decoderConfig.description). o : { width, height, fps }.
 * add(octets AVCC, horodatage µs, clé ?, description ?) ; les métadonnées (moov) sont écrites à la fin.
 */
export function mp4Writer(sink, o) {
  const w = out(sink), TS = 90000, delta = Math.round(TS / o.fps);
  w.put(box('ftyp', ascii('isom'), u32(512), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41')));
  const mdatAt = w.pos; w.put(cat([u32(1), ascii('mdat'), u64(0)]));
  const S = []; let avcC = null;
  return {
    add(data, tsUs, key, description) { if (description && !avcC) avcC = new Uint8Array(description); S.push({ off: w.pos, size: data.length, key: !!key, pts: Math.round(tsUs * TS / 1e6) }); w.put(data); },
    finish() {
      if (!avcC) throw new Error('MP4 : configuration H.264 absente (aucune image encodée ?)');
      w.at(mdatAt + 8, u64(w.pos - mdatAt));
      const n = S.length, durTS = n * delta, durMs = Math.round(n * 1000 / o.fps), now = Math.floor(Date.now() / 1000) + 2082844800;
      // (images B : décalage d'affichage par image — ctts — ; sinon rien)
      const offs = S.map((s, i) => s.pts - i * delta), minOff = Math.min(0, ...offs), shift = -minOff, needCtts = offs.some(x => x !== offs[0]) || offs[0] !== 0;
      const runs = []; for (const x of offs) { const v = x + shift, r = runs[runs.length - 1]; if (r && r[1] === v) r[0]++; else runs.push([1, v]); }
      const keys = S.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
      const avc1 = box('avc1', new Uint8Array(6), u16(1), new Uint8Array(16), u16(o.width), u16(o.height), u32(0x480000), u32(0x480000), u32(0), u16(1),
        cat([u8(17), ascii('Big Street Studio'), new Uint8Array(14)]), u16(0x18), u16(0xffff), box('avcC', avcC), box('pasp', u32(1), u32(1)));
      const stbl = box('stbl',
        full('stsd', 0, 0, u32(1), avc1),
        full('stts', 0, 0, u32(1), u32(n), u32(delta)),
        needCtts ? full('ctts', 0, 0, u32(runs.length), ...runs.map(([c, v]) => cat([u32(c), u32(v)]))) : [],
        keys.length < n ? full('stss', 0, 0, u32(keys.length), ...keys.map(u32)) : [],
        full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
        full('stsz', 0, 0, u32(0), u32(n), ...S.map(s => u32(s.size))),
        full('co64', 0, 0, u32(n), ...S.map(s => u64(s.off))));
      const edts = needCtts ? box('edts', full('elst', 0, 0, u32(1), u32(durMs), u32(shift + offs[0]), u16(1), u16(0))) : [];
      const trak = box('trak',
        full('tkhd', 0, 3, u32(now), u32(now), u32(1), u32(0), u32(durMs), new Uint8Array(8), u16(0), u16(0), u16(0), u16(0), ...MATRIX, u32(o.width * 65536), u32(o.height * 65536)),
        edts,
        box('mdia', full('mdhd', 0, 0, u32(now), u32(now), u32(TS), u32(durTS), u16(0x55C4), u16(0)),
          full('hdlr', 0, 0, u32(0), ascii('vide'), new Uint8Array(12), ascii('Big Street Studio\0')),
          box('minf', full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl)));
      w.put(box('moov', full('mvhd', 0, 0, u32(now), u32(now), u32(1000), u32(durMs), u32(0x10000), u16(0x100), new Uint8Array(10), ...MATRIX, new Uint8Array(24), u32(2)), trak));
      return w.pos;
    },
  };
}

// ---------------------------------------------------------------- AVI (Motion JPEG)
/** AVI 1.0 (lisible partout, 2 Go au plus) : une image JPEG par trame. o : { width, height, fps }. add(octets JPEG) */
export const AVI_MAX = 1.95e9;
export function aviWriter(sink, o) {
  const w = out(sink), us = Math.round(1e6 / o.fps);
  const avih = (frames, maxBps, buf) => cat([ascii('avih'), le32(56), le32(us), le32(maxBps), le32(0), le32(0x10), le32(frames), le32(0), le32(1), le32(buf), le32(o.width), le32(o.height), new Uint8Array(16)]);
  const strh = (frames, buf) => cat([ascii('strh'), le32(56), ascii('vids'), ascii('MJPG'), le32(0), le16(0), le16(0), le32(0), le32(1), le32(o.fps), le32(0), le32(frames), le32(buf), le32(0xffffffff), le32(0), le16(0), le16(0), le16(o.width), le16(o.height)]);
  const strf = cat([ascii('strf'), le32(40), le32(40), le32(o.width), le32(o.height), le16(1), le16(24), ascii('MJPG'), le32(o.width * o.height * 3), le32(0), le32(0), le32(0), le32(0)]);
  const strl = cat([ascii('LIST'), le32(4 + strh(0, 0).length + strf.length), ascii('strl'), strh(0, 0), strf]);
  const hdrlLen = 4 + avih(0, 0, 0).length + strl.length;
  w.put(cat([ascii('RIFF'), le32(0), ascii('AVI '), ascii('LIST'), le32(hdrlLen), ascii('hdrl')]));
  const avihAt = w.pos; w.put(avih(0, 0, 0));
  const strhAt = w.pos + 12; w.put(strl);
  const moviAt = w.pos; w.put(cat([ascii('LIST'), le32(0), ascii('movi')]));
  const idx = []; let maxSize = 0;
  return {
    get size() { return w.pos; },
    add(jpeg) {
      if (w.pos + jpeg.length + 16 * (idx.length + 2) > AVI_MAX) throw new Error('AVI limité à 2 Go : raccourcis la séquence, baisse la qualité, ou choisis MP4.');
      idx.push([w.pos - (moviAt + 8), jpeg.length]); maxSize = Math.max(maxSize, jpeg.length);
      w.put(cat([ascii('00dc'), le32(jpeg.length), jpeg, jpeg.length & 1 ? new Uint8Array(1) : new Uint8Array(0)]));
    },
    finish() {
      const moviEnd = w.pos;
      w.put(cat([ascii('idx1'), le32(idx.length * 16), ...idx.map(([off, len]) => cat([ascii('00dc'), le32(0x10), le32(off), le32(len)]))]));
      const n = idx.length, buf = maxSize + 8;
      w.at(4, le32(w.pos - 8)); w.at(moviAt + 4, le32(moviEnd - moviAt - 8));
      w.at(avihAt, avih(n, Math.round(maxSize * o.fps), buf)); w.at(strhAt, strh(n, buf));
      return w.pos;
    },
  };
}

// ---------------------------------------------------------------- GIF
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.47) * 22);
/**
 * Palette d'une image : coupe médiane sur un histogramme 5 bits par composante (32 768 cases), au plus n couleurs.
 * Rend { pal: Uint8Array(3 × n), map(r, g, b) → indice } (la couleur la plus proche, mise en cache par case).
 */
export function quantize(rgba, n = 256) {
  const H = new Uint32Array(32768), SR = new Float64Array(32768), SG = new Float64Array(32768), SB = new Float64Array(32768);
  for (let i = 0; i < rgba.length; i += 4) { const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], k = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3; H[k]++; SR[k] += r; SG[k] += g; SB[k] += b; }
  const bins = []; for (let k = 0; k < 32768; k++) if (H[k]) bins.push(k);
  const comp = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  const mk = list => { let lo = [31, 31, 31], hi = [0, 0, 0], cnt = 0; for (const k of list) { cnt += H[k]; for (let c = 0; c < 3; c++) { const v = comp(k, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } } const r = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], c = r[1] >= r[0] && r[1] >= r[2] ? 1 : r[0] >= r[2] ? 0 : 2; return { list, cnt, c, span: r[c], score: cnt * (r[c] + 1) }; };
  const boxes = [mk(bins)];
  while (boxes.length < n) {
    let bi = -1, best = 0; for (let i = 0; i < boxes.length; i++) if (boxes[i].span > 0 && boxes[i].score > best) { best = boxes[i].score; bi = i; }
    if (bi < 0) break;
    const B = boxes[bi]; B.list.sort((a, b) => comp(a, B.c) - comp(b, B.c));
    let half = B.cnt / 2, j = 0; for (let acc = 0; j < B.list.length - 1; j++) { acc += H[B.list[j]]; if (acc >= half) break; }
    j = Math.min(j, B.list.length - 2);   // (jamais de boîte vide)
    boxes.splice(bi, 1, mk(B.list.slice(0, j + 1)), mk(B.list.slice(j + 1)));
  }
  const pal = new Uint8Array(n * 3), lut = new Int16Array(32768).fill(-1);
  boxes.forEach((B, i) => { let r = 0, g = 0, b = 0, c = 0; for (const k of B.list) { r += SR[k]; g += SG[k]; b += SB[k]; c += H[k]; lut[k] = i; } pal[i * 3] = Math.round(r / c); pal[i * 3 + 1] = Math.round(g / c); pal[i * 3 + 2] = Math.round(b / c); });
  const m = boxes.length;
  const map = (r, g, b) => {
    const k = (r >> 3) << 10 | (g >> 3) << 5 | b >> 3; let v = lut[k]; if (v >= 0) return v;
    let bd = Infinity; for (let i = 0; i < m; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b, d = dr * dr * 3 + dg * dg * 4 + db * db * 2; if (d < bd) { bd = d; v = i; } }
    lut[k] = v; return v;
  };
  return { pal, map, size: m };
}
/** Compression LZW d'une image indexée (8 bits), découpée en sous-blocs de 255 octets */
export function lzw(idx, minBits = 8) {
  const clear = 1 << minBits, eoi = clear + 1, outB = [minBits], blk = []; let cur = 0, nb = 0, bits = minBits + 1, next = eoi + 1;
  const emit = code => { cur |= code << nb; nb += bits; while (nb >= 8) { blk.push(cur & 255); cur >>>= 8; nb -= 8; if (blk.length === 255) { outB.push(255, ...blk); blk.length = 0; } } };
  let dict = new Map(); emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = prefix << 8 | k, c = dict.get(key);
    if (c !== undefined) { prefix = c; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << bits) && bits < 12) bits++; }
    else { emit(clear); dict = new Map(); bits = minBits + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (nb > 0) { blk.push(cur & 255); if (blk.length === 255) { outB.push(255, ...blk); blk.length = 0; } }
  if (blk.length) outB.push(blk.length, ...blk);
  outB.push(0);
  return Uint8Array.from(outB);
}
/** GIF animé, en boucle. o : { width, height, fps, colors (2–256), dither }. add(pixels RGBA de la taille donnée) */
export function gifWriter(sink, o) {
  const w = out(sink), n = Math.max(2, Math.min(256, o.colors | 0 || 256)), bitsN = Math.max(1, Math.ceil(Math.log2(n))), palN = 1 << bitsN;
  w.put(cat([ascii('GIF89a'), le16(o.width), le16(o.height), Uint8Array.of(0, 0, 0), Uint8Array.of(0x21, 0xFF, 0x0B), ascii('NETSCAPE2.0'), Uint8Array.of(3, 1, 0, 0, 0)]));
  let frame = 0, cs = 0; const idx = new Uint8Array(o.width * o.height);
  return {
    add(rgba) {
      const Q = quantize(rgba, n), W = o.width;
      if (o.dither) for (let i = 0, p = 0; p < idx.length; p++, i += 4) { const d = BAYER[((p / W | 0) & 3) * 4 + (p % W & 3)]; idx[p] = Q.map(clamp8(rgba[i] + d), clamp8(rgba[i + 1] + d), clamp8(rgba[i + 2] + d)); }
      else for (let i = 0, p = 0; p < idx.length; p++, i += 4) idx[p] = Q.map(rgba[i], rgba[i + 1], rgba[i + 2]);
      // (délai en centièmes de seconde, arrondi sans dériver : l'image k finit à (k + 1) × 100 / fps)
      frame++; const end = Math.round(frame * 100 / o.fps), delay = Math.max(2, end - cs); cs += delay;
      const pal = new Uint8Array(palN * 3); pal.set(Q.pal.subarray(0, Math.min(Q.pal.length, palN * 3)));
      w.put(cat([Uint8Array.of(0x21, 0xF9, 4, 0x04), le16(delay), Uint8Array.of(0, 0), Uint8Array.of(0x2C), le16(0), le16(0), le16(o.width), le16(o.height), u8(0x80 | (bitsN - 1)), pal, lzw(idx, Math.max(2, bitsN))]));
    },
    finish() { w.put(Uint8Array.of(0x3B)); return w.pos; },
  };
}
const clamp8 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// ---------------------------------------------------------------- Formats proposés
// (débit de référence en Mb/s pour du 1080p à 30 images/s, par niveau de qualité ; ajusté selon la résolution et la cadence)
export const QUALITY = [['basse', 'Basse', 3], ['moyenne', 'Moyenne', 6], ['haute', 'Haute', 12], ['tres_haute', 'Très haute', 24], ['max', 'Maximale', 45]];
export const RESOLUTIONS = { '360p': [640, 360], '480p': [854, 480], '720p': [1280, 720], '1080p': [1920, 1080], '1440p': [2560, 1440], '4k': [3840, 2160] };
export const FORMATS = {
  webm: { name: 'WebM', note: 'VP9 — léger, lu par les navigateurs, VLC, Discord, YouTube', res: ['720p', '1080p', '1440p', '4k'], fps: [24, 30, 60] },
  mp4: { name: 'MP4', note: 'H.264 — le plus compatible (Windows, téléphones, montage, réseaux sociaux)', res: ['720p', '1080p', '1440p', '4k'], fps: [24, 30, 60] },
  avi: { name: 'AVI', note: 'Motion JPEG — chaque image indépendante (montage image par image), fichiers lourds, 2 Go au plus', res: ['720p', '1080p', '1440p', '4k'], fps: [24, 30, 60] },
  gif: { name: 'GIF', note: 'Animé, en boucle — 256 couleurs, pour de courts extraits', res: ['360p', '480p', '720p'], fps: [10, 15, 20, 25] },
};
/** Débit visé (bits/s) pour un niveau de qualité, une taille et une cadence */
export function bitrateFor(q, width, height, fps) {
  const base = (QUALITY.find(x => x[0] === q) || QUALITY[2])[2] * 1e6;
  return Math.round(base * (width * height) / (1920 * 1080) * Math.pow(fps / 30, 0.75));
}
/** Qualité JPEG (AVI) pour un niveau */
export const jpegQuality = q => ({ basse: 0.6, moyenne: 0.75, haute: 0.85, tres_haute: 0.92, max: 0.97 })[q] ?? 0.85;
/** Taille estimée du fichier, en octets : { format, quality, width, height, fps, frames, bitrate } */
export function estimateSize(o) {
  const secs = o.frames / o.fps;
  if (o.format === 'webm' || o.format === 'mp4') return (o.bitrate || bitrateFor(o.quality, o.width, o.height, o.fps)) * secs / 8 * 0.9 + 4096;
  if (o.format === 'avi') return o.width * o.height * (0.12 + jpegQuality(o.quality) ** 6 * 0.55) * o.frames + 16 * o.frames + 4096;
  return o.width * o.height * 0.55 * o.frames + 768 * o.frames;
}
/** Niveau H.264 suffisant pour une taille et une cadence (macroblocs/s et par image) → « avc1.PPCCLL » */
export function avcCodec(width, height, fps, profile = '6400') {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16), rate = mbs * fps;
  const L = [[0x1F, 108000, 3600], [0x28, 245760, 8192], [0x2A, 522240, 8704], [0x32, 589824, 22080], [0x33, 983040, 36864], [0x34, 2073600, 36864]].find(([, r, f]) => rate <= r && mbs <= f) || [0x34];
  return `avc1.${profile}${L[0].toString(16).padStart(2, '0')}`;
}
