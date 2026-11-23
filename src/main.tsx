import { render } from 'preact'
import './styles/tokens.css'
import '@tik-choco/mistvault/ui.css'
import './styles/markdown.css'
import './styles/app.css'
import { App } from './app'

const root = document.getElementById('app')
if (root) render(<App />, root)
