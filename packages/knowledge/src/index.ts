// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rami Fara and GhostHand contributors

export const knowledgePackageName = "@ghosthand/knowledge" as const;

export * from "./app-map.ts";
export * from "./induce-recipe.ts";
export * from "./knowledge.ts";
export * from "./knowledge-db.ts";
export * from "./parameterize.ts";
export * from "./recipe-book.ts";
export * from "./recipe-schema.ts";
export * from "./recipe-store.ts";
// Source/PR maps (general-agent-design §2.4).
export {
  type BuildSourceMapOptions,
  buildSourceMap,
  DEFAULT_TESTID_HELPERS,
  type SourceFile,
} from "./source-map/build-source-map.ts";
export { type ChangedSurface, type DiffInput, isAddedTestid, scopeDiff } from "./source-map/diff-scope.ts";
export {
  DEFAULT_INCLUDE,
  type ExtractSourceMapOptions,
  extractSourceMap,
  type SourceMapError,
} from "./source-map/extract-source-map.ts";
export { formatSourceMapSummary } from "./source-map/format-summary.ts";
export {
  type ExecFileFn,
  type GitDiffError,
  type GitDiffOptions,
  type GitDiffText,
  gitChangedSurface,
  readGitDiff,
} from "./source-map/git-diff.ts";
export {
  findSourceElements,
  matchesPattern as matchesTestidPattern,
  routeIndex as sourceRouteIndex,
  type SourceElementQuery,
  testidIndex,
} from "./source-map/lookups.ts";
export { matchRoute as matchSourceRoute, pathOf as urlPathOf, routeScore } from "./source-map/match-route.ts";
export { plannerContext, seedTargetsFor } from "./source-map/planner-hints.ts";
export {
  SourceElement,
  SourceForm,
  SourceFormField,
  SourceMap,
  SourceModule,
  SourceRisk,
  SourceRoute,
  SourceString,
} from "./source-map/source-map-schema.ts";
export { diffOracles, expectedTestidsForRoute, type RoutedPredicate } from "./source-map/source-oracles.ts";
export {
  type DiffHunk,
  type DiffLine,
  type FileDiff,
  parseNameOnly,
  parseUnifiedDiff,
} from "./source-map/unified-diff.ts";
export * from "./trust.ts";
