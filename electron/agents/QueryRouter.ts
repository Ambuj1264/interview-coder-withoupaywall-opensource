// QueryRouter.ts — Classifies incoming queries and routes to appropriate agents

import { ClassifiedQuery, QueryType } from './types';
import { ProviderManager } from './ProviderManager';

/**
 * QueryRouter uses a combination of lightweight heuristics and AI vision
 * to classify incoming queries and determine which agent(s) should handle them.
 */
export class QueryRouter {
  private providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }

  /**
   * Classifies a query based on screenshots and/or text.
   * Uses heuristics first for speed, falls back to AI classification.
   */
  async classifyQuery(
    screenshots?: Array<{ data: string }>,
    textQuery?: string,
    signal?: AbortSignal
  ): Promise<ClassifiedQuery> {
    // Step 1: Try fast heuristic classification from text
    if (textQuery) {
      const heuristicResult = this.heuristicClassify(textQuery);
      if (heuristicResult.confidence >= 0.8) {
        console.log(`[QueryRouter] Heuristic classification: ${heuristicResult.primaryType} (${heuristicResult.confidence})`);
        return heuristicResult;
      }
    }

    // Step 2: Use AI vision classification for screenshots
    if (screenshots?.length) {
      try {
        return await this.aiClassify(screenshots, textQuery, signal);
      } catch (error: unknown) {
        console.warn('[QueryRouter] AI classification failed, using fallback:', error);
      }
    }

    // Step 3: Default fallback
    return {
      primaryType: 'code_generation',
      secondaryTypes: [],
      confidence: 0.5,
      reasoning: 'Default classification — unable to determine query type.',
    };
  }

  /**
   * Fast regex/keyword-based classification for text queries.
   */
  private heuristicClassify(text: string): ClassifiedQuery {
    const lower = text.toLowerCase();

    // MCQ indicators
    const mcqPatterns = [
      /\b(?:which|what|choose|select|pick)\b.*\b(?:option|answer|correct|following)\b/i,
      /\b[a-d]\)\s/i,
      /\b(?:option\s+[a-d])\b/i,
      /\bmcq\b/i,
      /\bmultiple[\s-]choice\b/i,
    ];
    const mcqScore = mcqPatterns.reduce((s, p) => s + (p.test(text) ? 0.25 : 0), 0);

    // Explanation indicators
    const explainPatterns = [
      /\b(?:explain|what\s+is|how\s+does|why\s+does|describe|tell\s+me\s+about)\b/i,
      /\b(?:concept|theory|meaning|definition)\b/i,
      /\b(?:step[\s-]by[\s-]step|walk\s+through|breakdown)\b/i,
    ];
    const explainScore = explainPatterns.reduce((s, p) => s + (p.test(text) ? 0.3 : 0), 0);

    // Debug indicators
    const debugPatterns = [
      /\b(?:debug|fix|error|bug|wrong|incorrect|fail|issue)\b/i,
      /\b(?:not\s+working|broken|crash|exception)\b/i,
    ];
    const debugScore = debugPatterns.reduce((s, p) => s + (p.test(text) ? 0.35 : 0), 0);

    // Code generation indicators
    const codePatterns = [
      /\b(?:write|code|implement|create|build|solve|program|function|algorithm)\b/i,
      /\b(?:solution|optimize|refactor)\b/i,
    ];
    const codeScore = codePatterns.reduce((s, p) => s + (p.test(text) ? 0.3 : 0), 0);

    // Determine primary type
    const scores: Array<[QueryType, number]> = [
      ['mcq', Math.min(mcqScore, 1)],
      ['explanation', Math.min(explainScore, 1)],
      ['debugging', Math.min(debugScore, 1)],
      ['code_generation', Math.min(codeScore, 1)],
    ];
    scores.sort((a, b) => b[1] - a[1]);

    const [primaryType, primaryScore] = scores[0];
    const secondaryTypes = scores
      .slice(1)
      .filter(([, score]) => score >= 0.3)
      .map(([type]) => type);

    const isMixed = secondaryTypes.length > 0 && primaryScore < 0.7;

    return {
      primaryType: isMixed ? 'mixed' : primaryType,
      secondaryTypes: isMixed ? [primaryType, ...secondaryTypes] : secondaryTypes,
      confidence: Math.min(primaryScore + 0.1, 1),
      reasoning: `Heuristic: top=${primaryType}(${primaryScore.toFixed(2)}), secondary=[${secondaryTypes.join(',')}]`,
    };
  }

  /**
   * Uses AI vision to classify screenshots into query types.
   */
  private async aiClassify(
    screenshots: Array<{ data: string }>,
    textQuery?: string,
    signal?: AbortSignal
  ): Promise<ClassifiedQuery> {
    const sys = 'You are a query classifier. Respond with ONLY valid JSON.';
    const usr = `Classify this screenshot into one of these categories:
- "code_generation": A coding problem to solve (e.g., LeetCode, HackerRank, algorithm challenge)
- "mcq": A multiple-choice question with options (A/B/C/D or 1/2/3/4)
- "debugging": Code with errors, failed test cases, or bug reports
- "explanation": A request to explain a concept, code, or algorithm
- "mixed": Contains multiple types (e.g., solve + explain)

${textQuery ? `User also said: "${textQuery}"` : ''}

Respond as:
{"primaryType":"...","secondaryTypes":[],"confidence":0.9,"reasoning":"brief reason"}`;

    const resp = await this.providerManager.visionCompletion(
      [{ role: 'system', text: sys }, { role: 'user', text: usr, images: screenshots.map(s => s.data) }],
      { temperature: 0.1, maxTokens: 500, signal }
    );

    try {
      interface ClassificationResponse {
        primaryType?: QueryType;
        secondaryTypes?: QueryType[];
        confidence?: number;
        reasoning?: string;
      }
      const parsed = ProviderManager.parseJSONResponse(resp) as ClassificationResponse;
      return {
        primaryType: parsed.primaryType || 'code_generation',
        secondaryTypes: Array.isArray(parsed.secondaryTypes) ? parsed.secondaryTypes : [],
        confidence: parsed.confidence || 0.7,
        reasoning: parsed.reasoning || 'AI classification',
      };
    } catch {
      return {
        primaryType: 'code_generation',
        secondaryTypes: [],
        confidence: 0.5,
        reasoning: 'AI classification failed to parse; defaulting to code_generation.',
      };
    }
  }
}
