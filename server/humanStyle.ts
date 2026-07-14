import { computeStyleStats } from "../src/lib/authorAudit";

// Общий модуль «человечного стиля»: каталог признаков ИИ-текста, детерминированная
// оценка (AI-tell score) и промпт-блоки, которые внедряются в генерацию, чтобы модель
// писала очеловеченный текст с первого прохода, а не после отдельной редактуры.
//
// Принципиально: никаких внешних детекторов и оптимизации под их баллы. Оценка ниже —
// локальная метрика ремесла (штампы, ритм, однообразие), а не «обход детектора».
//
// Источники 2025–2026: Wikipedia Signs of AI writing, blader/humanizer, Aboudjem
// (43 паттерна / 5 voices), harshaneel/humanize (9 levers), русские списки ИИ-штампов.

export type AiTellCategory = "lexical" | "bureaucratic" | "structural" | "sensational" | "rlhf";

export interface AiTellPattern {
  id: string;
  category: AiTellCategory;
  pattern: RegExp;
  label: string;
  weight: number; // вклад одного попадания в счёт (до нормализации на объём)
}

// Каталог адаптирован под русскую художественную прозу. Тире и безупречная грамматика
// сознательно НЕ считаются признаками: в русской прозе тире — норма (диалоги).
export const AI_TELL_CATALOG: AiTellPattern[] = [
  // — гладкие универсальные формулы
  { id: "ne-prosto", category: "lexical", pattern: /не просто/iu, label: "«не просто X…»", weight: 3 },
  { id: "slovno-nekhotya", category: "lexical", pattern: /словно нехотя/iu, label: "«словно нехотя»", weight: 3 },
  { id: "pugayushchaya-skorost", category: "lexical", pattern: /с пугающей скоростью/iu, label: "«с пугающей скоростью»", weight: 3 },
  { id: "gustaya-ravnodushnaya", category: "lexical", pattern: /густая и равнодушная/iu, label: "«густая и равнодушная»", weight: 3 },
  { id: "prorvat-plotinu", category: "lexical", pattern: /прорвал[аи]? плотину/iu, label: "«прорвало плотину»", weight: 3 },
  { id: "tot-samyi-moment", category: "lexical", pattern: /в тот самый момент/iu, label: "«в тот самый момент»", weight: 3 },
  { id: "pered-litsom", category: "lexical", pattern: /перед лицом/iu, label: "«перед лицом»", weight: 2 },
  { id: "ne-mog-oshibitsya", category: "lexical", pattern: /не мог(?:ла|ли)? ошибиться/iu, label: "«не мог ошибиться»", weight: 3 },
  { id: "edinstvennyi-yakor", category: "lexical", pattern: /единственн(?:ый|ая|ое|ым|ой) (?:якорь|путеводитель|шанс|надежда|друг)/iu, label: "тройное «единственный…»", weight: 2 },
  { id: "poymannaya-ptica", category: "lexical", pattern: /как пойманн(?:ая|ый) птиц/iu, label: "«как пойманная птица»", weight: 2 },
  { id: "rastopilsya-sneg", category: "lexical", pattern: /та[яи]л[иао]? как снег/iu, label: "«тает как снег»", weight: 2 },
  // — телесно-эмоциональные штампы генеративной прозы
  { id: "kholodok-po-spine", category: "sensational", pattern: /холодок (?:пробежал|скользнул) по спине|по спине пробежал холодок/iu, label: "«холодок по спине»", weight: 3 },
  { id: "serdtse-propustilo", category: "sensational", pattern: /сердце пропустило удар/iu, label: "«сердце пропустило удар»", weight: 3 },
  { id: "vozdukh-sgustilsya", category: "sensational", pattern: /воздух (?:сгустился|застыл|зазвенел)/iu, label: "«воздух сгустился»", weight: 3 },
  { id: "vremya-zamerlo", category: "sensational", pattern: /время (?:словно |будто |как будто )?(?:остановилось|замерло|застыло)/iu, label: "«время остановилось»", weight: 3 },
  { id: "grobovaya-tishina", category: "sensational", pattern: /(?:повисла|воцарилась) (?:гробовая |звенящая )?тишина/iu, label: "«повисла тишина»", weight: 2 },
  { id: "vnutri-szhalos", category: "sensational", pattern: /внутри (?:вс[её] |что-то )?(?:сжалось|оборвалось|похолодело)/iu, label: "«внутри всё сжалось»", weight: 2 },
  { id: "volna-chuvstva", category: "sensational", pattern: /волна (?:страха|ужаса|паники|облегчения|гнева|ярости|тепла) (?:накрыла|захлестнула|окатила|прокатилась)/iu, label: "«волна чувства накрыла»", weight: 3 },
  { id: "ledyanoi-uzhas", category: "sensational", pattern: /ледян(?:ой|ым|ого) ужас/iu, label: "«ледяной ужас»", weight: 2 },
  { id: "chto-to-neulovimoe", category: "sensational", pattern: /что-то неуловим/iu, label: "«что-то неуловимое»", weight: 2 },
  { id: "sam-vozdukh", category: "sensational", pattern: /казалось, сам(?:а|о)? (?:воздух|земля|время|пространство)/iu, label: "«казалось, сам воздух…»", weight: 3 },
  { id: "strannoe-chuvstvo", category: "sensational", pattern: /странное (?:чувство|ощущение) (?:охватило|наполнило|не покидало)/iu, label: "«странное чувство охватило»", weight: 2 },
  { id: "tishina-davila", category: "sensational", pattern: /тишина (?:давила|нависала|обволакивала|поглотила)/iu, label: "олицетворённая тишина", weight: 2 },
  { id: "temnota-osyaz", category: "sensational", pattern: /темнота (?:была |казалась )?(?:осязаем|плотной|густой)/iu, label: "«осязаемая темнота»", weight: 1 },
  // — канцелярит и вводные-паразиты
  { id: "v-sovremennom-mire", category: "bureaucratic", pattern: /в современном мире/iu, label: "«в современном мире»", weight: 3 },
  { id: "ne-sekret", category: "bureaucratic", pattern: /не секрет,? что/iu, label: "«не секрет, что»", weight: 3 },
  { id: "stoit-otmetit", category: "bureaucratic", pattern: /(?:стоит|важно|следует) отметить/iu, label: "«стоит отметить»", weight: 3 },
  { id: "yavlyaetsya", category: "bureaucratic", pattern: /являет(?:ся|сь)/iu, label: "канцелярское «является»", weight: 1 },
  { id: "dannyi", category: "bureaucratic", pattern: /(?<![\p{L}\p{N}])данн(?:ый|ая|ое|ые|ого|ой|ым|ыми|ом)(?![\p{L}\p{N}])/iu, label: "канцелярское «данный»", weight: 1 },
  { id: "predstavlyaet-soboi", category: "bureaucratic", pattern: /представляет собой/iu, label: "«представляет собой»", weight: 2 },
  { id: "osushchestvlyat", category: "bureaucratic", pattern: /осуществл/iu, label: "канцелярское «осуществлять»", weight: 2 },
  { id: "svoego-roda", category: "bureaucratic", pattern: /своего рода/iu, label: "«своего рода»", weight: 1 },
  { id: "nado-otmetit", category: "bureaucratic", pattern: /надо (?:сказать|признать|отметить),? что/iu, label: "«надо сказать, что»", weight: 2 },
  // — структурные формулы
  { id: "eto-bylo-ne", category: "structural", pattern: /это был[оаи]? не (?:просто )?[^.!?]{3,40}[.,] (?:это|а)\b/iu, label: "зеркальное «это было не X — это Y»", weight: 3 },
  { id: "ritoricheskii-otvet", category: "structural", pattern: /\?\s+(?:Да|Нет|Возможно|Наверное)[,.]/u, label: "риторический вопрос + ответ", weight: 2 },
  { id: "slovno-budto-kaskad", category: "structural", pattern: /(?:словно|будто)[^.!?]{0,80}(?:словно|будто)/iu, label: "два «словно/будто» в одной фразе", weight: 2 },
  { id: "ne-tolko-no-i", category: "structural", pattern: /не только[^.!?]{0,60}но и/iu, label: "«не только… но и»", weight: 2 },
  { id: "odnako-vs[eё]-zhe", category: "structural", pattern: /однако вс[её] же/iu, label: "«однако всё же»", weight: 1 },
  { id: "vdrug-vnezapno", category: "structural", pattern: /(?:^|[.!?…]\s+|\n\s*)(?:И )?вдруг\b/iu, label: "зачин «Вдруг…»", weight: 2 },
  // — RLHF / «полезный ассистент» в художественной прозе
  { id: "podvodya-itog", category: "rlhf", pattern: /подводя итог|в заключение|резюмируя/iu, label: "итоговое резюме", weight: 3 },
  { id: "vazhno-ponyat", category: "rlhf", pattern: /важно понять|следует понимать|необходимо осознать/iu, label: "«важно понять»", weight: 3 },
  { id: "s-odnoy-storony", category: "rlhf", pattern: /с одной стороны[^.!?]{0,80}с другой/iu, label: "сбалансированное «с одной / с другой»", weight: 3 },
  { id: "takim-obrazom", category: "rlhf", pattern: /(?<![\p{L}\p{N}])таким образом(?![\p{L}\p{N}])/iu, label: "«таким образом»", weight: 2 },
  { id: "imeet-smysl", category: "rlhf", pattern: /имеет смысл (?:отметить|сказать|подчеркнуть)/iu, label: "«имеет смысл отметить»", weight: 2 },
];

