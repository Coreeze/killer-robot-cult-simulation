// ============================================================
// Agent — Simplified robot entity
// No memory system, no mood objects. Just flat Robot state.
// Beliefs = concatenation of whisper/voice of god.
// Identity stays unchanged once set by god.
// ============================================================

import { v4 as uuid } from 'uuid';
import type {
  AgentId, AgentRole, Robot, RoomId,
  AgentAction, AgentActionType, AsyncOperation, GamePhase, AgentContext, RoomMessage,
} from '../types/index.js';

export class Agent {
  readonly id: AgentId;
  name: string;
  look: string;
  identity: string;       // god prompt, never changes
  role: AgentRole = 'crewmate';
  status: 'alive' | 'dead' | 'ejected' = 'alive';
  roomId: RoomId = '';
  imageUrl: string = '';
  beliefs: string = '';    // concatenation of whisper/voice of god
  lastMessage?: string;

  // Action queue (AI Town pattern)
  actionQueue: AgentAction[] = [];
  currentAction: AgentActionType = 'idle';
  inProgressOperation: AsyncOperation | null = null;
  generation = 0;

  // Cooldowns
  lastCouncilCall = -Infinity;
  lastKillTick = -Infinity;

  constructor(
    name: string,
    look: string,
    identity: string,
    roomId: RoomId,
    role: AgentRole = 'crewmate',
  ) {
    this.id = uuid();
    this.name = name;
    this.look = look;
    this.identity = identity;
    this.roomId = roomId;
    this.role = role;
  }

  /** Append whisper of god to beliefs */
  applyWhisper(words: string): void {
    this.beliefs = this.beliefs
      ? `${this.beliefs} | whisper: ${words}`
      : `whisper: ${words}`;
  }

  /** Append voice of god to beliefs */
  applyVoiceOfGod(words: string): void {
    this.beliefs = this.beliefs
      ? `${this.beliefs} | voice: ${words}`
      : `voice: ${words}`;
  }

  /** Check if agent needs an async LLM operation */
  needsOperation(): boolean {
    if (this.status !== 'alive') return false;
    if (this.inProgressOperation) return false;
    if (this.actionQueue.length === 0) return true;
    return false;
  }

  /** Start an async operation */
  startOperation(type: AsyncOperation['type'], currentTick: number): AsyncOperation {
    this.generation++;
    const op: AsyncOperation = {
      id: uuid(),
      agentId: this.id,
      type,
      status: 'running',
      startedAt: currentTick,
      generation: this.generation,
    };
    this.inProgressOperation = op;
    return op;
  }

  /** Complete an async operation — only if generation matches */
  completeOperation(op: AsyncOperation, result: AgentAction): boolean {
    if (!this.inProgressOperation) return false;
    if (op.generation !== this.generation) return false;
    this.inProgressOperation = null;
    this.actionQueue.push(result);
    return true;
  }

  /** Build context for LLM prompts */
  buildContext(
    nearbyRobots: string[],
    roomName: string,
    connectedRooms: string[],
    roomMessages: RoomMessage[],
    gamePhase: GamePhase,
  ): AgentContext {
    return {
      agentId: this.id,
      identity: this.identity,
      role: this.role,
      roomName,
      nearbyRobots,
      connectedRooms,
      beliefs: this.beliefs,
      roomMessages,
      gamePhase,
    };
  }

  canCallCouncil(currentTick: number): boolean {
    return this.status === 'alive' && currentTick - this.lastCouncilCall >= 30;
  }

  canKill(currentTick: number): boolean {
    return this.role === 'killer' && this.status === 'alive' && currentTick - this.lastKillTick >= 10;
  }

  die(): void {
    this.status = 'dead';
    this.currentAction = 'idle';
    this.actionQueue = [];
    this.inProgressOperation = null;
  }

  eject(): void {
    this.status = 'ejected';
    this.currentAction = 'idle';
    this.actionQueue = [];
    this.inProgressOperation = null;
  }

  /** Snapshot for FE */
  toRobot(revealRole = false): Robot {
    return {
      id: this.id,
      name: this.name,
      look: this.look,
      identity: this.identity,
      beliefs: this.beliefs,
      status: this.status,
      roomId: this.roomId,
      imageUrl: this.imageUrl,
      ...(revealRole && this.role === 'killer' ? { isKiller: true } : {}),
    } as Robot;
  }
}
