// BaseAgent.ts — Abstract base class for all specialized agents

import { AgentContext, AgentResult, AgentCapability, QueryType } from './types';
import { ProviderManager } from './ProviderManager';

/**
 * BaseAgent is the abstract foundation for every specialized agent in the system.
 * 
 * To create a new agent:
 * 1. Extend this class
 * 2. Implement `id`, `capability`, `canHandle()`, and `execute()`
 * 3. Register the agent with the PluginRegistry
 */
export abstract class BaseAgent {
  /**
   * Unique identifier for this agent (e.g., 'code_generation', 'mcq_solver').
   */
  abstract readonly id: string;

  /**
   * Describes what this agent can do and which query types it supports.
   */
  abstract readonly capability: AgentCapability;

  /**
   * Shared provider manager for making AI API calls.
   */
  protected providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Determines whether this agent can handle the given context.
   * The QueryRouter uses this to decide which agent(s) to dispatch to.
   */
  abstract canHandle(context: AgentContext): boolean;

  /**
   * Executes the agent's primary task.
   * Must return an AgentResult with a confidence score.
   */
  abstract execute(context: AgentContext, signal?: AbortSignal): Promise<AgentResult>;

  /**
   * Optional lifecycle hook called before execute().
   * Override to perform setup, logging, or context enrichment.
   */
  async onBeforeExecute(_: AgentContext): Promise<void> {
    // Default no-op — subclasses can override
  }

  /**
   * Optional lifecycle hook called after execute().
   * Override to perform cleanup, logging, or result post-processing.
   */
  async onAfterExecute(_1: AgentContext, _2: AgentResult): Promise<void> {
    // Default no-op — subclasses can override
  }

  /**
   * Convenience method: runs the full lifecycle (before → execute → after).
   */
  async run(context: AgentContext, signal?: AbortSignal): Promise<AgentResult> {
    await this.onBeforeExecute(context);
    const result = await this.execute(context, signal);
    await this.onAfterExecute(context, result);
    return result;
  }

  /**
   * Creates a standard error result for this agent.
   */
  protected createErrorResult(error: string, queryType?: string): AgentResult {
    return {
      success: false,
      agentId: this.id,
      queryType: (queryType || this.capability.supportedQueryTypes[0]) as QueryType,
      error,
      confidence: 0,
      verified: false,
    };
  }

  /**
   * Creates a standard success result for this agent.
   */
  protected createSuccessResult(
    data: unknown,
    queryType: string,
    confidence: number,
    reasoning?: string
  ): AgentResult {
    return {
      success: true,
      agentId: this.id,
      queryType: queryType as QueryType,
      data,
      confidence,
      reasoning,
      verified: false, // Will be set to true after ReasoningLayer verification
    };
  }
}
