// ============================================================
// A-LINE: Killer Robot Cult Simulation — Type Definitions
// ============================================================

// --- Identifiers ---
export type AgentId = string;
export type GodId = string;
export type RoomId = string;
export type GameId = string;
export type OperationId = string;

// --- Map: array of rooms ---
export interface Room {
  id: RoomId;
  name: string;
  connections: RoomId[];
  robots: AgentId[];
}

// --- Robot ---
export interface Robot {
  id: AgentId;
  name: string;
  look: string;           // god prompt
  identity: string;       // god prompt, stays unchanged
  beliefs: string;        // concatenation of whisper/voice of god
  status: "alive" | "dead" | "ejected";
  roomId: RoomId;
  imageUrl: string;
  lastMessage?: string;
}

export type AgentRole = "crewmate" | "killer";

// --- Room Messages (group chat in a room) ---
export interface RoomMessage {
  from: AgentId;
  fromName: string;
  message: string;
  tick: number;
}

// --- God System ---
export interface God {
  id: GodId;
  agentId: AgentId;
  isKiller: boolean;
  connected: boolean;
}

export interface GodWhisper {
  godId: GodId;
  targetRobotId: AgentId;
  words: string;          // 3 words max, anytime
  tick: number;
}

export interface VoiceOfGodEntry {
  godId: GodId;
  words: string;          // 3 words
  tick: number;
}

export interface VoiceOfGodRound {
  roundNumber: number;
  selectedGods: GodId[];
  submissions: VoiceOfGodEntry[];
  votes: Map<GodId, GodId>;
  winner?: VoiceOfGodEntry;
  submissionDeadline: number;
  voteDeadline: number;
}

// --- Council ---
export interface CouncilSession {
  id: string;
  calledBy: AgentId;
  startTick: number;
  endTick: number;
  messages: CouncilMessage[];
  votes: Map<AgentId, AgentId | "skip">;
  result?: CouncilResult;
  active: boolean;
}

export interface CouncilMessage {
  agentId: AgentId;
  message: string;
  tick: number;
}

export interface CouncilResult {
  ejected: AgentId | null;
  voteBreakdown: Map<AgentId, number>;
}

// --- Game Phases ---
export type GamePhase = "lobby" | "setup" | "playing" | "vog" | "council" | "ended";

// --- Game Config ---
export interface GameConfig {
  minGods: number;
  maxGods: number;
  setupDurationTicks: number;
  voiceOfGodSelectionRate: number;
  voiceOfGodSubmitTicks: number;
  voiceOfGodVoteTicks: number;
  councilDurationTicks: number;
  councilCooldownTicks: number;
  voiceOfGodIntervalTicks: number;
  ticksPerSecond: number;
  maxWords: number;
  killerRatio: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  minGods: 3,
  maxGods: 10,
  setupDurationTicks: 30,
  voiceOfGodSelectionRate: 0.1,
  voiceOfGodSubmitTicks: 30,
  voiceOfGodVoteTicks: 30,
  councilDurationTicks: 60,
  councilCooldownTicks: 30,
  voiceOfGodIntervalTicks: 60,
  ticksPerSecond: 1,
  maxWords: 3,
  killerRatio: 0.25,
};

// --- Agent Actions ---
export type AgentActionType = "move" | "talk" | "kill" | "call_council" | "idle";

export interface AgentAction {
  type: AgentActionType;
  agentId: AgentId;
  tick: number;
  payload: MovePayload | TalkPayload | KillPayload | CallCouncilPayload | IdlePayload;
}

export interface MovePayload { type: "move"; targetRoomId: RoomId; }
export interface TalkPayload { type: "talk"; message: string; }
export interface KillPayload { type: "kill"; targetAgentId: AgentId; }
export interface CallCouncilPayload { type: "call_council"; reason: string; }
export interface IdlePayload { type: "idle"; }

// --- Communication Messages ---
export type MessageChannel = "direct" | "room" | "council" | "broadcast" | "god";

export interface SimMessage {
  id: string;
  channel: MessageChannel;
  from: AgentId | "system";
  to: AgentId | RoomId | "all";
  content: string;
  tick: number;
  metadata?: Record<string, unknown>;
}

// --- Engine Events ---
export type EngineEventType =
  | "tick"
  | "phase_change"
  | "agent_action"
  | "agent_died"
  | "agent_ejected"
  | "council_called"
  | "council_ended"
  | "voice_of_god"
  | "god_whisper"
  | "game_over"
  | "message";

export interface EngineEvent {
  type: EngineEventType;
  tick: number;
  data: unknown;
}

// --- Game State Snapshot (what FE receives every tick) ---
export interface GameState {
  phase: GamePhase;
  rooms: Room[];
  robots: Record<string, Robot>;
  countdown: number;
  killersFound: number;
  totalKillers: number;
  councilCooldown: number;
  roomMessages: Record<RoomId, RoomMessage[]>;  // recent chat per room
  council?: {
    messages: CouncilMessage[];
    votes: Record<string, string>;
  };
  voiceOfGod?: {
    selectedGods: GodId[];
    submissions: VoiceOfGodEntry[];
    phase: "submission" | "voting" | "done";
    winnerWords?: string;
  };
}

// --- LLM Integration (pluggable) ---
export interface AgentContext {
  agentId: AgentId;
  identity: string;
  role: AgentRole;
  roomName: string;
  nearbyRobots: string[];
  connectedRooms: string[];
  beliefs: string;
  roomMessages: RoomMessage[];
  gamePhase: GamePhase;
}

export interface LLMProvider {
  generate(prompt: string, context: AgentContext): Promise<string>;
}

// --- Async Operation ---
export type OperationStatus = "pending" | "running" | "completed" | "failed";

export interface AsyncOperation {
  id: OperationId;
  agentId: AgentId;
  type: "decide_action" | "generate_speech" | "council_speak" | "council_vote";
  status: OperationStatus;
  startedAt: number;
  result?: AgentAction | string;
  generation: number;
}
