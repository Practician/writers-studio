import type { QualityRubric, RubricPreset } from "./types";

const BASE_DIMENSIONS = [
  {
    id: "canon" as const,
    title: "Канон и фактическая целостность",
    weight: 30,
    description: "Сохраняет факты, числа, предметы, ограничения мира и защищённые термины.",
  },
  {
    id: "continuity" as const,
    title: "POV, последовательность и причинность",
    weight: 20,
    description: "Не меняет знания героя, порядок действий, точку зрения и причинные связи.",
  },
  {
    id: "voice" as const,
    title: "Авторский голос и регистр",
    weight: 20,
    description: "Следует доказательному паспорту голоса без механической имитации привычек автора.",
  },
  {
    id: "scene_value" as const,
    title: "Ценность сцены",
    weight: 15,
    description: "Сохраняет или усиливает движение ситуации, напряжение и конкретные действия.",
  },
  {
    id: "clarity" as const,
    title: "Ясность, ритм и естественность",
    weight: 15,
    description: "Улучшает читаемость и ритм без метатекста, штампов и искусственной гладкости.",
  },
];

export function buildQualityRubric(preset: RubricPreset = "author_edit"): QualityRubric {
  const sceneSuffix = preset === "scene_revision"
    ? " Оценивай также, насколько версия усиливает конкретную драматическую задачу текущей сцены."
    : "";

  return {
    id: `quality-gate/${preset}/v1`,
    version: "v1",
    dimensions: BASE_DIMENSIONS.map((dimension) => ({
      ...dimension,
      description: dimension.description + sceneSuffix,
    })),
    totalWeight: 100,
  };
}
