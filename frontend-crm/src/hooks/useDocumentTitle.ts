import { useEffect } from 'react'
import { themeConfig } from '../theme/theme.config'

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | ${themeConfig.brand.name}`
  }, [title])
}
