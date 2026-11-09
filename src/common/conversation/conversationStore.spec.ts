import { ConversationStore } from './conversationStore';

interface StubState {
  value: string;
}

describe('ConversationStore<TState> (generic, shared — ADR-009)', () => {
  let store: ConversationStore<StubState>;

  beforeEach(() => {
    store = new ConversationStore<StubState>();
  });

  it('UT-001 create then get with the same userId returns the stored state', () => {
    const conversationId = store.create('user-1', { value: 'first' });

    const result = store.get('user-1', conversationId);

    expect(result).toEqual({ value: 'first' });
  });

  it('UT-002 get with a different userId than the one that created the conversation returns null, never the other user state', () => {
    const conversationId = store.create('user-1', { value: 'secret' });

    const result = store.get('user-2', conversationId);

    expect(result).toBeNull();
  });

  it('UT-003 update on a conversation id that does not exist is a no-op, does not throw', () => {
    expect(() =>
      store.update('does-not-exist', { value: 'anything' }),
    ).not.toThrow();
    expect(store.get('user-1', 'does-not-exist')).toBeNull();
  });

  it('UT-004 delete removes the entry; a subsequent get returns null', () => {
    const conversationId = store.create('user-1', { value: 'first' });

    store.delete(conversationId);

    expect(store.get('user-1', conversationId)).toBeNull();
  });

  it('update replaces the stored state for an existing conversation, ownership unchanged', () => {
    const conversationId = store.create('user-1', { value: 'first' });

    store.update(conversationId, { value: 'second' });

    expect(store.get('user-1', conversationId)).toEqual({ value: 'second' });
  });

  it('two instances never share conversations (ADR-009: one provider instance per domain)', () => {
    const other = new ConversationStore<StubState>();
    const conversationId = store.create('user-1', { value: 'first' });

    expect(other.get('user-1', conversationId)).toBeNull();
  });
});
