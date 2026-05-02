// CodeGenerationAgent.ts — Specialized agent for code generation tasks
// Refactored from ProcessingHelper.generateSolutionsHelper()

import { BaseAgent } from './BaseAgent';
import { AgentContext, AgentResult, AgentCapability, CodeResultData } from './types';
import { ProviderManager } from './ProviderManager';
import { configHelper } from '../ConfigHelper';

export class CodeGenerationAgent extends BaseAgent {
  readonly id = 'code_generation';
  readonly capability: AgentCapability = {
    id: 'code_generation',
    name: 'Code Generation Agent',
    description: 'Generates clean, optimized, and production-ready code solutions for programming problems.',
    supportedQueryTypes: ['code_generation', 'mixed'],
    priority: 10,
  };

  constructor(providerManager: ProviderManager) {
    super(providerManager);
  }

  canHandle(context: AgentContext): boolean {
    return (
      context.queryType === 'code_generation' ||
      context.queryType === 'mixed'
    );
  }

  async execute(context: AgentContext, signal?: AbortSignal): Promise<AgentResult> {
    try {
      const { problemInfo, language } = context;

      if (!problemInfo) {
        return this.createErrorResult('No problem information provided.', 'code_generation');
      }

      const systemPrompt = `You are an expert coding interview assistant. You produce clean, optimized, and production-ready code.
Your solutions are well-commented and handle edge cases. Be concise and focus on efficiency.`;

      const userPrompt = `
Generate a solution for the following coding problem:

PROBLEM STATEMENT:
${problemInfo.problem_statement}

CONSTRAINTS:
${problemInfo.constraints || 'No specific constraints provided.'}

EXAMPLE INPUT:
${problemInfo.example_input || 'No example input provided.'}

EXAMPLE OUTPUT:
${problemInfo.example_output || 'No example output provided.'}

LANGUAGE: ${language}

Respond in EXACTLY this JSON format:
{
  "code": "// Your solution code here",
  "thoughts": ["Short insight 1", "Short insight 2"],
  "time_complexity": "O(X) - Brief reason",
  "space_complexity": "O(X) - Brief reason"
}

Requirements:
- Clean, efficient, and commented code
- Include 2-3 short key insights
- Brief complexity analysis
- Handle edge cases
`;

      const config = configHelper.loadConfig();
      const responseText = await this.providerManager.chatCompletion(userPrompt, {
        systemPrompt,
        temperature: 0.2,
        maxTokens: 4000,
        signal,
        model: config.solutionModel
      });

      // Try to parse as JSON first
      let result: CodeResultData;
      try {
        result = ProviderManager.parseJSONResponse(responseText) as CodeResultData;
      } catch {
        // If JSON parsing fails, fall back to regex extraction
        result = this.extractFromFreeText(responseText);
      }

      // Validate and enrich the result
      result = this.validateResult(result);

      return this.createSuccessResult(result, 'code_generation', 0.85, 
        `Generated ${language} solution using ${this.getApproachDescription(result)}`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CodeGenerationAgent] Error:', error);
      return this.createErrorResult(
        errorMessage || 'Failed to generate code solution.',
        'code_generation'
      );
    }
  }

  /**
   * Falls back to regex-based extraction when the LLM doesn't return valid JSON.
   */
  private extractFromFreeText(responseText: string): CodeResultData {
    // Extract code block
    const codeMatch = responseText.match(/```(?:\w+)?\s*([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : responseText;

    // Extract thoughts / key insights
    const thoughtsRegex = /(?:Thoughts|Key Insights|Reasoning|Approach)[:\s]*([\s\S]*?)(?:Time complexity|$)/i;
    const thoughtsMatch = responseText.match(thoughtsRegex);
    let thoughts: string[] = [];

    if (thoughtsMatch?.[1]) {
      const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g);
      if (bulletPoints) {
        thoughts = bulletPoints
          .map((point) => point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
          .filter(Boolean);
      } else {
        thoughts = thoughtsMatch[1].split('\n').map((l) => l.trim()).filter(Boolean);
      }
    }

    // Extract complexity
    const timeMatch = responseText.match(/Time complexity[:\s]*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i);
    const spaceMatch = responseText.match(/Space complexity[:\s]*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i);

    return {
      code,
      thoughts: thoughts.length > 0 ? thoughts : ['Solution approach based on efficiency and readability'],
      time_complexity: timeMatch?.[1]?.trim() || 'O(n) - Linear time complexity',
      space_complexity: spaceMatch?.[1]?.trim() || 'O(n) - Linear space complexity',
    };
  }

  /**
   * Validates and enriches the result to ensure quality.
   */
  private validateResult(result: CodeResultData): CodeResultData {
    // Ensure thoughts is a non-empty array
    if (!result.thoughts || result.thoughts.length === 0) {
      result.thoughts = ['Solution approach based on efficiency and readability'];
    }

    // Ensure complexity has Big-O notation
    result.time_complexity = this.ensureComplexityFormat(result.time_complexity);
    result.space_complexity = this.ensureComplexityFormat(result.space_complexity);

    return result;
  }

  /**
   * Ensures a complexity string has proper O() notation formatting.
   */
  private ensureComplexityFormat(complexity: string): string {
    if (!complexity || complexity.trim() === '') {
      return 'O(n) - Linear complexity';
    }

    if (!/O\([^)]+\)/i.test(complexity)) {
      return `O(n) - ${complexity}`;
    }

    // Ensure there's an explanation after the O() notation
    if (!complexity.includes('-') && !complexity.includes('because')) {
      const match = complexity.match(/O\([^)]+\)/i);
      if (match) {
        const notation = match[0];
        const rest = complexity.replace(notation, '').trim();
        if (rest) {
          return `${notation} - ${rest}`;
        }
      }
    }

    return complexity;
  }

  /**
   * Generates a brief description of the approach for the reasoning field.
   */
  private getApproachDescription(result: CodeResultData): string {
    if (result.thoughts.length > 0) {
      return result.thoughts[0].substring(0, 100);
    }
    return 'standard algorithm approach';
  }
}
