import type { UserVocabulary } from '../userVocabulary.ts'
import type { LearningState } from '../learningState.ts'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type AppData = { vocabulary: UserVocabulary; learning: LearningState; favorites: number[] }
export type IdentityMap = { nextId: number; localToCloud: Record<number,string> }
export type Cells = Record<string,Json>
export type CloudSnapshot = { revision: number; cells: Cells }
export type Change = { key: string; before: Json; after: Json }
export type OperationKind = 'vocabulary' | 'delete' | 'bulk-delete' | 'restore' | 'clear-user' | 'reset-progress' | 'clear-all' | 'favorite' | 'learned' | 'preferences' | 'start' | 'draft' | 'submit' | 'assess' | 'migration' | 'archive' | 'ai-complete' | 'review-request'
export type ErrorCategory = 'transient' | 'auth' | 'permanent' | 'conflict' | 'storage'
export type Operation = { id: string; protocol?: 2|3|4|5; learningEpoch?:number; kind: OperationKind; at: number; notBefore?:number; undoLabel?:string; changes: Change[]; status: 'pending' | 'processing' | 'failed' | 'conflict'; message?: string; expectedRevision?: number; migrationId?: string; attempted?:boolean; retryCount?:number; lastAttemptAt?:number; nextRetryAt?:number; errorCategory?:ErrorCategory; blockedBy?:string; wirePayload?:Json }
export type SyncCache = { version: 4 | 5 | 6; quarantine?:{value:unknown;reason:string}[]; selections?:{daily?:string;review?:string}; identities: IdentityMap; migrationIdentities?: IdentityMap; base: CloudSnapshot; queue: Operation[]; backups: Operation[]; initialized: boolean; migrationChoice?: 'account' | 'imported' }
export interface CloudTransport { pull(): Promise<CloudSnapshot>; reconcile?(ids:string[]):Promise<{accepted:string[];snapshot:CloudSnapshot}>; compactDrafts?(operations:Operation[]):Promise<{accepted:string[];snapshot:CloudSnapshot}>; push(operation: Operation): Promise<{ conflict: boolean; snapshot: CloudSnapshot; message?: string }> }
export const equal = (a: unknown,b: unknown): boolean => canonical(a) === canonical(b)
function canonical(value: unknown): string { return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])) : Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : value ?? null) }
export const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json
export const newId = () => crypto.randomUUID()
