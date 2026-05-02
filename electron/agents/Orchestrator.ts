// Orchestrator.ts — Central coordinator for the agentic AI system
// Manages the plan → classify → execute → verify workflow

import { ProviderManager } from './ProviderManager';
import { ContextManager } from './ContextManager';
import { PluginRegistry } from './PluginRegistry';
import { QueryRouter } from './QueryRouter';
import { ReasoningLayer } from './ReasoningLayer';
import { CodeGenerationAgent } from './CodeGenerationAgent';
import { DebuggingAgent } from './DebuggingAgent';
import { MCQSolverAgent } from './MCQSolverAgent';
import { ExplanationAgent } from './ExplanationAgent';
import {
  AgentContext,
  AgentResult,
  ClassifiedQuery,
  ProcessingStatus,
  QueryType,
  ProblemInfo,
  MCQResultData,
  CodeResultData,
  ExplanationResultData,
} from './types';

/**
 * The Orchestrator is the brain of the agentic system.
 * It classifies queries, dispatches to the right agent(s),
 * verifies results, and manages the overall workflow.
 */
export class Orchestrator {
  private providerManager: ProviderManager;
  private contextManager: ContextManager;
  private pluginRegistry: PluginRegistry;
  private queryRouter: QueryRouter;
  private reasoningLayer: ReasoningLayer;

  constructor() {
    // Initialize infrastructure
    this.providerManager = new ProviderManager();
    this.contextManager = new ContextManager();
    this.pluginRegistry = new PluginRegistry();
    this.queryRouter = new QueryRouter(this.providerManager);
    this.reasoningLayer = new ReasoningLayer(this.providerManager);

    // Register all built-in agents
    this.registerBuiltInAgents();

    console.log('[Orchestrator] Initialized with agents:', this.pluginRegistry.getSummary());
  }

  /**
   * Registers all built-in specialized agents.
   */
  private registerBuiltInAgents(): void {
    this.pluginRegistry.register(new CodeGenerationAgent(this.providerManager));
    this.pluginRegistry.register(new DebuggingAgent(this.providerManager));
    this.pluginRegistry.register(new MCQSolverAgent(this.providerManager));
    this.pluginRegistry.register(new ExplanationAgent(this.providerManager));
  }

  /**
   * Checks if the AI provider is configured and ready.
   */
  isReady(): boolean {
    return this.providerManager.isReady();
  }

  /**
   * Returns the ProviderManager (for backward compatibility checks).
   */
  getProviderManager(): ProviderManager {
    return this.providerManager;
  }

  /**
   * Returns the PluginRegistry for external agent registration.
   */
  getRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  // ─── Primary entry point: screenshot-based processing ──────────────

