// ============================================================
// World — Room registry and agent-room tracking
// No generation, no spatial math. Just loads a room layout
// JSON and tracks which agents are in which rooms.
// ============================================================

import type { Room, RoomId, AgentId } from '../types/index.js';

export class World {
  private rooms = new Map<RoomId, Room>();

  /** Load rooms from a layout JSON */
  loadLayout(layout: Room[]): void {
    this.rooms.clear();
    for (const def of layout) {
      this.rooms.set(def.id, {
        id: def.id,
        name: def.name,
        connections: [...def.connections],
        robots: [],
      });
    }
  }

  /** Place an agent in a room */
  placeAgent(agentId: AgentId, roomId: RoomId): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    if (!room.robots.includes(agentId)) {
      room.robots.push(agentId);
    }
    return true;
  }

  /** Move agent from current room to target room */
  moveAgent(agentId: AgentId, targetRoomId: RoomId): boolean {
    const target = this.rooms.get(targetRoomId);
    if (!target) return false;

    // Remove from current room
    for (const room of this.rooms.values()) {
      const idx = room.robots.indexOf(agentId);
      if (idx !== -1) {
        room.robots.splice(idx, 1);
        break;
      }
    }

    // Add to target
    if (!target.robots.includes(agentId)) {
      target.robots.push(agentId);
    }
    return true;
  }

  /** Get the room an agent is currently in */
  getAgentRoom(agentId: AgentId): Room | null {
    for (const room of this.rooms.values()) {
      if (room.robots.includes(agentId)) return room;
    }
    return null;
  }

  /** Get other agents in the same room */
  getNearbyAgents(agentId: AgentId): AgentId[] {
    const room = this.getAgentRoom(agentId);
    if (!room) return [];
    return room.robots.filter(id => id !== agentId);
  }

  /** Get rooms connected to a given room */
  getConnectedRooms(roomId: RoomId): Room[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return room.connections
      .map(id => this.rooms.get(id))
      .filter((r): r is Room => r !== undefined);
  }

  /** Get room by ID */
  getRoom(roomId: RoomId): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Get all rooms */
  getAllRooms(): Room[] {
    return [...this.rooms.values()];
  }

  /** Get a random room ID */
  getRandomRoomId(): RoomId {
    const rooms = [...this.rooms.values()];
    return rooms[Math.floor(Math.random() * rooms.length)].id;
  }

  /** Remove agent from all rooms */
  removeAgent(agentId: AgentId): void {
    for (const room of this.rooms.values()) {
      const idx = room.robots.indexOf(agentId);
      if (idx !== -1) {
        room.robots.splice(idx, 1);
        return;
      }
    }
  }

  /** Find next room on path from source to target (BFS) */
  findNextRoom(sourceId: RoomId, targetId: RoomId): RoomId | null {
    if (sourceId === targetId) return null;

    const visited = new Set<RoomId>();
    const queue: { roomId: RoomId; firstStep: RoomId }[] = [];

    const source = this.rooms.get(sourceId);
    if (!source) return null;

    for (const connId of source.connections) {
      queue.push({ roomId: connId, firstStep: connId });
    }
    visited.add(sourceId);

    while (queue.length > 0) {
      const { roomId, firstStep } = queue.shift()!;
      if (roomId === targetId) return firstStep;
      if (visited.has(roomId)) continue;
      visited.add(roomId);

      const room = this.rooms.get(roomId);
      if (!room) continue;
      for (const connId of room.connections) {
        if (!visited.has(connId)) {
          queue.push({ roomId: connId, firstStep });
        }
      }
    }

    return null;
  }
}
