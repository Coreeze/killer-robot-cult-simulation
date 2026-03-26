// ============================================================
// Demo — LLM-powered simulation via Groq
// Set GROQ_API_KEY in .env before running
// ============================================================

import 'dotenv/config';
import { Game } from '../game/Game.js';
import { GroqProvider } from '../llm/GroqProvider.js';
import mapLayout from '../data/map.json';

async function runDemo() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    console.error('Add your Groq API key to .env');
    process.exit(1);
  }

  console.log('A-LINE: Killer Robot Cult Simulation (Groq-powered)\n');

  const groq = new GroqProvider({
    apiKey,
    model: 'llama-3.3-70b-versatile',
    maxTokens: 150,
    temperature: 0.85,
    maxConcurrency: 8,
  });

  const game = new Game({ ticksPerSecond: 1, minGods: 3 });
  game.setLLM(groq);

  game.on({
    onPhaseChange: (phase, tick) => console.log(`\n--- ${phase.toUpperCase()} (tick ${tick}) ---`),
    onAgentDied: (victimId) => {
      const state = game.getState();
      console.log(`\n[KILL] ${state.robots[victimId]?.name || victimId} HAS BEEN KILLED`);
    },
    onCouncilCalled: (agentId) => {
      const state = game.getState();
      console.log(`\n[COUNCIL] called by ${state.robots[agentId]?.name}`);
    },
    onCouncilEnded: (result) => {
      console.log(`\n[VOTE] ${result.ejected ? 'EJECTED ' + result.ejected : 'No ejection'}`);
    },
    onVoiceOfGod: (entry) => console.log(`\n[VOICE OF GOD] "${entry.words}"`),
    onGameOver: (winner) => console.log(`\n[GAME OVER] ${winner === 'crew' ? 'CREWMATES' : 'KILLERS'} WIN!`),
  });

  // Join gods
  ['alice', 'bob', 'charlie', 'diana'].forEach(id => game.joinGame(id));

  // Start with map
  game.startGame(mapLayout);

  // Define robots with distinct identities
  game.defineRobot('alice', 'AXIOM-7', '🤖', 'logical, analytical, suspicious of everyone');
  game.defineRobot('bob', 'RUST', '⚙️', 'gruff, direct, fiercely loyal to the crew');
  game.defineRobot('charlie', 'WHISPER', '👁️', 'quiet, observant, speaks in riddles');
  game.defineRobot('diana', 'NOVA', '🔮', 'energetic, curious, trusts too easily');

  game.startSimulation();
  console.log('Simulation running...\n');

  // Print state every 3 seconds
  const printInterval = setInterval(() => {
    const state = game.getState();
    if (state.phase === 'ended') { clearInterval(printInterval); return; }

    const robots = Object.values(state.robots);
    const alive = robots.filter(r => r.status === 'alive');
    console.log(`\n[Tick] ${state.phase} | Alive: ${alive.length}/${robots.length}`);
    for (const r of alive) {
      const room = state.rooms.find(rm => rm.robots.includes(r.id));
      console.log(`  ${r.name} @ ${room?.name || '?'} | said: ${r.lastMessage || '-'}`);
    }
  }, 3000);

  // Whisper after 5 seconds
  setTimeout(() => {
    game.whisperToRobot('alice', 'trust no one');
    game.whisperToRobot('bob', 'protect nova');
    console.log('\n  alice whispers: "trust no one"');
    console.log('  bob whispers: "protect nova"');
  }, 5000);

  // Stop after 45 seconds
  setTimeout(() => {
    game.stop();
    clearInterval(printInterval);

    const stats = groq.getStats();
    console.log('\n=== Groq Stats ===');
    console.log(`  Requests: ${stats.totalRequests} | Tokens: ${stats.totalTokens} | Avg: ${stats.avgLatencyMs.toFixed(0)}ms | Errors: ${stats.errors}`);

    const final = game.getState();
    console.log('\n=== Final State ===');
    for (const r of Object.values(final.robots)) {
      console.log(`  ${r.name}: ${r.status} | beliefs: ${r.beliefs || 'none'}`);
    }
    process.exit(0);
  }, 45_000);
}

runDemo().catch(console.error);
