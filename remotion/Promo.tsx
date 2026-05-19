import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type WordTiming = {
  word: string;
  startMs: number;
  durationMs: number;
};

export type PromoInputProps = {
  title: string;
  url: string;
  words: WordTiming[];
  shotCount: number;
  voiceDurationMs: number;
  videoFile?: string;
  videoPreambleMs?: number;
};

export const defaultPromoProps: PromoInputProps = {
  title: "Hello, world",
  url: "https://gooboolygoo.github.io/projects/hello/",
  words: [],
  shotCount: 4,
  voiceDurationMs: 22000,
  videoFile: undefined,
  videoPreambleMs: 0,
};

const OUTRO_FRAMES = 90;

export const calculatePromoMetadata = ({
  props,
}: {
  props: PromoInputProps;
}) => {
  const fps = 30;
  const voiceFrames = Math.ceil((props.voiceDurationMs / 1000) * fps);
  const totalFrames = voiceFrames + OUTRO_FRAMES;
  return {
    durationInFrames: Math.max(totalFrames, 60),
    fps,
    width: 1080,
    height: 1920,
  };
};

export const Promo: React.FC<PromoInputProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const voiceFrames = Math.ceil((props.voiceDurationMs / 1000) * fps);
  const outroStart = voiceFrames;

  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      <Sequence durationInFrames={voiceFrames}>
        <MainScene
          shotCount={props.shotCount}
          words={props.words}
          voiceDurationMs={props.voiceDurationMs}
          videoFile={props.videoFile}
          videoPreambleMs={props.videoPreambleMs ?? 0}
        />
      </Sequence>

      <Sequence durationInFrames={voiceFrames}>
        <Audio src={staticFile("audio.mp3")} />
      </Sequence>

      <Sequence
        from={outroStart}
        durationInFrames={durationInFrames - outroStart}
      >
        <OutroCard url={props.url} />
      </Sequence>
    </AbsoluteFill>
  );
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

const MainScene: React.FC<{
  shotCount: number;
  words: WordTiming[];
  voiceDurationMs: number;
  videoFile?: string;
  videoPreambleMs: number;
}> = ({ shotCount, words, voiceDurationMs, videoFile, videoPreambleMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneMs = (frame / fps) * 1000;

  if (videoFile) {
    return (
      <AbsoluteFill style={{ background: "#0a0a0a" }}>
        <OffthreadVideo
          src={staticFile(videoFile)}
          startFrom={Math.max(0, Math.round((videoPreambleMs / 1000) * fps))}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.0) 75%, rgba(0,0,0,0.55) 100%)",
          }}
        />
        <Captions sceneMs={sceneMs} words={words} />
      </AbsoluteFill>
    );
  }

  const safeShots = Math.max(1, shotCount);
  const perShotMs = voiceDurationMs / safeShots;
  const shotIdx = Math.min(safeShots - 1, Math.floor(sceneMs / perShotMs));
  const shotProgress = Math.min(
    1,
    (sceneMs - shotIdx * perShotMs) / perShotMs,
  );

  const zoom = interpolate(shotProgress, [0, 1], [1.05, 1.18]);
  const panX = interpolate(shotProgress, [0, 1], [-20, 20]);

  const shotFile = `shot-${String(shotIdx + 1).padStart(2, "0")}.png`;

  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      <Img
        src={staticFile(shotFile)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${zoom}) translateX(${panX}px)`,
          transformOrigin: "center",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.0) 75%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      <Captions sceneMs={sceneMs} words={words} />
    </AbsoluteFill>
  );
};

const CAPTION_FONT =
  "Inter, 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

const CAPTION_CHUNK_MAX_CHARS = 50;

function chunkWordsByLength(
  words: WordTiming[],
  maxChars: number,
): WordTiming[][] {
  const chunks: WordTiming[][] = [];
  let current: WordTiming[] = [];
  let chars = 0;
  for (const w of words) {
    const wlen = w.word.length;
    const extra = current.length === 0 ? wlen : 1 + wlen;
    if (current.length > 0 && chars + extra > maxChars) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(w);
    chars += current.length === 1 ? wlen : 1 + wlen;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const Captions: React.FC<{ sceneMs: number; words: WordTiming[] }> = ({
  sceneMs,
  words,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (words.length === 0) return null;

  let activeIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (sceneMs >= w.startMs && sceneMs < w.startMs + w.durationMs) {
      activeIdx = i;
      break;
    }
    if (sceneMs >= w.startMs) activeIdx = i;
  }
  if (activeIdx < 0) return null;

  const chunks = chunkWordsByLength(words, CAPTION_CHUNK_MAX_CHARS);
  let chunkOffset = 0;
  let chunkIdx = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    if (activeIdx < chunkOffset + chunks[ci]!.length) {
      chunkIdx = ci;
      break;
    }
    chunkOffset += chunks[ci]!.length;
  }
  const chunk = chunks[chunkIdx]!;
  const activeInChunk = activeIdx - chunkOffset;

  const chunkStartFrame = (chunk[0]!.startMs / 1000) * fps;
  const chunkEntry = spring({
    frame: frame - chunkStartFrame,
    fps,
    config: { damping: 200 },
    durationInFrames: 9,
  });
  const chunkLift = interpolate(chunkEntry, [0, 1], [18, 0]);
  const chunkOpacity = interpolate(chunkEntry, [0, 1], [0, 1]);

  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 48,
        top: "54%",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "baseline",
        rowGap: 8,
        columnGap: 22,
        transform: `translateY(${chunkLift}px)`,
        opacity: chunkOpacity,
        fontFamily: CAPTION_FONT,
        pointerEvents: "none",
      }}
    >
      {chunk.map((w, i) => {
        const isActive = i === activeInChunk;
        return (
          <span
            key={`${chunkOffset + i}-${w.word}`}
            style={{
              display: "inline-block",
              fontSize: 78,
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: "0.005em",
              textTransform: "uppercase",
              color: isActive ? "#fff200" : "#ffffff",
              WebkitTextStroke: "5px #000",
              paintOrder: "stroke fill",
              textShadow:
                "0 5px 0 rgba(0,0,0,1), 0 10px 24px rgba(0,0,0,0.85)",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

const OutroCard: React.FC<{ url: string }> = ({ url }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const lift = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(900px 600px at 50% 50%, #1a3a2a 0%, #0a0a0a 70%)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 80,
        textAlign: "center",
        opacity,
        transform: `translateY(${lift}px)`,
        fontFamily: FONT_STACK,
      }}
    >
      <div
        style={{
          fontSize: 80,
          fontWeight: 800,
          marginBottom: 48,
          letterSpacing: -1.5,
        }}
      >
        Try it yourself
      </div>
      <div
        style={{
          fontSize: 32,
          opacity: 0.95,
          padding: "20px 28px",
          borderRadius: 18,
          background: "rgba(255,255,255,0.08)",
          maxWidth: "90%",
          wordBreak: "break-all",
        }}
      >
        {url}
      </div>
    </AbsoluteFill>
  );
};
