import act1 from "../web/game/scene/act1.txt";
import act2 from "../web/game/scene/act2.txt";
import act3 from "../web/game/scene/act3.txt";
import act4 from "../web/game/scene/act4.txt";
import review from "../web/game/scene/review.txt";
import hit from "../web/game/scene/hit.txt";
import reviewHit from "../web/game/scene/review_hit.txt";
import miss from "../web/game/scene/miss.txt";
import pw from "../web/game/scene/pw.txt";
import reviewMiss from "../web/game/scene/review_miss.txt";
import ending from "../web/game/scene/ending.txt";

type Effect =
  | { kind: "hit"; points: number }
  | { kind: "miss"; resetCombo: boolean }
  | { kind: "review-hit"; points: number }
  | { kind: "review-miss"; resetCombo: boolean };

type Option = { label: string; text: string; effect: Effect };

export type Question = {
  id: string;
  kind: "narrative" | "review";
  options: Option[];
};

export type PublicQuestion = {
  id: string;
  options: { label: string; text: string }[];
};

const QUESTION_SOURCES = [act1, act2, act3, act4, review];
const EXPECTED_IDS = [
  ...Array.from({ length: 20 }, (_, index) => `n${index + 1}`),
  "r1",
  "r2",
  "r3",
];

function strip(line: string): string {
  let body = line.trim();
  if (body.endsWith(";")) body = body.slice(0, -1).trimEnd();
  return body;
}

function unconditionalScoreAdd(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^setVar:score=score\+(\d+)$/.exec(strip(line));
    if (match) return Number(match[1]);
  }
  return null;
}

function resetsCombo(text: string): boolean {
  return text.split(/\r?\n/).some((line) => /^setVar:combo=0$/.test(strip(line)));
}

function comboRule(text: string): { every: number; bonus: number } {
  for (const line of text.split(/\r?\n/)) {
    const match = /^setVar:score=score\+(\d+) -when=combo==(\d+)$/.exec(strip(line));
    if (match) return { bonus: Number(match[1]), every: Number(match[2]) };
  }
  throw new Error("hit.txt 没有连击规则");
}

function calledScene(line: string): { scene: string; pts: number | null } | null {
  const body = strip(line);
  const match = /^callScene:([^\s]+)/.exec(body);
  if (!match) return null;
  const pts = /(?:^|\s)-pts=(\d+)/.exec(body);
  return { scene: match[1], pts: pts ? Number(pts[1]) : null };
}

function labelBlocks(text: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let name: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (name) blocks.set(name, buf.join("\n"));
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^label:(\S+)$/.exec(strip(line));
    if (match) {
      flush();
      name = match[1];
      buf = [];
      continue;
    }
    if (name) buf.push(line);
  }
  flush();
  return blocks;
}

const REVIEW_POINTS = unconditionalScoreAdd(reviewHit);
const BASE_POINTS = unconditionalScoreAdd(ending);
const COMBO = comboRule(hit);
const SCENE_RESETS: Record<string, boolean> = {
  "miss.txt": resetsCombo(miss),
  "pw.txt": resetsCombo(pw),
  "review_miss.txt": resetsCombo(reviewMiss),
};

if (REVIEW_POINTS == null || BASE_POINTS == null) {
  throw new Error("无法从剧本解析回顾分或基础分");
}

function effectFor(block: string): Effect | null {
  for (const line of block.split(/\r?\n/)) {
    const called = calledScene(line);
    if (!called) continue;
    if (called.scene === "hit.txt") {
      if (called.pts == null) throw new Error("callScene:hit.txt 缺少 -pts");
      return { kind: "hit", points: called.pts };
    }
    if (called.scene === "review_hit.txt") return { kind: "review-hit", points: REVIEW_POINTS };
    if (called.scene === "miss.txt" || called.scene === "pw.txt") {
      return { kind: "miss", resetCombo: SCENE_RESETS[called.scene] ?? false };
    }
    if (called.scene === "review_miss.txt") {
      return { kind: "review-miss", resetCombo: SCENE_RESETS[called.scene] ?? false };
    }
  }
  return null;
}

