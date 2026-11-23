export const languages = ['ja', 'en', 'zh'] as const
export type Language = typeof languages[number]
export const isLanguage = (value: unknown): value is Language => languages.some(language => language === value)
