/**
 * Канон «Лабиринт. Путь домой» — библия, план, правила и тексты,
 * которые уходят в generate_full_chapter через worldBible / bookPlan / summary / previousChapter.
 *
 * CANON_V: поднимать при смене стыков/механик (merge обновит story в localStorage).
 */
import type { AuthorProfileRecord, AuthorVoiceSheet, Character, Chapter, Story, WorldRule } from "../types";
import { chapterOrdinal } from "../lib/chapterContext";
import chapter5Text from "./labyrinth/chapter-5.content";
import chapter6Text from "./labyrinth/chapter-6.content";
import chapter7Text from "./labyrinth/chapter-7.content";

export const LABYRINTH_STORY_ID = "story-labyrinth";
/** v6: текст гл.7 (сон/NFC/двойная ладонь) в seed; пустой слот 7 заполняется каноном. */
export const LABYRINTH_CANON_VERSION = 6;
export const LABYRINTH_CANON_MARKER = `CANON_V${LABYRINTH_CANON_VERSION}_PALM_CH7`;
/** Маркер образца автора: при смене версии канона профиль перезапишется, если не помечен user: */
export const LABYRINTH_AUTHOR_SAMPLE_MARKER = `labyrinth-canon-ch5-6-v${LABYRINTH_CANON_VERSION}`;