function parseQuestions(): Question[] {
  const blocks = new Map<string, string>();
  for (const source of QUESTION_SOURCES) {
    for (const [label, block] of labelBlocks(source)) blocks.set(label, block);
  }
  const questions: Question[] = [];
  for (const source of QUESTION_SOURCES) {
    for (const line of source.split(/\r?\n/)) {
      const body = strip(line);
      if (!body.startsWith("choose:")) continue;
      const options = body.slice("choose:".length).split("|").map((part) => {
        const splitAt = part.lastIndexOf(":");
        if (splitAt <= 0) throw new Error(`无法解析选项：${part}`);
        const text = part.slice(0, splitAt).trim();
        const label = part.slice(splitAt + 1).trim();
        const effect = effectFor(blocks.get(label) ?? "");
        if (!effect) throw new Error(`选项 ${label} 没有计分场景`);
        return { label, text, effect };
      });
      const id = options[0]?.label.split("_")[0];
      if (!id || options.some((option) => !option.label.startsWith(`${id}_`))) {
        throw new Error(`选项标签不属于同一题：${options.map((option) => option.label).join(",")}`);
      }
      const correct = options.filter((option) => option.effect.kind === "hit" || option.effect.kind === "review-hit");
      if (correct.length !== 1) throw new Error(`${id} 的还原项不是恰好一个`);
      questions.push({ id, kind: id.startsWith("r") ? "review" : "narrative", options });
    }
  }
  return questions;
}

function parseTitles(text: string): (score: number) => string {
  const jumps: { label: string; min: number }[] = [];
  let fallbackLabel: string | null = null;
  const titles = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const body = strip(line);
    const conditional = /^jumpLabel:(rank\d+) -when=score>=(\d+)$/.exec(body);
    if (conditional) {
      jumps.push({ label: conditional[1], min: Number(conditional[2]) });
      continue;
    }
    const plain = /^jumpLabel:(rank\d+)$/.exec(body);
    if (plain) {
      fallbackLabel = plain[1];
      continue;
    }
    const label = /^label:(rank\d+)$/.exec(body);
    if (label) {
      current = label[1];
      continue;
    }
    const title = /^称号:「([^」]+)」/.exec(body);
    if (title && current) titles.set(current, title[1]);
  }
  const bands = jumps
    .map((jump) => ({ min: jump.min, title: titles.get(jump.label) }))
    .filter((band): band is { min: number; title: string } => Boolean(band.title))
    .sort((a, b) => b.min - a.min);
  const fallback = (fallbackLabel && titles.get(fallbackLabel)) || "";
  if (!bands.length || !fallback) throw new Error("ending.txt 未解析出称号");
  return (score: number) => {
    for (const band of bands) if (score >= band.min) return band.title;
    return fallback;
  };
}

export const QUESTIONS: readonly Question[] = parseQuestions();
export const QUESTION_COUNT = QUESTIONS.length;
const titleForScore = parseTitles(ending);

export function titleFor(score: number): string {
  return titleForScore(score);
}

export function publicQuestions(): PublicQuestion[] {
  return QUESTIONS.map((question) => ({
    id: question.id,
    options: question.options.map((option) => ({ label: option.label, text: option.text })),
  }));
}

export function scoreAnswers(choices: readonly string[], baseAwarded: boolean): {
  score: number;
  hits: number;
  answered: number;
} {
  let score = 0;
  let hits = 0;
  let combo = 0;
  for (let index = 0; index < choices.length; index++) {
    const question = QUESTIONS[index];
    if (!question) break;
    const option = question.options.find((item) => item.label === choices[index]);
    const effect = option?.effect;
    if (effect?.kind === "hit") {
      score += effect.points;
      hits += 1;
      combo += 1;
      if (combo === COMBO.every) {
        score += COMBO.bonus;
        combo = 0;
      }
    } else if (effect?.kind === "review-hit") {
      score += effect.points;
    } else if (effect?.kind === "miss" || effect?.kind === "review-miss") {
      if (effect.resetCombo) combo = 0;
    } else if (question.kind === "narrative") {
      combo = 0;
    }
  }
  if (baseAwarded) score += BASE_POINTS;
  return { score, hits, answered: choices.length };
}

function correctLabel(question: Question): string {
  const option = question.options.find((item) => item.effect.kind === "hit" || item.effect.kind === "review-hit");
  if (!option) throw new Error(`${question.id} 缺少还原项`);
  return option.label;
}


function assertScoring(): void {
  if (QUESTION_COUNT !== 23 || QUESTIONS.map((question) => question.id).join() !== EXPECTED_IDS.join()) {
    throw new Error(`题目不是 n1–n20 + r1–r3：${QUESTIONS.map((question) => question.id).join(",")}`);
  }
  const perfect = scoreAnswers(QUESTIONS.map(correctLabel), true);
  if (perfect.score !== 53 || perfect.hits !== 20 || perfect.answered !== 23) {
    throw new Error(`满分应为 53，实际 ${perfect.score}/${perfect.hits}/${perfect.answered}`);
  }
}

assertScoring();
