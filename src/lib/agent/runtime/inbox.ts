/**
 * @file 会话级 Agent Inbox 注册表
 * @author Charlie
 */

import { AgentInbox } from "@/lib/agent/agent-loop/types";

const inboxBySession = new Map<number, AgentInbox>();

export function getSessionInbox(sessionId: number): AgentInbox {
  let inbox = inboxBySession.get(sessionId);
  if (!inbox) {
    inbox = new AgentInbox();
    inboxBySession.set(sessionId, inbox);
  }
  return inbox;
}

export function steerAgent(sessionId: number, text: string): void {
  getSessionInbox(sessionId).steer(text);
}

export function injectAgentContext(sessionId: number, text: string): void {
  getSessionInbox(sessionId).inject(text);
}

export function followupAgent(sessionId: number, text: string): void {
  getSessionInbox(sessionId).followup(text);
}

export function clearSessionInbox(sessionId: number): void {
  inboxBySession.delete(sessionId);
}