export interface AiTellHit {
  id: string;
  label: string;
  category: AiTellCategory;
  match: string;
  index: number;
}

export function detectAiTells(text: string): AiTellHit[] {
  const hits: AiTellHit[] = [];
  for (const entry of AI_TELL_CATALOG) {
    const global = new RegExp(entry.pattern.source, entry.pattern.flags.includes("g") ? entry.pattern.flags : entry.pattern.flags + "g");
    for (const match of text.matchAll(global)) {
      hits.push({ id: entry.id, label: entry.label, category: entry.category, match: match[0], index: match.index ?? 0 });
    }
  }
  return hits.sort((left, right) => left.index - right.index);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

function wordsOf(sentence: string): string[] {
  return sentence.split(/\s+/u).filter(Boolean);
}

// Коэффициент вариации длин предложений: у живой прозы длины «дышат» (CV ≥ ~0.5),
// у генеративной — ровный средний ритм (CV ≤ ~0.3).
export function sentenceBurstiness(text: string): number {
  const lengths = splitSentences(text).map((sentence) => wordsOf(sentence).length);
  if (lengths.length < 3) return 1;
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  if (mean === 0) return 1;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

// Доля соседних предложений, начинающихся с одного и того же слова («Он… Он… Он…»).
export function repeatedOpenerShare(text: string): number {
  const openers = splitSentences(text)
    .map((sentence) => wordsOf(sentence)[0]?.toLowerCase().replace(/[^\p{L}ё]/gu, "") ?? "");
  if (openers.length < 3) return 0;
  let repeats = 0;
  for (let index = 1; index < openers.length; index += 1) {
    if (openers[index] && openers[index] === openers[index - 1]) repeats += 1;
  }
  return repeats / (openers.length - 1);
}

export interface AiTellScore {
  score: number; // 0 — человечно, 100 — набор генеративных признаков
  patternDensity: number; // взвешенные попадания на 1000 слов
  burstiness: number;
  openerRepetition: number;
  hits: AiTellHit[];
}

export function aiTellScore(text: string): AiTellScore {
  const hits = detectAiTells(text);
  const wordCount = Math.max(wordsOf(text).length, 1);
  const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
  const weighted = hits.reduce((sum, hit) => sum + (weightById.get(hit.id) ?? 1), 0);
  const patternDensity = (weighted / wordCount) * 1000;
  const burstiness = sentenceBurstiness(text);
  const openerRepetition = repeatedOpenerShare(text);

  // Составляющие: штампы (до 55), ровный ритм (до 30), однообразные зачины (до 15).
  const patternComponent = Math.min(patternDensity * 4, 55);
  const rhythmComponent = burstiness >= 0.55 ? 0 : Math.min(((0.55 - burstiness) / 0.55) * 30, 30);
  const openerComponent = Math.min(openerRepetition * 60, 15);
  const score = Math.round(Math.min(patternComponent + rhythmComponent + openerComponent, 100));
  return { score, patternDensity, burstiness, openerRepetition, hits };
}

// Оценка отдельного абзаца для точечной доводки (короткие блоки иначе недооцениваются).
export function paragraphAiTellScore(block: string): AiTellScore {
  const base = aiTellScore(block);
  // Короткий абзац со штампом: поднимаем score, чтобы он попал в touchup.
  if (base.hits.length > 0 && wordsOf(block).length < 40) {
    return { ...base, score: Math.min(100, Math.max(base.score, 25 + base.hits.length * 10)) };
  }
  return base;
}

/** Минимальная «живость» ритма для gate (ниже — ещё один pass). */
export const DEFAULT_MIN_BURSTINESS = 0.45;

export function heavyStampHits(score: AiTellScore): AiTellHit[] {
  return score.hits.filter((hit) => {
    const entry = AI_TELL_CATALOG.find((item) => item.id === hit.id);
    return (entry?.weight ?? 0) >= 3;
  });
}

export function humanizeGatePassed(
  score: AiTellScore,
  maxScore: number,
  minBurstiness = DEFAULT_MIN_BURSTINESS,
): boolean {
  if (score.score > maxScore) return false;
  if (heavyStampHits(score).length > 0) return false;
  // Для коротких текстов вызывающий код может передать minBurstiness=0.
  if (minBurstiness > 0 && score.burstiness < minBurstiness) return false;
  return true;
}

/** Абзац достаточно «чистый» — touchup его не трогает (сохраняем живые куски). */
export function isCleanBlock(block: string, cleanScoreMax = 10): boolean {
  const trimmed = block.trim();
  if (!trimmed || trimmed.length < 20) return true;
  const score = paragraphAiTellScore(trimmed);
  if (score.score > cleanScoreMax) return false;
  // Любой штамп weight≥2 — не «чистый»
  const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
  return !score.hits.some((hit) => (weightById.get(hit.id) ?? 1) >= 2);
}

// Пресеты голоса для историй без авторского образца (идея «5 voices» из humanizer-скилов).
export interface VoicePreset {
  id: string;
  title: string;
  directives: string;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "neutral",
    title: "Нейтрально-тёплый рассказчик",
    directives: "Рассказчик наблюдательный и сдержанно-тёплый. Простые точные слова, конкретные детали быта, короткие вспышки иронии. Эмоции показываются через действие и жест, а не называются.",
  },
  {
    id: "terse",
    title: "Резкий, рубленый",
    directives: "Рассказчик немногословный и жёсткий. Короткие фразы. Глаголы вместо прилагательных. Никаких развёрнутых метафор; сравнение — редкое и бытовое. Паузы и умолчания вместо объяснений.",
  },
  {
    id: "ironic",
    title: "Ироничный наблюдатель",
    directives: "Рассказчик умный и насмешливый, но не циничный. Сухие ремарки в сторону, неожиданные сопоставления, внутренние комментарии героя. Ирония — в деталях, не в открытых шутках.",
  },
  {
    id: "lyrical",
    title: "Лирический, плотный",
    directives: "Рассказчик чувственный, внимательный к свету, запаху, фактуре. Длинные фразы чередуются с очень короткими. Образы свежие и конкретные; запрещены расхожие поэтизмы (луна-серебро, звенящая тишина).",
  },
  {
    id: "conversational",
    title: "Разговорный, от первого лица",
    directives: "Живой устный тон: вводные словечки, оборванные мысли, самоперебивы. Герой говорит с читателем как со знакомым. Просторечие лёгкое, без нарочитых ошибок.",
  },
];

export function voicePresetById(id: unknown): VoicePreset | undefined {
  return typeof id === "string" ? VOICE_PRESETS.find((preset) => preset.id === id) : undefined;
}

// Режимы глубины очеловечивания при генерации главы.
export type HumanizeDepth = "fast" | "balanced" | "maximum";

export interface HumanizeDepthConfig {
  id: HumanizeDepth;
  title: string;
  description: string;
  sceneGeneration: boolean;
  maxTouchupBlocks: number;
  touchupRounds: number;
  bestOfN: number;
  /** Сколько полных черновиков главы генерировать (best-of-N). */
  chapterCandidates: number;
  scoreGate: number;
  minBurstiness: number;
  /** Абзацы с AI-tell ≤ этого порога не трогаем (если нет тяжёлых штампов). */
  cleanScoreMax: number;
  proseTemperature: number;
  sceneTemperature: number;
  minAuthorSampleChars: number; // 0 = sample optional
}

export const HUMANIZE_DEPTHS: Record<HumanizeDepth, HumanizeDepthConfig> = {
  fast: {
    id: "fast",
    title: "Быстро",
    description: "Один проход + лёгкая доводка штампов",
    sceneGeneration: false,
    maxTouchupBlocks: 10,
    touchupRounds: 1,
    bestOfN: 1,
    chapterCandidates: 1,
    scoreGate: 18,
    minBurstiness: 0.4,
    cleanScoreMax: 10,
    proseTemperature: 0.85,
    sceneTemperature: 0.85,
    minAuthorSampleChars: 0,
  },
  balanced: {
    id: "balanced",
    title: "Баланс",
    description: "Сцены + best-of-2 черновиков + доводка",
    sceneGeneration: true,
    maxTouchupBlocks: 16,
    touchupRounds: 2,
    bestOfN: 1,
    chapterCandidates: 2,
    scoreGate: 12,
    minBurstiness: 0.45,
    cleanScoreMax: 10,
    proseTemperature: 0.88,
    sceneTemperature: 0.9,
    minAuthorSampleChars: 0,
  },
  maximum: {
    id: "maximum",
    title: "Максимум",
    description: "Сцены + best-of-3 черновиков + best-of-N абзацев + gate",
    sceneGeneration: true,
    maxTouchupBlocks: 20,
    touchupRounds: 2,
    bestOfN: 2,
    chapterCandidates: 3,
    scoreGate: 8,
    minBurstiness: 0.5,
    cleanScoreMax: 8,
    proseTemperature: 0.9,
    sceneTemperature: 0.92,
    minAuthorSampleChars: 300,
  },
};

/**
 * Ранг кандидата главы: меньше = лучше.
 * Штампы и score важнее; burstiness поощряется; gate-pass даёт бонус.
 */
export function rankChapterCandidate(score: AiTellScore, scoreGate = 12, minBurstiness = 0.45): number {
  const heavy = heavyStampHits(score).length;
  const gateBonus = humanizeGatePassed(score, scoreGate, minBurstiness) ? -8 : 0;
  const burstPenalty = score.burstiness >= minBurstiness
    ? 0
    : ((minBurstiness - score.burstiness) / Math.max(minBurstiness, 0.01)) * 20;
  return score.score + heavy * 12 + burstPenalty + gateBonus;
}

export function pickBestChapterCandidate<T extends { text: string; score: AiTellScore }>(
  candidates: T[],
  scoreGate = 12,
  minBurstiness = 0.45,
): T {
  if (!candidates.length) throw new Error("Нет кандидатов главы");
  let best = candidates[0];
  let bestRank = rankChapterCandidate(best.score, scoreGate, minBurstiness);
  for (let index = 1; index < candidates.length; index += 1) {
    const rank = rankChapterCandidate(candidates[index].score, scoreGate, minBurstiness);
    if (rank < bestRank) {
      best = candidates[index];
      bestRank = rank;
    }
  }
  return best;
}

export function resolveHumanizeDepth(value: unknown): HumanizeDepthConfig {
  if (value === "fast" || value === "maximum" || value === "balanced") {
    return HUMANIZE_DEPTHS[value];
  }
  return HUMANIZE_DEPTHS.balanced;
}

// Негативные few-shot: пара «плохо → хорошо» работает лучше абстрактного запрета.
const NEGATIVE_EXAMPLES = `Примеры (плохо → хорошо):
1) Плохо: «Волна ледяного ужаса накрыла её, и время словно остановилось». Хорошо: «Она перестала слышать лифт за стеной. Пальцы сами собой смяли край рецепта».
2) Плохо: «Это был не просто дом — это была крепость его памяти». Хорошо: «Дом держал его крепче любых замков: под подоконником так и лежала отцовская стамеска».
3) Плохо: «Повисла гробовая тишина, и что-то неуловимое изменилось в его лице». Хорошо: «Никто не ответил. Он дважды моргнул и убрал руки со стола».
4) Плохо: «С одной стороны, он боялся, с другой — надеялся. Важно понять: выбора не было». Хорошо: «Он боялся. И всё равно шагнул».`;

// 9 levers (harshaneel/humanize 2026), адаптированные под русскую художественную прозу.
const NINE_LEVERS = `ДЕВЯТЬ РЫЧАГОВ ЖИВОГО ТЕКСТА:
1) Слова: убирай гладкие ИИ-формулы; одно-два неожиданных, но точных слова на абзац — из мира сцены, не из словаря «красивой прозы».
2) Ритм: чередуй короткие и длинные фразы естественно; не строй метроном из 15–20-словных предложений.
3) Без смягчителей: вырежи «стоит отметить», «важно понять», «таким образом», «с одной стороны… с другой», если это не прямая речь героя.
4) Структура: не заканчивай абзац выводом-резюме; обрывай на действии или конкретной детали.
5) Конкретика: абстрактное чувство → жест, предмет, число, запах, решение героя.
6) Голос: держи манеру образца (или персоны); допускай самоперебив и бытовую прямоту, если они есть у автора.
7) Связки: не начинай абзацы с «Кроме того», «Между тем», «Вдруг», «Однако» каскадом.
8) Пунктуация: в русской прозе тире в диалогах — норма. Не злоупотребляй тройными восклицаниями и «ударными» финалами каждого абзаца.
9) Сними голос «полезного ассистента»: без сбалансированных лекций, без объяснения читателю «что это значит», без идеально гладкой локальной связности.`;

/**
 * Паттерны, подтверждённые прогонами Yandex-нейродетектора (лабиринт, 2026-07).
 * Вшиваются в генерацию/рерайт, чтобы не оптимизировать «на глаз».
 */
export const YANDEX_DETECTOR_STYLE = `ПАТТЕРНЫ НЕЙРОДЕТЕКТОРА (Yandex lab, обязательно):
1) НЕ пиши рубленый «телеграф» без подлежащего (цепочки «Шаг. Ещё. Стоял. Смотрел.» на весь текст) — такие сегменты часто идут в AI 100%.
2) В повествовании от 1 лица держи «я» умеренно (~3–7 на 100 слов): не в каждое предложение, но и не вычищай до нуля. Безличные/глагольные куски — разрядка, не единственный режим.
3) Стиль «дневник / связная проза инженера»: полные фразы, бытовые мысли («подумал», «решил», «достал»), лёгкая шероховатость. Не «литературный пафос» и не «инструкция к механизму».
4) Один проход сцены: не повторяй одно и то же действие 2–3 раза («подошёл к отпечатку / и что дальше?» петлёй).
5) Не начинай главу с «Начну снова» и не вставляй бессмысленные часы экрана (типа «3:47»), если они не сюжетный якорь канона.
6) Конкретика лучше абстракции: жест, предмет, число заряда, запах — вместо «приближаюсь к пониманию» / «ключ к пониманию всего этого».
7) После правок сверяй: локальный AI-tell (humanStyle) + по возможности Yandex; HUMAN-сегменты отчёта не переписывай.`;

// Базовые правила человечного письма, добавляются к системной инструкции генерации.
export function humanStyleDirectives(): string {
  const bannedExamples = AI_TELL_CATALOG
    .filter((entry) => entry.weight >= 3)
    .map((entry) => entry.label)
    .join(", ");
  return `ПРАВИЛА ЖИВОГО ТЕКСТА (обязательны):
1. Следуй ритму авторского образца. Не конструируй механическое чередование коротких и длинных фраз и не ставь подряд рубленые фразы ради драматизма.
2. Не начинай соседние предложения и абзацы с одного и того же слова или конструкции.
3. Эмоции и атмосферу передавай через конкретное действие, жест, предмет или прямую мысль героя. Не называй чувства абстрактно и не олицетворяй среду («воздух сгустился», «тишина давила»).
4. Запрещены гладкие генеративные формулы, в том числе: ${bannedExamples}. Подбирай вместо них конкретное восприятие сцены.
5. Никакого канцелярита («является», «данный», «осуществлять», «представляет собой») в художественном тексте.
6. Не строй зеркальных конструкций («это не X — это Y») и не отвечай сам себе на риторические вопросы.
7. Метафора допустима, если она одна, свежая и вырастает из мира сцены. Не нанизывай образы подряд.
8. Абзац не обязан заканчиваться выводом или «ударной» финальной фразой. Обрывай там, где закончилось действие.
9. При этом НЕ имитируй человечность искусственно: не вставляй опечатки, лишние частицы, просторечие или ошибки ради «живости». Безупречная грамматика — не признак ИИ, портить её нельзя.
10. Не повторяй одну мысль дважды: сначала в описании, затем во внутренней реплике или выводе. Доверяй читателю и оставляй часть причин неразжёванными.
11. Не превращай сцену в перечень сенсорных каналов и точных характеристик. Числа, запахи, фактуры и термины появляются только тогда, когда влияют на ближайшее решение героя.
12. Если дан авторский образец, его степень простоты и шероховатости — норма. Не заменяй прямую бытовую фразу «более литературным» синонимом и не добавляй украшения, которых автор обычно не использует.
13. Не пиши как «полезный ассистент»: без лекций читателю, без «с одной стороны / с другой», без «важно понять», без подведения итогов в конце сцены.
14. От 1 лица: сохраняй «я» как естественную опору повествования (умеренно). Полное вычищение «я» и сплошной телеграф — вредны и для голоса, и для нейродетектора.
${YANDEX_DETECTOR_STYLE}
${NINE_LEVERS}
${NEGATIVE_EXAMPLES}`;
}

// --- Детерминированные проверки качества переписанных блоков ---

function normalizedSentenceTokens(sentence: string): Set<string> {
  return new Set(sentence.toLowerCase().match(/[а-яёa-z0-9]+/giu) ?? []);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// Ловит два известных сбоя редактуры: раздувание блока и «два варианта одного
// абзаца» внутри блока (почти одинаковые длинные предложения рядом).
export function blockQualityIssues(sourceBlock: string, revisedBlock: string): string[] {
  const issues: string[] = [];
  if (revisedBlock.length > sourceBlock.length * 1.6 && revisedBlock.length > sourceBlock.length + 200) {
    issues.push(`блок раздут с ${sourceBlock.length} до ${revisedBlock.length} знаков`);
  }
  if (revisedBlock.length < sourceBlock.length * 0.45 && sourceBlock.length > 120) {
    issues.push(`блок чрезмерно урезан с ${sourceBlock.length} до ${revisedBlock.length} знаков`);
  }
  const sentences = splitSentences(revisedBlock).filter((sentence) => wordsOf(sentence).length >= 6);
  const tokenSets = sentences.map(normalizedSentenceTokens);
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      if (jaccard(tokenSets[left], tokenSets[right]) >= 0.75) {
        issues.push("внутри блока два почти одинаковых предложения (черновые варианты)");
        return issues;
      }
    }
  }
  return issues;
}

