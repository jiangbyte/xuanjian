/**
 * @file 会话级 Inbox（steer / inject / followup）
 */

export class AgentInbox {
  private steers: string[] = [];
  private injects: string[] = [];
  private followups: string[] = [];

  get hasPending(): boolean {
    return (
      this.steers.length > 0 ||
      this.injects.length > 0 ||
      this.followups.length > 0
    );
  }

  steer(text: string): void {
    const t = text.trim();
    if (t) this.steers.push(t);
  }

  inject(text: string): void {
    const t = text.trim();
    if (t) this.injects.push(t);
  }

  followup(text: string): void {
    const t = text.trim();
    if (t) this.followups.push(t);
  }

  /** 取出并清空待合并用户消息 */
  drainAsUserMessages(): Array<{ role: "user"; content: string }> {
    const out: Array<{ role: "user"; content: string }> = [];
    for (const t of this.injects.splice(0)) {
      out.push({ role: "user", content: `（系统上下文）\n${t}` });
    }
    for (const t of this.steers.splice(0)) {
      out.push({ role: "user", content: `（用户中途指示）\n${t}` });
    }
    for (const t of this.followups.splice(0)) {
      out.push({ role: "user", content: t });
    }
    return out;
  }
}

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

export function clearSessionInbox(sessionId: number): void {
  inboxBySession.delete(sessionId);
}
