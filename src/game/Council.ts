// ============================================================
// Council — Group discussion and voting system
// 60s duration, all agents participate, time is frozen
// ============================================================

import { v4 as uuid } from 'uuid';
import type {
  AgentId, CouncilSession, CouncilMessage, CouncilResult, GameConfig,
} from '../types/index.js';

export class CouncilManager {
  private currentSession: CouncilSession | null = null;
  private lastCouncilEnd = -Infinity;

  constructor(private config: GameConfig) {}

  /** Can a council be called right now? */
  canCallCouncil(currentTick: number): boolean {
    if (this.currentSession?.active) return false;
    return currentTick - this.lastCouncilEnd >= this.config.councilCooldownTicks;
  }

  /** Start a new council session */
  startCouncil(calledBy: AgentId, currentTick: number): CouncilSession {
    const session: CouncilSession = {
      id: uuid(),
      calledBy,
      startTick: currentTick,
      endTick: currentTick + this.config.councilDurationTicks,
      messages: [],
      votes: new Map(),
      active: true,
    };
    this.currentSession = session;
    return session;
  }

  /** Add a message to the council discussion */
  addMessage(agentId: AgentId, message: string, tick: number): CouncilMessage | null {
    if (!this.currentSession?.active) return null;

    const msg: CouncilMessage = { agentId, message, tick };
    this.currentSession.messages.push(msg);
    return msg;
  }

  /** Cast a vote (agent votes to eject someone or skip) */
  castVote(voterId: AgentId, targetId: AgentId | 'skip'): boolean {
    if (!this.currentSession?.active) return false;
    this.currentSession.votes.set(voterId, targetId);
    return true;
  }

  /** Tally votes and determine result */
  tallyVotes(aliveAgentIds: AgentId[]): CouncilResult {
    if (!this.currentSession) {
      return { ejected: null, voteBreakdown: new Map() };
    }

    const voteCounts = new Map<string, number>();

    for (const [, target] of this.currentSession.votes) {
      voteCounts.set(target, (voteCounts.get(target) || 0) + 1);
    }

    // Find the target with the most votes (excluding 'skip')
    let maxVotes = 0;
    let ejectedId: AgentId | null = null;
    let skipVotes = voteCounts.get('skip') || 0;

    for (const [target, count] of voteCounts) {
      if (target === 'skip') continue;
      if (count > maxVotes) {
        maxVotes = count;
        ejectedId = target;
      } else if (count === maxVotes) {
        ejectedId = null; // tie = no ejection
      }
    }

    // Skip wins if it has more votes than the leading candidate
    if (skipVotes >= maxVotes) {
      ejectedId = null;
    }

    const result: CouncilResult = {
      ejected: ejectedId,
      voteBreakdown: voteCounts,
    };

    this.currentSession.result = result;
    return result;
  }

  /** End the council session */
  endCouncil(currentTick: number): CouncilResult {
    if (!this.currentSession) {
      return { ejected: null, voteBreakdown: new Map() };
    }

    const result = this.currentSession.result ?? this.tallyVotes([]);
    this.currentSession.active = false;
    this.lastCouncilEnd = currentTick;

    return result;
  }

  /** Check if council time is up */
  isExpired(currentTick: number): boolean {
    if (!this.currentSession?.active) return false;
    return currentTick >= this.currentSession.endTick;
  }

  /** Get current session */
  getSession(): CouncilSession | null {
    return this.currentSession;
  }

  /** Get discussion messages */
  getMessages(): CouncilMessage[] {
    return this.currentSession?.messages ?? [];
  }

  /** Check if all alive agents have voted */
  allVoted(aliveAgentIds: AgentId[]): boolean {
    if (!this.currentSession) return false;
    return aliveAgentIds.every(id => this.currentSession!.votes.has(id));
  }
}
