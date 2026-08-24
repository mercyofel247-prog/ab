export const FPS = 24;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type ClipConfig = {
  name: string;
  file: string;
  start: number;
  duration: number;
};

// Start/duration in frames at 24fps, derived from each source clip's real
// length (96, 144, 96, 96, 96 frames) minus the overlap eaten by the
// transition before it.
export const clips: ClipConfig[] = [
  { name: "scene1", file: "scenes/scene1.mp4", start: 0, duration: 96 },
  { name: "scene2", file: "scenes/scene2.mp4", start: 76, duration: 144 },
  { name: "scene3", file: "scenes/scene3.mp4", start: 202, duration: 96 },
  { name: "scene5", file: "scenes/scene5.mp4", start: 282, duration: 96 },
  { name: "scene8", file: "scenes/scene8.mp4", start: 364, duration: 96 },
];

export type TransitionType = "liquid" | "iris" | "edge" | "depth";

export type CutConfig = {
  outIdx: number;
  inIdx: number;
  overlapStart: number;
  overlapEnd: number;
  type: TransitionType;
  outgoingOnTop: boolean;
};

export const cuts: CutConfig[] = [
  {
    outIdx: 0,
    inIdx: 1,
    overlapStart: 76,
    overlapEnd: 96,
    type: "liquid",
    outgoingOnTop: false,
  },
  {
    outIdx: 1,
    inIdx: 2,
    overlapStart: 202,
    overlapEnd: 220,
    type: "iris",
    outgoingOnTop: true,
  },
  {
    outIdx: 2,
    inIdx: 3,
    overlapStart: 282,
    overlapEnd: 298,
    type: "edge",
    outgoingOnTop: true,
  },
  {
    outIdx: 3,
    inIdx: 4,
    overlapStart: 364,
    overlapEnd: 378,
    type: "depth",
    outgoingOnTop: false,
  },
];

export const totalDurationInFrames =
  clips[clips.length - 1].start + clips[clips.length - 1].duration;
