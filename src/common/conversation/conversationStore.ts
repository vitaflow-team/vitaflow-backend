import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface StoredConversation<TState> {
  userId: string;
  state: TState;
}

// Generic, in-memory conversation store (ADR-009): generalized from the AI
// workout generator's own concrete store so any feature with a short-lived,
// turn-by-turn conversation (workouts, meal-plan generation, ...) gets its
// own typed instance without duplicating this class. Each feature module
// declares `ConversationStore` directly in its own `providers` array (never
// imported from a shared module), so Nest instantiates a separate `Map` per
// module — two domains never share conversation data even though they share
// this one class (confirmed by this feature's own regression suite).
//
// Deliberately in-memory, not a Prisma table: an incomplete conversation
// must leave no database trace, and no feature using this store needs to
// resume a conversation across server restarts or instances. A future
// multi-instance deployment would need to move this to a shared store (e.g.
// Redis) — out of scope for every current caller.
@Injectable()
export class ConversationStore<TState> {
  private readonly conversations = new Map<
    string,
    StoredConversation<TState>
  >();

  create(userId: string, state: TState): string {
    const conversationId = randomUUID();
    this.conversations.set(conversationId, { userId, state });
    return conversationId;
  }

  get(userId: string, conversationId: string): TState | null {
    const entry = this.conversations.get(conversationId);
    if (!entry || entry.userId !== userId) return null;
    return entry.state;
  }

  update(conversationId: string, state: TState): void {
    const entry = this.conversations.get(conversationId);
    if (entry) entry.state = state;
  }

  delete(conversationId: string): void {
    this.conversations.delete(conversationId);
  }
}
