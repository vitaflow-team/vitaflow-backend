import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConversationAnswers } from './llmExplanation.types';
import { OrchestrationField } from './workouts.types';

export interface OrchestrationState {
  answers: ConversationAnswers;
  ageKnown: boolean;
  // `undefined` = not yet known/asked; a real value = known (pre-filled
  // from `FitnessProfile` or just answered this conversation) — ADR-015.
  weightKg?: number;
  heightCm?: number;
  sessionDurationMin?: number;
  // `undefined` = not yet asked; `null` = asked and explicitly skipped; a
  // string = provided — the three-state distinction `weightKg`/etc. above
  // don't need, since this field alone is optional (ADR-009/ADR-015).
  restrictionDetail?: string | null;
  // The field the most recently returned question was about; the next
  // `answer()` call's raw text is interpreted as a reply to this field.
  pendingField: OrchestrationField | null;
}

interface StoredConversation {
  userId: string;
  state: OrchestrationState;
}

// Deliberately in-memory, not a Prisma table: an incomplete conversation
// must leave no database trace (US-001.EC-2/UT-003), and this feature has
// no requirement to resume a conversation across server restarts or
// instances. A future multi-instance deployment would need to move this to
// a shared store (e.g. Redis) — out of this task's scope.
@Injectable()
export class ConversationStore {
  private readonly conversations = new Map<string, StoredConversation>();

  create(userId: string, state: OrchestrationState): string {
    const conversationId = randomUUID();
    this.conversations.set(conversationId, { userId, state });
    return conversationId;
  }

  get(userId: string, conversationId: string): OrchestrationState | null {
    const entry = this.conversations.get(conversationId);
    if (!entry || entry.userId !== userId) return null;
    return entry.state;
  }

  update(conversationId: string, state: OrchestrationState): void {
    const entry = this.conversations.get(conversationId);
    if (entry) entry.state = state;
  }

  delete(conversationId: string): void {
    this.conversations.delete(conversationId);
  }
}
