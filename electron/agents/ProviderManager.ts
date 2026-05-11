// ProviderManager.ts — Unified AI provider interface
import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { configHelper } from '../ConfigHelper';
import { CompletionOptions, VisionMessage } from './types';

export class ProviderManager {
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private googleClient: GoogleGenerativeAI | null = null;
  private apiKey: string | null = null;

  constructor() {
    this.initializeClients();
    configHelper.on('config-updated', () => {
      this.initializeClients();
    });
  }

  private initializeClients(): void {
    try {
      const config = configHelper.loadConfig();
      this.openaiClient = null;
      this.anthropicClient = null;
      this.googleClient = null;
      this.apiKey = null;

      if (!config.apiKey) {
        console.warn('[ProviderManager] No API key configured');
        return;
      }

      switch (config.apiProvider) {
        case 'openai':
          this.openaiClient = new OpenAI({ apiKey: config.apiKey, timeout: 60000, maxRetries: 2 });
          console.log('[ProviderManager] OpenAI client initialized');
          break;

        case 'gemini':
          this.apiKey = config.apiKey;
          this.googleClient = new GoogleGenerativeAI(config.apiKey);
          console.log('[ProviderManager] Google Gemini client initialized');
          break;

        case 'anthropic':
          this.anthropicClient = new Anthropic({ apiKey: config.apiKey, timeout: 60000, maxRetries: 2 });
          console.log('[ProviderManager] Anthropic client initialized');
          break;

        default:
          console.warn(`[ProviderManager] Unknown provider: ${config.apiProvider}`);
      }
    } catch (error) {
      console.error('[ProviderManager] Failed to initialize:', error);
    }
  }

  getProvider(): 'openai' | 'gemini' | 'anthropic' {
    const config = configHelper.loadConfig();
    return config.apiProvider;
  }

  isReady(): boolean {
    const provider = this.getProvider();
    switch (provider) {
      case 'openai': return !!this.openaiClient;
      case 'gemini': return !!this.googleClient;
      case 'anthropic': return !!this.anthropicClient;
      default: return false;
    }
  }

  private ensureReady(): void {
    if (!this.isReady()) this.initializeClients();
  }

  async chatCompletion(userPrompt: string, options: CompletionOptions = {}): Promise<string> {
    this.ensureReady();
    const provider = this.getProvider();
    const config = configHelper.loadConfig();
    const {
      model,
      maxTokens = 4000,
      temperature = 0.2,
      systemPrompt = 'You are a helpful AI assistant.',
    } = options;

    switch (provider) {
      case 'openai': {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');
        const response = await this.openaiClient.chat.completions.create({
          model: model || config.solutionModel || 'gpt-4o-mini',
          max_completion_tokens: maxTokens,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        });
        return response.choices[0]?.message?.content || '';
      }

      case 'gemini': {
        if (!this.googleClient) throw new Error('Google client not initialized');
        const modelName = model || config.solutionModel || 'gemini-2.0-flash';
        const geminiModel = this.googleClient.getGenerativeModel({ model: modelName });
        const result = await geminiModel.generateContent(`${systemPrompt}\n\n${userPrompt}`);
        return result.response.text();
      }

      case 'anthropic': {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');
        const response = await this.anthropicClient.messages.create({
          model: model || config.solutionModel || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        const block = response.content[0];
        return block.type === 'text' ? block.text : '';
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async visionCompletion(messages: VisionMessage[], options: CompletionOptions = {}): Promise<string> {
    this.ensureReady();
    const provider = this.getProvider();
    const config = configHelper.loadConfig();
    const { model, maxTokens = 4000, temperature = 0.2 } = options;

    const systemMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role === 'user');
    const promptText = userMsgs.map(m => m.text).join('\n');

    switch (provider) {
      case 'openai': {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');
        const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: 'text', text: promptText },
          ...userMsgs.flatMap(m => (m.images || []).map(img => ({
            type: 'image_url' as const,
            image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` },
          }))),
        ];
        const response = await this.openaiClient.chat.completions.create({
          model: model || config.extractionModel || 'gpt-4o-mini',
          max_completion_tokens: maxTokens,
          temperature,
          messages: [
            ...(systemMsg ? [{ role: 'system' as const, content: systemMsg.text }] : []),
            { role: 'user', content: contentParts },
          ],
        });
        return response.choices[0]?.message?.content || '';
      }

      case 'gemini': {
        if (!this.googleClient) throw new Error('Google client not initialized');
        const modelName = model || config.extractionModel || 'gemini-2.0-flash';
        const geminiModel = this.googleClient.getGenerativeModel({ model: modelName });
        const imageParts = userMsgs.flatMap(m => (m.images || []).map(img => ({
          inlineData: {
            data: img.replace(/^data:image\/\w+;base64,/, ''),
            mimeType: 'image/png' as const,
          },
        })));
        const result = await geminiModel.generateContent([
          ...(systemMsg ? [systemMsg.text] : []),
          promptText,
          ...imageParts,
        ]);
        return result.response.text();
      }

      case 'anthropic': {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');
        const imageBlocks: Anthropic.ImageBlockParam[] = userMsgs.flatMap(m =>
          (m.images || []).map(img => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: img.replace(/^data:image\/\w+;base64,/, ''),
            },
          }))
        );
        const response = await this.anthropicClient.messages.create({
          model: model || config.extractionModel || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          ...(systemMsg ? { system: systemMsg.text } : {}),
          messages: [{
            role: 'user',
            content: [...imageBlocks, { type: 'text' as const, text: promptText }],
          }],
        });
        const block = response.content[0];
        return block.type === 'text' ? block.text : '';
      }

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  static parseJSONResponse(responseText: string): unknown {
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }

  async safeCall<T>(fn: () => Promise<T>): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error: unknown) {
      const provider = this.getProvider();
      const err = error as { message?: string; status?: number; response?: { status: number } };
      let errorMessage = err.message || 'Unknown error';

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
