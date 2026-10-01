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
export { kindForStatus, type MapErrorContext, mapModelError, retryAfterMs } from "./map-model-error.ts";
export {
  createModelClient,
  DEFAULT_MODEL_TIMEOUT_MS,
  type ModelCallResult,
  type ModelClient,
  type ModelClientOptions,
  type ModelImage,
  type ModelRequest,
  type StructuredRequest,
  toModelUsage,
} from "./model-client.ts";
export { FALLBACK_KINDS, type ModelAttempt, type ModelError, ModelErrorKind } from "./model-error.ts";
export { createModelPlanner, plannerErrorFromModel } from "./model-planner.ts";
export { formatModelRef, type ModelRef, parseModelRef } from "./model-ref.ts";
export {
  type CommandOutput,
  formatModelsTable,
  formatTokens,
  type KeyStatus,
  type ModelsListEntry,
  type ModelsListOptions,
  modelsListCommand,
} from "./models-list-command.ts";
export { createOpenAIProvider, type OpenAIProviderOptions } from "./providers/openai-provider.ts";
export {
  createProviderRegistry,
  IMPLEMENTED_PROVIDER_KINDS,
  type ModelProvider,
  type ProviderCallOptions,
  type ProviderKind,
  type ProviderRegistry,
  type SdkLanguageModel,
} from "./providers/provider-registry.ts";
export {
  type BindingError,
  compatibleRoles,
  DEFAULT_ROLE_BINDINGS,
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
