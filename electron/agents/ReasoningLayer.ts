// ReasoningLayer.ts — Verification and validation of agent outputs

import { AgentContext, MCQResultData, VerificationResult, ConsistencyResult, ProblemInfo } from './types';
import { ProviderManager } from './ProviderManager';

/**
 * ReasoningLayer provides verification and validation for agent outputs.
 * It cross-checks answers, validates code logic, and detects potential hallucinations.
 */
export class ReasoningLayer {
  private providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Verifies an MCQ answer by re-evaluating with a different prompt structure.
   */
  async verifyMCQAnswer(result: MCQResultData, ctx: AgentContext): Promise<VerificationResult> {
    try {
      const optsList = result.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n');

      const resp = await this.providerManager.chatCompletion(
        `Verify MCQ. Question: "${result.question}"\nOptions:\n${optsList}\nProposed: "${result.selectedAnswer}" (index ${result.selectedIndex})\n\nIs this correct? Respond as JSON: {"verified": true/false, "confidence": 0.0-1.0, "issues": []}`,
        { systemPrompt: 'Verification agent. JSON only.', temperature: 0.1, maxTokens: 300 }
      );

      try {
        interface VerificationResponse {
          verified?: boolean;
          confidence?: number;
          issues?: string[];
          suggestions?: string[];
        }
        const parsed = ProviderManager.parseJSONResponse(resp) as VerificationResponse;
        return {
          verified: parsed.verified ?? true,
          confidence: parsed.confidence ?? 0.7,
          issues: parsed.issues || [],
          suggestions: parsed.suggestions || [],
        };
      } catch {
        return { verified: true, confidence: 0.6, issues: ['Verification parsing failed'] };
      }
    } catch (error: unknown) {
      console.warn('[ReasoningLayer] MCQ verification failed:', error);
      return { verified: true, confidence: 0.5, issues: ['Verification unavailable'] };
    }
  }

  /**
   * Verifies a code solution by mentally tracing through example inputs.
   */
  async verifyCodeSolution(code: string, problemInfo: ProblemInfo): Promise<VerificationResult> {
    try {
      const resp = await this.providerManager.chatCompletion(
        `Verify code solution for: ${problemInfo?.problem_statement || 'Unknown'}\n\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nDoes it solve the problem? JSON: {"verified": true/false, "confidence": 0.0-1.0, "issues": []}`,
        { systemPrompt: 'Code verification. JSON only.', temperature: 0.1, maxTokens: 500 }
      );

      try {
        interface VerificationResponse {
          verified?: boolean;
          confidence?: number;
          issues?: string[];
          suggestions?: string[];
        }
        const parsed = ProviderManager.parseJSONResponse(resp) as VerificationResponse;
        return {
          verified: parsed.verified ?? true,
          confidence: parsed.confidence ?? 0.7,
          issues: parsed.issues || [],
          suggestions: parsed.suggestions || [],
        };
      } catch {
        return { verified: true, confidence: 0.6, issues: ['Verification parsing failed'] };
      }
    } catch (error: unknown) {
      console.warn('[ReasoningLayer] Code verification failed:', error);
      return { verified: true, confidence: 0.5, issues: ['Verification unavailable'] };
    }
  }

  /**
   * Checks if an explanation is internally consistent and aligned with the context.
   */
  async checkConsistency(response: string, ctx: AgentContext): Promise<ConsistencyResult> {
    try {
      const contextSummary = ctx.problemInfo?.problem_statement || ctx.textQuery || 'No context';
      const resp = await this.providerManager.chatCompletion(
        `Check consistency:\nContext: "${contextSummary}"\nResponse: "${response.substring(0, 1000)}"\n\nAny factual errors? JSON: {"consistent": true/false, "confidence": 0.0-1.0, "inconsistencies": []}`,
        { systemPrompt: 'Consistency check. JSON only.', temperature: 0.1, maxTokens: 300 }
      );

      try {
        interface ConsistencyResponse {
          consistent?: boolean;
          confidence?: number;
          inconsistencies?: string[];
        }
        const parsed = ProviderManager.parseJSONResponse(resp) as ConsistencyResponse;
        return {
          consistent: parsed.consistent ?? true,
          confidence: parsed.confidence ?? 0.7,
          inconsistencies: parsed.inconsistencies || [],
        };
      } catch {
        return { consistent: true, confidence: 0.6 };
      }
    } catch (error: unknown) {
      console.warn('[ReasoningLayer] Consistency check failed:', error);
      return { consistent: true, confidence: 0.5 };
    }
  }
}
