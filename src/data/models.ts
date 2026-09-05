import type { UserVocabulary } from '../userVocabulary.ts'
import type { LearningState } from '../learningState.ts'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type AppData = { vocabulary: UserVocabulary; learning: LearningState; favorites: number[] }
export type IdentityMap = { nextId: number; localToCloud: Record<number,string> }
export type Cells = Record<string,Json>
export type CloudSnapshot = { revision: number; cells: Cells }
export type Change = { key: string; before: Json; after: Json }
export type OperationKind = 'vocabulary' | 'delete' | 'bulk-delete' | 'restore' | 'clear-user' | 'reset-progress' | 'clear-all' | 'favorite' | 'learned' | 'preferences' | 'start' | 'draft' | 'submit' | 'assess' | 'migration' | 'archive'
export type Operation = { id: string; protocol?: 2|3; kind: OperationKind; at: number; notBefore?:number; undoLabel?:string; changes: Change[]; status: 'pending' | 'conflict'; message?: string; expectedRevision?: number; migrationId?: string }
export type SyncCache = { version: 3; selections?:{daily?:string;review?:string}; identities: IdentityMap; migrationIdentities?: IdentityMap; base: CloudSnapshot; queue: Operation[]; backups: Operation[]; initialized: boolean; migrationChoice?: 'account' | 'imported' }
export interface CloudTransport { pull(): Promise<CloudSnapshot>; push(operation: Operation): Promise<{ conflict: boolean; snapshot: CloudSnapshot; message?: string }> }
export const equal = (a: unknown,b: unknown): boolean => canonical(a) === canonical(b)
function canonical(value: unknown): string { return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])) : Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : value ?? null) }
export const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json
export const newId = () => crypto.randomUUID()
