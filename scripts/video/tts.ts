import { writeFile } from "node:fs/promises";
import { Communicate } from "edge-tts-universal";

export const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

export type WordTiming = {
  word: string;
  startMs: number;
  durationMs: number;
};

export type TtsResult = {
  audioPath: string;
  durationMs: number;
  words: WordTiming[];
};

const HNS_PER_MS = 10_000;

export async function synthesize(args: {
  text: string;
  outPath: string;
  voice?: string;
  rate?: string;
}): Promise<TtsResult> {
  const audioChunks: Buffer[] = [];
  const words: WordTiming[] = [];

  const communicate = new Communicate(args.text, {
    voice: args.voice ?? DEFAULT_VOICE,
    rate: args.rate ?? "+0%",
  });

  for await (const chunk of communicate.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      audioChunks.push(chunk.data);
    } else if (chunk.type === "WordBoundary" && chunk.text) {
      const offset = typeof chunk.offset === "number" ? chunk.offset : 0;
      const duration = typeof chunk.duration === "number" ? chunk.duration : 0;
      words.push({
        word: chunk.text,
        startMs: Math.round(offset / HNS_PER_MS),
        durationMs: Math.round(duration / HNS_PER_MS),
      });
    }
  }

  if (audioChunks.length === 0) {
    throw new Error("Edge TTS returned no audio data.");
  }

  await writeFile(args.outPath, Buffer.concat(audioChunks));

  const last = words[words.length - 1];
  const durationMs = last ? last.startMs + last.durationMs : 0;

  return {
    audioPath: args.outPath,
    durationMs,
    words,
  };
}
