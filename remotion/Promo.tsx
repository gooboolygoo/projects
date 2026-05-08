import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
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
};

export const defaultPromoProps: PromoInputProps = {
  title: "Hello, world",
  url: "https://gooboolygoo.github.io/projects/hello/",
  words: [],
  shotCount: 4,
  voiceDurationMs: 22000,
};

const TITLE_FRAMES = 60;
const OUTRO_FRAMES = 90;

export const calculatePromoMetadata = ({
  props,
}: {
  props: PromoInputProps;
}) => {
  const fps = 30;
  const voiceFrames = Math.ceil((props.voiceDurationMs / 1000) * fps);
  const totalFrames = TITLE_FRAMES + voiceFrames + OUTRO_FRAMES;
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
  const outroStart = TITLE_FRAMES + voiceFrames;

  return (
    <AbsoluteFill style={{ background: "#0a0a0a" }}>
      <Sequence durationInFrames={TITLE_FRAMES}>
        <TitleCard title={props.title} />
      </Sequence>

      <Sequence from={TITLE_FRAMES} durationInFrames={voiceFrames}>
        <MainScene
          shotCount={props.shotCount}
          words={props.words}
          voiceDurationMs={props.voiceDurationMs}
        />
      </Sequence>

      <Sequence from={TITLE_FRAMES} durationInFrames={voiceFrames}>
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

const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const lift = interpolate(enter, [0, 1], [40, 0]);
  const opacity = interpolate(enter, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(900px 600px at 50% 50%, #2a2240 0%, #0a0a0a 70%)",
        color: "#fff",
        display: "flex",
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
          fontSize: 120,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: -3,
          maxWidth: "90%",
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const MainScene: React.FC<{
  shotCount: number;
  words: WordTiming[];
  voiceDurationMs: number;
}> = ({ shotCount, words, voiceDurationMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneMs = (frame / fps) * 1000;
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

const Captions: React.FC<{ sceneMs: number; words: WordTiming[] }> = ({
  sceneMs,
  words,
}) => {
  if (words.length === 0) return null;

  const WINDOW = 6;
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

  const start = Math.max(
    0,
    Math.min(words.length - WINDOW, activeIdx - Math.floor(WINDOW / 2)),
  );
  const visible = words.slice(start, start + WINDOW);

  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        bottom: 220,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "12px 18px",
        fontFamily: FONT_STACK,
      }}
    >
      {visible.map((w, i) => {
        const globalIdx = start + i;
        const isActive = globalIdx === activeIdx;
        return (
          <span
            key={`${globalIdx}-${w.word}`}
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.2,
              color: isActive ? "#ffe066" : "#fff",
              textShadow: "0 4px 14px rgba(0,0,0,0.65)",
              transform: isActive ? "scale(1.06)" : "scale(1)",
              transition: "transform 80ms linear",
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
