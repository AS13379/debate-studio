export { AdapterRegistry } from './adapter-registry'
export type {
  AdapterRegistryError,
  AdapterRegistryErrorCode,
  AdapterRegistryResult
} from './adapter-registry'
export { AuthenticatedHttpTransport } from './authenticated-http-transport'
export type { CredentialReferenceResolver } from './authenticated-http-transport'
export { ConnectionTestService } from './connection-test-service'
export type {
  ConnectionTestError,
  ConnectionTestErrorCode,
  ConnectionTestResult,
  ConnectionTestServiceOptions
} from './connection-test-service'
export { FetchHttpTransport } from './fetch-http-transport'
export type { FetchHttpTransportOptions, FetchImplementation } from './fetch-http-transport'
export { HttpTransportError } from './http-transport'
export type {
  HttpTransport,
  HttpTransportErrorCode,
  HttpTransportErrorOptions,
  HttpTransportRequest,
  HttpTransportResponse,
  HttpTransportStreamEvent
} from './http-transport'
export { MockAdapter, MockJudgeAdapter } from './mock-adapter'
export type { MockAdapterOptions } from './mock-adapter'
export { MockHttpTransport } from './mock-http-transport'
export type { MockHttpTransportOptions } from './mock-http-transport'
export { ModelAdapterError } from './model-adapter'
export type {
  ModelAdapter,
  UnifiedError,
  UnifiedMessage,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedRuntimeMetadata,
  UnifiedStreamEvent,
  UnifiedToolCall,
  UnifiedToolDefinition
} from './model-adapter'
export { OpenAIChatAdapter } from './openai-chat-adapter'
export type { OpenAIChatMessage, OpenAIChatRequestBody } from './openai-chat-adapter'
export { presentProviderFailure } from './provider-error-presentation'
export type {
  ProviderFailureCode,
  ProviderFailureInput,
  ProviderFailurePresentation
} from './provider-error-presentation'
