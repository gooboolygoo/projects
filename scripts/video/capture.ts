import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

export type CaptureResult = {
  shots: string[];
};

export async function captureShots(args: {
  url: string;
  outDir: string;
  count?: number;
  width?: number;
  height?: number;
}): Promise<CaptureResult> {
  const count = args.count ?? 4;
  const width = args.width ?? 1080;
  const height = args.height ?? 1920;

  await mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  const shots: string[] = [];
  try {
    await page.goto(args.url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(800);

    const fullHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const maxScroll = Math.max(0, fullHeight - height);

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const scrollY = Math.round(maxScroll * t);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), scrollY);
      await page.waitForTimeout(200);

      const file = join(args.outDir, `shot-${String(i + 1).padStart(2, "0")}.png`);
      await page.screenshot({
        path: file,
        fullPage: false,
        type: "png",
        clip: { x: 0, y: 0, width, height },
      });
      shots.push(file);
    }
  } finally {
    await browser.close();
  }

  return { shots };
}

// ============================================================
// Interactive demo capture: Playwright recordVideo + scripted steps
// ============================================================

export type DemoStep =
  | { action: "wait"; duration_s: number }
  | { action: "drag_slider"; selector: string; from: number; to: number; duration_s: number }
  | { action: "click"; selector: string }
  | { action: "scroll_to"; selector?: string; y?: number }
  | { action: "move_mouse"; selector: string };

export type DemoConfig = {
  duration_s?: number;
  setup?: DemoStep[];
  steps: DemoStep[];
};

export type DemoCaptureResult = {
  videoFile: string;
  width: number;
  height: number;
  durationMs: number;
  preambleMs: number;
};

export async function captureDemo(args: {
  url: string;
  outDir: string;
  durationMs: number;
  demo: DemoConfig;
  width?: number;
  height?: number;
}): Promise<DemoCaptureResult> {
  const width = args.width ?? 1080;
  const height = args.height ?? 1920;
  await mkdir(args.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: args.outDir, size: { width, height } },
  });
  const page = await ctx.newPage();

  const pageCreatedAt = Date.now();
  let preambleMs = 0;

  try {
    await page.goto(args.url, { waitUntil: "networkidle", timeout: 30_000 });
    await injectCursor(page);
    await page.waitForTimeout(400);

    for (const step of args.demo.setup ?? []) {
      await runStep(page, step);
    }

    const recordStart = Date.now();
    preambleMs = recordStart - pageCreatedAt;

    for (const step of args.demo.steps) {
      await runStep(page, step);
    }

    const elapsed = Date.now() - recordStart;
    const remaining = args.durationMs - elapsed;
    if (remaining > 0) await page.waitForTimeout(remaining);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  const files = await readdir(args.outDir);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Playwright did not produce a video file");

  const target = "demo.webm";
  if (webm !== target) {
    await rename(join(args.outDir, webm), join(args.outDir, target));
  }

  return {
    videoFile: target,
    width,
    height,
    durationMs: args.durationMs,
    preambleMs,
  };
}

async function injectCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      #__demo_cursor__ {
        position: fixed;
        width: 32px;
        height: 32px;
        background: rgba(255,255,255,0.95);
        border: 2px solid rgba(0,0,0,0.55);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 2147483647;
        transition: left 90ms linear, top 90ms linear;
        box-shadow: 0 4px 16px rgba(0,0,0,0.55);
      }
      #__demo_cursor__.click {
        background: rgba(255, 224, 102, 0.95);
      }
    `;
    document.head.appendChild(style);
    const c = document.createElement("div");
    c.id = "__demo_cursor__";
    c.style.left = "50%";
    c.style.top = "50%";
    document.body.appendChild(c);
  });
}

async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ x, y }) => {
      const c = document.getElementById("__demo_cursor__");
      if (c) {
        c.style.left = `${x}px`;
        c.style.top = `${y}px`;
      }
    },
    { x, y },
  );
}

async function moveCursorToSelector(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) return;
  await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function pulseCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const c = document.getElementById("__demo_cursor__");
    if (!c) return;
    c.classList.add("click");
    setTimeout(() => c.classList.remove("click"), 220);
  });
}

async function runStep(page: Page, step: DemoStep): Promise<void> {
  switch (step.action) {
    case "wait": {
      await page.waitForTimeout(step.duration_s * 1000);
      return;
    }
    case "click": {
      await moveCursorToSelector(page, step.selector);
      await page.waitForTimeout(180);
      await pulseCursor(page);
      await page.click(step.selector);
      await page.waitForTimeout(120);
      return;
    }
    case "move_mouse": {
      await moveCursorToSelector(page, step.selector);
      await page.waitForTimeout(150);
      return;
    }
    case "scroll_to": {
      if (step.selector) {
        const box = await page.locator(step.selector).boundingBox();
        if (box) {
          const targetY = Math.max(0, box.y - 80);
          await page.evaluate(
            (y) => window.scrollTo({ top: y, behavior: "smooth" }),
            targetY,
          );
        }
      } else if (step.y != null) {
        await page.evaluate(
          (y) => window.scrollTo({ top: y, behavior: "smooth" }),
          step.y,
        );
      }
      await page.waitForTimeout(450);
      return;
    }
    case "drag_slider": {
      const el = page.locator(step.selector);
      const sliderMeta = await el.evaluate((e) => {
        const input = e as HTMLInputElement;
        const rect = input.getBoundingClientRect();
        return {
          min: parseFloat(input.min || "0"),
          max: parseFloat(input.max || "100"),
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      });

      const totalMs = step.duration_s * 1000;
      const startTime = Date.now();
      // Park cursor on the slider before dragging
      await moveCursor(
        page,
        sliderMeta.left +
          ((step.from - sliderMeta.min) / (sliderMeta.max - sliderMeta.min)) *
            sliderMeta.width,
        sliderMeta.top + sliderMeta.height / 2,
      );
      await page.waitForTimeout(120);

      while (true) {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / totalMs);
        const value = step.from + (step.to - step.from) * t;
        await el.evaluate((e, v) => {
          const input = e as HTMLInputElement;
          input.value = String(v);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
        const frac =
          (value - sliderMeta.min) / (sliderMeta.max - sliderMeta.min);
        const x = sliderMeta.left + Math.max(0, Math.min(1, frac)) * sliderMeta.width;
        const y = sliderMeta.top + sliderMeta.height / 2;
        await moveCursor(page, x, y);
        if (t >= 1) break;
        await page.waitForTimeout(40);
      }
      // Fire final input + change events to settle the value precisely
      await el.evaluate((e, v) => {
        const input = e as HTMLInputElement;
        input.value = String(v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, step.to);
      return;
    }
  }
}
