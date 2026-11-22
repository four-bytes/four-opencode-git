// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 Four Bytes

export interface LayerConfig {
  id: string;
  order: number;
  enabled: boolean;
  ttlMs?: number;
}

export interface LayerContent {
  content: string;
  updatedAt: number;
  source?: string;
}

export interface Layer {
  config: LayerConfig;
  generate(): Promise<LayerContent>;
}
