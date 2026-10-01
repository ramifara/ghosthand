// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const modelsPackageName = "@ghosthand/models" as const;

export {
  AGGREGATOR_PROVIDERS,
  type BuildSnapshotOptions,
  buildModelsSnapshot,
  DEFAULT_SNAPSHOT_SELECTION,
  isChatModel,
  MODELS_DEV_ATTRIBUTION,
  type SnapshotSelection,
  trimModel,
} from "./catalog/build-snapshot.ts";
export type { CatalogError } from "./catalog/catalog-error.ts";
export {
  BUILTIN_GHOSTHAND_FIELDS,
  type GhostHandFields,
  GroundingConvention,
  NativeComputerTool,
} from "./catalog/ghosthand-fields.ts";
export {
  bundledSnapshot,
  type CatalogModel,
  CatalogOverrides,
  type CatalogProvider,
  type CatalogSource,
  type CreateCatalogOptions,
  createModelCatalog,
  type ModelCatalog,
  ModelOverride,
  type ModelPricing,
} from "./catalog/model-catalog.ts";
export {
  ModelsDevApi,
  ModelsDevModel,
  ModelsDevProvider,
  ModelsSnapshot,
  SnapshotModel,
  SnapshotProvider,
} from "./catalog/snapshot-schema.ts";
export {
  CHARS_PER_TOKEN,
  costForUsage,
  estimateInputCost,
  ModelCostMeter,
  type ModelCostMeterOptions,
  type ModelUsage,
  TOKENS_PER_IMAGE,
  ZERO_USAGE,
} from "./cost-meter.ts";
export {
  CHOICE_LABELS,
  choiceConfidence,
  createLogprobDecisionProvider,
  DEFAULT_LOGPROB_TIMEOUT_MS,
  LOGPROB_MAX_OPTIONS,
  type LogprobDecisionProviderOptions,
  labelProbabilities,
  questionPrompt,
} from "./decision/logprob-decision-provider.ts";
export { kindForStatus, type MapErrorContext, mapModelError, retryAfterMs } from "./map-model-error.ts";
export {
  type CallPlan,
  type CallTarget,
  createModelClient,
  DEFAULT_MODEL_TIMEOUT_MS,
  type ModelCallResult,
  type ModelClient,
  type ModelClientOptions,
  type ModelImage,
  type ModelRequest,
  type PlanRead,
  type StructuredRequest,
  type ToolCallOutput,
  toModelUsage,
} from "./model-client.ts";
export { FALLBACK_KINDS, type ModelAttempt, type ModelError, ModelErrorKind } from "./model-error.ts";
export { createModelPlanner, plannerErrorFromModel } from "./model-planner.ts";
export { formatModelRef, type ModelRef, parseModelRef } from "./model-ref.ts";
export * from "./model-writer.ts";
export {
  type CommandOutput,
  formatModelsTable,
  formatTokens,
  type KeyStatus,
  type ModelsListEntry,
  type ModelsListOptions,
  modelsListCommand,
} from "./models-list-command.ts";
export {
  ANTHROPIC_COMPUTER_TOOL_NAME,
  type AnthropicProviderOptions,
  createAnthropicProvider,
} from "./providers/anthropic-provider.ts";
export { createGoogleProvider, type GoogleProviderOptions } from "./providers/google-provider.ts";
export {
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  DEFAULT_LOCAL_SERVERS,
  type DiscoveredServer,
  type DiscoverOptions,
  discoverLocalModels,
  LOCAL_MODEL_DEFAULTS,
  type LocalServer,
  localModelOverrides,
} from "./providers/local-discovery.ts";
export {
  adaptSiwcRequestBody,
  collectSiwcStream,
  createOpenAIChatGptProvider,
  createSiwcFetch,
  type OpenAIChatGptProviderOptions,
  parseSseEvents,
  SIWC_API_BASE,
  SIWC_REJECTED_PARAMS,
  SIWC_USAGE_LIMIT_CODE,
} from "./providers/openai-chatgpt-provider.ts";
export {
  costFromMetadata,
  createOpenAICompatibleProvider,
  createOpenRouterProvider,
  extractChatMetadata,
  GHOSTHAND_METADATA_KEY,
  logprobsFromMetadata,
  OPENROUTER_BASE_URL,
  type OpenAICompatibleProviderOptions,
  type OpenRouterProviderOptions,
  type TokenLogprobs,
} from "./providers/openai-compatible-provider.ts";
export {
  createOpenAIProvider,
  OPENAI_COMPUTER_TOOL_NAME,
  type OpenAIProviderOptions,
} from "./providers/openai-provider.ts";
export {
  type ComputerDisplay,
  createProviderRegistry,
  IMPLEMENTED_PROVIDER_KINDS,
  type ModelProvider,
  type NativeComputerToolSet,
  type ProviderCallOptions,
  type ProviderKind,
  type ProviderRegistry,
  type SdkLanguageModel,
} from "./providers/provider-registry.ts";
export {
  type BindingError,
  compatibleRoles,
  DEFAULT_ROLE_BINDINGS,
  defaultRoleBindingsFor,
  PROVIDER_ROLE_MODELS,
  parseRoleBindings,
  ReasoningEffort,
  type RequirementGap,
  type RequirementOptions,
  type ResolvedChain,
  RoleBinding,
  RoleBindings,
  requirementGaps,
  resolveRoleChain,
  validateBindings,
  validateModelForRole,
} from "./role-bindings.ts";
export {
  CHAT_ROLES,
  type ChatRole,
  EXTERNAL_ROLES,
  isChatRole,
  ModelRole,
  ROLE_BADGES,
  ROLE_REQUIREMENTS,
  type RoleRequirement,
} from "./roles.ts";
export {
  ANTHROPIC_MAX_LONG_EDGE,
  ANTHROPIC_MAX_PIXELS,
  anthropicImageScale,
  type ImageSize,
  toImagePixels,
} from "./vision/grounding-geometry.ts";
export {
  type NativePoint,
  type NativeRead,
  readAnthropicCall,
  readOpenAICall,
} from "./vision/native-grounding.ts";
export {
  createVisionDriver,
  DRIVER_SYSTEM,
  type DriveOutcome,
  type DriveRequest,
  drivePrompt,
  JsonDriveAnswer,
  mapPoints,
  readAnthropicDrive,
  readOpenAIDrive,
  type VisionDriver,
} from "./vision/vision-driver.ts";
export {
  createVisionGrounder,
  GROUNDING_GUARD,
  type GroundingMethod,
  type GroundOutcome,
  type GroundRequest,
  type GroundResult,
  type GroundScreenshot,
  JsonGroundingAnswer,
  jsonGroundingPrompt,
  nativeGroundingPrompt,
  type VisionGrounder,
  type VisionGrounderOptions,
} from "./vision/vision-grounder.ts";
