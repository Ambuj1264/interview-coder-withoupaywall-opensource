// MCQSolverAgent.ts — Specialized agent for solving MCQs

import { BaseAgent } from './BaseAgent';
import { AgentContext, AgentResult, AgentCapability, MCQResultData, ProblemInfo } from './types';
import { ProviderManager } from './ProviderManager';
import { configHelper } from '../ConfigHelper';

export class MCQSolverAgent extends BaseAgent {
  readonly id = 'mcq_solver';
  readonly capability: AgentCapability = {
    id: 'mcq_solver',
    name: 'MCQ Solver Agent',
    description: 'Answers MCQs with a focus on accuracy and elimination strategy.',
    supportedQueryTypes: ['mcq', 'mixed'],
    priority: 10,
  };

  constructor(pm: ProviderManager) { super(pm); }

  canHandle(ctx: AgentContext): boolean {
    return ctx.queryType === 'mcq' || ctx.queryType === 'mixed';
  }

  async execute(ctx: AgentContext, signal?: AbortSignal): Promise<AgentResult> {
    try {
      const { screenshots, problemInfo, textQuery } = ctx;
      if (!screenshots?.length && !problemInfo?.options?.length && !textQuery) {
        return this.createErrorResult('No MCQ data provided.', 'mcq');
      }

      let mcqData: MCQResultData;
      if (screenshots?.length) {
        mcqData = await this.solveFromScreenshots(screenshots, signal);
      } else if (problemInfo?.options?.length) {
        mcqData = await this.solveFromInfo(problemInfo, signal);
      } else {
        mcqData = await this.solveFromText(textQuery!, signal);
      }

      return this.createSuccessResult(mcqData, 'mcq', mcqData.confidence,
        `Selected "${mcqData.selectedAnswer}" (${Math.round(mcqData.confidence * 100)}% confidence)`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createErrorResult(errorMessage || 'Failed to solve MCQ.', 'mcq');
    }
  }

  private readonly JSON_SCHEMA = `{
  "question": "Full question text",
  "options": ["A", "B", "C", "D"],
  "selectedAnswer": "Correct option text",
  "selectedIndex": 0,
  "confidence": 0.95,
  "explanation": "Brief explanation of the correct answer"
}`;

  private async solveFromScreenshots(screenshots: Array<{path: string; data: string}>, signal?: AbortSignal): Promise<MCQResultData> {
    const sys = 'You are an expert MCQ solver for IT/programming. Use an elimination strategy. Respond with ONLY valid JSON.';
    const usr = `Analyze the screenshot(s), extract the MCQ, and solve it.\nRespond in this JSON format:\n${this.JSON_SCHEMA}`;
    const config = configHelper.loadConfig();
    const resp = await this.providerManager.visionCompletion(
      [{ role: 'system', text: sys }, { role: 'user', text: usr, images: screenshots.map(s => s.data) }],
      { 
        temperature: 0.1, 
        maxTokens: 3000, 
        signal,
        model: config.mcqModel
      }
    );
    return this.parseResponse(resp);
  }

  private async solveFromInfo(info: ProblemInfo, signal?: AbortSignal): Promise<MCQResultData> {
    const q = info.problem_statement || 'Unknown Question';
    const options = info.options || [];
    const opts = options.map((o: string, i: number) => `${String.fromCharCode(65+i)}) ${o}`).join('\n');
    const config = configHelper.loadConfig();
    const resp = await this.providerManager.chatCompletion(
      `Solve this MCQ:\nQuestion: ${q}\nOptions:\n${opts}\nRespond as JSON:\n${this.JSON_SCHEMA}`,
      { 
        systemPrompt: 'Expert MCQ solver. JSON only.', 
        temperature: 0.1, 
        maxTokens: 3000, 
        signal,
        model: config.mcqModel
      }
    );
    return this.parseResponse(resp);
  }

  private async solveFromText(text: string, signal?: AbortSignal): Promise<MCQResultData> {
    const resp = await this.providerManager.chatCompletion(
      `Solve this MCQ:\n${text}\nRespond as JSON:\n${this.JSON_SCHEMA}`,
      { systemPrompt: 'Expert MCQ solver. JSON only.', temperature: 0.1, maxTokens: 3000, signal }
    );
    return this.parseResponse(resp);
  }

  private parseResponse(text: string): MCQResultData {
    interface RawMCQ {
      question?: string;
      options?: string[];
      selectedAnswer?: string;
      selected_answer?: string;
      selectedIndex?: number;
      selected_index?: number;
      confidence?: number;
      reasoning?: string;
      explanation?: string;
      relatedConcepts?: string[];
      related_concepts?: string[];
    }
    let p: RawMCQ;
    try { 
      p = ProviderManager.parseJSONResponse(text) as RawMCQ; 
    } catch {
      p = { question: 'Extracted from screenshot', options: [], selectedAnswer: '', selectedIndex: 0,
            confidence: 0.5, reasoning: text.substring(0, 500), explanation: 'See reasoning.', relatedConcepts: [] };
    }
    const r: MCQResultData = {
      question: p.question || 'Unknown',
      options: Array.isArray(p.options) ? p.options : [],
      selectedAnswer: p.selectedAnswer || p.selected_answer || '',
      selectedIndex: typeof p.selectedIndex === 'number' ? p.selectedIndex : (typeof p.selected_index === 'number' ? p.selected_index : 0),
      confidence: typeof p.confidence === 'number' ? Math.min(1, Math.max(0, p.confidence)) : 0.7,
      reasoning: 'Reasoning disabled to save tokens.',
      explanation: p.explanation || 'No explanation provided.',
      relatedConcepts: [],
    };
    if (r.options.length > 0 && r.selectedIndex < r.options.length && !r.selectedAnswer) {
      r.selectedAnswer = r.options[r.selectedIndex];
    }
    return r;
  }
}
