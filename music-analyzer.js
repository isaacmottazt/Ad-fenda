/* Fenda Music — análise musical local para o painel admin.
 * Não envia o áudio para terceiros: os recursos são calculados no navegador
 * e apenas os metadados finais são persistidos no Supabase.
 */
(function () {
  'use strict';

  const STYLE_CATALOG = [
    'Gospel', 'Adoração', 'Louvor', 'Contemporâneo', 'Rock Cristão',
    'MPB', 'Pop', 'Pop Rock', 'Rock', 'Indie', 'R&B', 'Soul', 'Funk',
    'Samba', 'Pagode', 'Sertanejo', 'Forró', 'Reggae', 'Jazz', 'Blues',
    'Eletrônica', 'Hip-Hop', 'Trap', 'Lo-fi', 'Instrumental', 'Acústico',
    'Clássico', 'Coral', 'Ambient', 'Dance'
  ];

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const round = (value, digits = 2) => Number(Number(value || 0).toFixed(digits));

  function normalizeAudioSamples(buffer, maxSeconds = 180) {
    const sourceRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const total = Math.min(buffer.length, Math.floor(maxSeconds * sourceRate));
    const mono = new Float32Array(total);
    for (let c = 0; c < channels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < total; i++) mono[i] += channel[i] / channels;
    }
    return { mono, sampleRate: sourceRate, duration: buffer.duration };
  }

  function extractEnvelope(mono, sampleRate, pointsPerSecond = 50) {
    const block = Math.max(1, Math.floor(sampleRate / pointsPerSecond));
    const envelope = [];
    for (let start = 0; start < mono.length; start += block) {
      const end = Math.min(mono.length, start + block);
      let sum = 0;
      for (let i = start; i < end; i++) sum += Math.abs(mono[i]);
      envelope.push(sum / Math.max(1, end - start));
    }
    const peak = Math.max(...envelope, 0.0001);
    return envelope.map(v => v / peak);
  }

  function estimateTempo(envelope, pointsPerSecond = 50) {
    if (envelope.length < pointsPerSecond * 3) return { bpm: null, periodicity: 0 };
    const minLag = Math.max(1, Math.floor(pointsPerSecond * 60 / 180));
    const maxLag = Math.min(envelope.length - 2, Math.ceil(pointsPerSecond * 60 / 55));
    const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0;
      let normA = 0;
      let normB = 0;
      for (let i = lag; i < envelope.length; i++) {
        const a = envelope[i] - mean;
        const b = envelope[i - lag] - mean;
        score += a * b;
        normA += a * a;
        normB += b * b;
      }
      const normalized = score / Math.sqrt((normA * normB) || 1);
      if (normalized > bestScore) { bestScore = normalized; bestLag = lag; }
    }
    let bpm = bestLag ? (60 * pointsPerSecond / bestLag) : null;
    // Resolve metade/dobro de tempo para manter o resultado musicalmente útil.
    if (bpm && bpm < 72) bpm *= 2;
    if (bpm && bpm > 168) bpm /= 2;
    return { bpm: bpm ? round(bpm, 1) : null, periodicity: clamp((bestScore + 1) / 2) };
  }

  function calculateFeatures(mono, sampleRate, envelope, tempo) {
    let sumSquares = 0;
    let zeroCrossings = 0;
    let variation = 0;
    let previous = mono[0] || 0;
    const stride = Math.max(1, Math.floor(sampleRate / 4000));
    for (let i = 0; i < mono.length; i += stride) {
      const value = mono[i] || 0;
      sumSquares += value * value;
      if ((value >= 0) !== (previous >= 0)) zeroCrossings++;
      if (i > 0) variation += Math.abs(value - previous);
      previous = value;
    }
    const count = Math.max(1, Math.ceil(mono.length / stride));
    const rms = Math.sqrt(sumSquares / count);
    const zcr = zeroCrossings / count;
    const dynamic = variation / count;
    const energy = clamp(rms * 3.4);
    const brightness = clamp(zcr * 7.5 + dynamic * 2.2);
    const danceability = clamp(tempo.periodicity * 0.55 + energy * 0.25 + (tempo.bpm >= 88 && tempo.bpm <= 138 ? 0.2 : 0));
    const rhythmProfile = tempo.bpm == null
      ? 'indefinido'
      : tempo.bpm < 72 ? 'lento'
      : tempo.bpm < 96 ? 'moderado-lento'
      : tempo.bpm < 120 ? 'moderado'
      : tempo.bpm < 145 ? 'acelerado' : 'rápido';
    return {
      energy: round(energy, 4),
      danceability: round(danceability, 4),
      brightness: round(brightness, 4),
      rhythmProfile,
      bpm: tempo.bpm,
      periodicity: round(tempo.periodicity, 4),
      analyzedSeconds: round(mono.length / sampleRate, 1),
    };
  }

  const CONTEXT_RULES = [
    { terms: ['adoração', 'adoracao', 'worship', 'louvor', 'louvores', 'hino', 'hinos', 'salmo', 'salmos', 'deus', 'jesus', 'cristo', 'oração', 'oracao', 'espírito', 'espirito'], tags: ['Adoração', 'Gospel'], weight: 5 },
    { terms: ['acústico', 'acustico', 'acoustic', 'unplugged', 'voz e violão', 'voz e violao'], tags: ['Acústico'], weight: 4 },
    { terms: ['ao vivo', 'ao-vivo', 'live', 'arena', 'session'], tags: ['Ao Vivo'], weight: 3 },
    { terms: ['remix', 'club mix', 'extended mix', 'edit'], tags: ['Eletrônica', 'Dance'], weight: 4 },
    { terms: ['piano', 'violão', 'violao', 'guitarra', 'strings', 'instrumental'], tags: ['Instrumental'], weight: 3 },
    { terms: ['rap', 'hip hop', 'hip-hop', 'trap', 'mc ', 'freestyle'], tags: ['Hip-Hop', 'Trap'], weight: 5 },
    { terms: ['funk', 'baile', 'mandelão', 'mandelao'], tags: ['Funk'], weight: 5 },
    { terms: ['samba', 'pagode', 'partido alto'], tags: ['Samba', 'Pagode'], weight: 5 },
    { terms: ['sertanejo', 'modão', 'modao', 'sofrência', 'sofrencia'], tags: ['Sertanejo'], weight: 5 },
    { terms: ['forró', 'forro', 'xote', 'baião', 'baiao'], tags: ['Forró'], weight: 5 },
    { terms: ['jazz', 'blues', 'soul', 'r&b', 'rnb'], tags: ['Jazz', 'Soul'], weight: 4 },
    { terms: ['ministério', 'ministerio', 'igreja', 'coral', 'quarteto'], tags: ['Gospel', 'Coral'], weight: 4 },
    { terms: ['dj ', 'dj-', 'electro', 'techno', 'house', 'beat'], tags: ['Eletrônica', 'Dance'], weight: 4 },
  ];

  const normalizeText = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function suggestStyles(features, metadata = {}) {
    const context = typeof metadata === 'string' ? { genre: metadata } : (metadata || {});
    const title = String(context.title || '').trim();
    const artist = String(context.artist || '').trim();
    const genre = String(context.genre || '').trim();
    const titleText = normalizeText(title);
    const artistText = normalizeText(artist);
    const fullText = normalizeText(`${title} ${artist} ${genre}`);
    const scores = new Map();
    const evidence = [];
    const add = (tag, score, reason) => {
      if (!tag) return;
      scores.set(tag, (scores.get(tag) || 0) + score);
      if (reason && !evidence.includes(reason)) evidence.push(reason);
    };

    // O gênero informado continua tendo prioridade, mas não domina sozinho a decisão.
    if (genre) add(genre, 6, `gênero informado: ${genre}`);

    for (const rule of CONTEXT_RULES) {
      const matchedInTitle = rule.terms.some(term => titleText.includes(normalizeText(term)));
      const matchedInArtist = rule.terms.some(term => artistText.includes(normalizeText(term)));
      const matchedInAny = rule.terms.some(term => fullText.includes(normalizeText(term)));
      if (!matchedInAny) continue;
      const multiplier = matchedInTitle ? 1.35 : matchedInArtist ? 1.2 : 1;
      rule.tags.forEach(tag => add(tag, rule.weight * multiplier, matchedInTitle ? `título: ${title}` : matchedInArtist ? `artista: ${artist}` : 'metadados da faixa'));
    }

    const bpm = features.bpm || 0;
    const energy = features.energy;
    const dance = features.danceability;
    const bright = features.brightness;
    if (energy < 0.35 && bpm < 90) {
      add('Adoração', 2.5, 'áudio calmo e lento'); add('Acústico', 1.5); add('Ambient', 1.5);
    } else if (energy > 0.68 && bpm >= 118) {
      add('Pop', 2.5, 'áudio energético e acelerado'); add(dance > 0.62 ? 'Dance' : 'Rock', 2);
    } else if (bpm >= 95 && bpm <= 125 && bright < 0.48) {
      add('MPB', 2, 'faixa moderada com baixa intensidade aguda'); add('Soul', 1.8);
    } else if (bpm >= 70 && bpm < 105 && energy >= 0.42) {
      add('Contemporâneo', 2, 'faixa moderada com energia média'); add('R&B', 1.5);
    } else {
      add('Contemporâneo', 1.5); add(dance > 0.55 ? 'Pop' : 'Instrumental', 1.2);
    }

    const styleTags = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .filter(tag => STYLE_CATALOG.includes(tag) || tag === 'Ao Vivo')
      .slice(0, 5);
    return { styleTags, contextEvidence: evidence.slice(0, 3) };
  }

  async function analyzeAudioFile(file, metadata = {}) {
    if (!file) throw new Error('Arquivo de áudio não informado.');
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Este navegador não oferece análise de áudio.');
    const context = new AudioContextClass();
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await context.decodeAudioData(arrayBuffer);
      const { mono, sampleRate, duration } = normalizeAudioSamples(decoded);
      const envelope = extractEnvelope(mono, sampleRate);
      const tempo = estimateTempo(envelope);
      const features = calculateFeatures(mono, sampleRate, envelope, tempo);
      const suggestion = suggestStyles(features, metadata);
      const styleTags = suggestion.styleTags;
      const confidence = clamp(0.3 + features.periodicity * 0.3 + (features.bpm ? 0.18 : 0) + (metadata.genre ? 0.08 : 0) + (suggestion.contextEvidence.length ? 0.12 : 0));
      return {
        duration: round(duration, 1),
        ...features,
        style: styleTags[0] || 'Contemporâneo',
        styleTags,
        contextEvidence: suggestion.contextEvidence,
        confidence: round(confidence, 4),
        source: 'browser-acoustic-v1',
        version: '1.0.0',
        analyzedAt: new Date().toISOString(),
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  window.FendaMusicAnalyzer = {
    styles: STYLE_CATALOG.slice(),
    analyzeAudioFile,
    suggestStyles,
  };
})();
