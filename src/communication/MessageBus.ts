// ============================================================
// MessageBus — MQTT-style three-tier messaging system
// Patterns: Beyond Playtesting MQTT + AgentScope actor model
// ============================================================

import EventEmitter from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import type { AgentId, RoomId, MessageChannel, SimMessage } from '../types/index.js';

type MessageHandler = (message: SimMessage) => void;

interface Subscription {
  id: string;
  channel: MessageChannel;
  target: string; // agentId, roomId, or 'all'
  handler: MessageHandler;
}

export class MessageBus {
  private emitter = new EventEmitter();
  private subscriptions = new Map<string, Subscription>();
  private messageLog: SimMessage[] = [];
  private maxLogSize = 10000;

  /** Send a direct message to a specific agent */
  sendDirect(from: AgentId | 'system', to: AgentId, content: string, tick: number, metadata?: Record<string, unknown>): SimMessage {
    const msg = this.createMessage('direct', from, to, content, tick, metadata);
    this.emit(msg);
    return msg;
  }

  /** Send a message to all agents in a room */
  sendRoom(from: AgentId | 'system', roomId: RoomId, content: string, tick: number, metadata?: Record<string, unknown>): SimMessage {
    const msg = this.createMessage('room', from, roomId, content, tick, metadata);
    this.emit(msg);
    return msg;
  }

  /** Send a message to the council channel */
  sendCouncil(from: AgentId, content: string, tick: number): SimMessage {
    const msg = this.createMessage('council', from, 'all', content, tick);
    this.emit(msg);
    return msg;
  }

  /** Broadcast a message to all agents (system events, voice of god) */
  broadcast(content: string, tick: number, metadata?: Record<string, unknown>): SimMessage {
    const msg = this.createMessage('broadcast', 'system', 'all', content, tick, metadata);
    this.emit(msg);
    return msg;
  }

  /** Send god influence to a specific agent */
  sendGodInfluence(from: string, to: AgentId, content: string, tick: number): SimMessage {
    const msg = this.createMessage('god', from as AgentId, to, content, tick);
    this.emit(msg);
    return msg;
  }

  /** Subscribe to messages on a channel/target */
  subscribe(channel: MessageChannel, target: string, handler: MessageHandler): string {
    const id = uuid();
    const sub: Subscription = { id, channel, target, handler };
    this.subscriptions.set(id, sub);

    const eventKey = this.getEventKey(channel, target);
    this.emitter.on(eventKey, handler);

    // Also subscribe to broadcast if subscribing to a specific target
    if (channel !== 'broadcast') {
      this.emitter.on(this.getEventKey('broadcast', 'all'), handler);
    }

    return id;
  }

  /** Unsubscribe from messages */
  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return;

    this.emitter.off(this.getEventKey(sub.channel, sub.target), sub.handler);
    if (sub.channel !== 'broadcast') {
      this.emitter.off(this.getEventKey('broadcast', 'all'), sub.handler);
    }

    this.subscriptions.delete(subscriptionId);
  }

  /** Get recent messages for a channel/target */
  getRecentMessages(channel: MessageChannel, target: string, limit = 50): SimMessage[] {
    return this.messageLog
      .filter(m => m.channel === channel && (m.to === target || m.to === 'all'))
      .slice(-limit);
  }

  /** Get all messages involving an agent (sent or received) */
  getAgentMessages(agentId: AgentId, limit = 100): SimMessage[] {
    return this.messageLog
      .filter(m => m.from === agentId || m.to === agentId || m.to === 'all')
      .slice(-limit);
  }

  /** Clear all subscriptions and logs */
  reset(): void {
    this.emitter.removeAllListeners();
    this.subscriptions.clear();
    this.messageLog = [];
  }

  private createMessage(
    channel: MessageChannel,
    from: AgentId | 'system',
    to: AgentId | RoomId | 'all',
    content: string,
    tick: number,
    metadata?: Record<string, unknown>,
  ): SimMessage {
    return { id: uuid(), channel, from, to, content, tick, metadata };
  }

  private emit(msg: SimMessage): void {
    this.messageLog.push(msg);
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog = this.messageLog.slice(-this.maxLogSize / 2);
    }

    const eventKey = this.getEventKey(msg.channel, msg.to);
    this.emitter.emit(eventKey, msg);

    // For room messages, also emit to each agent in the room (handled by subscribers)
    // For direct messages, emit on the specific agent key
    if (msg.channel === 'direct') {
      this.emitter.emit(this.getEventKey('direct', msg.to), msg);
    }
  }

  private getEventKey(channel: MessageChannel, target: string): string {
    return `${channel}:${target}`;
  }
}
