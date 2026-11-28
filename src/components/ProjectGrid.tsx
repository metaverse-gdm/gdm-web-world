import { Component, createRef } from 'preact'
import { createImpressionObserver } from '../lib/impressions'
import type { GroupView } from '../lib/catalogStore'
import type { ProjectRecord, StatsMetric } from '../lib/wires'
import { animateCards, MAX_FLIP_ITEMS, measureCards, reducedMotionQuery } from '../styles/motion'
import { ProjectCard } from './ProjectCard'

interface GridProps {
  projects: ProjectRecord[]
  order: string
  label: string
  displayNameFor(did: string): string | undefined
  avatarFor?(did: string): string | undefined
  groupFor(project: ProjectRecord): GroupView | undefined
  trackProject(id: string, metric: StatsMetric): void
  impressionsActive: boolean
}

export class ProjectGrid extends Component<GridProps> {
  private grid = createRef<HTMLUListElement>()
  private motion = window.matchMedia(reducedMotionQuery)
  private animations: Animation[] = []
  private hasShown = false
  private impressions?: ReturnType<typeof createImpressionObserver>

  private watchImpressions() {
    this.impressions?.setTargets(this.props.impressionsActive ? this.grid.current!.children : [])
  }

  private cancelAnimations = () => {
    for (const animation of this.animations) animation.cancel()
    this.animations = []
  }

  private onMotionChange = () => {
    if (this.motion.matches) this.cancelAnimations()
  }

  componentDidMount() {
    this.motion.addEventListener('change', this.onMotionChange)
    this.play(new Map())
    this.impressions = createImpressionObserver(target => {
      const id = (target as HTMLElement).dataset.project
      if (id) this.props.trackProject(id, 'impression')
    })
    this.watchImpressions()
  }

  getSnapshotBeforeUpdate(previous: GridProps) {
    const grid = this.grid.current
    if (!grid || previous.order === this.props.order || this.motion.matches ||
      Math.max(previous.projects.length, this.props.projects.length) > MAX_FLIP_ITEMS) return
    // Include in-flight transforms so a second update starts where the cards are now.
    return measureCards(grid)
  }

  componentDidUpdate(previous: GridProps, _state: unknown, before?: ReturnType<typeof measureCards>) {
    if (previous.order !== this.props.order || previous.impressionsActive !== this.props.impressionsActive) this.watchImpressions()
    if (previous.order === this.props.order) return
    this.cancelAnimations()
    this.play(before)
  }

  componentWillUnmount() {
    this.impressions?.dispose()
    this.motion.removeEventListener('change', this.onMotionChange)
    this.cancelAnimations()
  }

  private play(before?: ReturnType<typeof measureCards>) {
    const grid = this.grid.current
    if (!grid || this.props.projects.length === 0) return
    if (before) this.animations = animateCards(grid, before, !this.hasShown, this.motion.matches)
    this.hasShown = true
  }

  render({ projects, label, displayNameFor, avatarFor, groupFor, trackProject }: GridProps) {
    return <ul class="work-grid" aria-label={label} hidden={!projects.length} ref={this.grid}>
      {projects.map(project => <li key={project.projectId} data-project={project.projectId}>
        <ProjectCard project={project} displayNameFor={displayNameFor} avatarFor={avatarFor} group={groupFor(project)} onOpen={() => trackProject(project.projectId, 'click')} />
      </li>)}
    </ul>
  }
}
