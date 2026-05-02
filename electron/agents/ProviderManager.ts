// ProviderManager.ts — Unified AI provider interface
// Eliminates duplicated provider-specific if/else blocks from ProcessingHelper

import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { configHelper } from '../ConfigHelper';
import { CompletionOptions, VisionMessage } from './types';

// Dynamic imports for ESM modules
let OpenAIAgent: any;
let anthropicQuery: any;
let GoogleGemini: any;
let GoogleAgent: any;

async function loadEsmModules() {
  if (!OpenAIAgent) {
    // @ts-ignore
    const openaiAgents = await new Function('return import("openai-agents")')();
    OpenAIAgent = openaiAgents.OpenAIAgent;
  }
  if (!anthropicQuery) {
    // @ts-ignore
    const anthropicSdk = await new Function('return import("@anthropic-ai/claude-agent-sdk")')();
    anthropicQuery = anthropicSdk.query;
  }
  if (!GoogleGemini) {
    // @ts-ignore
    const googleAdk = await new Function('return import("@google/adk")')();
    GoogleGemini = googleAdk.Gemini;
    GoogleAgent = googleAdk.LlmAgent;
  }
}

/**
 * ProviderManager abstracts away the differences between OpenAI, Gemini, and Anthropic.
 * All agents use this single interface instead of handling providers directly.
 */
export class ProviderManager {
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private apiKey: string | null = null;

  constructor() {
    this.initializeClients();

    // Re-initialize whenever config changes
    configHelper.on('config-updated', () => {
      this.initializeClients();
    });
  }

  /**
   * Initialize or re-initialize AI clients from config.
   */
  private initializeClients(): void {
    try {
      const config = configHelper.loadConfig();

      // Reset all clients
      this.openaiClient = null;
      this.anthropicClient = null;
      this.apiKey = null;

      if (!config.apiKey) {
        console.warn('[ProviderManager] No API key configured');
        return;
      }

      switch (config.apiProvider) {
        case 'openai':
          process.env.OPENAI_API_KEY = config.apiKey;
          this.openaiClient = new OpenAI({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2,
          });
          console.log('[ProviderManager] OpenAI client initialized (Env key set)');
          break;

        case 'gemini':
          process.env.GOOGLE_GENAI_API_KEY = config.apiKey;
          this.apiKey = config.apiKey;
          console.log('[ProviderManager] Google ADK Agent SDK ready (Env key set)');
          break;

        case 'anthropic':
          process.env.ANTHROPIC_API_KEY = config.apiKey;
          this.anthropicClient = new Anthropic({
            apiKey: config.apiKey,
            timeout: 60000,
            maxRetries: 2,
          });
          console.log('[ProviderManager] Anthropic client initialized (Env key set)');
          break;

        default:
          console.warn(`[ProviderManager] Unknown provider: ${config.apiProvider}`);
      }
    } catch (error) {
      console.error('[ProviderManager] Failed to initialize:', error);
    }
  }

  /**
   * Returns the currently active provider name.
   */
  getProvider(): 'openai' | 'gemini' | 'anthropic' {
    const config = configHelper.loadConfig();
    return config.apiProvider;
  }

  /**
   * Returns true if the current provider is properly configured and ready.
   */
  isReady(): boolean {
    const provider = this.getProvider();
    switch (provider) {
      case 'openai': return !!this.openaiClient;
      case 'gemini': return !!this.apiKey;
      case 'anthropic': return !!this.anthropicClient;
      default: return false;
    }
  }

  /**
   * Ensure clients are initialized; re-initialize if not ready.
   */
  private ensureReady(): void {
    if (!this.isReady()) {
      this.initializeClients();
    }
  }

