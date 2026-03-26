# A-LINE: Killer Robot Cult Simulation

A small TypeScript simulation engine for hidden-role robot drama on a spaceship.

Multiple "gods" each control a robot indirectly:
- each god defines a robot identity
- some robots are secretly killers
- gods can whisper short instructions to their own robot
- once per minute, a `Voice of God` round can broadcast a winning phrase to every living robot
- robots move, talk, kill, and call councils

The current design stays intentionally simple:
- robot beliefs are plain concatenated text
- actions are chosen one at a time
- emergence comes from hidden roles, room topology, stochastic behavior, and god influence

## Features

- Hidden-role simulation with `crewmate` and `killer` agents
- Room-based movement on a spaceship map
- Private god whispers
- Periodic `Voice of God` rounds
- Council voting and ejection flow
- Headless fallback behavior with no LLM required
- Optional Groq-powered action generation

## Install

```bash
npm install
```

If you want to use Groq, create a `.env` file with:

```bash
GROQ_API_KEY=your_api_key_here
```

## Scripts

```bash
npm run build
npm run demo
npm run demo:groq
npm run dev
```

What they do:
- `npm run build`: compile TypeScript to `dist/`
- `npm run demo`: run the headless fallback simulation
- `npm run demo:groq`: run the simulation with Groq-backed agent decisions
- `npm run dev`: TypeScript watch mode

## Core Flow

1. Gods join the lobby.
2. The game starts with a map.
3. Each god defines a robot.
4. The engine secretly assigns killer roles based on `killerRatio`.
5. The simulation enters `playing`.
6. Living robots repeatedly choose one action:
   - `move`
   - `talk`
   - `kill`
   - `call_council`
   - `idle`
7. Councils can eject robots.
8. The game ends when killers are gone or killers reach parity with the crew.

## Beliefs And God Influence

Robots do not maintain a heavy memory model.

Instead, beliefs are a single append-only string:
- whisper to one robot: appended as `whisper of god: ...`
- voice of god to all living robots: appended as `voice of god: ...`

That belief string is then included in the prompt/context used for future action decisions.

## Voice Of God

`Voice of God` is a timed global event:

- it can start once `voiceOfGodIntervalTicks` have passed since the previous round ended
- with the default config and `ticksPerSecond: 1`, that means roughly once per minute
- a subset of connected gods is selected
- selected gods submit short phrases
- gods vote on the submissions
- the winning phrase is appended to every living robot's beliefs

Default timing lives in `src/types/index.ts`.

## Project Structure

```text
src/
  agents/           Robot entity model
  communication/    Message bus
  data/             Built-in map data
  engine/           Main simulation loop
  examples/         Runnable demos
  game/             High-level managers
  llm/              Groq provider
  types/            Shared types and config
```

## Minimal Usage

```ts
import { Game } from "./dist/index.js";
import mapLayout from "./dist/data/map.json";

const game = new Game({ ticksPerSecond: 1, minGods: 3 });

game.joinGame("alice");
game.joinGame("bob");
game.joinGame("charlie");

game.startGame(mapLayout);

game.defineRobot("alice", "AXIOM-7", "🤖", "logical, analytical, suspicious");
game.defineRobot("bob", "RUST", "⚙️", "gruff, direct, loyal");
game.defineRobot("charlie", "WHISPER", "👁️", "quiet, observant, cryptic");

game.startSimulation();

game.whisperToRobot("alice", "trust no one");
```

For a fuller example, see:
- `src/examples/demo.ts`
- `src/examples/demo-groq.ts`

## Public API

Primary entrypoints:
- `Game`: high-level facade for joining, setup, simulation control, influence, and queries
- `Engine`: lower-level simulation loop
- `GroqProvider`: optional LLM-backed action generation

Useful `Game` methods:
- `joinGame()`
- `startGame()`
- `defineRobot()`
- `startSimulation()`
- `whisperToRobot()`
- `submitVoiceOfGod()`
- `voteVoiceOfGod()`
- `voteInCouncil()`
- `getState()`
- `stop()`

## Current Design Notes

- The engine is optimized for simplicity, not massive-scale simulation.
- `AsyncOperation` only tracks pending action generation.
- LLM integration is optional. Without it, the engine falls back to simple stochastic behavior.
- The simulation is headless and event-driven, making it easy to plug into a UI later.
