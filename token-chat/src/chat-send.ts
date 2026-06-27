import {
  chatRunWorkflow,
  type ChatRunWorkflowCallbacks,
} from './chat-run-workflow';

export function setChatCallbacks(callbacks: ChatRunWorkflowCallbacks): void {
  chatRunWorkflow.setCallbacks(callbacks);
}

export function getWebSearchPhase() {
  return chatRunWorkflow.getWebSearchPhase();
}

export function getWebSearchStatusText(): string {
  return chatRunWorkflow.getWebSearchStatusText();
}

export function isChatWebSearchEnabled(): boolean {
  return chatRunWorkflow.isChatWebSearchEnabled();
}

export function handleSend(): Promise<void> {
  return chatRunWorkflow.handleSendIntent();
}
