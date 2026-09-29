// Pure competition clock. Production uses Date.now(); callers can pass any `now`
// to check the deadline boundary without a test clock in the Worker.

export const MATCH_MS = 15 * 60 * 1000;

export type RoomStatus = "waiting" | "running" | "finished";
export type PlayerStatus = "waiting" | "playing" | "completed" | "timeout";

export function deadlineAtFrom(startedAt: number): number {
  return startedAt + MATCH_MS;
}

export function floorElapsedMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(MATCH_MS, Math.floor(ms / 1000) * 1000);
}

export function shouldFinalizeAtDeadline(
  now: number,
  status: RoomStatus,
  deadlineAt: number | null,
): boolean {
  return status === "running" && deadlineAt != null && now >= deadlineAt;
}

/** New answers and the completion bonus are accepted only strictly before the deadline. */
export function acceptsNewAnswer(
  now: number,
  status: RoomStatus,
  deadlineAt: number | null,
): boolean {
  return status === "running" && deadlineAt != null && now < deadlineAt;
}

export function awardsCompletionBase(input: {
  now: number;
  roomStatus: RoomStatus;
  deadlineAt: number | null;
  answered: number;
  questionCount: number;
  alreadyAwarded: boolean;
}): boolean {
  if (input.alreadyAwarded || input.answered < input.questionCount) return false;
  return acceptsNewAnswer(input.now, input.roomStatus, input.deadlineAt);
}

export type ElapsedInput = {
  now: number;
  roomStatus: RoomStatus;
  startedAt: number | null;
  deadlineAt: number | null;
  endedAt: number | null;
  playerStatus: PlayerStatus;
  finishedAt: number | null;
};

/**
 * Whole seconds, capped at 15:00. Completed time is frozen at finish.
 * Unfinished after a natural cutoff is exactly MATCH_MS; after a manual stop
 * it is end-start, also floored to a second. Ties compare this value.
 */
export function elapsedMs(input: ElapsedInput): number {
  if (input.startedAt == null) return 0;
  if (input.playerStatus === "completed" && input.finishedAt != null) {
    return floorElapsedMs(input.finishedAt - input.startedAt);
  }
  if (input.roomStatus === "finished") {
    if (input.deadlineAt != null && input.endedAt != null && input.endedAt >= input.deadlineAt) {
      return MATCH_MS;
    }
    if (input.endedAt == null) return MATCH_MS;
    return floorElapsedMs(input.endedAt - input.startedAt);
  }
  const cap = input.deadlineAt ?? input.startedAt + MATCH_MS;
  return floorElapsedMs(Math.min(input.now, cap) - input.startedAt);
}

/** Competition ranks (1, 1, 3) aligned to the input order. Compare already-floored elapsedMs. */
export function competitionRanks(
  players: readonly { score: number; elapsedMs: number }[],
): number[] {
  const order = players.map((_, index) => index).sort((i, j) => {
    const a = players[i];
    const b = players[j];
    if (a.score !== b.score) return b.score - a.score;
    if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    return i - j;
  });
  const ranks = new Array<number>(players.length);
  for (let place = 0; place < order.length; place++) {
    const index = order[place];
    const previous = place === 0 ? -1 : order[place - 1];
    const tied = previous >= 0
      && players[previous].score === players[index].score
      && players[previous].elapsedMs === players[index].elapsedMs;
    ranks[index] = tied ? ranks[previous] : place + 1;
  }
  return ranks;
}
