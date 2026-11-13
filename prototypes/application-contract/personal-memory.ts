export interface MemoryCaptureRequest {
  conversationId: string;
  messageId: string;
  expectedProjectId?: string | null;
  expectedSourceText?: string;
  scope: 'project' | 'conversation';
  category: 'preferences' | 'projects' | 'technical' | 'decisions';
  text: string;
  keywords: readonly string[];
}
