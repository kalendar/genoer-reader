/**
 * Compose the message array sent to the engine for one chat turn.
 *
 * Retrieval is re-run per question (SPEC.md §5 "Conversation"); only the CURRENT
 * question is grounded with retrieved passages. Prior turns are replayed as
 * plain user/assistant messages to preserve conversational context without
 * re-stuffing (and re-paying the token cost of) old passages.
 */
import type { ChatMessage } from '$lib/engine';
import type { ChatTurn } from '$lib/stores/chat';

export function composeMessages(
	systemPrompt: string,
	history: ChatTurn[],
	groundedUserContent: string
): ChatMessage[] {
	const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
	for (const turn of history) {
		messages.push({ role: turn.role, content: turn.content });
	}
	messages.push({ role: 'user', content: groundedUserContent });
	return messages;
}
