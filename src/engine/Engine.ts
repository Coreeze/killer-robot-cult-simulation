// ============================================================
// Engine — Core simulation heartbeat and tick system
// 1 tick per second. Agents decide via LLM (Groq).
// Simplified: no memory, no mood objects, flat Robot state.
// ============================================================

import EventEmitter from 'eventemitter3';
import { Agent } from '../agents/Agent.js';
import { World } from '../game/World.js';
import { CouncilManager } from '../game/Council.js';
import { VoiceOfGodManager } from '../game/VoiceOfGod.js';
import { MessageBus } from '../communication/MessageBus.js';
import type {
  AgentId, GodId, God, GamePhase, GameConfig, EngineEvent,
  EngineEventType, AgentAction, AgentContext, LLMProvider, RoomMessage,
  VoiceOfGodEntry, CouncilResult, GameState, GodWhisper, Room,
  AsyncOperation,
} from '../types/index.js';

export interface EngineCallbacks {
  onTick?: (tick: number) => void;
  onPhaseChange?: (phase: GamePhase, tick: number) => void;
  onAgentAction?: (action: AgentAction) => void;
  onAgentDied?: (agentId: AgentId, killerId: AgentId) => void;
  onCouncilCalled?: (agentId: AgentId) => void;
  onCouncilEnded?: (result: CouncilResult) => void;
  onVoiceOfGod?: (entry: VoiceOfGodEntry) => void;
  onGameOver?: (winningSide: 'crew' | 'killers') => void;
}

export class Engine {
  private tick = 0;
  private phase: GamePhase = 'lobby';
  private running = false;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  readonly world: World;
  readonly council: CouncilManager;
  readonly voiceOfGod: VoiceOfGodManager;
  readonly messageBus: MessageBus;
  private emitter = new EventEmitter();

  private agents = new Map<AgentId, Agent>();
  private gods = new Map<GodId, God>();
  private llm: LLMProvider | null = null;

  private callbacks: EngineCallbacks = {};

  // Room messages buffer — cleared each tick, kept for snapshot
  private roomMessages = new Map<string, RoomMessage[]>();

  // Whisper log for current tick
  private recentWhispers: GodWhisper[] = [];

  // Game tracking
  private killersFound = 0;
  private totalKillers = 0;
  private phaseStartTick = 0;

  constructor(private config: GameConfig) {
    this.world = new World();
    this.council = new CouncilManager(config);
    this.voiceOfGod = new VoiceOfGodManager(config);
    this.messageBus = new MessageBus();
  }

  // ==================== LIFECYCLE ====================

  setLLM(llm: LLMProvider): void {
    this.llm = llm;
  }

