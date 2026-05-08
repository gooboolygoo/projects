import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

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
