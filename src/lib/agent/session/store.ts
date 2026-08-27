/**
 * @file 内存会话事件存储
 * @author Charlie
 */

import type { SessionEvent } from "@/lib/agent/session/types";

export class SessionStore {
  private events: SessionEvent[] = [];
  private seq = 0;
  private turn = 0;
  private step = 0;

  append<T extends SessionEvent["type"]>(
    type: T,
    data: Omit<Extract<SessionEvent, { type: T }>, "type" | "seq">,
  ): SessionEvent {
    this.seq += 1;
    const event = { type, ...data, seq: this.seq } as SessionEvent;
    this.events.push(event);
    return event;
  }

  getEvents(): readonly SessionEvent[] {
    return this.events;
  }

  startTurn(): number {
    this.turn += 1;
    this.step = 0;
    this.append("turn/start", { turn: this.turn });
    return this.turn;
  }

  endTurn(reason?: string): void {
    this.append("turn/end", { turn: this.turn, reason });
  }

  startStep(): number {
    this.step += 1;
    this.append("step/start", { turn: this.turn, step: this.step });
    return this.step;
  }

  endStep(): void {
    this.append("step/end", { turn: this.turn, step: this.step });
  }

  clear(): void {
    this.events = [];
    this.seq = 0;
    this.turn = 0;
    this.step = 0;
  }
}
