import type { Language } from './languages'
import type { ProjectFields, ProjectText } from './wires'

export function localizedProject(project: ProjectFields, language: Language): ProjectText & { lang?: Language } {
  const translation = project.translations?.[language]
  if (translation) return { ...translation, lang: language }
  const { title, summary, description, lang } = project
  return { title, summary, description, lang }
}