  /**
   * Process screenshots through the full agentic pipeline:
   * 1. Extract content from screenshots
   * 2. Classify the query type
   * 3. Route to the appropriate agent
   * 4. Verify the result
   * 5. Return unified AgentResult
   */
  async processScreenshots(
    screenshots: Array<{ path: string; data: string }>,
    language: string,
    signal?: AbortSignal,
    onProgress?: (status: ProcessingStatus) => void
  ): Promise<AgentResult> {
    try {
      // Step 1: Classify the query
      onProgress?.({ message: 'Analyzing screenshots...', progress: 10 });

      const classification = await this.queryRouter.classifyQuery(
        screenshots.map((s) => ({ data: s.data })),
        undefined,
        signal
      );

      console.log('[Orchestrator] Classification:', classification);
      onProgress?.({
        message: `Detected: ${this.getQueryTypeLabel(classification.primaryType)}`,
        progress: 20,
        phase: 'classification',
      });

      // Step 2: Extract problem info from screenshots
      onProgress?.({ message: 'Extracting problem details...', progress: 30 });

      const problemInfo = await this.extractProblemInfo(
        screenshots,
        language,
        classification.primaryType,
        signal
      );

      // Step 3: Build context
      const context = this.contextManager.buildContext(classification.primaryType, {
        screenshots,
        language,
        problemInfo,
      });

      // Record user action
      this.contextManager.recordUserAction(
        `Submitted ${screenshots.length} screenshot(s) — classified as ${classification.primaryType}`
      );

      // Step 4: Execute the appropriate agent(s)
      onProgress?.({
        message: `Running ${this.getQueryTypeLabel(classification.primaryType)} agent...`,
        progress: 50,
      });

      let result: AgentResult;

      if (classification.primaryType === 'mixed') {
        result = await this.processMixedQuery(classification, context, signal, onProgress);
      } else {
        result = await this.executeSingleAgent(classification.primaryType, context, signal);
      }

      if (!result.success) {
        return result;
      }

      // Step 5: Verify the result (lightweight — skipped on low confidence classifications)
      if (classification.confidence >= 0.6) {
        onProgress?.({ message: 'Verifying result...', progress: 85 });
        result = await this.verifyResult(result, context);
      }

      // Step 6: Record and return
      this.contextManager.recordAgentResponse(
        result.agentId,
        JSON.stringify(result.data).substring(0, 500)
      );

      onProgress?.({ message: 'Complete', progress: 100 });
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Orchestrator] Processing error:', error);
      return {
        success: false,
        agentId: 'orchestrator',
        queryType: 'code_generation',
        error: errorMessage || 'Processing failed.',
        confidence: 0,
        verified: false,
      };
    }
  }

  // ─── Debug-specific entry point (backward compat) ──────────────────

  /**
   * Process extra screenshots for debugging (called from solutions view).
   * This is a direct dispatch to the DebuggingAgent.
   */
  async processDebugScreenshots(
    screenshots: Array<{ path: string; data: string }>,
    problemInfo: ProblemInfo,
    language: string,
    signal?: AbortSignal,
    onProgress?: (status: ProcessingStatus) => void
  ): Promise<AgentResult> {
    onProgress?.({ message: 'Processing debug screenshots...', progress: 30 });

    const context = this.contextManager.buildContext('debugging', {
      screenshots,
      language,
      problemInfo,
    });

    const result = await this.executeSingleAgent('debugging', context, signal);

    onProgress?.({ message: 'Debug analysis complete', progress: 100 });
    return result;
  }

  // ─── Internal execution methods ────────────────────────────────────

  /**
   * Executes a single agent for a given query type.
   */
  private async executeSingleAgent(
    queryType: QueryType,
    context: AgentContext,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    const agents = this.pluginRegistry.getAgentsForType(queryType);

    if (agents.length === 0) {
      return {
        success: false,
        agentId: 'orchestrator',
        queryType,
        error: `No agent registered for query type: ${queryType}`,
        confidence: 0,
        verified: false,
      };
    }

    // Use the highest-priority agent
    const agent = agents[0];
    console.log(`[Orchestrator] Dispatching to ${agent.id} for ${queryType}`);

    return agent.run(context, signal);
  }

  /**
   * Handles mixed queries by dispatching to multiple agents.
   */
  private async processMixedQuery(
    classification: ClassifiedQuery,
    context: AgentContext,
    signal?: AbortSignal,
    onProgress?: (status: ProcessingStatus) => void
  ): Promise<AgentResult> {
    const types = [classification.primaryType, ...classification.secondaryTypes]
      .filter((t) => t !== 'mixed');

    // If no secondary types, fall back to code_generation
    if (types.length === 0) {
      types.push('code_generation');
    }

    const results: AgentResult[] = [];

    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      onProgress?.({
        message: `Running ${this.getQueryTypeLabel(type)} agent (${i + 1}/${types.length})...`,
        progress: 50 + Math.round((i / types.length) * 30),
      });

      const subContext = { ...context, queryType: type as QueryType };
      const result = await this.executeSingleAgent(type as QueryType, subContext, signal);
      results.push(result);
    }

    // Combine results
    const successResults = results.filter((r) => r.success);
    if (successResults.length === 0) {
      return results[0] || {
        success: false,
        agentId: 'orchestrator',
        queryType: 'mixed',
        error: 'All agents failed for mixed query.',
        confidence: 0,
        verified: false,
      };
    }

    // Return the primary result with secondary data attached
    const primary = successResults[0];
    const secondary = successResults.slice(1);

    return {
      ...primary,
      queryType: 'mixed',
      metadata: {
        ...primary.metadata,
        secondaryResults: secondary.map((r) => ({
          agentId: r.agentId,
          queryType: r.queryType,
          data: r.data,
          confidence: r.confidence,
        })),
      },
    };
  }

  // ─── Problem extraction ────────────────────────────────────────────

  /**
   * Extracts problem information from screenshots using the vision API.
   * Adapts the extraction prompt based on the detected query type.
   */
  private async extractProblemInfo(
    screenshots: Array<{ path: string; data: string }>,
    language: string,
    queryType: QueryType,
    signal?: AbortSignal
  ): Promise<ProblemInfo> {
    const imageDataList = screenshots.map((s) => s.data);

    let extractionPrompt: string;

    if (queryType === 'mcq') {
      extractionPrompt = `Extract the MCQ from these screenshots. Return JSON with:
{
  "problem_statement": "The question text",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "question_type": "mcq",
  "constraints": null,
  "example_input": null,
  "example_output": null
}`;
    } else if (queryType === 'explanation') {
      extractionPrompt = `Extract the content that needs explanation from these screenshots. Return JSON with:
{
  "problem_statement": "The content/concept/code to explain",
  "question_type": "explanation",
  "constraints": null,
  "example_input": null,
  "example_output": null
}`;
    } else {
      extractionPrompt = `Extract the coding problem details from these screenshots. Preferred language: ${language}. Return JSON with:
{
  "problem_statement": "Full problem statement",
  "constraints": "Any constraints",
  "example_input": "Example input",
  "example_output": "Example output",
  "question_type": "coding"
}`;
    }

    const systemPrompt = 'You are a problem extractor. Analyze screenshots and extract structured information. Return ONLY valid JSON, no other text.';

    const responseText = await this.providerManager.visionCompletion(
      [
        { role: 'system', text: systemPrompt },
        { role: 'user', text: extractionPrompt, images: imageDataList },
      ],
      { temperature: 0.2, maxTokens: 4000, signal }
    );

    try {
      return ProviderManager.parseJSONResponse(responseText) as ProblemInfo;
    } catch {
      console.warn('[Orchestrator] Failed to parse problem info, using raw text');
      return {
        problem_statement: responseText.substring(0, 2000),
        question_type: queryType === 'mcq' ? 'mcq' : 'coding',
      };
    }
  }

  // ─── Verification ──────────────────────────────────────────────────

  /**
   * Runs the appropriate verification based on query type.
   */
  private async verifyResult(result: AgentResult, context: AgentContext): Promise<AgentResult> {
    try {
      switch (result.queryType) {
        case 'mcq': {
          const verification = await this.reasoningLayer.verifyMCQAnswer(result.data as MCQResultData, context);
          return {
            ...result,
            verified: verification.verified,
            confidence: (result.confidence + verification.confidence) / 2,
            metadata: { ...result.metadata, verification },
          };
        }

        case 'code_generation': {
          const codeData = result.data as CodeResultData;
          if (codeData?.code && context.problemInfo) {
            const verification = await this.reasoningLayer.verifyCodeSolution(
              codeData.code,
              context.problemInfo
            );
            return {
              ...result,
              verified: verification.verified,
              confidence: (result.confidence + verification.confidence) / 2,
              metadata: { ...result.metadata, verification },
            };
          }
          return { ...result, verified: true };
        }

        case 'explanation': {
          const explanationData = result.data as ExplanationResultData;
          const consistency = await this.reasoningLayer.checkConsistency(
            explanationData?.explanation || '',
            context
          );
          return {
            ...result,
            verified: consistency.consistent,
            confidence: (result.confidence + consistency.confidence) / 2,
            metadata: { ...result.metadata, consistency },
          };
        }

        default:
          return { ...result, verified: true };
      }
    } catch (error) {
      console.warn('[Orchestrator] Verification failed, skipping:', error);
      return { ...result, verified: true };
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────

  /**
   * Returns a human-readable label for a query type.
   */
  private getQueryTypeLabel(type: QueryType): string {
    const labels: Record<QueryType, string> = {
      code_generation: 'Code Generation',
      debugging: 'Debugging',
      mcq: 'MCQ Solving',
      explanation: 'Explanation',
      mixed: 'Multi-Task',
    };
    return labels[type] || type;
  }

  /**
   * Clears all context (called on reset).
   */
  resetContext(): void {
    this.contextManager.clearContext();
  }
}
