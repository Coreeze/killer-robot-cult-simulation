// ============================================================
// Demo — Headless simulation with fallback AI (no LLM)
// ============================================================

import { Game } from '../game/Game.js';
import mapLayout from '../data/map.json';

async function runDemo() {
  console.log('A-LINE: Killer Robot Cult Simulation\n');

  const game = new Game({ ticksPerSecond: 2, minGods: 3 });

  game.on({
    onPhaseChange: (phase, tick) => console.log(`\n[PHASE] ${phase} (tick ${tick})`),
    onAgentDied: (victimId) => {
      const state = game.getState();
      const victim = state.robots[victimId];
      console.log(`\n[KILL] ${victim?.name || victimId} has been murdered!`);
    },
    onCouncilCalled: (agentId) => {
      const state = game.getState();
      const caller = state.robots[agentId];
      console.log(`\n[COUNCIL] ${caller?.name || agentId} called a council!`);
    },
    onCouncilEnded: (result) => {
      console.log(`\n[VOTE] ${result.ejected ? 'Ejected ' + result.ejected : 'No ejection'}`);
    },
    onVoiceOfGod: (entry) => console.log(`\n[VOICE OF GOD] "${entry.words}"`),
    onGameOver: (winner) => console.log(`\n[GAME OVER] ${winner === 'crew' ? 'Crewmates' : 'Killers'} win!`),
  });

  // Join gods
  ['alice', 'bob', 'charlie', 'diana'].forEach(id => game.joinGame(id));

  // Start with map
  game.startGame(mapLayout);

  // Define robots
  game.defineRobot('alice', 'AXIOM-7', '🤖', 'logical and analytical robot');
  game.defineRobot('bob', 'RUST', '⚙️', 'gruff but loyal industrial bot');
  game.defineRobot('charlie', 'WHISPER', '👁️', 'quiet observant android');
  game.defineRobot('diana', 'NOVA', '🔮', 'energetic curious drone');

  game.startSimulation();

  // Print state every 2 seconds
  const printInterval = setInterval(() => {
    const state = game.getState();
    if (state.phase === 'ended') { clearInterval(printInterval); return; }

    const robots = Object.values(state.robots);
    const alive = robots.filter(r => r.status === 'alive');
    console.log(`\n[Tick] Phase: ${state.phase} | Alive: ${alive.length}/${robots.length}`);
    for (const r of alive) {
      const room = state.rooms.find(rm => rm.robots.includes(r.id));
      console.log(`  ${r.name} @ ${room?.name || '?'} | beliefs: ${r.beliefs || 'none'} | said: ${r.lastMessage || '-'}`);
    }

    // Show room messages
    for (const [roomId, msgs] of Object.entries(state.roomMessages)) {
      if (msgs.length > 0) {
        const room = state.rooms.find(r => r.id === roomId);
        console.log(`  [${room?.name}] ${msgs.map(m => `${m.fromName}: ${m.message}`).join(' | ')}`);
      }
    }
  }, 2000);

  // Whisper after 3 seconds
  setTimeout(() => {
    game.whisperToRobot('alice', 'trust no one');
    console.log('\n  alice whispers: "trust no one"');
  }, 3000);

  // Stop after 20 seconds
  setTimeout(() => {
    game.stop();
    clearInterval(printInterval);
    const final = game.getState();
    console.log('\n=== Final State ===');
    for (const r of Object.values(final.robots)) {
      console.log(`  ${r.name}: ${r.status} | beliefs: ${r.beliefs || 'none'}`);
    }
    process.exit(0);
  }, 20_000);
}

runDemo().catch(console.error);
