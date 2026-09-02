import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import decodeAudio from "npm:audio-decode@3.12.0";

type Job = {
  job_id: number;
  music_id: number;
  title: string | null;
  artist: string | null;
  src: string | null;
  genre: string | null;
  style: string | null;
  style_tags: string[] | null;
  tempo_bpm: number | null;
  rhythm_profile: string | null;
};

type OnlineResult = {
  genres: string[];
  source: string | null;
};

const MAX_JOBS_PER_RUN = 1;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_ANALYSIS_SECONDS = 30;

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function secrets are missing.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function normalize(value: unknown): string {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function searchOnline(title: string, artist: string, genre: string): Promise<OnlineResult> {
  const query = [title, artist].filter(Boolean).join(" ").trim();
  if (!query) return { genres: unique([genre]), source: null };
  const encoded = encodeURIComponent(query);
  const [itunes, deezer] = await Promise.allSettled([
    fetchJson(`https://itunes.apple.com/search?term=${encoded}&entity=song&limit=6`),
    fetchJson(`https://api.deezer.com/search/track?q=${encoded}&limit=6`),
  ]);
  const candidates: Array<{ title: string; artist: string; genre: string; source: string }> = [];
  if (itunes.status === "fulfilled") {
    for (const item of itunes.value?.results || []) candidates.push({
      title: clean(item.trackName), artist: clean(item.artistName), genre: clean(item.primaryGenreName), source: "iTunes",
    });
  }
  if (deezer.status === "fulfilled") {
    for (const item of deezer.value?.data || []) candidates.push({
      title: clean(item.title), artist: clean(item.artist?.name), genre: clean(item.genre?.name), source: "Deezer",
    });
  }
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  const ranked = candidates.map(item => {
    const itemTitle = normalize(item.title);
    const itemArtist = normalize(item.artist);
    const titleHit = wantedTitle && itemTitle && (itemTitle === wantedTitle || itemTitle.includes(wantedTitle) || wantedTitle.includes(itemTitle));
    const artistHit = wantedArtist && itemArtist && (itemArtist === wantedArtist || itemArtist.includes(wantedArtist) || wantedArtist.includes(itemArtist));
    return { item, score: (titleHit ? 2 : 0) + (artistHit ? 2 : 0) + (item.genre ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.item;
  return { genres: unique([genre, best?.genre]), source: best?.source || null };
}

function toMonoSamples(audioBuffer: any): { samples: Float32Array; sampleRate: number } {
  const channelData = Array.isArray(audioBuffer?.channelData)
    ? audioBuffer.channelData
    : (typeof audioBuffer?.getChannelData === "function"
      ? Array.from({ length: Number(audioBuffer.numberOfChannels || 1) }, (_, index) => audioBuffer.getChannelData(index))
      : []);
  const channels = Math.max(1, channelData.length);
  const sampleRate = Number(audioBuffer?.sampleRate || 44100);
  const sourceLength = Number(channelData[0]?.length || 0);
  const length = Math.min(sourceLength, Math.floor(sampleRate * MAX_ANALYSIS_SECONDS));
  if (!length) throw new Error("O decodificador não retornou amostras PCM.");
  const samples = new Float32Array(length);
  for (let channel = 0; channel < channels; channel++) {
    const data = channelData[channel] || channelData[0];
    for (let i = 0; i < length; i++) samples[i] += (data[i] || 0) / channels;
  }
  return { samples, sampleRate };
}

function analyzeRhythm(audioBuffer: any) {
  const { samples, sampleRate } = toMonoSamples(audioBuffer);
  if (samples.length < sampleRate * 4) throw new Error("Áudio curto demais para estimar o ritmo.");
  const windowSize = 1024;
  const hop = 512;
  const envelope: number[] = [];
  let previous = 0;
  for (let start = 0; start + windowSize <= samples.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + windowSize; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / windowSize);
    envelope.push(Math.max(0, rms - previous));
    previous = rms;
  }
  const frameRate = sampleRate / hop;
  let bestBpm = 0;
  let bestScore = -Infinity;
  for (let bpm = 60; bpm <= 180; bpm++) {
    const lag = Math.max(1, Math.round((60 * frameRate) / bpm));
    let score = 0;
    let count = 0;
    for (let i = lag; i < envelope.length; i++) {
      score += envelope[i] * envelope[i - lag];
      count++;
    }
    const normalizedScore = count ? score / count : 0;
    if (normalizedScore > bestScore) { bestScore = normalizedScore; bestBpm = bpm; }
  }
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const energy = Math.max(0, Math.min(1, Math.sqrt(sum / samples.length) * 3.2));
  const danceability = Math.max(0, Math.min(1, 0.25 + energy * 0.45 + (bestBpm >= 90 && bestBpm <= 145 ? 0.25 : 0)));
  const rhythmProfile = bestBpm < 78 ? "lento" : bestBpm < 108 ? "moderado" : bestBpm < 145 ? "dançante" : "rápido";
  return { bpm: bestBpm || null, energy, danceability, rhythmProfile, confidence: Math.max(0.35, Math.min(0.92, 0.45 + Math.abs(bestScore) * 8)) };
}

async function downloadAndAnalyze(src: string | null) {
  if (!src) return null;
  const response = await fetch(src, { redirect: "follow" });
  if (!response.ok) throw new Error(`Áudio HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_AUDIO_BYTES) throw new Error("Áudio maior que o limite de análise server-side.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("Áudio maior que o limite de análise server-side.");
  const buffer = await decodeAudio(bytes);
  return analyzeRhythm(buffer);
}

async function processJob(job: Job) {
  const [onlineResult, audioResult] = await Promise.allSettled([
    !clean(job.style) ? searchOnline(clean(job.title), clean(job.artist), clean(job.genre)) : Promise.resolve({ genres: [], source: null }),
    (!job.tempo_bpm || !clean(job.rhythm_profile)) ? downloadAndAnalyze(job.src) : Promise.resolve(null),
  ]);
  const online = onlineResult.status === "fulfilled" ? onlineResult.value : { genres: [], source: null };
  const audio = audioResult.status === "fulfilled" ? audioResult.value : null;
  const errors = [
    onlineResult.status === "rejected" ? `metadados: ${onlineResult.reason?.message || "indisponível"}` : "",
    audioResult.status === "rejected" ? `áudio: ${audioResult.reason?.message || "indisponível"}` : "",
  ].filter(Boolean);
  const tags = unique([...(job.style_tags || []), ...online.genres]);
  const updates: Record<string, unknown> = {
    style: online.genres[0] || null,
    style_tags: tags.length ? tags : null,
    tempo_bpm: audio?.bpm || null,
    energy_score: audio?.energy ?? null,
    danceability_score: audio?.danceability ?? null,
    rhythm_profile: audio?.rhythmProfile || null,
    analysis_confidence: audio?.confidence ?? null,
    analysis_source: [online.source, audio ? "edge-wasm-v1" : null].filter(Boolean).join("+") || null,
    analysis_version: "edge-wasm-v1",
    analyzed_at: new Date().toISOString(),
  };
  const { error } = await supabase.rpc("complete_music_analysis_job", {
    p_job_id: job.job_id,
    p_music_id: job.music_id,
    p_updates: updates,
    p_error: errors.length && !online.genres.length && !audio ? errors.join("; ") : null,
  });
  if (error) throw error;
  return { music_id: job.music_id, saved: Object.keys(updates).length, warnings: errors };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: { "content-type": "application/json" } });
  try {
    const { data: jobs, error } = await supabase.rpc("claim_music_analysis_jobs", { p_limit: MAX_JOBS_PER_RUN });
    if (error) throw error;
    const results = [];
    for (const job of (jobs || []) as Job[]) {
      try { results.push(await processJob(job)); }
      catch (jobError) {
        await supabase.rpc("complete_music_analysis_job", { p_job_id: job.job_id, p_music_id: job.music_id, p_updates: {}, p_error: jobError?.message || "Falha de análise" });
        results.push({ music_id: job.music_id, saved: 0, error: jobError?.message || "Falha de análise" });
      }
    }
    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Worker unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
  }
});
