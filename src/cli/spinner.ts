const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;

export type Spinner = {
  start: (text: string) => void;
  update: (text: string) => void;
  setProgress: (current: number, total: number) => void;
  stop: (finalText?: string) => void;
};

function shouldEnableSpinner(): boolean {
  if (!process.stderr.isTTY) return false;
  const v = (process.env.NO_SPINNER || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return false;
  return true;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function renderProgressBar(current: number, total: number, width = 18): string {
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return "";
  const ratio = clamp(current / total, 0, 1);
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);
  return `[${"=".repeat(filled)}${".".repeat(empty)}] ${current}/${total}`;
}

export function createSpinner(opts: { intervalMs?: number } = {}): Spinner {
  const enabled = shouldEnableSpinner();
  const intervalMs = Math.max(50, opts.intervalMs ?? 120);

  let frameIdx = 0;
  let text = "";
  let startedAtMs = 0;
  let lastLineLength = 0;
  let progressCurrent: number | null = null;
  let progressTotal: number | null = null;
  let timer: NodeJS.Timeout | null = null;

  const buildLine = () => {
    const frame = SPINNER_FRAMES[frameIdx++ % SPINNER_FRAMES.length];
    const elapsed = startedAtMs ? formatElapsed(Date.now() - startedAtMs) : "00:00";
    const progress =
      progressCurrent !== null && progressTotal !== null
        ? renderProgressBar(progressCurrent, progressTotal)
        : "";
    return `${frame} ${text}${progress ? " " + progress : ""} (${elapsed})`;
  };

  const render = () => {
    const line = buildLine();
    const pad = Math.max(0, lastLineLength - line.length);
    lastLineLength = line.length;
    process.stderr.write(`\r${line}${pad ? " ".repeat(pad) : ""}`);
  };

  const clearLine = () => {
    if (!lastLineLength) return;
    process.stderr.write(`\r${" ".repeat(lastLineLength)}\r`);
    lastLineLength = 0;
  };

  const start = (t: string) => {
    text = t;
    if (!enabled) return;
    if (timer) clearInterval(timer);
    frameIdx = 0;
    startedAtMs = Date.now();
    progressCurrent = null;
    progressTotal = null;
    render();
    timer = setInterval(render, intervalMs);
  };

  const update = (t: string) => {
    text = t;
    if (!enabled) return;
    render();
  };

  const setProgress = (current: number, total: number) => {
    progressCurrent = current;
    progressTotal = total;
    if (!enabled) return;
    render();
  };

  const stop = (finalText?: string) => {
    if (!enabled) return;
    if (timer) clearInterval(timer);
    timer = null;
    const elapsed = startedAtMs ? formatElapsed(Date.now() - startedAtMs) : "00:00";
    clearLine();
    if (finalText) process.stderr.write(`${finalText} (${elapsed})\n`);
    startedAtMs = 0;
    progressCurrent = null;
    progressTotal = null;
  };

  return { start, update, setProgress, stop };
}