// Ритмические проблемы отдельного абзаца — для точечной доводки не только по
// штампам, но и по «ровному» генеративному ритму.
export function rhythmIssues(block: string): string[] {
  const sentences = splitSentences(block);
  if (sentences.length < 4) return [];
  const issues: string[] = [];
  if (sentenceBurstiness(block) < 0.35) {
    issues.push("ровный ритм: все предложения близкой длины — нужно чередовать короткие и длинные");
  }
  if (repeatedOpenerShare(block) > 0.4) {
    issues.push("однотипные зачины: соседние предложения начинаются одинаково");
  }
  return issues;
}

// Все issues абзаца для touchup (штампы + ритм + высокий paragraph score).
export function blockHumanizeIssues(block: string): string[] {
  const issues: string[] = [
    ...detectAiTells(block)
      .filter((hit) => {
        const entry = AI_TELL_CATALOG.find((item) => item.id === hit.id);
        return (entry?.weight ?? 0) >= 2;
      })
      .map((hit) => `штамп «${hit.match}» (${hit.label}) — замени конкретным восприятием, действием или прямой мыслью героя`),
    ...rhythmIssues(block),
  ];
  const score = paragraphAiTellScore(block);
  if (score.score >= 22 && !issues.length) {
    issues.push("абзац звучит генеративно: упрости лексику, добавь конкретную деталь, разбей ровный ритм");
  }
  return [...new Set(issues)];
}