export function isLabyrinthStory(
  story: Pick<Story, "id" | "title"> & { chapters?: Chapter[] } | null | undefined,
): boolean {
  if (!story) return false;
  if (story.id === LABYRINTH_STORY_ID) return true;
  const title = story.title || "";
  if (/лабиринт/i.test(title) || /labyrinth/i.test(title)) return true;
  // эвристика: канон-id глав или типичные названия
  const chapters = story.chapters || [];
  if (chapters.some((c) => /^lab-ch-\d+/i.test(c.id || ""))) return true;
  if (
    chapters.some(
      (c) =>
        /число\s*20/i.test(c.title || "") ||
        /отпечаток\s+ладони/i.test(c.title || "") ||
        /первый\s+круг/i.test(c.title || ""),
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Восстановить слоты 1–9 и текст гл.5–6 в конкретной книге (даже если title не «Лабиринт»).
 * Вызывается кнопкой «Канон» / при merge.
 */
export function ensureLabyrinthChapterSlots(story: Story): Story {
  const seed = buildLabyrinthStory();
  const seedByOrdinal = new Map<number, Chapter>();
  for (const ch of seed.chapters) {
    const n = ordinalOf(ch);
    if (n != null) seedByOrdinal.set(n, ch);
  }

  const byOrdinal = new Map<number, Chapter>();
  const unnumbered: Chapter[] = [];
  for (const ch of story.chapters || []) {
    const n = ordinalOf(ch);
    if (n == null) {
      unnumbered.push(ch);
      continue;
    }
    const prev = byOrdinal.get(n);
    if (!prev || (ch.content || "").length > (prev.content || "").length) {
      byOrdinal.set(n, ch);
    }
  }

  const ordered: Chapter[] = [];
  const maxCanon = Math.max(0, ...seedByOrdinal.keys());
  for (let n = 1; n <= maxCanon; n++) {
    const canon = seedByOrdinal.get(n);
    if (!canon) continue;
    ordered.push(applyCanonChapter(byOrdinal.get(n), canon, n));
    byOrdinal.delete(n);
  }
  const extras = [...byOrdinal.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ch]) => ch);

  return {
    ...story,
    chapters: [...ordered, ...extras, ...unnumbered],
    worldBible: story.worldBible?.includes(LABYRINTH_CANON_MARKER)
      ? story.worldBible
      : seed.worldBible,
    bookPlan: story.bookPlan?.includes(LABYRINTH_CANON_MARKER) ? story.bookPlan : seed.bookPlan,
    updatedAt: Date.now(),
  };
}

/** Короткие правила для WorldBuilder + склейки в worldBible. */
export const LABYRINTH_WORLD_RULES: WorldRule[] = [
  {
    id: "lr-level-1",
    title: "Уровень 1 — Темнота",
    content:
      "Абсолютная темнота, мягкие дымчатые стены, ровный пол. Опасности: дезориентация, жажда, голод, паника, разряд телефона. Функция телефона: тепловизор. Метки ключом загораются бледно-синим.",
  },
  {
    id: "lr-phone-charge",
    title: "Заряд и числа в воздухе",
    content:
      "Число над источником (напр. 20) — доступный ресурс. Может конвертироваться в % заряда телефона (20 → ~20%). Беспроводная зарядка: телефон на диск/узел у числа; число тает к 0, заряд растёт. Полный разряд = слепая зона (без тепловизора/карты позже).",
  },
  {
    id: "lr-food-mint",
    title: "Питательная масса (мята и мёд)",
    content:
      "Зелёная/дымчатая масса со вкусом мяты и мёда снимает голод и жажду. Это отдельный ресурс от числа-заряда: можно и поесть, и зарядить, если механика узла это позволяет. Запах мяты/мёда — маркер ресурса на расстоянии.",
  },
  {
    id: "lr-rings-puzzle",
    title: "Головоломка колец (гл. 6, канон)",
    content:
      "Три концентрических кольца, на каждом 12 секторов. Каждое кольцо вращается независимо по часовой или против. Сектора выравниваются относительно всей конструкции и друг друга (не «красивый узор»). Яркость висящего числа = близость к верной сборке (ближе — ярче, дальше — тусклее). Значение числа растёт к max 20 при хорошем соотношении и падает к 0 при ошибках. Цель: поймать яркую 20, затем забрать ресурс (еда/заряд). После съёма ресурса кольца могут «остыть» — разовый пакет.",
  },
  {
    id: "lr-continuity-5-6",
    title: "Стык глав 5→6 (обязательный)",
    content:
      "Конец 5: телефон ~2%, сильный голод и жажда; герой рвёт правило левой руки, чертит диагональный символ отмены (бледно-синий шрам), шагает в ТЕМНОТУ правого коридора на запах мяты и мёда. Начало 6: НЕ сыт, НЕ 20%, НЕ «Начну снова», НЕ «свет из ниоткуда». Сначала тьма и спуск; зеленоватое пятно вдали = число 20. Еда и 20% — награда после головоломки.",
  },
  {
    id: "lr-style",
    title: "Голос и повествование",
    content:
      "1 лицо, сухой инженерный тон, survival, стиль «дневник» (канон: Word-гл.6 optimal). «Я» умеренно (~3–7 на 100 слов): не в каждое предложение, но не вычищать до нуля. Смешивай полные фразы и короткие бытовые («Подумал, что…», «Не сейчас.»). Конкретика: %, жест, запах, сектор/кольцо — вместо абстрактных выводов. Без тройных петель «и что дальше?». Без «Начну снова», без часов на экране. Без штампов «волна ужаса», «холод по спине». Только русский. Образец стиля: главы 5–6 (authorSample).",
  },
  {
    id: "lr-style-patterns-ch6",
    title: "Паттерны стиля гл. 6 (для продолжения)",
    content:
      "Опора на текст Word «Глава 6. Число 20» (optimal): 1) Вход из стыка 5→6 — тьма, правый коридор, диагональ отмены, 2%, голод/жажда, запах мяты/мёда. 2) Механика: три кольца × 12, яркость = сборка, поймать яркую 20. 3) Ресурс: масса → сытость; телефон на диск → число тает, заряд ~20%. 4) Финал: отпечаток ладони ВИДЕН, НЕ активирован («Не сейчас… им займусь, когда буду готов»). 5) Ритм: абзацы ~40–80 слов, внутренний монолог без лекций читателю. 6) Дальше (гл.7+): тот же голос и конкретика; не откатывать заряд к 2% и не решать кольца заново с нуля.",
  },
  {
    id: "lr-detector-yandex",
    title: "Нейродетектор (Yandex) — стиль",
    content:
      "Цель: HUMAN-сегменты, не телеграф и не UI-лог. Связная проза + бытовые мысли. Один проход сцены. Конкретика (жест, заряд %, запах) вместо «приближаюсь к пониманию». Не цепочки «1. метка 2. метка», не CW/CCW/NFC-латиница, не спам «не найдено: N». После генерации: локальный AI-tell (в т.ч. category interface) + при возможности Yandex; AI-сегменты — rewrite_detector_segments, HUMAN не трогать. Эталон: гл.6 optimal.",
  },
  {
    id: "lr-palm-ch7",
    title: "Отпечаток ладони (крючок гл. 7)",
    content:
      "В конце гл. 6 отпечаток только обнаружен, НЕ активирован. Гл. 7: сон (институт-загадка → дом/мама/зачёт → сон во сне → явь). Телефон к отпечатку → «обнаружена новая метка», список меток; сбор светящихся точек у колец/чаши/стены — через жест, без нумерованного лога на всю главу; ритм по кончикам пальцев → двойная ладонь (2-й слой, другой цвет); счётчик «не найдено» редко; вход Ур.2. Не откатывать 20%. Не решать кольца с нуля.",
  },
  {
    id: "lr-style-patterns-ch7",
    title: "Паттерны стиля гл. 7 (сон + метки, анти-UI)",
    content:
      "1) Стык с гл.6: 20%, сытость, «не сейчас», засыпает у стены. 2) Сон: аудитория+загадка → дом/мама → сон во сне → явь (кроссовки/ключи/%). 3) Метки: телефон плашмя к отпечатку; точки по кольцам/чаше/стене; ритм пальцев → янтарный 2-й слой; щель Ур.2. 4) Пиши как гл.6: тело, %, запах, ошибка попытки; подписи экрана вшиты в абзац. 5) Запрет: 10+ пунктов «N. текст», CW/CCW, спам счётчика, телеграф на весь текст, отполированная «новелла» сна.",
  },
  {
    id: "lr-resource-choice",
    title: "Правило: ресурс — это выбор",
    content:
      "Еда, вода, заряд, сон, безопасность ограничены. Поздние узлы могут требовать выбрать: съесть массу ИЛИ зарядить телефон. На узле «Число 20» (гл. 6) канонично доступны оба: сначала масса, затем конвертация числа в заряд.",
  },
];

export const LABYRINTH_WORLD_BIBLE = `${LABYRINTH_CANON_MARKER}

БИБЛИЯ МИРА — «Лабиринт. Путь домой» (рабочий канон приложения)

ЖАНР И ТОН
Попаданство, техно-мистика, survival, психологический триллер. Сначала: один человек, темнота, разряжающийся телефон. Мир ведёт себя как система, но без прямой «игровой» UI-болтовни. Герой — студент, технический склад ума, ирония в стрессе, ошибки и паника допустимы.

ГЕРОЙ
Один. Экипировка: футболка, джинсы, кроссовки, связка ключей, смартфон. Нет других людей до встреч по плану (гл. 20+). Тон: 1 лицо.

ЛАБИРИНТ — УРОВЕНЬ 1
Темнота, мягкие дымчатые стены, чёрный ровный пол. Опасности: дезориентация, жажда, голод, паника, 2–3% заряда. Метки ключом — бледно-синие. Правило левой руки работает, пока Лабиринт не загонит в петлю; ломать шаблон — осознанный выбор (символ отмены).

ТЕЛЕФОН
Уровень 1: тепловизор; нет связи/интернета/фонарика. Заряд — критический ресурс. Источники: числа в воздухе, узлы, станции. Число N ≈ до N% заряда при конвертации.

РЕСУРС «ЧИСЛО 20» И КОЛЬЦА (канон гл. 6)
Тупик ~2×2 м. В воздухе зеленоватое число (max 20). На полу: 3 концентрических кольца × 12 секторов; вращение независимое, CW/CCW. Яркость числа = качество сборки; значение 0…20. Поймать яркую 20 → питательная мятно-медовая масса (голод/жажда) + заряд телефона до ~20% (число тает). Отпечаток ладони — только в конце, без активации.

СТЫК 5→6
5 заканчивается: 2%, жажда/голод, диагональ отмены, шаг в правый тёмный коридор к мяте/мёду.
6 начинается из этой тьмы; «свет» = появление числа, не лампочка из ниоткуда.

УРОВЕНЬ 2+ (кратко)
Карта, датчики, давление, магнит, скрытые закладки, комнаты выбора, следы чужих, попутчики, петли, автосохранение — по плану книги. Не раскрывать полную правду Лабиринта в первой книге.

ПРАВИЛА
1) У каждого уровня есть выход. 2) Простой путь ≠ правильный. 3) Ресурс — выбор. 4) Телефон открывает функции за действие. 5) Лабиринт запоминает. 6) Смерть позже может быть не концом. 7) Дом существует, но путь к нему — через систему.

ЯЗЫК
Зелёный — ресурс/заряд. Синий — метки/информация. Числа, запахи, вибрации телефона — речь Лабиринта.

${LABYRINTH_WORLD_RULES.map((r) => `[${r.title}]\n${r.content}`).join("\n\n")}
`;

export const LABYRINTH_BOOK_PLAN = `${LABYRINTH_CANON_MARKER}

ПЛАН КНИГИ — «Лабиринт. Путь домой»

АКТ 1. ПОПАДАНИЕ
1. Загрузка завершена — гроза, «Загрузка завершена», темнота.
2. Уровень 1 — приход в себя, экипировка, надпись «Уровень 1».
3. Тепловизор — единственная функция, низкий заряд.
4. Правило левой руки — метки ключом, обход.
5. Первый круг — петля, жажда/голод, 2–3% заряда; отказ от левой руки; символ отмены; шаг в правый коридор (мята/мёд).
6. Число 20 — спуск в тьме; узел с числом; ГОЛОВОЛОМКА: 3 кольца × 12 секторов, независимое вращение; яркость и значение 0…20; поймать яркую 20; еда; заряд → 20%; отпечаток ладони (не активировать).
7. Отпечаток ладони — активация следа, кольца/линии перехода, Уровень 2.

АКТ 2. ПЕРВЫЕ ПРАВИЛА
8. Уровень 2 — карта и датчики, шаги в статусе.
9. Карта — пропущенная скрытая закладка.
10. Датчики — магнитометр, барометр и др.
11. Полосы на стенах — зоны без экрана.
12. Магнитная ловушка — металл/ключи/телефон.
13. Давление — барометр, герметизация.
14. Первая скрытая закладка — «Журнал», запись «Ты уже выбирал не туда».

АКТ 3–7 — по полной библии: комнаты выбора, чужой почерк, голоса, кровь, встреча, союз, конкуренты, смерть/респаун, петли, ложный выход, «Маршрут домой 1%», крючок на кн. 2.

КАНОН-ОГРАНИЧЕНИЯ ДЛЯ ГЕНЕРАЦИИ
- Не ломать стык 5→6 и механику колец гл. 6.
- Не открывать карту/датчики до гл. 7–8.
- Не вводить других людей до плана встречи.
- Не повторять одну сцену трижды. «Я» умеренно (дневник), не телеграф без «я».
- Без «Начну снова» и без случайных часов на экране (3:47 и т.п.), если не канон.
- Синопсис главы (summary) — обязательные события; previousChapter — хвост для стыка.
- Стиль под Yandex: см. правило «Нейродетектор» и humanStyleDirectives.YANDEX_DETECTOR_STYLE.
`;

export const LABYRINTH_CHARACTER: Character = {
  id: "char-labyrinth-hero",
  name: "Герой (студент)",
  role: "Протагонист",
  traits: "Ироничный в стрессе, аналитик, не геройствует зря, ошибается и злится, технический склад ума",
  goals: "Выжить, сохранить заряд телефона, понять правила Лабиринта, найти путь домой",
  description:
    "Студент 20–25 лет. Футболка, джинсы, кроссовки, связка ключей, смартфон с тепловизором. Один на Уровне 1. Имя в тексте может не называться — повествование от 1 лица.",
};

/**
 * Образец голоса для humanize / generate: хвост гл.5 + полный текст гл.6 из Word optimal.
 * Уходит в authorSample, чтобы гл.7+ писались в тех же паттернах.
 */
export const LABYRINTH_AUTHOR_SAMPLE: string = [
  chapter5Text.trim().slice(-2500),
  chapter6Text.trim(),
]
  .filter(Boolean)
  .join("\n\n");

export const LABYRINTH_STYLE_DESCRIPTION =
  "Голос канона «Лабиринт» по главам 5–6 (Word optimal): 1 лицо, дневник инженера-студента в survival. Конкретика (заряд %, запах, кольца, ключи), умеренное «я», без пафоса и без телеграфа. Стыки между главами непрерывны; механики не откатываются.";

export const LABYRINTH_PROTECTED_TERMS = [
  "тепловизор",
  "Уровень 1",
  "Уровень 2",
  "Лабиринт",
  "мята",
  "мёд",
  "меда",
  "число 20",
  "20%",
  "отпечаток ладони",
  "правило левой руки",
  "кольца",
];

/** Паспорт голоса по тексту Word-гл.6 — для generate/humanize без отдельной загрузки файла. */
export const LABYRINTH_VOICE_SHEET: AuthorVoiceSheet = {
  summary:
    "Повествование от 1 лица: студент в темноте, думает вслух, считает ресурсы, ошибается, злится. Ритм дневника — связная проза с бытовыми репликами, не инструкция и не «красивая литература».",
  voiceRules: [
    "1 лицо; «я» умеренно (есть в тексте, но не в каждом предложении).",
    "Конкретика: проценты заряда, запахи (мята/мёд), жесты (ключ, ладонь, кольца), размеры (~2×2 м).",
    "Внутренний монолог короткий: «Подумал…», «Не сейчас», «Ну, что же…» — без лекций читателю.",
    "Абзацы средней длины; чередуй действие и короткую мысль.",
    "Механики описывай через пробу героя (крутил — ярче/тусклее), не через энциклопедию мира.",
    "Стык с прошлой главой: не сбрасывай голод/заряд/локацию без причины.",
    "Крючки оставляй открытыми (отпечаток есть — активация позже), не закрывай всё в одной главе.",
  ],
  avoid: [
    "Начну снова",
    "случайные часы на экране (3:47 и т.п.)",
    "тройные петли «и что дальше?» / повтор одной сцены",
    "телеграф без «я» на весь текст",
    "штампы: волна ужаса, холодок по спине, воздух сгустился",
    "откат канона: снова 2% и кольца с нуля после уже снятого ресурса",
    "активация отпечатка ладони до главы 7",
    "другие люди на Уровне 1",
  ],
  evidence: [
    {
      quote: "Правый коридор был темнее, чем петля за спиной.",
      observation: "Стык 5→6: продолжение тьмы, не «свет из ниоткуда».",
    },
    {
      quote: "Мне нужно было поймать именно яркую двадцатку.",
      observation: "Механика через цель героя, не через мануал.",
    },
    {
      quote: "Отпечаток никуда не денется — им займусь, когда буду готов.",
      observation: "Финал-крючок: отложено, не активировано.",
    },
  ],
};

/** Профиль автора для IndexedDB: образец = Word гл.6 (+хвост 5). */
export function buildLabyrinthAuthorProfile(now = Date.now()): AuthorProfileRecord {
  return {
    storyId: LABYRINTH_STORY_ID,
    sample: LABYRINTH_AUTHOR_SAMPLE,
    sampleFileName: LABYRINTH_AUTHOR_SAMPLE_MARKER,
    styleDescription: LABYRINTH_STYLE_DESCRIPTION,
    protectedTerms: [...LABYRINTH_PROTECTED_TERMS],
    voiceSheet: LABYRINTH_VOICE_SHEET,
    updatedAt: now,
  };
}

/**
 * Нужно ли обновить профиль автора каноном.
 * Не трогаем, если пользователь явно загрузил свой образец (sampleFileName начинается с user:).
 */
export function shouldSeedLabyrinthAuthorProfile(
  existing: AuthorProfileRecord | undefined | null,
): boolean {
  if (!existing) return true;
  const name = (existing.sampleFileName || "").trim();
  if (name.startsWith("user:")) return false;
  if (name === LABYRINTH_AUTHOR_SAMPLE_MARKER && (existing.sample || "").trim().length >= 300) {
    return false;
  }
  // старый канон-маркер / пустой образец → обновить
  if (!name || name.startsWith("labyrinth-canon") || (existing.sample || "").trim().length < 300) {
    return true;
  }
  // чужой/неизвестный файл — не затирать
  return false;
}

function chapter(
  id: string,
  title: string,
  summary: string,
  content = "",
): Chapter {
  return { id, title, summary, content };
}

/** Синопсисы 1–7: summary уходит в generate как currentChapterSummary / канон. */
export function buildLabyrinthChapters(): Chapter[] {
  return [
    chapter(
      "lab-ch-1",
      "Глава 1. Загрузка завершена",
      "Возвращение с ВУЗа, гроза, вибрация телефона, надпись «Загрузка завершена», вспышка, темнота.",
    ),
    chapter(
      "lab-ch-2",
      "Глава 2. Уровень 1",
      "Приход в себя в темноте. Футболка, джинсы, кроссовки, ключи, телефон. На экране «Уровень 1». Обычные функции мертвы.",
    ),
    chapter(
      "lab-ch-3",
      "Глава 3. Тепловизор",
      "Единственная функция — тепловизор. Коридоры, дымчатые стены, тупик. Нужно двигаться. Заряд низкий.",
    ),
    chapter(
      "lab-ch-4",
      "Глава 4. Правило левой руки",
      "Обход вдоль левой стены, метки ключом (синие). Лабиринт кажется плоским — пока.",
    ),
    chapter(
      "lab-ch-5",
      "Глава 5. Первый круг",
      "Петля, жажда, голод, заряд 3%→2%. Отказ от правила левой руки. Диагональный символ отмены на стене (бледно-синий). Шаг в ТЕМНОТУ правого коридора на запах мяты и мёда. КОНЕЦ: не сыт, не 20%.",
      chapter5Text.trim(),
    ),
    chapter(
      "lab-ch-6",
      "Глава 6. Число 20",
      "СТЫК: продолжение шага в правый тёмный коридор (2%, голод, жажда). Спуск; вдали зеленоватое пятно = число 20, не «лампочка». Тупик: ёмкость с мятно-медовой массой + 3 кольца × 12 секторов (независимо CW/CCW). Яркость = сборка; значение 0…20; поймать яркую 20. Ест — голод/жажда уходят. Телефон на диск — число тает, заряд → 20%. Отпечаток ладони обнаружен, НЕ активирован. Без повторов сцен. 1 лицо, «я» умеренно (дневник, не телеграф). Без часов на экране.",
      chapter6Text.trim(),
    ),
    chapter(
      "lab-ch-7",
      "Глава 7. Отпечаток ладони",
      "Старт: после гл. 6 — ~20%, сытость, отпечаток НЕ активирован; герой засыпает у стены. Сон: институт (загадка на доске — иначе не выйти из аудитории) → дом, мама, зачёт, весь день «лабиринт был сном» → сон во сне → выворот, просыпается в Лабиринте. Явь: телефон к отпечатку → «обнаружена новая метка», NFC-список; сбор светящихся точек (текст/числа) у колец, чаши и т.д.; ритм по кончикам пальцев отпечатка → второй слой (двойная ладонь, другой цвет); счётчик «не найдено: N»; вход Ур.2. Не откатывать заряд к 2%. Не решать кольца с нуля.",
      chapter7Text.trim(),
    ),
    chapter(
      "lab-ch-8",
      "Глава 8. Уровень 2",
      "«Уровень 2» на экране. Карта и датчики. Шаги/статус. Новая опасность среды.",
    ),
    chapter(
      "lab-ch-9",
      "Глава 9. Карта",
      "Карта пройденного; осознание пропущенной скрытой закладки.",
    ),
  ];
}

export function buildLabyrinthStory(now = Date.now()): Story {
  return {
    id: LABYRINTH_STORY_ID,
    title: "Лабиринт. Путь домой",
    genre: "психологический триллер / survival / техно-мистика",
    description:
      "Студент в многоуровневом Лабиринте. Телефон — якорь и интерфейс системы. Уровень 1: темнота, тепловизор, ресурсы-числа, кольца.",
    updatedAt: now,
    characters: [LABYRINTH_CHARACTER],
    chapters: buildLabyrinthChapters(),
    worldRules: LABYRINTH_WORLD_RULES,
    bookPlan: LABYRINTH_BOOK_PLAN,
    worldBible: LABYRINTH_WORLD_BIBLE,
  };
}

function ordinalOf(ch: Chapter): number | null {
  return chapterOrdinal(ch.title, ch.id);
}

function applyCanonChapter(existing: Chapter | undefined, canon: Chapter, n: number): Chapter {
  if (!existing) {
    return { ...canon };
  }
  // 5–6: всегда полный текст канона (стык, кольца, Word optimal)
  if (n === 5 || n === 6) {
    return {
      ...existing,
      id: existing.id || canon.id,
      title: canon.title,
      summary: canon.summary,
      content: canon.content,
    };
  }
  // 7: title+summary канона; пустой content — из seed; непустой пользовательский не затираем
  if (n === 7) {
    return {
      ...existing,
      id: existing.id || canon.id,
      title: canon.title,
      summary: canon.summary,
      content: (existing.content || "").trim() || canon.content || "",
    };
  }
  // 1–4, 8–9: title/summary канона, если пусто; content не трогаем
  return {
    ...existing,
    id: existing.id || canon.id,
    title: existing.title?.trim() ? existing.title : canon.title,
    summary: existing.summary?.trim() ? existing.summary : canon.summary,
    content: existing.content || "",
  };
}

/**
 * Влить/обновить канон Лабиринта в список stories (localStorage).
 * - нет story → prepend seed
 * - есть → bible/plan/rules; гл.5–6 content; слоты 1–9 по порядку; удалённые главы восстанавливаются
 */
export function mergeLabyrinthCanonIntoStories(stories: Story[]): Story[] {
  const seed = buildLabyrinthStory();
  const list = Array.isArray(stories) ? [...stories] : [];
  const idx = list.findIndex((s) => isLabyrinthStory(s));

  if (idx < 0) {
    return [seed, ...list];
  }

  const existing = list[idx];
  const already =
    typeof existing.worldBible === "string" &&
    existing.worldBible.includes(LABYRINTH_CANON_MARKER);

  const withSlots = ensureLabyrinthChapterSlots(existing);

  // world rules: заменить/добавить по id канона
  const ruleMap = new Map((existing.worldRules || []).map((r) => [r.id, r]));
  for (const r of seed.worldRules) ruleMap.set(r.id, r);
  const rules = [...ruleMap.values()];

  list[idx] = {
    ...withSlots,
    id: existing.id || LABYRINTH_STORY_ID,
    title: existing.title || seed.title,
    genre: existing.genre || seed.genre,
    description: existing.description || seed.description,
    worldBible: seed.worldBible,
    bookPlan: seed.bookPlan,
    worldRules: rules,
    characters:
      existing.characters?.length > 0
        ? existing.characters.some((c) => c.id === LABYRINTH_CHARACTER.id)
          ? existing.characters.map((c) =>
              c.id === LABYRINTH_CHARACTER.id ? LABYRINTH_CHARACTER : c,
            )
          : [LABYRINTH_CHARACTER, ...existing.characters]
        : seed.characters,
    // always bump when marker changes so localStorage rewrite is obvious
    updatedAt: already ? withSlots.updatedAt : Date.now(),
  };

  return list;
}
