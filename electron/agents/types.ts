// types.ts — Core type definitions for the agentic AI system

/**
 * The classification of an incoming query.
 */
export type QueryType = 'code_generation' | 'debugging' | 'mcq' | 'explanation' | 'mixed';

/**
 * Shared context passed into every agent invocation.
 */
export interface AgentContext {
  queryType: QueryType;
  language: string;
  screenshots?: Array<{ path: string; data: string }>;
  problemInfo?: ProblemInfo;
  previousSolution?: string;
  conversationHistory?: AgentMessage[];
  textQuery?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Extracted problem information from screenshots.
 */
export interface ProblemInfo {
  problem_statement: string;
  constraints?: string;
  example_input?: string;
  example_output?: string;
  options?: string[];        // For MCQ questions
  question_type?: 'coding' | 'mcq' | 'explanation' | 'mixed';
}

/**
 * A single message in the conversation history.
 */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  agentId?: string;
}

/**
 * The unified result structure returned by any agent.
 */
export interface AgentResult {
  success: boolean;
  agentId: string;
  queryType: QueryType;
  data?: unknown;
  error?: string;
  confidence: number;        // 0–1 confidence score
  reasoning?: string;        // Explanation of approach taken
  verified: boolean;         // Whether the reasoning layer verified this
  metadata?: Record<string, unknown>;
}

/**
 * Describes what a given agent can do.
 */
export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  supportedQueryTypes: QueryType[];
  priority: number;          // Higher = preferred when multiple agents match
}

/**
 * Result of query classification by the QueryRouter.
 */
export interface ClassifiedQuery {
  primaryType: QueryType;
  secondaryTypes: QueryType[];
  confidence: number;
  reasoning: string;
}

/**
 * Progress updates emitted during agent processing.
 */
export interface ProcessingStatus {
  message: string;
  progress: number;          // 0–100
  agentId?: string;
  phase?: string;
}

/**
 * MCQ-specific result payload.
 */
export interface MCQResultData {
  question: string;
  options: string[];
  selectedAnswer: string;
  selectedIndex: number;
  confidence: number;
  reasoning: string;
  explanation: string;
  relatedConcepts: string[];
}

/**
 * Code generation result payload.
 */
export interface CodeResultData {
  code: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
}

/**
 * Debugging result payload.
 */
export interface DebugResultData {
  code: string;
  debug_analysis: string;
  thoughts: string[];
  time_complexity: string;
  space_complexity: string;
}

/**
 * Explanation result payload.
 */
export interface ExplanationResultData {
  title: string;
  explanation: string;
  keyPoints: string[];
  codeExamples?: string[];
  relatedTopics?: string[];
}

/**
 * Verification result from the ReasoningLayer.
 */
export interface VerificationResult {
  verified: boolean;
  confidence: number;
  issues?: string[];
  suggestions?: string[];
}

/**
 * Consistency check result from the ReasoningLayer.
 */
export interface ConsistencyResult {
  consistent: boolean;
  confidence: number;
  inconsistencies?: string[];
}

/**
 * Options for AI completion calls via the ProviderManager.
 */
export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
}

/**
 * A message structure for vision API calls.
 */
export interface VisionMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  images?: string[];  // base64 image data
}
