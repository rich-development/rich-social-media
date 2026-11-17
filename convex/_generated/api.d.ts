/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as channels from "../channels.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as library from "../library.js";
import type * as media from "../media.js";
import type * as posts from "../posts.js";
import type * as publisher from "../publisher.js";
import type * as users from "../users.js";
import type * as workspaces from "../workspaces.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  channels: typeof channels;
  crons: typeof crons;
  http: typeof http;
  library: typeof library;
  media: typeof media;
  posts: typeof posts;
  publisher: typeof publisher;
  users: typeof users;
  workspaces: typeof workspaces;
}>;

export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {};