  /**
   * Unified text chat completion across all providers.
   */
  async chatCompletion(
    userPrompt: string,
    options: CompletionOptions = {}
  ): Promise<string> {
    this.ensureReady();
    const provider = this.getProvider();
    const config = configHelper.loadConfig();
    const {
      model,
      maxTokens = 4000,
      temperature = 0.2,
      systemPrompt = 'You are a helpful AI assistant.',
      signal,
    } = options;

    switch (provider) {
      case 'openai': {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');
        
        await loadEsmModules();
        const agent = new OpenAIAgent({
          model: (model || config.solutionModel || 'gpt-5.4') as any,
          system_instruction: systemPrompt,
        }, { apiKey: config.apiKey });

        const result = await agent.createChatCompletion(userPrompt);
        return result.choices[0] || '';
      }

      case 'gemini': {
        if (!this.apiKey) throw new Error('Google API key not configured');
        await loadEsmModules();
        const modelName = model || config.solutionModel || 'gemini-3.1-pro';
        
        const geminiModel = new GoogleGemini({
          apiKey: this.apiKey,
          model: modelName,
        });

        const agent = new GoogleAgent({
          name: 'SolutionAgent',
          model: geminiModel,
          instruction: systemPrompt,
        });

        // Use a simple prompt for now
        let finalResponse = '';
        const stream = agent.runLive(userPrompt as any);
        for await (const event of stream as any) {
          if (event.type === 'content' && event.content) {
            finalResponse += event.content;
          }
        }
        
        return finalResponse;
      }

      case 'anthropic': {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');
        await loadEsmModules();
        
        const stream = anthropicQuery({
          prompt: `${systemPrompt}\n\n${userPrompt}`,
          options: {
            allowedTools: [], // One-off completion for now
          }
        });

        let finalResponse = '';
        for await (const message of stream) {
          if ((message as any).type === 'agentMessage') {
            finalResponse += (message as any).message;
          }
        }

        return finalResponse;
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Unified vision completion (text + images) across all providers.
   */
  async visionCompletion(
    messages: VisionMessage[],
    options: CompletionOptions = {}
  ): Promise<string> {
    this.ensureReady();
    const provider = this.getProvider();
    const config = configHelper.loadConfig();
    const {
      model,
      maxTokens = 4000,
      temperature = 0.2,
      signal,
    } = options;

    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role === 'user');

    switch (provider) {
      case 'openai': {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');

        await loadEsmModules();
        const agent = new OpenAIAgent({
          model: (model || config.extractionModel || 'gpt-5.4') as any,
          system_instruction: systemMsg?.text || 'You are a vision-capable AI agent.',
        }, { apiKey: config.apiKey });

        // Format content parts for OpenAI Vision (OpenAIAgent wraps this in a 'user' message)
        const contentParts: any[] = [
          { type: 'text', text: userMsgs[0]?.text || '' },
          ...userMsgs.flatMap(m => (m.images || []).map(img => ({
            type: 'image_url',
            image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` }
          })))
        ];

        const result = await agent.createChatCompletion(contentParts);
        return result.choices[0] || '';
      }

      case 'gemini': {
        if (!this.apiKey) throw new Error('Google API key not configured');
        await loadEsmModules();

        const modelName = model || config.extractionModel || 'gemini-3.1-pro';
        const geminiModel = new GoogleGemini({
          apiKey: this.apiKey,
          model: modelName,
        });

        const agent = new GoogleAgent({
          name: 'VisionAgent',
          model: geminiModel,
          instruction: systemMsg?.text || 'You are a vision-capable AI agent.',
        });
        
        const promptText = userMsgs.map(m => m.text).join('\n');
        
        // Format parts for Gemini Vision
        const parts = [
          { text: promptText },
          ...userMsgs.flatMap(m => (m.images || []).map(img => ({
            inlineData: {
              data: img.replace(/^data:image\/\w+;base64,/, ''),
              mimeType: 'image/png'
            }
          })))
        ];

        let finalResponse = '';
        const stream = agent.runLive({ role: 'user', parts } as any);
        for await (const event of stream as any) {
          if (event.type === 'content' && event.content) {
            finalResponse += event.content;
          }
        }
        
        return finalResponse;
      }

      case 'anthropic': {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');
        await loadEsmModules();

        const promptText = userMsgs.map(m => m.text).join('\n');
        const stream = anthropicQuery({
          prompt: promptText,
          options: {
            allowedTools: [],
          }
        });
        let finalResponse = '';
        for await (const message of stream) {
          if ((message as any).type === 'agentMessage') {
            finalResponse += (message as any).message;
          }
        }
        return finalResponse;
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Parses a potentially markdown-wrapped JSON response from any provider.
   */
  static parseJSONResponse(responseText: string): unknown {
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Wraps an API call with standardized error handling.
   * Returns { success, data?, error? }.
   */
  async safeCall<T>(
    fn: () => Promise<T>
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error: unknown) {
      const provider = this.getProvider();
      const err = error as { 
        message?: string; 
        status?: number; 
        response?: { status: number } 
      };
      let errorMessage = err.message || 'Unknown error';

      // Map common HTTP status codes to user-friendly messages
      if (err?.response?.status === 401 || err?.status === 401) {
        errorMessage = `Invalid ${provider} API key. Please check your settings.`;
      } else if (err?.response?.status === 429 || err?.status === 429) {
        errorMessage = `${provider} API rate limit exceeded. Please wait before trying again.`;
      } else if (err?.response?.status === 413 || err?.status === 413) {
        errorMessage = `Input too large for ${provider}. Try with fewer screenshots.`;
      } else if (err?.response?.status === 500 || err?.status === 500) {
        errorMessage = `${provider} server error. Please try again later.`;
      }

      console.error(`[ProviderManager] ${provider} error:`, error);
      return { success: false, error: errorMessage };
    }
  }
}
