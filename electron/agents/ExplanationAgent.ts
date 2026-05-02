// ExplanationAgent.ts — Specialized agent for explaining code, concepts, and answers

import { BaseAgent } from './BaseAgent';
import { AgentContext, AgentResult, AgentCapability, ExplanationResultData } from './types';
import { ProviderManager } from './ProviderManager';
import { configHelper } from '../ConfigHelper';

export class ExplanationAgent extends BaseAgent {
  readonly id = 'explanation';
  readonly capability: AgentCapability = {
    id: 'explanation',
    name: 'Explanation Agent',
    description: 'Explains code snippets, algorithms, concepts. Provides step-by-step breakdowns.',
    supportedQueryTypes: ['explanation', 'mixed'],
    priority: 8,
  };

  constructor(pm: ProviderManager) { super(pm); }

  canHandle(ctx: AgentContext): boolean {
    return ctx.queryType === 'explanation' || ctx.queryType === 'mixed';
  }

  async execute(ctx: AgentContext, signal?: AbortSignal): Promise<AgentResult> {
    try {
      const { screenshots, problemInfo, textQuery, language } = ctx;
      if (!screenshots?.length && !problemInfo && !textQuery) {
        return this.createErrorResult('No content to explain.', 'explanation');
      }

      let result: ExplanationResultData;
      if (screenshots?.length) {
        result = await this.explainFromScreenshots(screenshots, language, signal);
      } else {
        const content = textQuery || problemInfo?.problem_statement || '';
        result = await this.explainFromText(content, language, signal);
      }

      return this.createSuccessResult(result, 'explanation', 0.85,
        `Explained: ${result.title.substring(0, 80)}`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(errorMessage || 'Failed to generate explanation.', 'explanation');
    }
  }

  private async explainFromScreenshots(
    screenshots: Array<{path: string; data: string}>, language: string, signal?: AbortSignal
  ): Promise<ExplanationResultData> {
    const sys = `You are a patient, expert programming tutor. You explain concepts clearly with examples. Respond with ONLY valid JSON.`;
    const usr = `Analyze the screenshot(s) and provide a thorough explanation of the code/concept shown.
Preferred language: ${language}

Respond in this JSON format:
{
  "title": "Brief title of what is being explained",
  "explanation": "Detailed markdown explanation with step-by-step breakdown. Use headings, code blocks, and examples.",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "codeExamples": ["// Optional code example 1"]
}`;
    const config = configHelper.loadConfig();
    const resp = await this.providerManager.visionCompletion(
      [{ role: 'system', text: sys }, { role: 'user', text: usr, images: screenshots.map(s => s.data) }],
      { 
        temperature: 0.3, 
        maxTokens: 4000, 
        signal,
        model: config.explanationModel
      }
    );
    return this.parseResponse(resp);
  }

  private async explainFromText(
    content: string, language: string, signal?: AbortSignal
  ): Promise<ExplanationResultData> {
    const config = configHelper.loadConfig();
    const resp = await this.providerManager.chatCompletion(
      `Explain the following in detail (preferred language: ${language}):\n\n${content}\n\nRespond as JSON with fields: title, explanation (markdown), keyPoints (array), codeExamples (array).`,
      { 
        systemPrompt: 'Expert programming tutor. Respond with ONLY valid JSON.', 
        temperature: 0.3, 
        maxTokens: 4000, 
        signal,
        model: config.explanationModel
      }
    );
    return this.parseResponse(resp);
  }

  private parseResponse(text: string): ExplanationResultData {
    interface RawExplanation {
      title?: string;
      explanation?: string;
      keyPoints?: string[];
      key_points?: string[];
      codeExamples?: string[];
      code_examples?: string[];
      relatedTopics?: string[];
      related_topics?: string[];
    }
    let p: RawExplanation;
    try { 
      p = ProviderManager.parseJSONResponse(text) as RawExplanation; 
    } catch {
      p = { title: 'Explanation', explanation: text, keyPoints: [], codeExamples: [], relatedTopics: [] };
    }
    return {
      title: p.title || 'Explanation',
      explanation: p.explanation || text,
      keyPoints: Array.isArray(p.keyPoints || p.key_points) ? (p.keyPoints || p.key_points) as string[] : [],
      codeExamples: Array.isArray(p.codeExamples || p.code_examples) ? (p.codeExamples || p.code_examples) as string[] : [],
      relatedTopics: [],
    };
  }
}
