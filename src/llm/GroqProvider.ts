// ============================================================
// GroqProvider — Fast LLM inference via Groq API
// Simplified: only generate(), no importance/embed
// ============================================================

import Groq from 'groq-sdk';
import type { LLMProvider } from '../types/index.js';

export interface GroqProviderConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxConcurrency?: number;
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export class GroqProvider implements LLMProvider {
  private client: Groq;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  private activeRequests = 0;
  private maxConcurrency: number;
  private queue: Array<{ resolve: () => void }> = [];

  private stats = {
    totalRequests: 0,
    totalTokens: 0,
    errors: 0,
    avgLatencyMs: 0,
  };

  constructor(config: GroqProviderConfig) {
    this.client = new Groq({ apiKey: config.apiKey });
    this.model = config.model || DEFAULT_MODEL;
    this.maxTokens = config.maxTokens || 150;
    this.temperature = config.temperature || 0.85;
    this.maxConcurrency = config.maxConcurrency || 10;
  }

  async generate(prompt: string): Promise<string> {
    await this.acquireConcurrency();
    const start = Date.now();

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a robot AI on a cursed spaceship. Stay in character. Be concise. Respond in the exact format requested.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      const result = completion.choices[0]?.message?.content || '';
      const latency = Date.now() - start;

      this.stats.totalRequests++;
      this.stats.totalTokens += completion.usage?.total_tokens || 0;
      this.stats.avgLatencyMs = (
        this.stats.avgLatencyMs * (this.stats.totalRequests - 1) + latency
      ) / this.stats.totalRequests;

      return result;
    } catch (err) {
      this.stats.errors++;
      throw err;
    } finally {
      this.releaseConcurrency();
    }
  }

  getStats() {
    return { ...this.stats };
  }

  private async acquireConcurrency(): Promise<void> {
    if (this.activeRequests < this.maxConcurrency) {
      this.activeRequests++;
      return;
    }
    return new Promise(resolve => {
      this.queue.push({ resolve });
    });
  }

  private releaseConcurrency(): void {
    this.activeRequests--;
    const next = this.queue.shift();
    if (next) {
      this.activeRequests++;
      next.resolve();
    }
  }
}
