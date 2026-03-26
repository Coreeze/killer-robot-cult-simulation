// ============================================================
// Game — High-level game manager wrapping the Engine
// ============================================================

import { Engine } from '../engine/Engine.js';
import type {
  GameConfig, GodId, AgentId, GameState, LLMProvider, Room,
  VoiceOfGodEntry, CouncilResult,
} from '../types/index.js';
import { DEFAULT_CONFIG as defaultConfig } from '../types/index.js';

export interface GameEvents {
  onPhaseChange?: (phase: string, tick: number) => void;
  onAgentDied?: (victimId: AgentId, killerId: AgentId) => void;
  onCouncilCalled?: (agentId: AgentId) => void;
  onCouncilEnded?: (result: CouncilResult) => void;
  onVoiceOfGod?: (entry: VoiceOfGodEntry) => void;
  onGameOver?: (winner: 'crew' | 'killers') => void;
  onTick?: (tick: number) => void;
}

export class Game {
  private engine: Engine;
  private config: GameConfig;

  constructor(config?: Partial<GameConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.engine = new Engine(this.config);
  }

  setLLM(llm: LLMProvider): void {
    this.engine.setLLM(llm);
  }

  on(events: GameEvents): void {
    this.engine.on(events);
  }

  // ==================== LOBBY ====================

  joinGame(godId: GodId): { success: boolean; error?: string } {
    const god = this.engine.addGod(godId);
    if (!god) {
      return {
        success: false,
        error: this.engine.getPhase() !== 'lobby' ? 'Game already started' : 'Room is full',
      };
    }
    return { success: true };
  }

  leaveGame(godId: GodId): void {
    this.engine.removeGod(godId);
  }

  // ==================== SETUP ====================

  startGame(mapLayout: Room[]): { success: boolean; error?: string } {
    const started = this.engine.startGame(mapLayout);
    if (!started) {
      return {
        success: false,
        error: this.engine.getPhase() !== 'lobby'
          ? 'Game already started'
          : `Need at least ${this.config.minGods} players`,
      };
    }
    return { success: true };
  }

  defineRobot(
    godId: GodId,
    name: string,
    look: string,
    identity: string,
    imageUrl?: string,
  ): { success: boolean; agentId?: AgentId; error?: string } {
    const agent = this.engine.defineRobot(godId, name, look, identity, imageUrl);
    if (!agent) {
      return { success: false, error: 'Cannot define robot right now' };
    }
    return { success: true, agentId: agent.id };
  }

  startSimulation(): void {
    this.engine.startSimulation();
  }

  // ==================== PLAYING ====================

  /** Whisper of god — private, any time, 3 words */
  whisperToRobot(godId: GodId, words: string): { success: boolean; error?: string } {
    const wordCount = words.trim().split(/\s+/).length;
    if (wordCount > this.config.maxWords) {
      return { success: false, error: `Maximum ${this.config.maxWords} words allowed` };
    }
    const ok = this.engine.whisperToRobot(godId, words);
    return ok ? { success: true } : { success: false, error: 'Cannot whisper right now' };
  }

  // ==================== VOICE OF GOD ====================

  submitVoiceOfGod(godId: GodId, words: string): { success: boolean; error?: string } {
    const wordCount = words.trim().split(/\s+/).length;
    if (wordCount > this.config.maxWords) {
      return { success: false, error: `Maximum ${this.config.maxWords} words allowed` };
    }
    const ok = this.engine.submitVoiceOfGod(godId, words);
    return ok ? { success: true } : { success: false, error: 'Not selected or already submitted' };
  }

  voteVoiceOfGod(godId: GodId, forGodId: GodId): { success: boolean } {
    return { success: this.engine.voteVoiceOfGod(godId, forGodId) };
  }

  // ==================== COUNCIL ====================

  voteInCouncil(godId: GodId, targetAgentId: AgentId | 'skip'): { success: boolean } {
    return { success: this.engine.voteInCouncil(godId, targetAgentId) };
  }

  // ==================== QUERIES ====================

  getState(): GameState {
    return this.engine.getSnapshot();
  }

  getPhase(): string {
    return this.engine.getPhase();
  }

  getTick(): number {
    return this.engine.getCurrentTick();
  }

  stop(): void {
    this.engine.stop();
  }

  getEngine(): Engine {
    return this.engine;
  }
}
