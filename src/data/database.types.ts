// Schema contract for supabase/migrations. Regenerate from the deployed project as documented.
import type { Json } from './models'
type Owned = { user_id:string; updated_at:string; revision:number }
type Table<Row> = { Row:Row; Insert:Partial<Row>; Update:Partial<Row>; Relationships:[] }
export type Database = { public: { Tables: {
  profiles:Table<{id:string;created_at:string;revision:number}>
  user_vocabulary:Table<Owned & {id:string;english:string;english_alternatives:string[];turkish_meanings:string[];part_of_speech:string|null;example_sentence:string|null;tags:string[];created_at:string|null;deleted_at:string|null}>
  learning_progress:Table<Owned & {id:string;vocabulary_id:string;vocabulary_source:string;favorite:boolean;learned:boolean;needs_review:boolean;times_tested:number;times_known:number;times_missed:number;consecutive_known:number;last_tested_at:string|null;last_known_at:string|null;next_review_at:string|null;english_to_turkish_stats:Json;turkish_to_english_stats:Json}>
  test_sessions:Table<Owned & {id:string;session_type:string;test_direction:string;started_at:string|null;completed_at:string|null;total_questions:number;known_count:number;missed_count:number;accuracy:number;state:Json}>
  test_answers:Table<{id:string;user_id:string;session_id:string;vocabulary_id:string;vocabulary_source:string;direction:string;typed_answer:string;was_correct:boolean;self_assessment_known:boolean;answered_at:string|null;activity_date:string|null;question_index:number;operation_id:string;snapshot:Json}>
  account_records:Table<Owned & {key:string;value:Json}>
  migration_receipts:Table<{user_id:string;id:string;operation_id:string;created_at:string}>
  operation_receipts:Table<{user_id:string;id:string;created_at:string}>
  builtin_overrides:Table<Owned & {vocabulary_id:string;content:Json|null;suppressed:boolean}>
}; Views:Record<string,never>; Functions:{
  kelime_snapshot:{Args:Record<string,never>;Returns:Json}
  kelime_apply:{Args:{p_operation:Json};Returns:Json}
}; Enums:Record<string,never>; CompositeTypes:Record<string,never> } }
