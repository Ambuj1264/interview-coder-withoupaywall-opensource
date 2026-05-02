// DebuggingAgent.ts — Specialized agent for debugging and code improvement
// Refactored from ProcessingHelper.processExtraScreenshotsHelper()

import { BaseAgent } from './BaseAgent';
import { AgentContext, AgentResult, AgentCapability, DebugResultData } from './types';
import { ProviderManager } from './ProviderManager';
import { configHelper } from '../ConfigHelper';

export class DebuggingAgent extends BaseAgent {
  readonly id = 'debugging';
  readonly capability: AgentCapability = {
    id: 'debugging',
    name: 'Debugging Agent',
    description: 'Analyzes code screenshots for bugs, errors, and improvements. Provides structured debug analysis.',
    supportedQueryTypes: ['debugging', 'mixed'],
    priority: 9,
  };

  constructor(providerManager: ProviderManager) {
    super(providerManager);
  }

  canHandle(context: AgentContext): boolean {
    return (
      context.queryType === 'debugging' ||
      context.queryType === 'mixed'
    );
  }

  async execute(context: AgentContext, signal?: AbortSignal): Promise<AgentResult> {
    try {
      const { screenshots, problemInfo, language } = context;

      if (!screenshots?.length) {
        return this.createErrorResult('No screenshots provided for debugging.', 'debugging');
      }

      const systemPrompt = `You are a coding interview assistant helping debug solutions. Analyze screenshots (errors, code, or test cases) and provide concise help.
Your response MUST use these headers (###):
### Issues
- Short bullet points

### Fixes
- Specific code changes

### Explanation
Brief reason why

If you include code, use \`\`\`${language}.`;

      const userPrompt = `I'm solving: "${problemInfo?.problem_statement || 'Unknown problem'}" in ${language}. Help me debug this. Provide a concise analysis of issues and fixes.`;

      const imageDataList = screenshots.map((s) => s.data);
      const config = configHelper.loadConfig();

      const responseText = await this.providerManager.visionCompletion(
        [
          { role: 'system', text: systemPrompt },
          { role: 'user', text: userPrompt, images: imageDataList },
        ],
        { 
          temperature: 0.2, 
          maxTokens: 4000, 
          signal,
          model: config.debuggingModel
        }
      );

      // Extract structured data from the response
      const result = this.parseDebugResponse(responseText);

      return this.createSuccessResult(result, 'debugging', 0.80,
        `Analyzed ${screenshots.length} screenshot(s) for bugs and improvements`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[DebuggingAgent] Error:', error);
      return this.createErrorResult(
        errorMessage || 'Failed to process debug request.',
        'debugging'
      );
    }
  }

  /**
   * Parses the raw debug response into structured DebugResultData.
   */
  private parseDebugResponse(debugContent: string): DebugResultData {
    // Extract code block if present
    let extractedCode = '// Debug mode - see analysis below';
    const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/);
    if (codeMatch?.[1]) {
      extractedCode = codeMatch[1].trim();
    }

    // Format the debug content with proper headers if missing
    let formattedContent = debugContent;
    if (!debugContent.includes('# ') && !debugContent.includes('## ')) {
      formattedContent = debugContent
        .replace(/issues identified|problems found|bugs found/i, '## Issues Identified')
        .replace(/code improvements|improvements|suggested changes/i, '## Code Improvements')
        .replace(/optimizations|performance improvements/i, '## Optimizations')
        .replace(/explanation|detailed analysis/i, '## Explanation');
    }

    // Extract bullet points for thoughts
    const bulletPoints = formattedContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g);
    const thoughts = bulletPoints
      ? bulletPoints
          .map((point) => point.replace(/^[ ]*(?:[-*•]|\d+\.)[ ]+/, '').trim())
          .slice(0, 5)
      : ['Debug analysis based on your screenshots'];

    return {
      code: extractedCode,
      debug_analysis: formattedContent,
      thoughts,
      time_complexity: 'N/A - Debug mode',
      space_complexity: 'N/A - Debug mode',
    };
  }
}