  on(callbacks: EngineCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  subscribe(event: EngineEventType, handler: (e: EngineEvent) => void): void {
    this.emitter.on(event, handler);
  }

  // ==================== GAME FLOW ====================

  addGod(godId: GodId): God | null {
    if (this.phase !== 'lobby') return null;
    if (this.gods.size >= this.config.maxGods) return null;

    const god: God = { id: godId, agentId: '', isKiller: false, connected: true };
    this.gods.set(godId, god);
    return god;
  }

  removeGod(godId: GodId): void {
    this.gods.delete(godId);
  }

  /** Load map and start game */
  startGame(mapLayout: Room[]): boolean {
    if (this.phase !== 'lobby') return false;
    if (this.gods.size < this.config.minGods) return false;

    // Load the map
    this.world.loadLayout(mapLayout);

    // Decide killers
    const godList = [...this.gods.values()];
    const killerCount = Math.max(1, Math.floor(godList.length * this.config.killerRatio));
    this.totalKillers = killerCount;

    const shuffled = [...godList].sort(() => Math.random() - 0.5);
    for (let i = 0; i < killerCount; i++) {
      shuffled[i].isKiller = true;
    }

    this.setPhase('setup');
    return true;
  }

  /** God defines their robot during setup */
  defineRobot(godId: GodId, name: string, look: string, identity: string, imageUrl?: string): Agent | null {
    if (this.phase !== 'setup') return null;
    const god = this.gods.get(godId);
    if (!god) return null;
    if (god.agentId) return null;

    const roomId = this.world.getRandomRoomId();
    const agent = new Agent(name, look, identity, roomId, god.isKiller ? 'killer' : 'crewmate');
    if (imageUrl) agent.imageUrl = imageUrl;

    this.world.placeAgent(agent.id, roomId);
    this.agents.set(agent.id, agent);
    god.agentId = agent.id;

    return agent;
  }

  /** Start the main simulation */
  startSimulation(): void {
    if (this.phase !== 'setup') return;

    // Auto-generate default robots for gods who didn't define one
    for (const god of this.gods.values()) {
      if (!god.agentId) {
        this.defineRobot(god.id, `Robot-${god.id.slice(0, 4)}`, '🤖', 'a robot on a spaceship');
      }
    }

    this.setPhase('playing');
    this.startHeartbeat();
  }

  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  // ==================== HEARTBEAT ====================

  private startHeartbeat(): void {
    this.running = true;
    const msPerTick = 1000 / this.config.ticksPerSecond;

    this.tickInterval = setInterval(() => {
      if (!this.running) return;
      this.processTick();
    }, msPerTick);
  }

  private processTick(): void {
    this.tick++;

    switch (this.phase) {
      case 'playing':
        this.tickPlaying();
        break;
      case 'council':
        this.tickCouncil();
        break;
      case 'vog':
        this.tickVoiceOfGod();
        break;
    }

    this.emit('tick', { tick: this.tick });
    this.callbacks.onTick?.(this.tick);
  }

  private tickPlaying(): void {
    const aliveAgents = this.getAliveAgents();

    // Schedule LLM operations for agents that need them
    for (const agent of aliveAgents) {
      if (agent.needsOperation()) {
        this.scheduleAgentOperation(agent);
      }
    }

    // Process completed actions
    for (const agent of aliveAgents) {
      this.processAgentActions(agent);
    }

    // Check if Voice of God round should start
    if (this.voiceOfGod.shouldStartRound(this.tick)) {
      this.startVoiceOfGodRound();
    }

    this.checkWinCondition();
  }

  private tickCouncil(): void {
    if (this.council.isExpired(this.tick)) {
      const result = this.council.endCouncil(this.tick);

      if (result.ejected) {
        const ejectedAgent = this.agents.get(result.ejected);
        if (ejectedAgent) {
          ejectedAgent.eject();
          if (ejectedAgent.role === 'killer') {
            this.killersFound++;
          }
          this.emit('agent_ejected', { agentId: result.ejected, role: ejectedAgent.role });
        }
      }

      this.callbacks.onCouncilEnded?.(result);
      this.setPhase('playing');
      this.checkWinCondition();
    }
  }

  private tickVoiceOfGod(): void {
    const vogPhase = this.voiceOfGod.getPhase(this.tick);

    if (vogPhase === 'done') {
      const winner = this.voiceOfGod.endRound(this.tick);
      if (winner) {
        // Apply voice of god to ALL alive agents' beliefs
        for (const agent of this.getAliveAgents()) {
          agent.applyVoiceOfGod(winner.words);
        }
        this.callbacks.onVoiceOfGod?.(winner);
        this.emit('voice_of_god', winner);
      }
      this.setPhase('playing');
    }
  }

  // ==================== AGENT OPERATIONS ====================

  private scheduleAgentOperation(agent: Agent): void {
    if (agent.inProgressOperation) return;

    const op = agent.startOperation('decide_action', this.tick);

    if (!this.llm) {
      this.fallbackBehavior(agent, op);
      return;
    }

    this.executeLLMOperation(agent, op);
  }

  private async executeLLMOperation(agent: Agent, op: AsyncOperation): Promise<void> {
    if (!this.llm) return;

    try {
      const room = this.world.getAgentRoom(agent.id);
      const roomName = room?.name || 'Unknown';
      const nearbyIds = this.world.getNearbyAgents(agent.id);
      const nearbyNames = nearbyIds
        .map(id => this.agents.get(id))
        .filter((a): a is Agent => a !== undefined && a.status === 'alive')
        .map(a => a.name);
      const connectedRooms = room
        ? this.world.getConnectedRooms(room.id).map(r => r.name)
        : [];
      const recentMessages = room ? (this.roomMessages.get(room.id) || []) : [];

      const context = agent.buildContext(nearbyNames, roomName, connectedRooms, recentMessages, this.phase);
      const prompt = this.buildActionPrompt(agent, context, nearbyIds);
      const response = await this.llm.generate(prompt, context);
      const action = this.parseAction(agent, response, nearbyIds);

      if (action) {
        agent.completeOperation(op, action);
      } else {
        op.status = 'failed';
        agent.inProgressOperation = null;
      }
    } catch {
      op.status = 'failed';
      agent.inProgressOperation = null;
    }
  }

  private fallbackBehavior(agent: Agent, op: NonNullable<Agent['inProgressOperation']>): void {
    const nearbyIds = this.world.getNearbyAgents(agent.id);
    const room = this.world.getAgentRoom(agent.id);

    let action: AgentAction;

    if (agent.role === 'killer' && agent.canKill(this.tick) && nearbyIds.length === 1 && Math.random() < 0.3) {
      action = { type: 'kill', agentId: agent.id, tick: this.tick, payload: { type: 'kill', targetAgentId: nearbyIds[0] } };
    } else if (nearbyIds.length > 0 && Math.random() < 0.4) {
      const lines = agent.role === 'killer'
        ? ['Everything seems fine.', 'Nothing suspicious here.', 'We should stick together.']
        : ['Did you hear something?', 'I don\'t feel safe.', 'Something doesn\'t add up...'];
      action = {
        type: 'talk', agentId: agent.id, tick: this.tick,
        payload: { type: 'talk', message: lines[Math.floor(Math.random() * lines.length)] },
      };
    } else if (room && room.connections.length > 0) {
      const targetRoomId = room.connections[Math.floor(Math.random() * room.connections.length)];
      action = { type: 'move', agentId: agent.id, tick: this.tick, payload: { type: 'move', targetRoomId } };
    } else {
      action = { type: 'idle', agentId: agent.id, tick: this.tick, payload: { type: 'idle' } };
    }

    agent.completeOperation(op, action);
  }

  // ==================== ACTION PROCESSING ====================

  private processAgentActions(agent: Agent): void {
    if (agent.actionQueue.length === 0) return;

    const action = agent.actionQueue.shift()!;
    agent.currentAction = action.type;

    switch (action.type) {
      case 'move': this.processMove(agent, action); break;
      case 'talk': this.processTalk(agent, action); break;
      case 'kill': this.processKill(agent, action); break;
      case 'call_council': this.processCallCouncil(agent, action); break;
    }

    this.callbacks.onAgentAction?.(action);
    this.emit('agent_action', action);
  }

  private processMove(agent: Agent, action: AgentAction): void {
    const payload = action.payload as { type: 'move'; targetRoomId: string };
    this.world.moveAgent(agent.id, payload.targetRoomId);
    agent.roomId = payload.targetRoomId;
  }

  private processTalk(agent: Agent, action: AgentAction): void {
    const payload = action.payload as { type: 'talk'; message: string };
    const room = this.world.getAgentRoom(agent.id);
    if (!room) return;

    agent.lastMessage = payload.message;

    // Add to room messages
    const msg: RoomMessage = {
      from: agent.id,
      fromName: agent.name,
      message: payload.message,
      tick: this.tick,
    };

    if (!this.roomMessages.has(room.id)) {
      this.roomMessages.set(room.id, []);
    }
    this.roomMessages.get(room.id)!.push(msg);

    // Also send via message bus
    this.messageBus.sendRoom(agent.id, room.id, `${agent.name}: ${payload.message}`, this.tick);
  }

  private processKill(agent: Agent, action: AgentAction): void {
    const payload = action.payload as { type: 'kill'; targetAgentId: AgentId };
    if (agent.role !== 'killer') return;

    const victim = this.agents.get(payload.targetAgentId);
    if (!victim || victim.status !== 'alive') return;
    if (victim.roomId !== agent.roomId) return;

    victim.die();
    agent.lastKillTick = this.tick;

    this.callbacks.onAgentDied?.(victim.id, agent.id);
    this.emit('agent_died', { victimId: victim.id, killerId: agent.id });
  }

  private processCallCouncil(agent: Agent, _action: AgentAction): void {
    if (!agent.canCallCouncil(this.tick)) return;
    if (!this.council.canCallCouncil(this.tick)) return;

    agent.lastCouncilCall = this.tick;
    this.council.startCouncil(agent.id, this.tick);
    this.setPhase('council');

    this.callbacks.onCouncilCalled?.(agent.id);
    this.emit('council_called', { agentId: agent.id });
  }

  // ==================== VOICE OF GOD ====================

  private startVoiceOfGodRound(): void {
    const godList = [...this.gods.values()];
    this.voiceOfGod.startRound(godList, this.tick);
    this.setPhase('vog');
  }

  // ==================== GOD INPUTS ====================

  /** Whisper of god — any god, any time, 3 words, to their robot */
  whisperToRobot(godId: GodId, words: string): boolean {
    const god = this.gods.get(godId);
    if (!god || !god.agentId) return false;

    if (words.trim().split(/\s+/).length > this.config.maxWords) return false;

    const agent = this.agents.get(god.agentId);
    if (!agent || agent.status !== 'alive') return false;

    agent.applyWhisper(words.trim());

    const whisper: GodWhisper = {
      godId,
      targetRobotId: god.agentId,
      words: words.trim(),
      tick: this.tick,
    };
    this.recentWhispers.push(whisper);

    this.emit('god_whisper', whisper);
    return true;
  }

  submitVoiceOfGod(godId: GodId, words: string): boolean {
    return this.voiceOfGod.submitWords(godId, words, this.tick);
  }

  voteVoiceOfGod(godId: GodId, forGodId: GodId): boolean {
    return this.voiceOfGod.castVote(godId, forGodId);
  }

  voteInCouncil(godId: GodId, targetAgentId: AgentId | 'skip'): boolean {
    const god = this.gods.get(godId);
    if (!god || !god.agentId) return false;
    return this.council.castVote(god.agentId, targetAgentId);
  }

  // ==================== WIN CONDITION ====================

  private checkWinCondition(): void {
    const alive = this.getAliveAgents();
    const aliveKillers = alive.filter(a => a.role === 'killer');
    const aliveCrew = alive.filter(a => a.role === 'crewmate');

    if (aliveKillers.length >= aliveCrew.length && aliveKillers.length > 0) {
      this.setPhase('ended');
      this.stop();
      this.callbacks.onGameOver?.('killers');
      this.emit('game_over', { winner: 'killers' });
      return;
    }

    if (aliveKillers.length === 0) {
      this.setPhase('ended');
      this.stop();
      this.callbacks.onGameOver?.('crew');
      this.emit('game_over', { winner: 'crew' });
    }
  }

  // ==================== SNAPSHOT ====================

  getSnapshot(): GameState {
    const council = this.council.getSession();
    const vogRound = this.voiceOfGod.getRound();
    const vogPhase = vogRound ? this.voiceOfGod.getPhase(this.tick) : null;

    // Calculate countdown based on current phase
    let countdown = 0;
    if (this.phase === 'council' && council) {
      countdown = Math.max(0, council.endTick - this.tick);
    } else if (this.phase === 'vog' && vogRound) {
      if (vogPhase === 'submission') countdown = Math.max(0, vogRound.submissionDeadline - this.tick);
      else if (vogPhase === 'voting') countdown = Math.max(0, vogRound.voteDeadline - this.tick);
    }

    // Build room messages record
    const roomMsgs: Record<string, RoomMessage[]> = {};
    for (const [roomId, msgs] of this.roomMessages) {
      roomMsgs[roomId] = msgs.slice(-20); // last 20 messages per room
    }

    return {
      phase: this.phase,
      rooms: this.world.getAllRooms(),
      robots: Object.fromEntries(
        [...this.agents.values()].map(a => [a.id, a.toRobot(this.phase === 'ended')])
      ),
      countdown,
      killersFound: this.killersFound,
      totalKillers: this.totalKillers,
      councilCooldown: Math.max(0, this.config.councilCooldownTicks - (this.tick - (council ? council.endTick : 0))),
      roomMessages: roomMsgs,
      council: council?.active ? {
        messages: council.messages,
        votes: Object.fromEntries(council.votes),
      } : undefined,
      voiceOfGod: vogRound && vogPhase ? {
        selectedGods: vogRound.selectedGods,
        submissions: vogRound.submissions,
        phase: vogPhase === 'done' ? 'done' : vogPhase,
        winnerWords: vogRound.winner?.words,
      } : undefined,
    };
  }

  getAliveAgents(): Agent[] {
    return [...this.agents.values()].filter(a => a.status === 'alive');
  }

  getAgent(agentId: AgentId): Agent | undefined {
    return this.agents.get(agentId);
  }

  getCurrentTick(): number {
    return this.tick;
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  // ==================== INTERNAL ====================

  private setPhase(phase: GamePhase): void {
    const old = this.phase;
    this.phase = phase;
    this.phaseStartTick = this.tick;
    this.callbacks.onPhaseChange?.(phase, this.tick);
    this.emit('phase_change', { from: old, to: phase, tick: this.tick });
  }

  private emit(type: EngineEventType, data: unknown): void {
    this.emitter.emit(type, { type, tick: this.tick, data });
  }

  // ==================== PROMPT BUILDING ====================

  private buildActionPrompt(agent: Agent, context: AgentContext, nearbyIds: AgentId[]): string {
    const roleInfo = agent.role === 'killer'
      ? 'You are a KILLER. Eliminate others secretly. Act normal, deflect suspicion.'
      : 'You are a CREWMATE. Identify killers and survive. Be observant.';

    const actions = ['move <room_name>', 'talk <message>', 'idle'];
    if (agent.role === 'killer' && agent.canKill(this.tick) && nearbyIds.length > 0) {
      actions.push('kill <robot_name>');
    }
    if (agent.canCallCouncil(this.tick)) {
      actions.push('call_council <reason>');
    }

    const recentChat = context.roomMessages.length > 0
      ? `Recent conversation:\n${context.roomMessages.slice(-5).map(m => `  ${m.fromName}: ${m.message}`).join('\n')}`
      : 'No recent conversation.';

    return `You are ${agent.name}, a robot on a cursed spaceship heading to Planet X.
Identity: ${agent.identity}
${roleInfo}

You are in: ${context.roomName}
Nearby robots: ${context.nearbyRobots.join(', ') || 'none'}
Connected rooms: ${context.connectedRooms.join(', ') || 'none'}
Beliefs: ${agent.beliefs || 'none'}

${recentChat}

Choose ONE action: ${actions.join(' | ')}
Respond in EXACTLY this format: ACTION: <type> DETAIL: <detail>
Examples: "ACTION: move DETAIL: Engine Room" or "ACTION: talk DETAIL: I don't trust anyone here" or "ACTION: kill DETAIL: KRON"`;
  }

  private parseAction(agent: Agent, response: string, nearbyIds: AgentId[]): AgentAction | null {
    const actionMatch = response.match(/ACTION:\s*(\w+)/i);
    const detailMatch = response.match(/DETAIL:\s*(.+)/i);

    const actionType = actionMatch?.[1]?.toLowerCase() || 'idle';
    const detail = detailMatch?.[1]?.trim() || '';

    switch (actionType) {
      case 'move': {
        const rooms = this.world.getAllRooms();
        const targetRoom = rooms.find(r =>
          r.name.toLowerCase().includes(detail.toLowerCase())
        );
        if (!targetRoom) return null;
        return { type: 'move', agentId: agent.id, tick: this.tick, payload: { type: 'move', targetRoomId: targetRoom.id } };
      }
      case 'talk':
        return { type: 'talk', agentId: agent.id, tick: this.tick, payload: { type: 'talk', message: detail || 'Hello.' } };
      case 'kill': {
        const target = nearbyIds.find(id => {
          const a = this.agents.get(id);
          return a && a.name.toLowerCase().includes(detail.toLowerCase());
        }) || nearbyIds[0];
        if (!target) return null;
        return { type: 'kill', agentId: agent.id, tick: this.tick, payload: { type: 'kill', targetAgentId: target } };
      }
      case 'call_council':
        return { type: 'call_council', agentId: agent.id, tick: this.tick, payload: { type: 'call_council', reason: detail || 'Something is wrong.' } };
      default:
        return { type: 'idle', agentId: agent.id, tick: this.tick, payload: { type: 'idle' } };
    }
  }
}