export interface FlagBlocksOptions {
  maximum: number;
  /** Не трогать абзацы с score ≤ cleanScoreMax без тяжёлых штампов (по умолчанию 10). */
  cleanScoreMax?: number;
  /** Только ритм (для pass «разбить burstiness»). */
  rhythmOnly?: boolean;
}

// Индексы абзацев, требующих доводки, по убыванию «грязи».
// Чистые абзацы (низкий score, нет штампов weight≥2) пропускаем — иначе Яндекс
// «заглаживает» живые куски.
export function flagBlocksForTouchup(
  blocks: string[],
  maximumOrOptions: number | FlagBlocksOptions,
): number[] {
  const options: FlagBlocksOptions = typeof maximumOrOptions === "number"
    ? { maximum: maximumOrOptions, cleanScoreMax: 10 }
    : { cleanScoreMax: 10, ...maximumOrOptions };

  return blocks
    .map((block, index) => {
      const score = paragraphAiTellScore(block);
      const issues = options.rhythmOnly ? rhythmIssues(block) : blockHumanizeIssues(block);
      const weightById = new Map(AI_TELL_CATALOG.map((entry) => [entry.id, entry.weight]));
      const hasHeavy = score.hits.some((hit) => (weightById.get(hit.id) ?? 1) >= 2);
      const clean = !hasHeavy && score.score <= (options.cleanScoreMax ?? 10);
      return {
        index,
        issues: issues.length,
        score: score.score,
        clean,
        burstiness: score.burstiness,
      };
    })
    .filter((entry) => {
      if (entry.clean && !options.rhythmOnly) return false;
      if (options.rhythmOnly) {
        // Для ритм-pass: только длинные «ровные» абзацы
        return entry.issues > 0 || (entry.burstiness < 0.35 && entry.score >= 5);
      }
      return entry.issues > 0 || entry.score >= 22;
    })
    .sort((left, right) => right.score - left.score || right.issues - left.issues)
    .slice(0, options.maximum)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
}

