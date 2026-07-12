// Общий модуль «человечного стиля»: каталог признаков ИИ-текста, детерминированная
// оценка (AI-tell score) и промпт-блоки, которые внедряются в генерацию, чтобы модель
// писала очеловеченный текст с первого прохода, а не после отдельной редактуры.
//
// Принципиально: никаких внешних детекторов и оптимизации под их баллы. Оценка ниже —
// локальная метрика ремесла (штампы, ритм, однообразие), а не «обход детектора».

export type AiTellCategory = "lexical" | "bureaucratic" | "structural" | "sensational";

export interface AiTellPattern {
  id: string;
  category: AiTellCategory;
  pattern: RegExp;
  label: string;
  weight: number; // вклад одного попадания в счёт (до нормализации на объём)
}

// Каталог адаптирован под русскую художественную прозу. Источники: собственный список
// PRIORITY_STYLE_PATTERNS, открытые humanizer-каталоги (blader/humanizer, Aboudjem —
// 43 паттерна) и русскоязычные списки признаков ИИ-текста. Тире и безупречная грамматика
// сознательно НЕ считаются признаками: в русской прозе тире — норма (диалоги).
export const AI_TELL_CATALOG: AiTellPattern[] = [
  // — гладкие универсальные формулы (исходные приоритетные штампы)
  { id: "ne-prosto", category: "lexical", pattern: /не просто/iu, label: "«не просто X…»", weight: 3 },
  { id: "slovno-nekhotya", category: "lexical", pattern: /словно нехотя/iu, label: "«словно нехотя»", weight: 3 },
  { id: "pugayushchaya-skorost", category: "lexical", pattern: /с пугающей скоростью/iu, label: "«с пугающей скоростью»", weight: 3 },
  { id: "gustaya-ravnodushnaya", category: "lexical", pattern: /густая и равнодушная/iu, label: "«густая и равнодушная»", weight: 3 },
  { id: "prorvat-plotinu", category: "lexical", pattern: /прорвал[аи]? плотину/iu, label: "«прорвало плотину»", weight: 3 },
  { id: "tot-samyi-moment", category: "lexical", pattern: /в тот самый момент/iu, label: "«в тот самый момент»", weight: 3 },
  { id: "pered-litsom", category: "lexical", pattern: /перед лицом/iu, label: "«перед лицом»", weight: 2 },
  { id: "ne-mog-oshibitsya", category: "lexical", pattern: /не мог(?:ла|ли)? ошибиться/iu, label: "«не мог ошибиться»", weight: 3 },
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
  // — канцелярит и вводные-паразиты (частые в ИИ-тексте, чуждые живой прозе)
  { id: "v-sovremennom-mire", category: "bureaucratic", pattern: /в современном мире/iu, label: "«в современном мире»", weight: 3 },
  { id: "ne-sekret", category: "bureaucratic", pattern: /не секрет,? что/iu, label: "«не секрет, что»", weight: 3 },
  { id: "stoit-otmetit", category: "bureaucratic", pattern: /(?:стоит|важно|следует) отметить/iu, label: "«стоит отметить»", weight: 3 },
  { id: "yavlyaetsya", category: "bureaucratic", pattern: /являет(?:ся|сь)/iu, label: "канцелярское «является»", weight: 1 },
  // \b не работает с кириллицей в JS — границы слова через lookaround
  { id: "dannyi", category: "bureaucratic", pattern: /(?<![\p{L}\p{N}])данн(?:ый|ая|ое|ые|ого|ой|ым|ыми|ом)(?![\p{L}\p{N}])/iu, label: "канцелярское «данный»", weight: 1 },
  { id: "predstavlyaet-soboi", category: "bureaucratic", pattern: /представляет собой/iu, label: "«представляет собой»", weight: 2 },
  { id: "osushchestvlyat", category: "bureaucratic", pattern: /осуществл/iu, label: "канцелярское «осуществлять»", weight: 2 },
  { id: "svoego-roda", category: "bureaucratic", pattern: /своего рода/iu, label: "«своего рода»", weight: 1 },
  // — структурные формулы
  { id: "eto-bylo-ne", category: "structural", pattern: /это был[оаи]? не (?:просто )?[^.!?]{3,40}[.,] (?:это|а)\b/iu, label: "зеркальное «это было не X — это Y»", weight: 3 },
  { id: "ritoricheskii-otvet", category: "structural", pattern: /\?\s+(?:Да|Нет|Возможно|Наверное)[,.]/u, label: "риторический вопрос + ответ", weight: 2 },
  { id: "slovno-budto-kaskad", category: "structural", pattern: /(?:словно|будто)[^.!?]{0,80}(?:словно|будто)/iu, label: "два «словно/будто» в одной фразе", weight: 2 },
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

// Негативные few-shot: пара «плохо → хорошо» работает лучше абстрактного запрета.
const NEGATIVE_EXAMPLES = `Примеры (плохо → хорошо):
1) Плохо: «Волна ледяного ужаса накрыла её, и время словно остановилось». Хорошо: «Она перестала слышать лифт за стеной. Пальцы сами собой смяли край рецепта».
2) Плохо: «Это был не просто дом — это была крепость его памяти». Хорошо: «Дом держал его крепче любых замков: под подоконником так и лежала отцовская стамеска».
3) Плохо: «Повисла гробовая тишина, и что-то неуловимое изменилось в его лице». Хорошо: «Никто не ответил. Он дважды моргнул и убрал руки со стола».`;

// Базовые правила человечного письма, добавляются к системной инструкции генерации.
export function humanStyleDirectives(): string {
  const bannedExamples = AI_TELL_CATALOG
    .filter((entry) => entry.weight >= 3)
    .map((entry) => entry.label)
    .join(", ");
  return `ПРАВИЛА ЖИВОГО ТЕКСТА (обязательны):
1. Ритм должен дышать: чередуй короткие предложения (3–7 слов) с длинными (20–35 слов). Запрещён ровный средний ритм, когда все фразы по 12–18 слов.
2. Не начинай соседние предложения и абзацы с одного и того же слова или конструкции.
3. Эмоции и атмосферу передавай через конкретное действие, жест, предмет или прямую мысль героя. Не называй чувства абстрактно и не олицетворяй среду («воздух сгустился», «тишина давила»).
4. Запрещены гладкие генеративные формулы, в том числе: ${bannedExamples}. Подбирай вместо них конкретное восприятие сцены.
5. Никакого канцелярита («является», «данный», «осуществлять», «представляет собой») в художественном тексте.
6. Не строй зеркальных конструкций («это не X — это Y») и не отвечай сам себе на риторические вопросы.
7. Метафора допустима, если она одна, свежая и вырастает из мира сцены. Не нанизывай образы подряд.
8. Абзац не обязан заканчиваться выводом или «ударной» финальной фразой. Обрывай там, где закончилось действие.
9. При этом НЕ имитируй человечность искусственно: не вставляй опечатки, лишние частицы, просторечие или ошибки ради «живости». Безупречная грамматика — не признак ИИ, портить её нельзя.
${NEGATIVE_EXAMPLES}`;
}

// Паспорт голоса как персона рассказчика: развёрнутая «биография» даёт более
// человечный и разнообразный текст, чем список правил.
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
