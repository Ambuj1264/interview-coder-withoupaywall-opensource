// ContextManager.ts — Manages shared state and conversation context across agents

import { AgentContext, AgentMessage, QueryType } from './types';
import { configHelper } from '../ConfigHelper';

/**
 * ContextManager maintains conversation history and builds contexts for agent invocations.
 * It enables agents to share state and collaborate through a unified context.
 */
export class ContextManager {
  private conversationHistory: AgentMessage[] = [];
  private activeContext: AgentContext | null = null;
  private readonly maxHistorySize: number;

  constructor(maxHistorySize: number = 20) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Builds a complete AgentContext by merging defaults, config, and provided extras.
   */
  buildContext(queryType: QueryType, extras: Partial<AgentContext> = {}): AgentContext {
    const config = configHelper.loadConfig();

    const context: AgentContext = {
      queryType,
      language: extras.language || config.language || 'python',
      screenshots: extras.screenshots,
      problemInfo: extras.problemInfo,
      previousSolution: extras.previousSolution,
      conversationHistory: this.getRelevantHistory(queryType),
      textQuery: extras.textQuery,
      metadata: {
        ...extras.metadata,
        provider: config.apiProvider,
        timestamp: Date.now(),
      },
    };

    this.activeContext = context;
    return context;
  }

  /**
   * Adds a message to the conversation history.
   * Automatically trims to maxHistorySize.
   */
  addToHistory(message: AgentMessage): void {
    this.conversationHistory.push({
      ...message,
      timestamp: message.timestamp || Date.now(),
    });

    // Trim oldest messages if we exceed the limit
    if (this.conversationHistory.length > this.maxHistorySize) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Returns conversation history relevant to the given query type.
   * Filters to keep only related context to avoid polluting agent prompts.
   */
  getRelevantHistory(queryType: QueryType): AgentMessage[] {
    // For mixed queries, return all recent history
    if (queryType === 'mixed') {
      return [...this.conversationHistory].slice(-10);
    }

    // For specific query types, return messages from the same agent + system messages
    return this.conversationHistory
      .filter((msg) => {
        // Always include system messages
        if (msg.role === 'system') return true;
        // Include messages from the same agent type
        if (msg.agentId?.includes(queryType)) return true;
        // Include recent user messages for context
        if (msg.role === 'user') return true;
        return false;
      })
      .slice(-10);
  }

  /**
   * Returns the currently active context, or null if none.
   */
  getActiveContext(): AgentContext | null {
    return this.activeContext;
  }

  /**
   * Updates the active context with new information.
   * Useful when agents need to enrich the context during processing.
   */
  updateActiveContext(updates: Partial<AgentContext>): void {
    if (this.activeContext) {
      this.activeContext = { ...this.activeContext, ...updates };
    }
  }

  /**
   * Returns the full conversation history.
   */
  getFullHistory(): AgentMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Clears all context and history. Called on reset.
   */
  clearContext(): void {
    this.conversationHistory = [];
    this.activeContext = null;
  }

  /**
   * Records a user action (screenshot submission, query) in history.
   */
  recordUserAction(content: string): void {
    this.addToHistory({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Records an agent's response in history.
   */
  recordAgentResponse(agentId: string, content: string): void {
    this.addToHistory({
      role: 'assistant',
      content,
      timestamp: Date.now(),
      agentId,
    });
  }
}