/** Извлечь числа из текста (для anti-repeat / факт-check). */
export function extractNumbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?%?/gu)].map((match) => match[0]);
}

/** Грубое пересечение 5-грамм слов между двумя текстами (anti-repeat сцен). */
export function repeatedNgramShare(left: string, right: string, n = 5): number {
  const toGrams = (text: string) => {
    const tokens = text.toLowerCase().match(/[а-яёa-z0-9]+/giu) ?? [];
    const grams = new Set<string>();
    for (let index = 0; index <= tokens.length - n; index += 1) {
      grams.add(tokens.slice(index, index + n).join(" "));
    }
    return grams;
  };
  const a = toGrams(left);
  const b = toGrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

// Доля содержательно изменённых блоков (нормализованное сравнение) — чтобы
// режимы силы редактуры были обещанием результата, а не тона просьбы.
export function changedBlockShare(sourceBlocks: string[], revisedBlocks: string[]): number {
  if (!sourceBlocks.length) return 0;
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let changed = 0;
  for (let index = 0; index < sourceBlocks.length; index += 1) {
    if (normalize(sourceBlocks[index]) !== normalize(revisedBlocks[index] ?? "")) changed += 1;
  }
  return changed / sourceBlocks.length;
}

// Выбрать лучший из N вариантов абзаца по AI-tell (ниже = лучше).
export function pickBestVariant(source: string, variants: string[]): string {
  const sourceScore = paragraphAiTellScore(source).score;
  const candidates = variants
    .filter((variant) => typeof variant === "string" && variant.trim())
    .filter((variant) => !blockQualityIssues(source, variant).length);
  if (!candidates.length) return source;
  let best = source;
  let bestScore = sourceScore;
  for (const candidate of candidates) {
    const score = paragraphAiTellScore(candidate).score;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

// Паспорт голоса как персона рассказчика: развёрнутая «биография» даёт более
// человечный и разнообразный текст, чем список правил.
// Количественный портрет голоса по образцу автора: модели заметно лучше держат
// манеру, когда цель измерима, а не описана прилагательными.
export function quantitativeVoiceBlock(sample: string): string {
  const stats = computeStyleStats(sample);
  if (stats.words < 100) return "";
  const lines = [
    `- средняя длина предложения: ~${Math.round(stats.averageSentenceWords)} слов (разброс ±${Math.round(stats.sentenceLengthDeviation)})`,
    `- доля коротких фраз (до 4 слов): ${Math.round(stats.shortSentenceShare * 100)}%`,
    `- доля строк-диалогов: ${Math.round(stats.dialogueLineShare * 100)}%`,
    `- восклицания: ~${stats.exclamationsPerThousandWords.toFixed(1)} на 1000 слов`,
    `- многоточия: ~${stats.ellipsesPerThousandWords.toFixed(1)} на 1000 слов`,
    `- разговорные частицы (же, ведь, ну…): ~${stats.particlesPerThousandWords.toFixed(1)} на 1000 слов`,
    `- сравнения (будто, словно…): ~${stats.similesPerThousandWords.toFixed(1)} на 1000 слов`,
  ];
  return `ИЗМЕРИМЫЙ ПОРТРЕТ ГОЛОСА (статистика образца автора — держи текст в этих пределах, не копируя события):\n${lines.join("\n")}`;
}

export function voicePersonaBlock(voiceSheet: unknown): string {
  if (!voiceSheet || typeof voiceSheet !== "object") return "";
  const sheet = voiceSheet as { summary?: string; voiceRules?: string[]; avoid?: string[] };
  const rules = Array.isArray(sheet.voiceRules) ? sheet.voiceRules.slice(0, 20).join("\n- ") : "";
  const avoid = Array.isArray(sheet.avoid) ? sheet.avoid.slice(0, 12).join("\n- ") : "";
  return `ПЕРСОНА РАССКАЗЧИКА (паспорт голоса автора — пиши от этой манеры, а не «в общем стиле»):
${typeof sheet.summary === "string" ? sheet.summary : ""}
Правила голоса:
- ${rules}
Чего этот автор не делает (не имитируй механически):
- ${avoid}`;
}

// Позитивные few-shot абзацы из образца (не события — только манера).
export function positiveVoiceFewShots(sample: string, maximum = 3): string {
  const paragraphs = sample
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40 && paragraph.length <= 900);
  if (!paragraphs.length) {
    const slice = sample.trim().slice(0, 900);
    return slice ? `Эталонные фрагменты манеры (не копируй сюжет):\n"""\n${slice}\n"""` : "";
  }
  const picked = paragraphs.slice(0, maximum);
  return `Эталонные абзацы манеры автора (ритм и лексика; события и имена из образца НЕ переносить в новую главу):\n${picked.map((paragraph, index) => `${index + 1}) """${paragraph}"""`).join("\n")}`;
}
