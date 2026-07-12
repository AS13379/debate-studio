/** Domain-only type draft. Keep this file free of Electron, React and provider SDK types. */

export type ProtocolType =
  | 'mock' | 'openai-chat' | 'openai-responses' | 'gemini-native'
  | 'dashscope-native' | 'anthropic-messages' | 'mimo-native' | 'custom-native';

export interface ProviderPreset { id: string; name: string; defaultBaseUrl?: string; recommendedProtocols: ProtocolType[]; modelList?: { path: string; method: 'GET' | 'POST' }; consoleUrl?: string; capabilityNotes?: string; }
export interface ProviderConnection { id: string; presetId?: string; name: string; baseUrl: string; protocol: ProtocolType; credentialRef?: string; createdAt: string; }
export interface ModelCapabilities { textInput: boolean; imageInput: boolean; documentInput: boolean; audioInput: boolean; videoInput: boolean; streaming: boolean; reasoning: boolean; toolCalling: boolean; webSearch: boolean; structuredOutput: boolean; contextWindow?: number; maxOutputTokens?: number; }
export interface ModelProfile { id: string; connectionId: string; modelId: string; alias?: string; protocol: ProtocolType; capabilities: ModelCapabilities; }

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; assetId: string; mimeType: string; dataUrl?: string; localPath?: string };
export interface UnifiedRequest { requestId: string; model: ModelProfile; system?: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ContentPart[] }>; stream: boolean; signal: AbortSignal; }
export interface UnifiedResponse { providerRequestId?: string; content: ContentPart[]; usage?: TokenUsage; raw?: unknown; }
export type UnifiedStreamEvent = { type: 'text-delta'; text: string } | { type: 'usage'; usage: TokenUsage } | { type: 'completed'; response: UnifiedResponse } | { type: 'error'; error: NormalizedError };
export interface ModelAdapter { protocol: ProtocolType; validate(request: UnifiedRequest): NormalizedError | undefined; stream(request: UnifiedRequest): AsyncIterable<UnifiedStreamEvent>; }

export type ErrorKind = 'invalid_api_key' | 'insufficient_balance' | 'rate_limited' | 'model_not_found' | 'unsupported_protocol_feature' | 'unsupported_asset' | 'context_too_long' | 'content_rejected' | 'network' | 'timeout' | 'stream_interrupted' | 'empty_response' | 'invalid_response' | 'local_file' | 'search' | 'web_access' | 'database' | 'unknown';
export interface NormalizedError { kind: ErrorKind; titleZh: string; messageZh: string; rawCode?: string; retryable: boolean; suggestedActions: string[]; technicalDetails?: string; }
export interface TokenUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedCost?: number; costIsEstimated?: boolean; }

export type DebateStage = 'validating' | 'moderating' | 'public_pool' | 'affirmative_planning' | 'negative_planning' | 'affirmative_research' | 'negative_research' | 'argument_drafting' | 'affirmative_opening' | 'negative_opening' | 'cross_examination' | 'rebuttal' | 'free_debate' | 'negative_closing' | 'affirmative_closing' | 'adjudication';
export type SessionStatus = 'draft' | 'running' | 'paused' | 'waiting_retry' | 'stopped' | 'completed';
export type ParticipantRole = 'affirmative' | 'negative' | 'moderator' | 'judge' | 'user';
export type TurnStatus = 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'skipped';
export interface DebateParticipant { id: string; role: ParticipantRole; modelProfileId?: string; displayName: string; }
export interface DebateTurn { id: string; sessionId: string; stage: DebateStage; participantId: string; status: TurnStatus; retryOfTurnId?: string; promptSnapshotId?: string; outputText: string; usage?: TokenUsage; startedAt?: string; endedAt?: string; error?: NormalizedError; }
export interface DebateState { sessionId: string; status: SessionStatus; currentStage?: DebateStage; currentTurnId?: string; remainingFreeDebateRounds: number; }
export type DebateCommand = { type: 'START' } | { type: 'PAUSE' } | { type: 'RESUME' } | { type: 'STOP' } | { type: 'RETRY_TURN'; turnId: string } | { type: 'SKIP_STAGE'; reason?: string } | { type: 'FORCE_NEXT_STAGE'; reason: string } | { type: 'FORCE_SUMMARY'; reason: string } | { type: 'ASK_PARTICIPANT'; target: ParticipantRole | 'both'; question: string } | { type: 'SUBMIT_EVIDENCE'; assetId: string; visibility: Visibility };
export interface DebateEvent { id: string; sessionId: string; turnId?: string; type: string; payload: unknown; createdAt: string; }

export type Visibility = 'public' | 'affirmative_private' | 'negative_private' | 'moderator_private';
export interface PublicResourcePool { topicDefinition: string; scope: string; directions: string[]; starterSources: string[]; excludedIssues: string[]; moderatorNotes: string; }
export interface ResearchSession { id: string; debateSessionId: string; ownerParticipantId: string; visibility: Visibility; }
export interface ResearchGoal { id: string; researchSessionId: string; text: string; status: 'planned' | 'active' | 'completed'; }
export interface SearchQuery { id: string; researchSessionId: string; query: string; createdAt: string; }
export interface ResearchSource { id: string; researchSessionId: string; title: string; url?: string; domain?: string; publishedAt?: string; fetchedAt?: string; summary?: string; }
export interface ResearchAsset { id: string; ownerParticipantId?: string; visibility: Visibility; kind: 'text' | 'webpage' | 'image' | 'pdf' | 'audio' | 'video'; localPath?: string; url?: string; mimeType: string; title: string; sourceName?: string; sourceDate?: string; capturedAt: string; isOriginal: boolean; transformations: AssetTransformation[]; }
export interface AssetTransformation { type: 'ocr' | 'text-extraction' | 'transcription' | 'keyframes' | 'vision-description'; status: 'pending' | 'completed' | 'failed'; createdAt: string; detail?: string; }
export interface ResearchNote { id: string; researchSessionId: string; assetId?: string; text: string; }
export interface SourceEvaluation { id: string; sourceId: string; credibility: 'low' | 'medium' | 'high'; rationale: string; }
export interface ProvisionalClaim { id: string; researchSessionId: string; text: string; supportingSourceIds: string[]; }
export interface ResearchSummary { id: string; researchSessionId: string; content: string; createdAt: string; }
export type EvidenceStatus = 'unverified' | 'supported' | 'disputed' | 'outdated' | 'inaccessible' | 'misleading' | 'rejected';
export interface EvidenceRecord { id: string; publicCode: string; assetId?: string; sourceId?: string; submittedByParticipantId: string; status: EvidenceStatus; statusNote?: string; }
export interface ContextSnapshot { id: string; sessionId: string; confirmedFacts: string[]; disputedFacts: string[]; affirmativeClaims: string[]; negativeClaims: string[]; concessions: string[]; unansweredQuestions: string[]; evidenceIds: string[]; currentDisputes: string[]; possibleContradictions: string[]; recentTurnIds: string[]; createdAt: string; }

export interface SearchTool { search(input: { sessionId: string; query: string; signal: AbortSignal }): Promise<Array<{ title: string; url: string; summary: string; domain: string; publishedAt?: string; fetchedAt: string }>>; }
