export interface MemoryCaptureRequest {
  conversationId: string;
  messageId: string;
  scope: 'project' | 'conversation' | 'assistant.ordinary';
  category: 'preferences' | 'projects' | 'technical' | 'decisions';
  text: string;
  keywords: readonly string[];
}
