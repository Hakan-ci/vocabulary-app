export const directions = ['englishToTurkish', 'turkishToEnglish'] as const
export type TestDirection = typeof directions[number]
export type TestMode = TestDirection | 'mixed'
export const modeLabels: Record<TestMode, string> = {
  englishToTurkish: 'English → Turkish', turkishToEnglish: 'Turkish → English', mixed: 'Mixed',
}
export const isDirection = (value: unknown): value is TestDirection => directions.some(direction => direction === value)
export const isTestMode = (value: unknown): value is TestMode => value === 'mixed' || isDirection(value)
export type DirectionalStatistics = {
  timesTested: number
  timesKnown: number
  timesMissed: number
  consecutiveKnown: number
  lastTestedAt: number | null
  lastKnownAt: number | null
}
export type DifficultyLevel = 'New' | 'Easy' | 'Medium' | 'Hard' | 'Very Hard'
export type Difficulty = { score: number; level: DifficultyLevel }
